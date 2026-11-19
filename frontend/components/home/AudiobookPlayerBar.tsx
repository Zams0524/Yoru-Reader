import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Gauge,
  ListMusic,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AudiobookItem } from '../../types/integrations';
import { absCoverUrl } from '../../utils/audiobookshelfService';
import { useAudiobookPlayback, type AudiobookPlayback } from './useAudiobookPlayback';
import { useAudiobookNotification } from './useAudiobookNotification';
import {
  AUDIO_PREFS_EVENT,
  getMarcadores,
  getSaltos,
  marcar,
  quitarMarcador,
  renombrarMarcador,
  SALTOS,
  setSaltos as guardarSaltos,
  type MarcadorAudio,
  type SaltosAudio,
} from '../../utils/reproductorAudio';

/*
  Cuánto salta cada botón ya no se decide aquí.

  Eran dos constantes —atrás 10, adelante 30— con una nota que decía «cuando sea
  configurable, este es el sitio del que tirar». Ya lo es: los dos saltos se eligen en
  «Más opciones › Saltos» y se guardan por perfil, porque los 30 de adelante son para
  saltarse un anuncio o un pasaje y hay quien los quiere en 15 y quien en 60.
*/

/**
 * El temporizador de sueño.
 *
 * `at` es un instante de reloj de pared, en milisegundos; `endSec`, un segundo del
 * audiolibro. Son dos cosas distintas a propósito: «en veinte minutos» es una alarma
 * y debe seguir corriendo aunque pauses, y «al acabar el capítulo» es un punto del
 * audio y debe esperarte si lo paras.
 */
type SleepTimer =
  | { kind: 'off' }
  | { kind: 'at'; at: number; minutes: number }
  | { kind: 'chapter'; endSec: number };

const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60];

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
  const [sleep, setSleep] = useState<SleepTimer>({ kind: 'off' });
  /*
    Los saltos y los marcadores se leen de lo guardado y se vuelven a leer con el
    aviso: la barra y el ampliado son dos vistas de lo mismo, y poner un marcador en
    uno tiene que verse en el otro sin cerrar nada.
  */
  const [saltos, setSaltos] = useState(getSaltos);
  const [marcadores, setMarcadores] = useState(() => getMarcadores(item.id));
  useEffect(() => {
    const onUpdate = () => { setSaltos(getSaltos()); setMarcadores(getMarcadores(item.id)); };
    onUpdate();
    window.addEventListener(AUDIO_PREFS_EVENT, onUpdate);
    return () => window.removeEventListener(AUDIO_PREFS_EVENT, onUpdate);
  }, [item.id]);

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

  /*
    El temporizador de sueño, que para de verdad.

    Dos formas, porque se usan en dos momentos distintos: «en N minutos», para el que
    se está durmiendo ya, y «al acabar el capítulo», para el que quiere terminar lo
    que está oyendo. El de minutos cuenta reloj de pared, no tiempo de audio: si
    pausas y te duermes, el temporizador sigue, que es lo que uno espera de una
    alarma. El de capítulo mira dónde va el audio, que es lo que uno espera de él.

    Se comprueba cada segundo y no con un `setTimeout` a lo lejos, porque saltar
    atrás, cambiar de capítulo o pausar mueven el objetivo.
  */
  /*
    Las dependencias son valores sueltos y no `playback` ni `sleep` enteros, y es lo
    que hace que esto funcione. `playback` es un objeto nuevo en cada render y el
    tiempo cambia cuatro veces por segundo: con el objeto en las dependencias, el
    intervalo se desmontaba y se volvía a montar antes de cumplir su primer segundo,
    así que no saltaba nunca. Lo probé y el audio se pasó de largo el final del
    capítulo tan tranquilo.

    Por eso lo que el intervalo necesita se lee de referencias, que siempre están al
    día, y el efecto solo se rehace cuando cambia el temporizador de verdad.
  */
  const marcaRef = useRef({ playback, sleep });
  marcaRef.current = { playback, sleep };
  const objetivo = sleep.kind === 'at' ? sleep.at : sleep.kind === 'chapter' ? sleep.endSec : 0;
  useEffect(() => {
    if (sleep.kind === 'off') return undefined;
    const timer = window.setInterval(() => {
      const { playback: ahora, sleep: puesto } = marcaRef.current;
      if (puesto.kind === 'off') return;
      const llegó = puesto.kind === 'at'
        ? Date.now() >= puesto.at
        // El segundo al que apuntaba el capítulo, medido en el audiolibro entero.
        : ahora.time >= puesto.endSec;
      if (!llegó) return;
      ahora.pause();
      setSleep({ kind: 'off' });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleep.kind, objetivo]);

  /*
    Android: lo que suena, en la notificación y en la pantalla de bloqueo. El botón del
    temporizador de ahí no tiene sitio para un menú, así que da vueltas: 15, 30, 60
    minutos y apagado. Para «al acabar el capítulo» está el reproductor ampliado.
  */
  const sleepNote = sleep.kind === 'at'
    ? (() => {
        const minutes = Math.max(1, Math.ceil((sleep.at - Date.now()) / 60_000));
        return es ? `Se apaga en ${minutes} min` : `Stops in ${minutes} min`;
      })()
    : sleep.kind === 'chapter'
      ? (es ? 'Se apaga al acabar el capítulo' : 'Stops at the end of the chapter')
      : '';
  useAudiobookNotification({
    source: 'audiobook',
    active: Boolean(session),
    id: item.id,
    title: item.title,
    subtitle,
    cover: absCoverUrl(item.id),
    playing: playback.playing,
    time: position,
    duration,
    rate: playback.rate,
    note: sleepNote,
    es,
    back: saltos.back,
    forward: saltos.forward,
    onPlay: playback.play,
    onPause: playback.pause,
    onSeek: playback.seekTo,
    onSleep: () => setSleep((previous) => {
      const steps = [15, 30, 60];
      const next = steps[(previous.kind === 'at' ? steps.indexOf(previous.minutes) : -1) + 1];
      return next ? { kind: 'at', at: Date.now() + next * 60_000, minutes: next } : { kind: 'off' };
    }),
    onClose,
  });

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
            onClick={() => playback.seekTo(position - saltos.back)}
            aria-label={es ? `Atrás ${saltos.back} segundos` : `Back ${saltos.back} seconds`}
          >
            <RotateCcw size={17} />
            <span className="yoru-player-jump">{saltos.back}</span>
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
            onClick={() => playback.seekTo(position + saltos.forward)}
            aria-label={es ? `Adelante ${saltos.forward} segundos` : `Forward ${saltos.forward} seconds`}
          >
            <RotateCw size={17} />
            <span className="yoru-player-jump">{saltos.forward}</span>
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
            /*
              Antes este botón decía «Guardar la posición» y lo que hacía era saltar al
              segundo en el que ya estabas, solo para forzar el guardado. El progreso se
              guarda solo —cada pocos segundos y al pausar—, así que el botón pasa a lo
              que un marcapáginas quiere decir: marcar este momento para volver. El
              nombre se le pone luego, en la lista del reproductor ampliado.
            */
            onClick={() => marcar(item.id, position)}
            aria-label={es ? 'Marcar este momento' : 'Bookmark this moment'}
            title={es ? 'Marcar este momento' : 'Bookmark this moment'}
          >
            <Bookmark size={17} />
          </button>
          <button
            type="button"
            className="yoru-player-btn"
            onClick={() => setExpanded(true)}
            aria-label={es ? 'Ampliar reproductor' : 'Expand player'}
            title={es ? 'Ampliar reproductor' : 'Expand player'}
          >
            <ChevronUp size={17} />
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

      {expanded && (
        <ExpandedPlayer
          es={es}
          item={item}
          playback={playback}
          position={position}
          duration={duration}
          chapters={chapters}
          chapterIndex={chapterIndex}
          volume={volume}
          muted={muted}
          sleep={sleep}
          saltos={saltos}
          marcadores={marcadores}
          onVolume={(value) => { setMuted(false); setVolume(value); }}
          onMute={() => setMuted((value) => !value)}
          onSleep={setSleep}
          onCollapse={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

/**
 * El reproductor a pantalla completa.
 *
 * Es la misma sesión y el mismo `<audio>` que la barra —no hay un segundo
 * reproductor—, solo otra manera de enseñarlo: la portada grande, el capítulo en
 * el que vas y los mandos a un tamaño que se acierta sin mirar.
 *
 * Ocupa la ventana entera con `position: fixed`, por encima de la barra. Como el
 * lector nunca está montado a la vez que el shell, no le cambia la medida de la
 * página a nadie: el lector sigue midiendo la ventana, que es lo suyo.
 */
function ExpandedPlayer({
  es,
  item,
  playback,
  position,
  duration,
  chapters,
  chapterIndex,
  volume,
  muted,
  sleep,
  saltos,
  marcadores,
  onVolume,
  onMute,
  onSleep,
  onCollapse,
}: {
  es: boolean;
  item: AudiobookItem;
  playback: AudiobookPlayback;
  position: number;
  duration: number;
  chapters: NonNullable<AudiobookItem['chapters']>;
  chapterIndex: number;
  volume: number;
  muted: boolean;
  sleep: SleepTimer;
  saltos: SaltosAudio;
  marcadores: MarcadorAudio[];
  onVolume: (value: number) => void;
  onMute: () => void;
  onSleep: (value: SleepTimer) => void;
  onCollapse: () => void;
}) {
  const [panel, setPanel] = useState<'none' | 'chapters' | 'sleep' | 'more' | 'bookmarks' | 'jumps'>('none');
  const tint = useCoverTint(item.id);
  /** El marcador al que se le está escribiendo el nombre, por su segundo. */
  const [renombrando, setRenombrando] = useState<number | null>(null);
  const [nombre, setNombre] = useState('');
  /*
    A la derecha, lo que queda del capítulo o del libro. Se puede cambiar porque las
    dos preguntas son normales y ninguna sustituye a la otra: «¿acabo el capítulo antes
    de dormirme?» y «¿cuánto me falta para terminarlo?».
  */
  const [ambito, setAmbito] = useState<'chapter' | 'book'>('chapter');

  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : null;
  /*
    A la derecha va lo que queda **del capítulo**, no del libro, y se dice cuál de
    las dos cosas es. Un «−0:02» suelto en un audiolibro de seis horas se lee como
    que el libro se acaba, y es sólo el capítulo.
  */
  const chapterEnd = chapter && chapter.end > 0 ? chapter.end : duration;
  const chapterLeft = Math.max(0, chapterEnd - position);

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className="yoru-player-full"
      /* El fondo toma el color de la portada; si no se puede leer, se queda el del tema. */
      style={tint ? ({ '--yoru-tint': tint } as React.CSSProperties) : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={es ? 'Reproductor' : 'Player'}
    >
      <div className="yoru-player-full-top">
        <button type="button" className="yoru-player-btn" onClick={onCollapse} aria-label={es ? 'Plegar' : 'Collapse'}>
          <ChevronDown size={22} />
        </button>
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => setPanel((open) => (open === 'more' ? 'none' : 'more'))}
          aria-label={es ? 'Más opciones' : 'More options'}
        >
          <MoreHorizontal size={22} />
        </button>
      </div>

      <div className="yoru-player-full-art">
        <img src={absCoverUrl(item.id)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </div>

      <h2 className="yoru-player-full-title">{item.title}</h2>
      {item.author && <p className="yoru-player-full-author">{item.author}</p>}

      {/* El capítulo es una fila pulsable: lleva a la lista, que es lo que se busca. */}
      {chapters.length > 0 && (
        <button
          type="button"
          className="yoru-player-full-chapter"
          onClick={() => setPanel((open) => (open === 'chapters' ? 'none' : 'chapters'))}
          aria-expanded={panel === 'chapters'}
        >
          <span>
            {chapterIndex >= 0 ? `${chapterIndex + 1}. ${chapters[chapterIndex].title}` : (es ? 'Capítulos' : 'Chapters')}
          </span>
          <ChevronRight size={16} />
        </button>
      )}

      <input
        className="yoru-player-full-seek"
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        value={Math.floor(position)}
        style={{ '--yoru-played': `${duration > 0 ? (position / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(event) => playback.seekTo(Number(event.target.value))}
        aria-label={es ? 'Posición' : 'Position'}
      />
      <div className="yoru-player-full-times">
        <span>{formatClock(position)}</span>
        <button
          type="button"
          className="yoru-player-full-left"
          onClick={() => setAmbito((previo) => (previo === 'chapter' ? 'book' : 'chapter'))}
          title={es ? 'Cambiar entre el capítulo y el libro' : 'Switch between chapter and book'}
        >
          {ambito === 'chapter'
            ? `${es ? 'CAPÍTULO' : 'CHAPTER'} −${formatClock(chapterLeft)}`
            : `${es ? 'LIBRO' : 'BOOK'} −${formatClock(Math.max(0, duration - position))}`}
        </button>
      </div>

      <div className="yoru-player-full-controls">
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => playback.seekTo(chapters[chapterIndex - 1]?.start ?? 0)}
          disabled={chapterIndex <= 0}
          aria-label={es ? 'Capítulo anterior' : 'Previous chapter'}
        >
          <SkipBack size={24} />
        </button>
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => playback.seekTo(position - saltos.back)}
          aria-label={es ? `Atrás ${saltos.back} segundos` : `Back ${saltos.back} seconds`}
        >
          <RotateCcw size={24} />
          <span className="yoru-player-jump">{saltos.back}</span>
        </button>
        <button
          type="button"
          className="yoru-player-full-play"
          onClick={() => (playback.playing ? playback.pause() : playback.play())}
          aria-label={playback.playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Reproducir' : 'Play')}
        >
          {playback.playing ? <Pause size={30} /> : <Play size={30} />}
        </button>
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => playback.seekTo(position + saltos.forward)}
          aria-label={es ? `Adelante ${saltos.forward} segundos` : `Forward ${saltos.forward} seconds`}
        >
          <RotateCw size={24} />
          <span className="yoru-player-jump">{saltos.forward}</span>
        </button>
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => playback.seekTo(chapters[chapterIndex + 1]?.start ?? duration)}
          disabled={chapterIndex < 0 || chapterIndex >= chapters.length - 1}
          aria-label={es ? 'Capítulo siguiente' : 'Next chapter'}
        >
          <SkipForward size={24} />
        </button>
      </div>

      <div className="yoru-player-full-tools">
        <button type="button" className="yoru-player-btn" onClick={playback.nextRate}>
          {playback.rate}×
        </button>
        <button
          type="button"
          className={`yoru-player-btn${sleep.kind !== 'off' ? ' is-on' : ''}`}
          onClick={() => setPanel((open) => (open === 'sleep' ? 'none' : 'sleep'))}
          aria-expanded={panel === 'sleep'}
          aria-label={es ? 'Temporizador de sueño' : 'Sleep timer'}
        >
          <Moon size={20} />
          {sleep.kind === 'at' && <span className="yoru-player-jump">{sleep.minutes}m</span>}
          {sleep.kind === 'chapter' && <span className="yoru-player-jump">{es ? 'cap.' : 'ch.'}</span>}
        </button>

        <span className="yoru-player-full-spacer" />

        <button type="button" className="yoru-player-btn" onClick={onMute} aria-label={es ? 'Silenciar' : 'Mute'}>
          <VolumeIcon size={20} />
        </button>
        <input
          className="yoru-player-full-volume"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(volume * 100)}
          onChange={(event) => onVolume(Number(event.target.value) / 100)}
          aria-label={es ? 'Volumen' : 'Volume'}
        />
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => setPanel((open) => (open === 'chapters' ? 'none' : 'chapters'))}
          aria-label={es ? 'Lista de capítulos' : 'Chapter list'}
        >
          <ListMusic size={20} />
        </button>
        <button
          type="button"
          className="yoru-player-btn"
          onClick={() => playback.seekTo(position)}
          aria-label={es ? 'Guardar la posición' : 'Save position'}
        >
          <Bookmark size={20} />
        </button>
      </div>

      {panel === 'chapters' && (
        <div className="yoru-player-full-panel">
          {chapters.length > 0 ? (
            <ul>
              {chapters.map((entry, index) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={index === chapterIndex ? 'current' : ''}
                    onClick={() => { playback.seekTo(entry.start); setPanel('none'); }}
                  >
                    <span>{index + 1}. {entry.title}</span>
                    <span>{formatClock(Math.max(0, entry.end - entry.start))}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{es ? 'Este audiolibro viene de una pieza.' : 'This audiobook comes in one piece.'}</p>
          )}
        </div>
      )}

      {panel === 'sleep' && (
        <div className="yoru-player-full-panel">
          <ul>
            {SLEEP_MINUTES.map((minutes) => (
              <li key={minutes}>
                <button
                  type="button"
                  className={sleep.kind === 'at' && sleep.minutes === minutes ? 'current' : ''}
                  onClick={() => { onSleep({ kind: 'at', at: Date.now() + minutes * 60_000, minutes }); setPanel('none'); }}
                >
                  <span>{es ? `En ${minutes} minutos` : `In ${minutes} minutes`}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className={sleep.kind === 'chapter' ? 'current' : ''}
                disabled={!chapter}
                onClick={() => { if (chapter) { onSleep({ kind: 'chapter', endSec: chapterEnd }); setPanel('none'); } }}
              >
                <span>{es ? 'Al acabar el capítulo' : 'At the end of the chapter'}</span>
              </button>
            </li>
            {sleep.kind !== 'off' && (
              <li>
                <button type="button" onClick={() => { onSleep({ kind: 'off' }); setPanel('none'); }}>
                  <span>{es ? 'Quitar el temporizador' : 'Turn the timer off'}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      {panel === 'more' && (
        <div className="yoru-player-full-panel">
          <ul>
            <li>
              <button type="button" onClick={() => setPanel('bookmarks')}>
                <span>{es ? 'Marcadores' : 'Bookmarks'}</span>
                <span>{marcadores.length || ''}</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => setPanel('jumps')}>
                <span>{es ? 'Saltos' : 'Jump amounts'}</span>
                <span>−{saltos.back}s / +{saltos.forward}s</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => { playback.seekTo(0); setPanel('none'); }}>
                <span>{es ? 'Volver al principio' : 'Back to the start'}</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => { onCollapse(); setPanel('none'); }}>
                <span>{es ? 'Plegar el reproductor' : 'Collapse the player'}</span>
              </button>
            </li>
          </ul>
        </div>
      )}

      {/*
        Marcadores: cada uno es un segundo del audiolibro con un nombre que le pones tú.
        Pulsarlo lleva ahí; el lápiz le cambia el nombre y la papelera lo quita. El
        nombre se escribe aquí y no al marcar, porque se marca en mitad de una frase
        —muchas veces desde la barra, sin abrir esto— y pararlo todo para pedir un
        título sería perder el momento que querías guardar.
      */}
      {panel === 'bookmarks' && (
        <div className="yoru-player-full-panel">
          <ul>
            <li>
              <button type="button" onClick={() => { marcar(item.id, position); setRenombrando(Math.round(position)); setNombre(''); }}>
                <span>{es ? 'Marcar este momento' : 'Bookmark this moment'}</span>
                <span>{formatClock(position)}</span>
              </button>
            </li>
            {marcadores.length === 0 ? (
              <li>
                <p>
                  {es
                    ? 'Todavía no has marcado nada. Guarda un momento para volver a él.'
                    : 'Nothing bookmarked yet. Save a moment to come back to it.'}
                </p>
              </li>
            ) : (
              marcadores.map((entrada) => (
                <li key={entrada.at} className="yoru-player-bookmark">
                  {renombrando === entrada.at ? (
                    <form
                      className="yoru-player-bookmark-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        renombrarMarcador(item.id, entrada.at, nombre.trim());
                        setRenombrando(null);
                      }}
                    >
                      <input
                        type="text"
                        value={nombre}
                        autoFocus
                        onChange={(event) => setNombre(event.target.value)}
                        placeholder={es ? 'Nombre (opcional)' : 'Label (optional)'}
                        aria-label={es ? 'Nombre del marcador' : 'Bookmark label'}
                      />
                      <button type="submit">{es ? 'Guardar' : 'Save'}</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={Math.abs(position - entrada.at) <= 2 ? 'current' : ''}
                        onClick={() => { playback.seekTo(entrada.at); setPanel('none'); }}
                      >
                        <span>{entrada.label || (es ? 'Sin nombre' : 'Unlabelled')}</span>
                        <span>{formatClock(entrada.at)}</span>
                      </button>
                      <span className="yoru-player-bookmark-tools">
                        <button
                          type="button"
                          onClick={() => { setRenombrando(entrada.at); setNombre(entrada.label); }}
                          aria-label={es ? 'Cambiar el nombre' : 'Edit label'}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => quitarMarcador(item.id, entrada.at)}
                          aria-label={es ? 'Quitar el marcador' : 'Delete bookmark'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {panel === 'jumps' && (
        <div className="yoru-player-full-panel">
          <ul>
            <li><p>{es ? 'Atrás' : 'Back'}</p></li>
            {SALTOS.map((segundos) => (
              <li key={`back-${segundos}`}>
                <button
                  type="button"
                  className={saltos.back === segundos ? 'current' : ''}
                  onClick={() => guardarSaltos({ ...saltos, back: segundos })}
                >
                  <span>{segundos} s</span>
                </button>
              </li>
            ))}
            <li><p>{es ? 'Adelante' : 'Forward'}</p></li>
            {SALTOS.map((segundos) => (
              <li key={`forward-${segundos}`}>
                <button
                  type="button"
                  className={saltos.forward === segundos ? 'current' : ''}
                  onClick={() => guardarSaltos({ ...saltos, forward: segundos })}
                >
                  <span>{segundos} s</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * El color dominante de la portada, para teñir el fondo del ampliado.
 *
 * Se lee de la propia imagen con un canvas diminuto —ocho por ocho basta para una
 * media— y se promedia. Si el servidor no deja leerla (es otro origen y puede no
 * mandar las cabeceras que hacen falta), el canvas queda marcado y lanza al leerlo:
 * ahí se devuelve vacío y el fondo se queda con el del tema, que es correcto y no
 * depende de que esto salga bien.
 */
function useCoverTint(itemId: string): string {
  const [tint, setTint] = useState('');
  useEffect(() => {
    setTint('');
    let alive = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!alive) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 8, 8);
        const { data } = context.getImageData(0, 0, 8, 8);
        let r = 0; let g = 0; let b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const count = data.length / 4;
        setTint(`rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`);
      } catch {
        // Portada de otro origen sin permiso para leerla: sin tinte, y sin ruido.
      }
    };
    image.src = absCoverUrl(itemId);
    return () => { alive = false; };
  }, [itemId]);
  return tint;
}
