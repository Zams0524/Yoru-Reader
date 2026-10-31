import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudiobookshelfPlaybackSession } from '../../types/integrations';
import {
  closeAudiobookSession,
  locateTrack,
  startAudiobookPlayback,
  syncAudiobookSession,
  updateAudiobookProgress,
} from '../../utils/audiobookshelfService';
import { describeServerError } from '../../utils/serverHttp';
import { finishOpenTiming, markOpenTiming, startOpenTiming } from '../../utils/openTiming';

/**
 * Escuchar un audiolibro a secas, sin libro delante.
 *
 * El otro reproductor, el del lector (`reader/AudioSyncPlayer.tsx`), está construido
 * alrededor de un libro: vive dentro del lector, se monta con el id del libro y su
 * razón de ser es que el texto siga al audio. No sirve para un audiolibro que no
 * tiene libro, y en esta biblioteca los hay.
 *
 * Esto es lo mínimo honesto para escuchar: sesión, pistas en orden, saltar, y el
 * progreso de vuelta al servidor, que es lo que hace que la escucha siga donde la
 * dejó aunque continúe en el móvil.
 */

const SYNC_INTERVAL_MS = 15_000;
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export type PlaybackPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface AudiobookPlayback {
  phase: PlaybackPhase;
  session: AudiobookshelfPlaybackSession | null;
  playing: boolean;
  /** Segundos desde el principio del audiolibro entero, no de la pista. */
  time: number;
  rate: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Empieza a sonar; con `at`, desde ese segundo. */
  start: (at?: number) => void;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  nextRate: () => void;
  /** Para enchufar al `<audio>`. */
  handlers: {
    onLoadedMetadata: () => void;
    onTimeUpdate: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
  };
}

export function useAudiobookPlayback(itemId: string, es: boolean): AudiobookPlayback {
  const [phase, setPhase] = useState<PlaybackPhase>({ kind: 'idle' });
  const [session, setSession] = useState<AudiobookshelfPlaybackSession | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [trackIndex, setTrackIndex] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<AudiobookshelfPlaybackSession | null>(null);
  const timeRef = useRef(0);
  const listenedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const playAfterLoadRef = useRef(false);
  const trackIndexRef = useRef(0);
  trackIndexRef.current = trackIndex;

  // Un audiolibro distinto es una sesión distinta: lo de antes no vale.
  useEffect(() => {
    setPhase({ kind: 'idle' });
    setSession(null);
    setPlaying(false);
    setTime(0);
    setTrackIndex(0);
    sessionRef.current = null;
    timeRef.current = 0;
    listenedRef.current = 0;
  }, [itemId]);

  const report = useCallback(async (close: boolean) => {
    const current = sessionRef.current;
    if (!current) return;
    const update = {
      currentTime: timeRef.current,
      timeListened: Math.round(listenedRef.current),
      duration: current.duration,
    };
    listenedRef.current = 0;
    try {
      if (close) await closeAudiobookSession(current.id, update);
      else await syncAudiobookSession(current.id, update);
    } catch (error) {
      console.warn('[Audiobookshelf] No se pudo sincronizar la sesión:', error);
    }
    updateAudiobookProgress(current.itemId, update.currentTime, current.duration)
      .catch((error) => console.warn('[Audiobookshelf] No se pudo guardar el progreso:', error));
  }, []);

  // Al salir de la ficha se cierra la sesión: si no, el servidor la deja colgada.
  useEffect(() => () => { void report(true); sessionRef.current = null; }, [report]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => void report(false), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, report]);

  const loadTrack = useCallback((target: AudiobookshelfPlaybackSession, globalTime: number, autoplay: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    const { trackIndex: index, offset } = locateTrack(target.tracks, globalTime);
    playAfterLoadRef.current = autoplay;
    if (index === trackIndexRef.current && audio.src === target.tracks[index].url && audio.readyState > 0) {
      audio.currentTime = offset;
      if (autoplay) void audio.play().catch(() => setPlaying(false));
      return;
    }
    pendingSeekRef.current = offset;
    setTrackIndex(index);
    audio.src = target.tracks[index].url;
    audio.playbackRate = rate;
    audio.load();
  }, [rate]);

  const start = useCallback((at?: number) => {
    if (sessionRef.current) {
      if (typeof at === 'number') {
        const clamped = Math.max(0, Math.min(sessionRef.current.duration, at));
        timeRef.current = clamped;
        setTime(clamped);
      }
      loadTrack(sessionRef.current, timeRef.current, true);
      return;
    }
    setPhase({ kind: 'loading' });
    // Abrir un audiolibro también se mide: aquí lo que se espera es el servidor.
    startOpenTiming('audiolibro suelto');
    startAudiobookPlayback(itemId)
      .then((started) => {
        markOpenTiming('sesión del servidor');
        finishOpenTiming();
        sessionRef.current = started;
        setSession(started);
        const from = typeof at === 'number' ? at : started.currentTime;
        timeRef.current = from;
        setTime(from);
        setPhase({ kind: 'ready' });
        // El <audio> aparece con la fase «ready», así que la pista se carga después
        // de pintar: antes no hay elemento al que darle la fuente.
        window.setTimeout(() => loadTrack(started, from, true), 0);
      })
      .catch((error) => setPhase({ kind: 'error', message: describeServerError(error, es) }));
  }, [itemId, es, loadTrack]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    const current = sessionRef.current;
    if (!audio || !current) return;
    if (!audio.src) { loadTrack(current, timeRef.current, true); return; }
    void audio.play().catch(() => setPlaying(false));
  }, [loadTrack]);

  const pause = useCallback(() => { audioRef.current?.pause(); }, []);

  const seekTo = useCallback((seconds: number) => {
    const current = sessionRef.current;
    if (!current) { start(seconds); return; }
    const clamped = Math.max(0, Math.min(current.duration, seconds));
    timeRef.current = clamped;
    setTime(clamped);
    lastTickRef.current = null;
    loadTrack(current, clamped, playing);
  }, [loadTrack, playing, start]);

  const nextRate = useCallback(() => {
    setRate((current) => {
      const next = RATES[(RATES.indexOf(current) + 1) % RATES.length];
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const handlers = {
    onLoadedMetadata: () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.playbackRate = rate;
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      if (playAfterLoadRef.current) void audio.play().catch(() => setPlaying(false));
    },
    onTimeUpdate: () => {
      const audio = audioRef.current;
      const current = sessionRef.current;
      if (!audio || !current) return;
      const globalTime = (current.tracks[trackIndexRef.current]?.startOffset || 0) + audio.currentTime;
      const now = performance.now();
      if (!audio.paused && lastTickRef.current !== null) {
        // Segundos de reloj escuchados, con tope para que un atasco o un salto no cuenten.
        listenedRef.current += Math.min(2, (now - lastTickRef.current) / 1000);
      }
      lastTickRef.current = audio.paused ? null : now;
      timeRef.current = globalTime;
      setTime(globalTime);
    },
    onPlay: () => setPlaying(true),
    onPause: () => { setPlaying(false); lastTickRef.current = null; },
    onEnded: () => {
      const current = sessionRef.current;
      if (!current) return;
      const next = current.tracks[trackIndexRef.current + 1];
      if (next) loadTrack(current, next.startOffset, true);
      else { setPlaying(false); void report(false); }
    },
  };

  return { phase, session, playing, time, rate, audioRef, start, play, pause, seekTo, nextRate, handlers };
}
