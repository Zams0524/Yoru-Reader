import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AudiobookItem } from '../../types/integrations';
import { absCoverUrl } from '../../utils/audiobookshelfService';
import { useAudiobookPlayback, type AudiobookPlayback } from './useAudiobookPlayback';

/** El reloj del reproductor: h:mm:ss, o m:ss cuando no llega a la hora. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * El reproductor de audiolibros, que vive por encima de las pantallas.
 *
 * Antes el reproductor era parte de la ficha: salir de la ficha lo desmontaba y el
 * audio se paraba en seco. Escuchar un audiolibro de hora y pico sin poder ni mirar
 * la siguiente serie no es escuchar; es quedarse preso de una pantalla.
 *
 * Por eso el estado y el `<audio>` suben aquí, a un proveedor que envuelve el shell
 * entero, y la barra se ancla abajo. La ficha sigue mandando —es donde se pulsa
 * «Escuchar»— pero ya no es la dueña: le pide al proveedor que ponga este audiolibro,
 * y el audio sigue sonando cuando te vas a Inicio, al catálogo o a otra serie.
 */

interface PlayerValue {
  /** Lo que está puesto ahora, o null si no hay nada. */
  current: AudiobookItem | null;
  /** El estado del reproductor: el mismo que usaba la ficha, ahora compartido. */
  playback: AudiobookPlayback;
  /** Pone este audiolibro; con `at`, desde ese segundo. */
  open: (item: AudiobookItem, at?: number) => void;
  /** Lo quita y cierra la barra. */
  close: () => void;
}

const PlayerContext = createContext<PlayerValue | null>(null);

/** El reproductor compartido. Fuera del proveedor no hay ninguno, y se dice. */
export function useAudiobookPlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('useAudiobookPlayer fuera de AudiobookPlayerProvider');
  return value;
}

export function AudiobookPlayerProvider({ es, children }: { es: boolean; children: React.ReactNode }) {
  const [current, setCurrent] = useState<AudiobookItem | null>(null);
  const playback = useAudiobookPlayback(current?.id || '', es);
  /*
    `open` cambia el audiolibro y acto seguido querría arrancarlo, pero el hook se
    reinicia con el id nuevo: arrancar aquí mismo sería pedírselo a la sesión vieja.
    Se deja apuntado y lo arranca la barra cuando ya está montada con el id nuevo.
  */
  const pendingAt = useRef<number | undefined>(undefined);
  const startRef = useRef(playback.start);
  startRef.current = playback.start;

  const open = useCallback((item: AudiobookItem, at?: number) => {
    setCurrent((previous) => {
      if (previous?.id === item.id) {
        // El mismo audiolibro: no se reinicia nada, como mucho se salta.
        startRef.current(at);
        return previous;
      }
      pendingAt.current = at;
      return item;
    });
  }, []);

  const close = useCallback(() => {
    playback.pause();
    setCurrent(null);
  }, [playback]);

  const value = useMemo<PlayerValue>(
    () => ({ current, playback, open, close }),
    [current, playback, open, close]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {current && <PlayerBar es={es} item={current} playback={playback} pendingAt={pendingAt} onClose={close} />}
    </PlayerContext.Provider>
  );
}

/**
 * La barra de abajo. Portada y título a la izquierda, los mandos en el centro, y el
 * volumen y el marcador a la derecha, que es donde ya se buscan.
 *
 * Es `position: fixed`, y eso tiene una consecuencia que ya nos mordió una vez: el
 * lector a pantalla completa mide la ventana para repartir el texto en páginas. La
 * barra no llega a pintarse con el lector abierto —el shell no se monta debajo de
 * él—, así que no le roba alto ni le cambia la medida.
 */
function PlayerBar({
  es,
  item,
  playback,
  pendingAt,
  onClose,
}: {
  es: boolean;
  item: AudiobookItem;
  playback: AudiobookPlayback;
  pendingAt: React.MutableRefObject<number | undefined>;
  onClose: () => void;
}) {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // El arranque que dejó apuntado `open`, ya con el audiolibro correcto montado.
  React.useEffect(() => {
    const at = pendingAt.current;
    pendingAt.current = undefined;
    playback.start(at);
    // Solo al cambiar de audiolibro: es lo que marca una sesión nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  React.useEffect(() => {
    const audio = playback.audioRef.current;
    if (audio) { audio.volume = volume; audio.muted = muted; }
  }, [volume, muted, playback.audioRef, playback.phase]);

  const session = playback.session;
  const duration = session?.duration || item.duration || 0;
  const position = playback.time;
  const chapters = item.chapters || [];
  const chapterIndex = chapters.findIndex(
    (chapter) => position >= chapter.start && (chapter.end <= 0 || position < chapter.end)
  );
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : null;
  /*
    Debajo del título va el capítulo, salvo cuando el capítulo se llama igual que el
    audiolibro —lo normal en los que vienen de una pieza—, que entonces es repetir la
    misma palabra dos veces y no dice nada. Ahí vale más el autor.
  */
  const subtitle = chapter && chapter.title !== item.title ? chapter.title : (item.author || '');

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={`yoru-player-bar${expanded ? ' is-expanded' : ''}`}
      role="region"
      aria-label={es ? 'Reproductor' : 'Player'}
    >
      <audio
        ref={playback.audioRef}
        preload="metadata"
        onLoadedMetadata={playback.handlers.onLoadedMetadata}
        onTimeUpdate={playback.handlers.onTimeUpdate}
        onPlay={playback.handlers.onPlay}
        onPause={playback.handlers.onPause}
        onEnded={playback.handlers.onEnded}
        onError={playback.handlers.onError}
      />

      {/*
        El progreso va pegado al borde de arriba: se ve de un vistazo, sin leer. Lo
        recorrido se pinta con un degradado duro en el fondo, porque un `input` de
        rango no tiene forma de colorear solo la parte de la izquierda — y sin eso la
        barra es una línea gris igual al principio que al final.
      */}
      <input
        className="yoru-player-seek"
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        value={Math.floor(position)}
        style={{ '--yoru-played': `${duration > 0 ? (position / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(event) => playback.seekTo(Number(event.target.value))}
        aria-label={es ? 'Posición' : 'Position'}
      />

      <div className="yoru-player-row">
        <div className="yoru-player-now">
          <span className="yoru-player-cover">
            <img
              src={absCoverUrl(item.id)}
              alt=""
              onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
            />
          </span>
          <span className="yoru-player-text">
            <span className="yoru-player-title">{item.title}</span>
            <span className="yoru-player-sub">{subtitle}</span>
          </span>
        </div>

        <div className="yoru-player-controls">
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => playback.seekTo(chapters[chapterIndex - 1]?.start ?? 0)}
            disabled={chapterIndex <= 0}
            aria-label={es ? 'Capítulo anterior' : 'Previous chapter'}
          >
            <SkipBack size={17} />
          </button>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => playback.seekTo(position - 15)}
            aria-label={es ? 'Atrás 15 segundos' : 'Back 15 seconds'}
          >
            <RotateCcw size={17} />
            <span className="yoru-player-jump">15</span>
          </button>
          <button
            type="button"
            className="yoru-player-play"
            onClick={() => (playback.playing ? playback.pause() : playback.play())}
            aria-label={playback.playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Reproducir' : 'Play')}
          >
            {playback.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => playback.seekTo(position + 30)}
            aria-label={es ? 'Adelante 30 segundos' : 'Forward 30 seconds'}
          >
            <RotateCw size={17} />
            <span className="yoru-player-jump">30</span>
          </button>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => playback.seekTo(chapters[chapterIndex + 1]?.start ?? duration)}
            disabled={chapterIndex < 0 || chapterIndex >= chapters.length - 1}
            aria-label={es ? 'Capítulo siguiente' : 'Next chapter'}
          >
            <SkipForward size={17} />
          </button>
          <span className="yoru-player-clock">
            {formatClock(position)} <span>/</span> {formatClock(duration)}
          </span>
        </div>

        <div className="yoru-player-side">
          <button
            type="button"
            className="yoru-player-btn"
            onClick={playback.nextRate}
            aria-label={es ? 'Velocidad' : 'Speed'}
            title={es ? 'Velocidad' : 'Speed'}
          >
            <Gauge size={17} />
            <span className="yoru-player-jump">{playback.rate}×</span>
          </button>
          <div className="yoru-player-volume">
            <button
              type="button"
              className="yoru-player-btn"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? (es ? 'Quitar el silencio' : 'Unmute') : (es ? 'Silenciar' : 'Mute')}
            >
              <VolumeIcon size={17} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(event) => { setMuted(false); setVolume(Number(event.target.value) / 100); }}
              aria-label={es ? 'Volumen' : 'Volume'}
            />
          </div>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => playback.seekTo(position)}
            aria-label={es ? 'Guardar la posición' : 'Save position'}
            title={es ? 'Guardar la posición' : 'Save position'}
          >
            <Bookmark size={17} />
          </button>
          <button
            type="button"
            className="yoru-player-btn yoru-player-only-narrow"
            onClick={() => setExpanded((value) => !value)}
            aria-label={es ? 'Más' : 'More'}
          >
            <ChevronDown size={17} />
          </button>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={onClose}
            aria-label={es ? 'Cerrar el reproductor' : 'Close the player'}
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {playback.phase.kind === 'error' && (
        <p className="yoru-player-error" role="alert">{playback.phase.message}</p>
      )}
    </div>
  );
}
