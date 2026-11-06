import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudiobookshelfPlaybackSession } from '../../types/integrations';
import {
  closeAudiobookSession,
  locateTrack,
  probeMediaAuth,
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
    /** Sin esto, una pista que no carga deja el reproductor mudo y en 0:00. */
    onError: () => void;
  };
}

/** Lo que significa cada código de `MediaError`, dicho para quien lo lee en pantalla. */
function mediaErrorMessage(code: number | undefined, es: boolean): string {
  if (code === 1) return es ? 'Se canceló la carga del audio.' : 'Loading the audio was cancelled.';
  if (code === 2) {
    return es
      ? 'No se pudo traer el audio del servidor. Comprueba que Audiobookshelf sigue encendido.'
      : 'Could not fetch the audio from the server. Check that Audiobookshelf is still up.';
  }
  if (code === 3) return es ? 'El audio llegó, pero no se pudo descodificar.' : 'The audio arrived but could not be decoded.';
  if (code === 4) {
    return es
      ? 'El servidor no dio el audio, o este formato no se puede reproducir aquí.'
      : 'The server did not serve the audio, or this format cannot be played here.';
  }
  return es ? 'No se pudo reproducir el audio.' : 'The audio could not be played.';
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
  /** La pista que hay que cargar en cuanto exista el `<audio>`. Ver el efecto de abajo. */
  const pendingStartRef = useRef<{ session: AudiobookshelfPlaybackSession; from: number } | null>(null);
  const playAfterLoadRef = useRef(false);
  const trackIndexRef = useRef(0);
  trackIndexRef.current = trackIndex;

  /*
    Un audiolibro distinto es una sesión distinta: lo de antes no vale.

    Esto se hace durante el render y no en un efecto, y la diferencia importa. El
    hook vive en el proveedor, y quien pide reproducir es la barra, que es su hija;
    los efectos de los hijos corren antes que los del padre. Con el reinicio en un
    efecto, al pasar de un audiolibro a otro la barra arrancaba primero y se
    encontraba la sesión del anterior: el reproductor aparecía con el minuto del
    audiolibro que acababas de dejar, y lo de verdad no sonaba.

    Reiniciar aquí es el patrón que React documenta para el estado que depende de
    una prop, y deja todo limpio antes de que corra ningún efecto.
  */
  const [lastItemId, setLastItemId] = useState(itemId);
  if (itemId !== lastItemId) {
    setLastItemId(itemId);
    setPhase({ kind: 'idle' });
    setSession(null);
    setPlaying(false);
    setTime(0);
    setTrackIndex(0);
    sessionRef.current = null;
    timeRef.current = 0;
    listenedRef.current = 0;
  }

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
    // Que no haya `<audio>` todavía no es normal: lo encauza el efecto de más abajo.
    if (!audio) { console.warn('[Audiobookshelf] loadTrack sin <audio> montado; se reintenta al pintar.'); return; }
    const { trackIndex: index, offset } = locateTrack(target.tracks, globalTime);
    playAfterLoadRef.current = autoplay;
    if (index === trackIndexRef.current && audio.src === target.tracks[index].url && audio.readyState > 0) {
      audio.currentTime = offset;
      if (autoplay) void audio.play().catch((error) => { setPlaying(false); console.warn('[Audiobookshelf] play() rechazado:', error); });
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
        /*
          El <audio> solo aparece con la fase «ready», así que aquí todavía no existe
          el elemento al que darle la fuente. Antes esto se resolvía con un
          `setTimeout(…, 0)`, que no es una garantía de nada: es una carrera contra el
          pintado de React, y la perdía. `loadTrack` se encontraba `audioRef.current`
          a null, se iba por su cláusula de guarda y no cargaba nada — en silencio. El
          reproductor salía pintado, con su duración y su minuto, y mudo. Al segundo
          intento sí sonaba, porque para entonces el elemento ya estaba.

          Se deja encargado y lo recoge el efecto de abajo, que por definición corre
          con el DOM ya pintado. Es como lo hace el reproductor del lector
          (`reader/AudioSyncPlayer.tsx`), y por lo mismo.
        */
        pendingStartRef.current = { session: started, from };
        setPhase({ kind: 'ready' });
      })
      .catch((error) => setPhase({ kind: 'error', message: describeServerError(error, es) }));
  }, [itemId, es, loadTrack]);

  /*
    Recoge el encargo que dejó `start()`, ya con el `<audio>` en el DOM. Depende de
    `phase` porque es el cambio a «ready» el que lo monta: ese render es justo el que
    hace falta esperar.
  */
  useEffect(() => {
    const pending = pendingStartRef.current;
    if (!pending || !audioRef.current) return;
    pendingStartRef.current = null;
    loadTrack(pending.session, pending.from, true);
  }, [phase, loadTrack]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    const current = sessionRef.current;
    if (!audio || !current) return;
    if (!audio.src) { loadTrack(current, timeRef.current, true); return; }
    void audio.play().catch(reportPlayRejection);
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

  /*
    Un rechazo de `play()` se tragaba el motivo. Los dos que importan son distintos y
    hay que distinguirlos: el navegador bloqueando la reproducción sin un gesto del
    usuario, y la pista que no se puede reproducir.
  */
  const reportPlayRejection = useCallback((error: unknown) => {
    setPlaying(false);
    const name = error instanceof Error ? error.name : '';
    console.warn(`[Audiobookshelf] play() rechazado: ${name || error}`);
    if (name === 'NotAllowedError') {
      setPhase({
        kind: 'error',
        message: es
          ? 'El navegador no deja empezar a sonar solo. Pulsa el botón de reproducir.'
          : 'The browser will not start playback on its own. Press play.',
      });
    }
  }, [es]);

  const handlers = {
    onLoadedMetadata: () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.playbackRate = rate;
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      if (playAfterLoadRef.current) void audio.play().catch(reportPlayRejection);
    },
    /*
      Que la pista no cargara no se enteraba nadie: el `<audio>` no tenía manejador de
      error, así que el reproductor se quedaba pintado en 0:00 y en silencio, sin una
      sola línea en ningún sitio. Un reproductor que falla callado es el peor caso,
      porque parece que el fallo lo tienes tú.
    */
    onError: () => {
      const audio = audioRef.current;
      const code = audio?.error?.code;
      const detail = audio?.error?.message || '';
      const url = audio?.currentSrc || audio?.src || '';
      // El testigo viaja en la dirección; no se escribe en el registro.
      const safeUrl = url.replace(/([?&]token=)[^&]*/i, '$1…');
      console.warn(`[Audiobookshelf] la pista no cargó (código ${code ?? '?'}) ${detail} — ${safeUrl}`);
      setPlaying(false);
      setPhase({ kind: 'error', message: mediaErrorMessage(code, es) });
      /*
        «Format error» no dice si el fichero es ilegible o si el servidor contestó un
        401 que el navegador no sabe interpretar. Preguntándoselo de las dos maneras se
        sabe cuál de las dos es, que son arreglos opuestos.
      */
      const track = sessionRef.current?.tracks[trackIndexRef.current];
      if (url) {
        void probeMediaAuth(url, track?.fileUrl || '').then((resumen) => {
          console.warn(`[Audiobookshelf] el servidor responde: ${resumen}`);
        });
      }
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
