import { useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  YoruNotifications,
  playerArtwork,
  supportsPlayerSources,
  type PlayerSource,
} from '../../utils/yoruNotifications';

/**
 * Android: el audiolibro que suena, en el reproductor del sistema.
 *
 * Hasta ahora solo la lectura en voz alta tenía notificación. Un audiolibro sonaba
 * en un `<audio>` de la página y Android no se enteraba: ni notificación, ni pantalla
 * de bloqueo, ni botones de los auriculares, y al no haber servicio en primer plano
 * el sistema podía congelar la app con el audio a medias. Lo dijo zams (19 nov 2026):
 * «cuando estás escuchando algo no aparece».
 *
 * Se usa el mismo servicio nativo que la lectura en voz alta (`ReadAloudService`),
 * con dos diferencias que se le dicen al mandar el estado:
 *  - `ownsAudio: false`: el sonido lo pone el WebView, que ya pide el foco de audio.
 *    Si el servicio lo pidiera también, se lo quitaría al WebView y pausaría el
 *    audiolibro que pretende anunciar.
 *  - `source`: quién ha puesto el reproductor. Los botones vuelven con ese nombre, y
 *    cada uno atiende solo los suyos; sin eso, pulsar «reproducir» en la notificación
 *    de un audiolibro arrancaría también la voz del lector.
 *
 * En escritorio y en un APK anterior no hace nada (`supportsPlayerSources`).
 */

interface Options {
  source: Exclude<PlayerSource, 'readAloud'>;
  /** Hay un audiolibro cargado. */
  active: boolean;
  id: string;
  title: string;
  /** Capítulo o autor: la segunda línea. */
  subtitle: string;
  cover?: string;
  playing: boolean;
  /** Segundos desde el principio del audiolibro entero. */
  time: number;
  duration: number;
  rate: number;
  /** El temporizador de sueño, dicho en una línea; vacío si no hay. */
  note: string;
  es: boolean;
  /** Segundos que saltan «anterior» y «siguiente». */
  back: number;
  forward: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  /** Sin esto no se enseña el botón del temporizador. */
  onSleep?: () => void;
  /** La X de la notificación, o deslizarla fuera. */
  onClose: () => void;
}

/** Cuánto puede desviarse la barra del sistema antes de corregirla (segundos). */
const DRIFT_SECONDS = 2;

export function useAudiobookNotification(options: Options) {
  const { source, active, id, title, subtitle, cover, playing, time, duration, rate, note, es, back, forward } = options;
  const hasSleep = Boolean(options.onSleep);

  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    void supportsPlayerSources().then((ok) => { if (alive) setSupported(ok); });
    return () => { alive = false; };
  }, []);

  /*
    La notificación sale al empezar a sonar, no al cargar: el reproductor del lector
    tiene su audiolibro cargado y en pausa desde que se abre, y eso no es estar
    escuchando. Cerrarla desde la notificación la quita hasta que vuelva a sonar.
  */
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!active) setEngaged(false);
    else if (playing) setEngaged(true);
  }, [active, playing]);
  const on = supported && active && engaged;

  const latest = useRef(options);
  latest.current = options;

  // La portada, una vez por audiolibro. Si no se puede leer, sale el icono de Yoru.
  const [artwork, setArtwork] = useState<{ id: string; data?: string } | null>(null);
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    void playerArtwork(`audiobook:${id}`, cover).then((data) => { if (alive) setArtwork({ id, data }); });
    return () => { alive = false; };
  }, [on, id, cover]);
  const artworkReady = artwork?.id === id;

  const shownRef = useRef(false);
  const artworkSentRef = useRef<string | null>(null);
  const sentRef = useRef<{ key: string; position: number; at: number } | null>(null);
  const second = Math.floor(time);

  useEffect(() => {
    if (!on) {
      if (shownRef.current) {
        shownRef.current = false;
        sentRef.current = null;
        artworkSentRef.current = null;
        void YoruNotifications.stopReadAloud({ source }).catch(() => {});
      }
      return;
    }
    if (!artworkReady) return;
    /*
      El tiempo cambia cuatro veces por segundo y no se manda cada vez: Android mueve
      la barra solo, a la velocidad que se le dijo. Solo se vuelve a mandar cuando
      cambia algo de lo que se ve, o cuando el audio ya no está donde Android cree
      (un salto, un cambio de capítulo, un atasco de la red).
    */
    const key = JSON.stringify([id, title, subtitle, playing, rate, note, es, back, forward, Math.round(duration), hasSleep]);
    const last = sentRef.current;
    const now = Date.now();
    if (last && last.key === key) {
      const expected = last.position + (playing ? ((now - last.at) / 1000) * rate : 0);
      if (Math.abs(time - expected) < DRIFT_SECONDS) return;
    }
    sentRef.current = { key, position: time, at: now };
    const firstOfBook = artworkSentRef.current !== id;
    artworkSentRef.current = id;
    shownRef.current = true;
    void YoruNotifications.updateReadAloud({
      source,
      ownsAudio: false,
      showSleep: hasSleep,
      bookTitle: title,
      chapter: subtitle,
      sentence: '',
      showSentence: false,
      playing,
      positionMs: Math.round(time * 1000),
      durationMs: Math.round(duration * 1000),
      rate,
      note,
      lang: es ? 'es' : 'en',
      previousLabel: es ? `Atrás ${back} segundos` : `Back ${back} seconds`,
      nextLabel: es ? `Adelante ${forward} segundos` : `Forward ${forward} seconds`,
      ...(firstOfBook ? (artwork?.data ? { artwork: artwork.data } : { clearArtwork: true }) : {}),
    }).catch(() => {});
    // `time` entra por `second`: una vez por segundo basta para notar un salto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, artworkReady, source, id, title, subtitle, playing, rate, note, es, back, forward, duration, hasSleep, second]);

  // Al desmontarse quien lo puso, el reproductor se va con él.
  useEffect(() => () => {
    if (shownRef.current) void YoruNotifications.stopReadAloud({ source }).catch(() => {});
  }, [source]);

  // Los botones de la notificación, la pantalla de bloqueo y los auriculares.
  useEffect(() => {
    if (!supported) return undefined;
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void YoruNotifications.addListener('readAloudAction', (event) => {
      if (event.source !== source) return;
      const current = latest.current;
      if (!current.active) return;
      switch (event.action) {
        case 'play': current.onPlay(); break;
        case 'pause': current.onPause(); break;
        case 'previous': current.onSeek(current.time - current.back); break;
        case 'next': current.onSeek(current.time + current.forward); break;
        case 'seek': current.onSeek(event.positionMs / 1000); break;
        case 'sleep': current.onSleep?.(); break;
        case 'close':
          setEngaged(false);
          current.onClose();
          break;
        default: break;
      }
    }).then((added) => {
      if (removed) void added.remove();
      else handle = added;
    });
    return () => {
      removed = true;
      void handle?.remove();
    };
  }, [supported, source]);
}
