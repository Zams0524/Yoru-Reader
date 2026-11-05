import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlignLeft, ChevronDown, ChevronUp, FileText, Link2, Loader2, Pause, Play, RotateCcw, RotateCw, Search, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import type { AudiobookItem, AudiobookshelfPlaybackSession } from '../../types/integrations';
import {
  AUDIOBOOK_AUTO_MATCH_SCORE,
  audiobookSearchQuery,
  chapterAt,
  closeAudiobookSession,
  findAudiobookMatches,
  getAudiobookLink,
  locateTrack,
  searchAudiobooks,
  setAudiobookLink,
  startAudiobookPlayback,
  syncAudiobookSession,
  updateAudiobookProgress,
} from '../../utils/audiobookshelfService';
import { describeServerError } from '../../utils/serverHttp';
import { finishOpenTiming, markOpenTiming, startOpenTiming } from '../../utils/openTiming';
import { db } from '../../utils/db';

interface Props {
  book: { id: string; title: string; author?: string };
  lang: string;
  accent: string;
  onClose: () => void;
  /** Sits higher while the page bar is shown at the bottom (like the read-aloud bar). */
  raised?: boolean;
  /** Slides away a few seconds after the last touch while playing with the reader's bars hidden. */
  autoHide?: boolean;
  /** CSS px from the bottom of the screen up to the top of the player, now and in its low place. */
  onReach?: (reach: { current: number; low: number }) => void;

  // ── Alineación texto-audio ────────────────────────────────────────────
  // El reproductor no sabe nada del texto: el lector es quien tiene los párrafos. Aquí
  // solo entran y salen segundos, y el lector decide qué hacer con ellos.

  /** La alineación cargada para este libro, si la hay. */
  alignment?: { name: string; notice: string } | null;
  /** El usuario eligió un `.srt`. El lector lo carga y lo guarda. */
  onImportSrt?: (file: File) => void;
  /** Dónde va el audio, en ms. Se llama en cada `timeupdate`. */
  onTimeMs?: (ms: number) => void;
  /** El lector mete aquí su mando para poder saltar a un segundo del audio. */
  seekRef?: React.MutableRefObject<((seconds: number) => void) | null>;
  /** Si el texto debe seguir al audio. Lo decide el usuario. */
  followText?: boolean;
  onFollowTextChange?: (value: boolean) => void;
}

/** Speeds for language learners: a bit slower than normal up to double. */
const AUDIOBOOK_RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'yoru_abs_rate';
const VOLUME_KEY = 'yoru_abs_volume';
const SYNC_INTERVAL_MS = 15_000;
const AUTO_HIDE_MS = 4000;
const RAISE_PX = 92;

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function savedRate(): number {
  const rate = Number(localStorage.getItem(RATE_KEY));
  return AUDIOBOOK_RATES.includes(rate) ? rate : 1;
}

type Phase =
  | { kind: 'matching' }
  | { kind: 'choose'; matches: AudiobookItem[] }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/**
 * Plays the Audiobookshelf audiobook of the book being read. The first time it looks for the
 * audiobook by title (and volume number) and links it to the book; the link is remembered. The
 * listening position goes back to Audiobookshelf every few seconds while playing, on pause and on
 * close, so listening carries on from any device.
 */
export default function AudioSyncPlayer({
  book, lang, accent, onClose, raised = false, autoHide = false, onReach,
  alignment = null, onImportSrt, onTimeMs, seekRef, followText = false, onFollowTextChange,
}: Props) {
  const es = lang === 'es';
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'matching' });
  /** El modo reproductor, a pantalla completa. */
  const [expanded, setExpanded] = useState(false);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(saved) && saved > 0 && saved <= 1 ? saved : 1;
  });
  const [session, setSession] = useState<AudiobookshelfPlaybackSession | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(savedRate);
  const [searchText, setSearchText] = useState('');
  const [hidden, setHidden] = useState(false);
  const [touched, setTouched] = useState(0);

  // What the server has not heard yet.
  const sessionRef = useRef<AudiobookshelfPlaybackSession | null>(null);
  const listenedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const playAfterLoadRef = useRef(false);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !onReach) return;
    const bottom = parseFloat(getComputedStyle(bar).bottom);
    if (!Number.isFinite(bottom)) return;
    const current = bottom + bar.offsetHeight + 6;
    onReach({ current, low: current - (raised ? RAISE_PX : 0) });
  }, [onReach, raised, phase.kind]);


  // Only while playing: a list of audiobooks to choose from stays put.
  useEffect(() => {
    setHidden(false);
    if (!autoHide || !playing) return;
    const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [autoHide, playing, touched]);

  // ── Session ───────────────────────────────────────────────────────────

  const report = useCallback(async (close: boolean) => {
    const current = sessionRef.current;
    if (!current) return;
    const update = { currentTime: timeRef.current, timeListened: Math.round(listenedRef.current), duration: current.duration };
    listenedRef.current = 0;
    // Lo escuchado tambien cuenta en las estadisticas, en su propio campo.
    if (update.timeListened > 0) {
      void db.saveReadingStatsEntry(book.title || '', 0, 0, 0, update.timeListened)
        .catch((error) => console.warn('[Audiobookshelf] No se pudo apuntar la escucha:', error));
    }
    try {
      if (close) await closeAudiobookSession(current.id, update);
      else await syncAudiobookSession(current.id, update);
    } catch (error) {
      console.warn('[Audiobookshelf] Session sync failed:', error);
    }
    // Progress too, in case the session expired on the server.
    updateAudiobookProgress(current.itemId, update.currentTime, current.duration).catch((error) => {
      console.warn('[Audiobookshelf] Progress update failed:', error);
    });
  }, []);

  const loadTrack = useCallback((target: AudiobookshelfPlaybackSession, globalTime: number, autoplay: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    const { trackIndex: index, offset } = locateTrack(target.tracks, globalTime);
    playAfterLoadRef.current = autoplay;
    if (index === trackIndex && audio.src === target.tracks[index].url && audio.readyState > 0) {
      audio.currentTime = offset;
      if (autoplay) void audio.play().catch(() => setPlaying(false));
      return;
    }
    pendingSeekRef.current = offset;
    setTrackIndex(index);
    audio.src = target.tracks[index].url;
    audio.playbackRate = rate;
    audio.volume = volume;
    audio.load();
  }, [rate, trackIndex]);

  const openSession = useCallback(async (itemId: string) => {
    setPhase({ kind: 'loading' });
    // Abrir el audiolibro es un tiempo aparte del de abrir el libro: lo que se espera
    // aqui es que el servidor monte la sesion de escucha.
    startOpenTiming('audiolibro');
    try {
      const started = await startAudiobookPlayback(itemId);
      markOpenTiming('sesion del servidor');
      finishOpenTiming();
      sessionRef.current = started;
      setSession(started);
      timeRef.current = started.currentTime;
      setTime(started.currentTime);
      setPhase({ kind: 'ready' });
    } catch (error) {
      setPhase({ kind: 'error', message: describeServerError(error, es) });
    }
  }, [es]);

  // Once the <audio> element is there, load where the user left off (paused).
  useEffect(() => {
    if (phase.kind !== 'ready' || !session || audioRef.current?.src) return;
    loadTrack(session, timeRef.current, false);
  }, [phase.kind, session, loadTrack]);

  const chooseItem = useCallback((item: AudiobookItem) => {
    setAudiobookLink(book.id, { itemId: item.id, title: item.title, chapters: item.chapters?.length });
    void openSession(item.id);
  }, [book.id, openSession]);

  // First open: the linked audiobook, or look for one.
  useEffect(() => {
    let current = true;
    const link = getAudiobookLink(book.id);
    if (link) {
      void openSession(link.itemId);
      return () => { current = false; };
    }
    setSearchText(audiobookSearchQuery(book.title));
    findAudiobookMatches(book)
      .then((matches) => {
        if (!current) return;
        const [best, second] = matches;
        if (best && best.score >= AUDIOBOOK_AUTO_MATCH_SCORE && (!second || second.score < best.score - 0.1)) {
          chooseItem(best.item);
        } else {
          setPhase({ kind: 'choose', matches: matches.map((match) => match.item) });
        }
      })
      .catch((error) => { if (current) setPhase({ kind: 'error', message: describeServerError(error, es) }); });
    return () => { current = false; };
  }, [book.id]); // Once per book.

  // Close the session when the player goes away (closing it, leaving the book).
  useEffect(() => () => {
    void report(true);
    sessionRef.current = null;
  }, [report]);

  // While playing, tell the server every few seconds; and when the app goes to the background.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => void report(false), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, report]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void report(false); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [report]);

  // ── Audio element events ──────────────────────────────────────────────

  const onLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    audio.volume = volume;
    if (pendingSeekRef.current !== null) {
      audio.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
    }
    if (playAfterLoadRef.current) void audio.play().catch(() => setPlaying(false));
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    const current = sessionRef.current;
    if (!audio || !current) return;
    const globalTime = (current.tracks[trackIndex]?.startOffset || 0) + audio.currentTime;
    onTimeMsRef.current?.(globalTime * 1000);
    const now = performance.now();
    if (!audio.paused && lastTickRef.current !== null) {
      // Wall-clock seconds listened, capped so a stall or a seek does not count.
      listenedRef.current += Math.min(2, (now - lastTickRef.current) / 1000);
    }
    lastTickRef.current = audio.paused ? null : now;
    timeRef.current = globalTime;
    setTime(globalTime);
  };

  const onEnded = () => {
    const current = sessionRef.current;
    if (!current) return;
    const next = current.tracks[trackIndex + 1];
    if (next) loadTrack(current, next.startOffset, true);
    else { setPlaying(false); void report(false); }
  };

  // ── Controls ──────────────────────────────────────────────────────────

  const play = () => {
    const audio = audioRef.current;
    if (!audio || !session) return;
    if (!audio.src) { loadTrack(session, timeRef.current, true); return; }
    void audio.play().catch((error) => {
      console.warn('[Audiobookshelf] Play failed:', error);
      setPlaying(false);
      setPhase({ kind: 'error', message: es ? 'No se pudo reproducir el audio (¿el servidor sigue encendido?).' : 'Could not play the audio (is the server still on?).' });
    });
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  const seekTo = (globalTime: number) => {
    if (!session) return;
    const clamped = Math.max(0, Math.min(session.duration, globalTime));
    timeRef.current = clamped;
    setTime(clamped);
    lastTickRef.current = null;
    loadTrack(session, clamped, playing);
  };

  // El lector salta al audio por aquí. En una ref y no por props para no volver a
  // montar nada cada vez que cambia el segundo.
  const onTimeMsRef = useRef(onTimeMs);
  onTimeMsRef.current = onTimeMs;
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;
  useEffect(() => {
    if (!seekRef) return undefined;
    seekRef.current = (seconds: number) => seekToRef.current(seconds);
    return () => { seekRef.current = null; };
  }, [seekRef]);

  const changeVolume = (next: number) => {
    setVolume(next);
    try { localStorage.setItem(VOLUME_KEY, String(next)); } catch { /* sin sitio: vale para esta sesión */ }
    if (audioRef.current) audioRef.current.volume = next;
  };

  const changeRate = (next: number) => {
    setRate(next);
    try { localStorage.setItem(RATE_KEY, String(next)); } catch { /* storage full: keep for this session */ }
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const nextRate = () => {
    const index = AUDIOBOOK_RATES.indexOf(rate);
    changeRate(AUDIOBOOK_RATES[(index + 1) % AUDIOBOOK_RATES.length]);
  };

  const relink = () => {
    pause();
    void report(true);
    sessionRef.current = null;
    setSession(null);
    setAudiobookLink(book.id, null);
    setPhase({ kind: 'choose', matches: [] });
  };

  const runSearch = async () => {
    setPhase({ kind: 'matching' });
    try {
      const items = await searchAudiobooks(searchText);
      setPhase({ kind: 'choose', matches: items });
    } catch (error) {
      setPhase({ kind: 'error', message: describeServerError(error, es) });
    }
  };

  // Lock screen / headset controls where the platform supports them.
  useEffect(() => {
    if (!session || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: session.title || book.title,
        artist: session.author || book.author || '',
        artwork: session.coverUrl ? [{ src: session.coverUrl, sizes: '512x512' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekTo(timeRef.current - 15));
      navigator.mediaSession.setActionHandler('seekforward', () => seekTo(timeRef.current + 30));
    } catch {
      // Not supported here.
    }
    return () => {
      try {
        for (const action of ['play', 'pause', 'seekbackward', 'seekforward'] as MediaSessionAction[]) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch { /* ignore */ }
    };
  }, [session]); // Handlers read refs; register again only for a new session.

  // ── Render ────────────────────────────────────────────────────────────

  const chapters = session?.chapters || [];
  const shownTime = scrubbing ?? time;
  const chapterIndex = chapterAt(chapters, shownTime);
  const className = `audio-sync-player${raised ? ' is-raised' : ''}${hidden ? ' is-hidden' : ''}`;
  const style = { '--read-aloud-accent': accent } as React.CSSProperties;

  const closeButton = (
    <button type="button" className="read-aloud-btn" onClick={onClose} aria-label={es ? 'Cerrar audiolibro' : 'Close audiobook'}>
      <X size={18} />
    </button>
  );

  if (phase.kind !== 'ready' || !session) {
    return (
      <div ref={barRef} className={className} style={style} role="dialog" aria-label={es ? 'Audiolibro' : 'Audiobook'}>
        <div className="audio-sync-row">
          <strong className="audio-sync-title">{es ? 'Audiolibro' : 'Audiobook'}</strong>
          {closeButton}
        </div>
        {(phase.kind === 'matching' || phase.kind === 'loading') && (
          <p className="audio-sync-message"><Loader2 size={15} className="guide-spin" /> {phase.kind === 'matching' ? (es ? 'Buscando en Audiobookshelf…' : 'Searching Audiobookshelf…') : (es ? 'Preparando el audio…' : 'Preparing audio…')}</p>
        )}
        {phase.kind === 'error' && (
          <p className="audio-sync-message is-error">{phase.message}</p>
        )}
        {(phase.kind === 'choose' || phase.kind === 'error') && (
          <>
            <form className="audio-sync-search" onSubmit={(e) => { e.preventDefault(); void runSearch(); }}>
              <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={es ? 'Título del audiolibro' : 'Audiobook title'} />
              <button type="submit" className="read-aloud-btn" aria-label={es ? 'Buscar' : 'Search'}><Search size={17} /></button>
            </form>
            {phase.kind === 'choose' && (
              phase.matches.length === 0
                ? <p className="audio-sync-message">{es ? 'No se encontró este libro. Busca el título del audiolibro.' : 'This book was not found. Search for the audiobook title.'}</p>
                : (
                  <>
                    <p className="audio-sync-message">
                      {es
                        ? 'Parecidos por título. Elige cuál es:'
                        : 'Similar by title. Pick the right one:'}
                    </p>
                  <ul className="audio-sync-matches">
                    {phase.matches.slice(0, 8).map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => chooseItem(item)}>
                          <img src={item.coverUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                          <span>
                            <strong>{item.title}</strong>
                            <small>{[item.author, item.duration ? formatTime(item.duration) : ''].filter(Boolean).join(' · ')}</small>
                          </span>
                          <Link2 size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  </>
                )
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      className={className}
      style={style}
      role="toolbar"
      aria-label={es ? 'Audiolibro' : 'Audiobook'}
      aria-hidden={hidden || undefined}
      onPointerDown={() => setTouched((n) => n + 1)}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => { setPlaying(true); lastTickRef.current = performance.now(); }}
        onPause={() => { setPlaying(false); lastTickRef.current = null; void report(false); }}
        onEnded={onEnded}
        onError={() => { setPlaying(false); setPhase({ kind: 'error', message: es ? 'No se pudo cargar el audio desde Audiobookshelf.' : 'Could not load the audio from Audiobookshelf.' }); }}
      />
      <div className="audio-sync-row">
        {/*
          La portada y el titulo abren el reproductor. Es el gesto que ya trae
          aprendido cualquiera que haya usado Spotify o YT Music, y no hay que
          ensenarlo. El chevron de abajo se queda para quien lo busque.
          Cuando hay capitulos, el selector ocupa el sitio del titulo y se queda
          fuera del boton: es un control, y meterlo dentro lo dejaria inservible.
        */}
        <button
          type="button"
          className={`audio-sync-open${chapters.length > 0 ? ' is-cover-only' : ''}`}
          onClick={() => setExpanded(true)}
          aria-label={es ? 'Abrir el reproductor' : 'Open the player'}
          title={es ? 'Abrir el reproductor' : 'Open the player'}
        >
          <img className="audio-sync-cover" src={session.coverUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          {chapters.length === 0 && <span className="audio-sync-title">{session.title}</span>}
        </button>
        {chapters.length > 0 ? (
          <select
            className="audio-sync-chapter"
            value={Math.max(0, chapterIndex)}
            onChange={(e) => seekTo(chapters[Number(e.target.value)].start)}
            aria-label={es ? 'Capítulo' : 'Chapter'}
          >
            {chapters.map((chapter, index) => <option key={chapter.id} value={index}>{chapter.title}</option>)}
          </select>
        ) : null}
        {alignment ? (
          <button
            type="button"
            className="read-aloud-btn"
            onClick={() => onFollowTextChange?.(!followText)}
            aria-pressed={followText}
            style={followText ? { color: accent } : undefined}
            aria-label={es ? 'El texto sigue al audio' : 'Text follows the audio'}
            title={(es ? 'El texto sigue al audio' : 'Text follows the audio')
              + (alignment.notice ? ` — ${alignment.notice}` : '')}
          >
            <AlignLeft size={16} />
          </button>
        ) : onImportSrt ? (
          <button
            type="button"
            className="read-aloud-btn"
            onClick={() => srtInputRef.current?.click()}
            aria-label={es ? 'Importar alineación (.srt)' : 'Import alignment (.srt)'}
            title={es ? 'Importar alineación (.srt) para que el texto siga al audio'
              : 'Import an alignment (.srt) so the text follows the audio'}
          >
            <FileText size={16} />
          </button>
        ) : null}
        <input
          ref={srtInputRef}
          type="file"
          accept=".srt,.vtt,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // deja volver a elegir el mismo fichero tras un fallo
            if (file) onImportSrt?.(file);
          }}
        />
        <button type="button" className="read-aloud-btn" onClick={relink} aria-label={es ? 'Cambiar audiolibro' : 'Change audiobook'} title={es ? 'Cambiar audiolibro' : 'Change audiobook'}>
          <Link2 size={16} />
        </button>
        {closeButton}
      </div>
      <div className="audio-sync-row">
        <span className="audio-sync-time">{formatTime(shownTime)}</span>
        <input
          type="range"
          className="audio-sync-scrubber"
          min={0}
          max={Math.max(1, Math.floor(session.duration))}
          step={1}
          value={Math.floor(shownTime)}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null); } }}
          onKeyUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null); } }}
          aria-label={es ? 'Posición' : 'Position'}
        />
        <span className="audio-sync-time">-{formatTime(session.duration - shownTime)}</span>
      </div>
      <div className="audio-sync-row audio-sync-controls">
        <button type="button" className="read-aloud-btn" onClick={() => seekTo(time - 15)} aria-label={es ? 'Atrás 15 segundos' : 'Back 15 seconds'}>
          <RotateCcw size={18} /><small>15</small>
        </button>
        <button type="button" className="read-aloud-btn read-aloud-play" onClick={playing ? pause : play} aria-label={playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Reproducir' : 'Play')}>
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button type="button" className="read-aloud-btn" onClick={() => seekTo(time + 30)} aria-label={es ? 'Adelante 30 segundos' : 'Forward 30 seconds'}>
          <RotateCw size={18} /><small>30</small>
        </button>
        <button type="button" className="read-aloud-chip" onClick={nextRate} aria-label={es ? 'Velocidad' : 'Speed'}>
          {rate}×
        </button>
        {/*
          Este no es uno mas de la fila: abre otra pantalla, no mueve el audio
          quince segundos. Lleva marco y acento para que se distinga de los
          cuatro redondos de al lado.
        */}
        <button
          type="button"
          className="read-aloud-btn audio-sync-expand"
          onClick={() => setExpanded(true)}
          aria-label={es ? 'Abrir el reproductor' : 'Open the player'}
          title={es ? 'Abrir el reproductor' : 'Open the player'}
        >
          <ChevronUp size={18} />
        </button>
      </div>

      {/*
        El modo reproductor. Sigue en este mismo árbol de React, no en una vista
        aparte, porque el <audio> de arriba tiene que seguir montado: sacarlo a otra
        pantalla cortaria la reproduccion al abrirlo.

        Pero el nodo se cuelga del <body>, y eso no es un adorno. La barra lleva
        `transform: translateX(-50%)` y `backdrop-filter`, y cualquiera de los dos
        convierte a la barra en el marco de referencia de sus hijos `position:
        fixed`. Sin el portal, el `inset: 0` del reproductor no mide la pantalla:
        mide la barrita. El modo a pantalla completa salia encajonado en 460 px de
        ancho sobre la propia barra, que es lo que parecia «no funciona».
      */}
      {expanded && createPortal(
        <div className="audio-full" role="dialog" aria-modal="true"
             aria-label={es ? 'Reproductor' : 'Player'}>
          <div className="audio-full-top">
            <button type="button" className="read-aloud-btn" onClick={() => setExpanded(false)}
                    aria-label={es ? 'Plegar el reproductor' : 'Collapse the player'}>
              <ChevronDown size={22} />
            </button>
            <button type="button" className="read-aloud-btn" onClick={relink}
                    aria-label={es ? 'Cambiar audiolibro' : 'Change audiobook'}
                    title={es ? 'Cambiar audiolibro' : 'Change audiobook'}>
              <Link2 size={18} />
            </button>
          </div>

          <img className="audio-full-cover" src={session.coverUrl} alt=""
               onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />

          <h2 className="audio-full-title">{session.title}</h2>
          {session.author && <p className="audio-full-author">{session.author}</p>}

          {chapters.length > 0 && chapterIndex >= 0 && (
            <select
              className="audio-full-chapter"
              value={chapterIndex}
              onChange={(e) => seekTo(chapters[Number(e.target.value)].start)}
              aria-label={es ? 'Capítulo' : 'Chapter'}
            >
              {chapters.map((chapter, index) => (
                <option key={chapter.id} value={index}>{index + 1}. {chapter.title}</option>
              ))}
            </select>
          )}

          <input
            type="range"
            className="audio-sync-scrubber audio-full-scrubber"
            min={0}
            max={Math.max(1, Math.floor(session.duration))}
            step={1}
            value={Math.floor(shownTime)}
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onPointerUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null); } }}
            onKeyUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null); } }}
            aria-label={es ? 'Posición' : 'Position'}
          />
          <div className="audio-full-times">
            <span>{formatTime(shownTime)}</span>
            {/* Lo que queda del capítulo, no del libro: es lo que uno quiere saber
                cuando decide si sigue escuchando un rato más. */}
            <span>
              {chapterIndex >= 0
                ? `${es ? 'CAPÍTULO' : 'CHAPTER'}  -${formatTime(Math.max(0, chapters[chapterIndex].end - shownTime))}`
                : `-${formatTime(session.duration - shownTime)}`}
            </span>
          </div>

          <div className="audio-full-controls">
            <button type="button" className="read-aloud-btn" disabled={chapterIndex <= 0}
                    onClick={() => seekTo(chapters[chapterIndex - 1].start)}
                    aria-label={es ? 'Capítulo anterior' : 'Previous chapter'}>
              <SkipBack size={22} />
            </button>
            <button type="button" className="read-aloud-btn" onClick={() => seekTo(time - 10)}
                    aria-label={es ? 'Atrás 10 segundos' : 'Back 10 seconds'}>
              <RotateCcw size={26} /><small>10</small>
            </button>
            <button type="button" className="audio-full-play" onClick={playing ? pause : play}
                    aria-label={playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Reproducir' : 'Play')}>
              {playing ? <Pause size={30} /> : <Play size={30} />}
            </button>
            <button type="button" className="read-aloud-btn" onClick={() => seekTo(time + 30)}
                    aria-label={es ? 'Adelante 30 segundos' : 'Forward 30 seconds'}>
              <RotateCw size={26} /><small>30</small>
            </button>
            <button type="button" className="read-aloud-btn"
                    disabled={chapterIndex < 0 || chapterIndex >= chapters.length - 1}
                    onClick={() => seekTo(chapters[chapterIndex + 1].start)}
                    aria-label={es ? 'Capítulo siguiente' : 'Next chapter'}>
              <SkipForward size={22} />
            </button>
          </div>

          <div className="audio-full-tools">
            <button type="button" className="read-aloud-chip" onClick={nextRate}
                    aria-label={es ? 'Velocidad' : 'Speed'}>{rate}×</button>

            <label className="audio-full-volume">
              <Volume2 size={18} aria-hidden="true" />
              <input
                type="range" min={0} max={1} step={0.05} value={volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label={es ? 'Volumen' : 'Volume'}
              />
            </label>

            {/*
              Aquí vive «el texto sigue al audio»: es donde uno está cuando decide
              escuchar y leer a la vez, y en la barra pequeña competía por sitio con
              los controles. En la barra se queda igualmente, para no obligar a abrir
              el reproductor solo para encenderlo.
            */}
            {alignment && (
              <button
                type="button"
                className="read-aloud-chip"
                onClick={() => onFollowTextChange?.(!followText)}
                aria-pressed={followText}
                style={followText ? { color: accent, borderColor: accent } : undefined}
                title={alignment.notice || undefined}
              >
                <AlignLeft size={16} aria-hidden="true" />
                {es ? 'Seguir el texto' : 'Follow the text'}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
