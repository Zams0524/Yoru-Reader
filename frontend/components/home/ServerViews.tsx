import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Headphones, ListPlus, Loader2, MoreHorizontal, Pause, Play, Server, Settings as SettingsIcon } from 'lucide-react';
import {
  absCoverUrl,
  audiobookMatchScore,
  bookIdForAudiobook,
  getAudiobook,
  getAudiobookLibraries,
  getAudiobookProgress,
  getAudiobooks,
  isAudiobookshelfConfigured,
  setAudiobookLink,
} from '../../utils/audiobookshelfService';
import type { AudiobookItem, AudiobookshelfLibrary } from '../../types/integrations';
import { describeServerError } from '../../utils/serverHttp';
import { getCachedServerCatalog, sample, serverItemId, type ServerItem } from '../../utils/serverCatalog';
import { Rail } from './primitives';
import { useAudiobookPlayer } from './AudiobookPlayerBar';
import { isAudiobookInList, toggleAudiobookInList } from '../../utils/audiobookList';

/**
 * Las vistas de servidor dentro del lienzo del shell: el contenido de Kavita y el de
 * Audiobookshelf se miran desde la barra lateral, no desde Ajustes. Sin credenciales
 * no se da un error seco, sino el estado vacío con el camino para ponerlas.
 */

export function ServerEmptyState({
  kind,
  es,
  onOpenSettings,
}: {
  kind: 'kavita' | 'audiobookshelf';
  es: boolean;
  onOpenSettings: () => void;
}) {
  const isKavita = kind === 'kavita';
  const Icon = isKavita ? Server : Headphones;
  return (
    <div className="yoru-server-empty">
      <Icon size={34} aria-hidden="true" />
      <h2 className="yoru-stats-title">{isKavita ? 'Kavita' : 'Audiobookshelf'}</h2>
      <p className="yoru-empty-note">
        {isKavita
          ? es
            ? 'Conecta tu servidor Kavita y tus novelas aparecerán aquí, listas para leer o descargar.'
            : 'Connect your Kavita server and your novels show up here, ready to read or download.'
          : es
            ? 'Conecta tu servidor Audiobookshelf y tus audiolibros aparecerán aquí.'
            : 'Connect your Audiobookshelf server and your audiobooks show up here.'}
      </p>
      <button type="button" className="yoru-btn yoru-btn-primary" onClick={onOpenSettings}>
        <SettingsIcon size={16} />
        {es ? 'Configurar servidor' : 'Set up the server'}
      </button>
    </div>
  );
}

function formatDuration(seconds: number, es: boolean): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

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
 * El texto de una sinopsis que viene con HTML dentro.
 *
 * Los saltos (`<br>`, `</p>`) se conservan como saltos de línea de verdad, el resto
 * de etiquetas se quita y las entidades se descodifican. No se inyecta como HTML a
 * propósito: lo que manda el servidor no entra en la página como marcado.
 */
function plainText(raw: string): string {
  if (!raw) return '';
  const withBreaks = raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const decoded = withBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\n{3,}/g, '\n\n').trim();
}

/** Fila que no existe cuando no hay valor; la ficha no pinta huecos. */
function MetaRow({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <tr>
      <th>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

/**
 * La ficha de un audiolibro del servidor.
 *
 * Es la otra mitad del vínculo: desde el libro ya se llegaba al audiolibro, pero no al
 * revés, porque el catálogo de Audiobookshelf era una cuadrícula de portadas sin
 * detalle. Aquí se enseña lo que Audiobookshelf guarda y Kavita no tiene (narrador,
 * ASIN, duración, capítulos) y, si algún libro de la biblioteca apunta a este
 * audiolibro, el botón para abrirlo.
 */
/**
 * Cuántos audiolibros por tanda.
 *
 * Suficientes para llenar la pantalla de sobra y que la cascada no vaya pidiendo
 * cada dos filas, y pocos para que la primera tanda aparezca pronto.
 */
const AUDIO_PAGE_SIZE = 48;

/** Las pestañas de la ficha, en el orden en que se necesitan. */
const TABS: { id: 'summary' | 'technical' | 'chapters' | 'history'; es: string; en: string }[] = [
  { id: 'summary', es: 'Resumen', en: 'Summary' },
  { id: 'technical', es: 'Técnico', en: 'Technical' },
  { id: 'chapters', es: 'Capítulos', en: 'Chapters' },
  { id: 'history', es: 'Historial de escucha', en: 'Listening history' },
];

function AudiobookDetail({
  item,
  es,
  onBack,
  onOpenLocalBook,
  libraryBooks,
}: {
  item: AudiobookItem;
  es: boolean;
  onBack: () => void;
  onOpenLocalBook?: (bookId: string, listen?: boolean) => void;
  /** La biblioteca local, para poder vincular desde aquí. */
  libraryBooks?: { id: string; title: string; author?: string }[];
}) {
  const [full, setFull] = useState<AudiobookItem>(item);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkedBookId, setLinkedBookId] = useState<string | null>(() => bookIdForAudiobook(item.id));
  // Por dónde iba, según el servidor, para poder decir «Continuar · N %» antes de
  // abrir sesión. Sin esto habría que empezar a sonar para saberlo.
  const [saved, setSaved] = useState<{ currentTime: number; duration: number } | null>(null);
  /*
    El reproductor ya no es de esta ficha: vive en la barra de abajo, que sobrevive a
    salir de aquí. Esta pantalla solo le dice qué poner y le pregunta por dónde va.
  */
  const player = useAudiobookPlayer();
  const playback = player.playback;
  /** ¿Lo que suena es este audiolibro? Si no, sus mandos no hablan de esta ficha. */
  const isCurrent = player.current?.id === item.id;
  const [tab, setTab] = useState<'summary' | 'technical' | 'chapters' | 'history'>('summary');
  const [moreOpen, setMoreOpen] = useState(false);
  const [inList, setInList] = useState(() => isAudiobookInList(item.id));

  // La cuadrícula pide los items en modo reducido, así que el detalle hay que pedirlo
  // aparte; mientras llega se enseña lo que ya se tenía en lugar de una pantalla vacía.
  useEffect(() => {
    let alive = true;
    setFull(item);
    setLoading(true);
    setDescriptionOpen(false);
    setLinking(false);
    setLinkedBookId(bookIdForAudiobook(item.id));
    setSaved(null);
    getAudiobook(item.id)
      .then((detail) => { if (alive) setFull(detail); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    getAudiobookProgress(item.id).then((progress) => { if (alive) setSaved(progress); });
    return () => { alive = false; };
  }, [item]);

  const chapters = full.chapters || [];
  const duration = (isCurrent && playback.session?.duration) || full.duration || saved?.duration || 0;
  const listening = isCurrent && playback.phase.kind === 'ready';
  const position = listening ? playback.time : (saved?.currentTime || 0);
  const percent = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  const nowChapter = chapters.findIndex(
    (chapter) => position >= chapter.start && (chapter.end <= 0 || position < chapter.end),
  );

  /**
   * Los libros de la biblioteca a los que podría pertenecer este audiolibro, los que
   * mejor casan primero. El parecido lo calcula la misma función que usa el lector
   * para proponer un audiolibro, solo que mirando al revés.
   */
  const scored = useMemo(() => {
    const books = libraryBooks || [];
    return [...books]
      .map((book) => ({ book, score: audiobookMatchScore(book, full) }))
      .sort((a, b) => b.score - a.score);
  }, [libraryBooks, full]);
  const candidates = useMemo(() => scored.map((entry) => entry.book), [scored]);
  /**
   * Si ni el mejor llega a parecerse, se dice. Listar tres libros al azar como si
   * fueran candidatos es peor que admitir que no hay ninguno: invita a vincular mal.
   */
  const likely = (scored[0]?.score ?? 0) >= 0.3;
  /*
    Audiobookshelf devuelve la sinopsis con HTML dentro, y salía en crudo: el lector
    veía «<br />» escrito en mitad de la frase. Aquí se pasa a texto — los saltos de
    línea se respetan, las etiquetas se van — en vez de inyectarlo como HTML, que
    sería meter en la página lo que mande el servidor.
  */
  const description = plainText(full.description || '');
  const longDescription = description.length > 420;

  return (
    <div className="yoru-detail">
      <button type="button" className="yoru-detail-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {es ? 'Volver' : 'Back'}
      </button>

      <div className="yoru-detail-head">
        <div className="yoru-detail-cover">
          <img src={absCoverUrl(full.id)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        </div>
        <div className="yoru-detail-info">
          <h1 className="yoru-detail-title">{full.title}</h1>
          {full.author && <div className="yoru-detail-author">{full.author}</div>}
          {full.narrator && (
            <div className="yoru-detail-author">{es ? 'Narrado por' : 'Narrated by'} {full.narrator}</div>
          )}

          {/*
            Qué es esto y en qué formatos lo tienes, en una línea y en este orden:
            primero que es un audiolibro, y al final que además existe el libro, que
            es justamente lo que esta app viene a juntar.
          */}
          <div className="yoru-detail-kinds">
            <span>{es ? 'Audiolibro' : 'Audiobook'}</span>
            {full.publishedYear && <span>{full.publishedYear}</span>}
            {formatDuration(full.duration, es) && <span>{formatDuration(full.duration, es)}</span>}
            {chapters.length > 1 && <span>{chapters.length} {es ? 'capítulos' : 'chapters'}</span>}
            {linkedBookId && <span className="is-linked">{es ? 'Libro electrónico' : 'Ebook'}</span>}
          </div>

          <div className="yoru-detail-badges">
            {full.series && <span className="yoru-badge">{full.series}</span>}
          </div>

          {/*
            Escuchar es lo que se viene a hacer a la ficha de un audiolibro, así que
            es el botón principal. Leer escuchando solo aparece cuando hay libro
            vinculado, y vincular baja a acción secundaria: es un ajuste que se hace
            una vez, no la acción de esta pantalla.
          */}
          <div className="yoru-detail-actions">
            <button
              type="button"
              className="yoru-btn yoru-btn-primary"
              onClick={() => (isCurrent && playback.playing ? playback.pause() : player.open(full))}
              disabled={isCurrent && playback.phase.kind === 'loading'}
            >
              {isCurrent && playback.phase.kind === 'loading' ? <Loader2 size={16} className="guide-spin" />
                : isCurrent && playback.playing ? <Pause size={16} />
                : <Play size={16} />}
              {isCurrent && playback.phase.kind === 'loading' ? (es ? 'Preparando' : 'Preparing')
                : isCurrent && playback.playing ? (es ? 'Pausar' : 'Pause')
                : percent > 0 ? (es ? `Continuar · ${percent} %` : `Continue · ${percent}%`)
                : (es ? 'Escuchar' : 'Listen')}
            </button>

            {/*
              «Leer y escuchar» es la razón de ser de esta app, así que está arriba
              siempre. Sin libro vinculado no se esconde: lleva a vincularlo, que es
              el paso que falta, en vez de hacer como que la opción no existe.
            */}
            <button
              type="button"
              className="yoru-btn"
              onClick={() => {
                if (linkedBookId && onOpenLocalBook) onOpenLocalBook(linkedBookId, true);
                else setLinking(true);
              }}
            >
              <Headphones size={16} />
              {es ? 'Leer y escuchar' : 'Read and listen'}
            </button>

            {/*
              Una lista de verdad, no un menú que no lleva a ningún sitio: lo que se
              añade aquí sale en «Tu lista» en Inicio. Por eso es un interruptor y no
              un desplegable de estantes — los estantes se calculan del progreso de
              los libros tuyos, y este audiolibro no es tuyo, es del servidor.
            */}
            <button
              type="button"
              className={`yoru-btn${inList ? ' is-on' : ''}`}
              onClick={() => { toggleAudiobookInList(full.id); setInList(isAudiobookInList(full.id)); }}
              aria-pressed={inList}
            >
              {inList ? <Check size={16} /> : <ListPlus size={16} />}
              {inList ? (es ? 'En tu lista' : 'In your list') : (es ? 'Añadir a lista' : 'Add to list')}
            </button>

            <button
              type="button"
              className="yoru-btn yoru-btn-icon"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-label={es ? 'Más opciones' : 'More options'}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>

          {moreOpen && (
            <div className="yoru-detail-menu" role="menu">
              {linkedBookId && onOpenLocalBook && (
                <button type="button" role="menuitem" onClick={() => onOpenLocalBook(linkedBookId)}>
                  {es ? 'Abrir el libro' : 'Open the book'}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setLinking((open) => !open); }}>
                {linkedBookId
                  ? (es ? 'Cambiar el libro vinculado' : 'Change the linked book')
                  : (es ? 'Vincular con un libro tuyo' : 'Link to one of your books')}
              </button>
              {linkedBookId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setAudiobookLink(linkedBookId, null); setLinkedBookId(null); setMoreOpen(false); }}
                >
                  {es ? 'Deshacer el vínculo' : 'Unlink'}
                </button>
              )}
            </div>
          )}

          {playback.phase.kind === 'error' && (
            <p className="yoru-stats-empty" role="alert">{playback.phase.message}</p>
          )}

          {/*
            Los mandos ya no están aquí: están en la barra de abajo, que no se va al
            cambiar de pantalla. Repetirlos en la ficha sería tener dos reproductores
            para un solo audio, y el de aquí desaparecería al salir.
          */}

        </div>
      </div>

      {/*
        Cuatro pestañas en vez de una columna infinita. Antes la ficha era sinopsis,
        tabla de datos y lista de capítulos, una detrás de otra: en un audiolibro de
        sesenta capítulos había que bajar media pantalla para llegar a lo que se
        venía a ver.

        El orden es el de siempre: primero de qué va, luego los datos, luego por
        dónde ir, y al final lo que ya escuchaste.
      */}
      <div className="yoru-detail-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`yoru-detail-tab${tab === entry.id ? ' active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {es ? entry.es : entry.en}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        description ? (
          <div className="yoru-server-summary">
            <p className={longDescription && !descriptionOpen ? 'is-clamped' : ''}>{description}</p>
            {longDescription && (
              <button type="button" className="yoru-server-more" onClick={() => setDescriptionOpen((open) => !open)}>
                {descriptionOpen ? (es ? 'Leer menos' : 'Read less') : (es ? 'Leer más' : 'Read more')}
              </button>
            )}
          </div>
        ) : (
          <p className="yoru-stats-empty">
            {es ? 'Este audiolibro no trae sinopsis.' : 'This audiobook has no summary.'}
          </p>
        )
      )}

      {tab === 'technical' && (
      <table className="yoru-meta-table">
        <tbody>
          <MetaRow label={es ? 'Autor' : 'Author'} value={full.author} />
          <MetaRow label={es ? 'Narrador' : 'Narrator'} value={full.narrator} />
          <MetaRow label={es ? 'Serie' : 'Series'} value={full.series} />
          <MetaRow label={es ? 'Duración' : 'Duration'} value={formatDuration(full.duration, es)} />
          <MetaRow label={es ? 'Capítulos' : 'Chapters'} value={chapters.length > 1 ? chapters.length : undefined} />
          <MetaRow label={es ? 'Editorial' : 'Publisher'} value={full.publisher} />
          <MetaRow label={es ? 'Año' : 'Year'} value={full.publishedYear} />
          <MetaRow label={es ? 'Idioma' : 'Language'} value={full.language} />
          <MetaRow label="ISBN" value={full.isbn} />
          <MetaRow label="ASIN" value={full.asin} />
        </tbody>
      </table>
      )}

      {loading && (
        <p className="yoru-stats-empty"><Loader2 size={16} className="guide-spin" /></p>
      )}

      {tab === 'chapters' && (
        chapters.length > 1 ? (
          /* Estaban ahí con sus duraciones pidiendo que los pulsaras, y no hacían nada. */
          <div className="yoru-chapter-list">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                type="button"
                className={`yoru-chapter-row${index === nowChapter ? ' current' : ''}`}
                onClick={() => player.open(full, chapter.start)}
              >
                <span className="yoru-chapter-index">{index + 1}</span>
                <span className="yoru-chapter-title">{chapter.title}</span>
                <span className="yoru-chapter-time">{formatDuration(chapter.end - chapter.start, es)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="yoru-stats-empty">
            {es ? 'Este audiolibro viene de una pieza, sin capítulos.' : 'This audiobook comes in one piece, with no chapters.'}
          </p>
        )
      )}

      {/*
        El historial sale del propio servidor, que es quien lleva la cuenta y la
        comparte con el móvil. Decimos lo que sabe —por dónde vas y cuánto queda— y
        no fingimos una lista de sesiones que Audiobookshelf no nos da por audiolibro.
      */}
      {tab === 'history' && (
        saved || listening ? (
          <table className="yoru-meta-table">
            <tbody>
              <MetaRow
                label={es ? 'Por dónde vas' : 'Where you are'}
                value={`${formatClock(position)} ${es ? 'de' : 'of'} ${formatClock(duration)}`}
              />
              <MetaRow label={es ? 'Escuchado' : 'Listened'} value={`${percent} %`} />
              <MetaRow
                label={es ? 'Te queda' : 'Left'}
                value={formatDuration(Math.max(0, duration - position), es)}
              />
              {nowChapter >= 0 && (
                <MetaRow label={es ? 'Capítulo actual' : 'Current chapter'} value={chapters[nowChapter].title} />
              )}
            </tbody>
          </table>
        ) : (
          <p className="yoru-stats-empty">
            {es ? 'Todavía no has escuchado nada de este audiolibro.' : 'You have not listened to any of this audiobook yet.'}
          </p>
        )
      )}

      {/*
        Elegir el libro vive aquí abajo, pero ya no se abre desde aquí: poner y
        quitar el vínculo está en el menú «…» de arriba, con las demás cosas que se
        hacen una vez. Lo que queda es la lista de candidatos, que necesita sitio.
      */}
      <div className="yoru-server-section">
        {!linkedBookId && linking && (
          candidates.length === 0 ? (
            <p className="yoru-empty-note">
              {es
                ? 'Tu biblioteca está vacía. Descarga el libro desde Explorar Kavita y vuelve aquí.'
                : 'Your library is empty. Download the book from Explore Kavita and come back.'}
            </p>
          ) : (
            <>
              {!likely && (
                <p className="yoru-empty-note">
                  {es
                    ? 'Ninguno de tus libros se parece a este audiolibro. Estos son todos, por si lo quieres vincular igualmente.'
                    : 'None of your books looks like this audiobook. These are all of them, in case you want to link it anyway.'}
                </p>
              )}
              <ul className="yoru-link-list">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className="yoru-link-row"
                      onClick={() => {
                        setAudiobookLink(candidate.id, { itemId: full.id, title: full.title, chapters: chapters.length });
                        setLinkedBookId(candidate.id);
                        setLinking(false);
                      }}
                    >
                      <span className="yoru-link-title">{candidate.title}</span>
                      {candidate.author && <span className="yoru-link-author">{candidate.author}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Una serie de audiolibros, con sus tomos.
 *
 * La serie no es una entidad de Audiobookshelf: el montón lo hacemos nosotros
 * agrupando por el campo `series` que trae cada audiolibro. Por eso esta vista no
 * pide nada al servidor — sale entera de la misma caché que alimenta los carruseles
 * de Inicio, así que aparece al instante y funciona sin red.
 *
 * Existe porque la tarjeta «Serie A · 3 audiolibros» tenía que llevar a los tres.
 * Antes llevaba al primero, que es peor que no llevar a ningún sitio: el usuario
 * cree que ha llegado.
 */
export function AudiobookSeriesView({
  seriesKey,
  es,
  onBack,
  onOpenItem,
}: {
  seriesKey: string;
  es: boolean;
  onBack: () => void;
  onOpenItem: (item: ServerItem) => void;
}) {
  const items = useMemo(() => {
    const catalog = getCachedServerCatalog();
    return catalog.audiobooks
      .filter((item) => item.series === seriesKey)
      // Por título y con números de verdad, para que el tomo 2 no caiga tras el 10.
      .sort((a, b) => a.title.localeCompare(b.title, 'ja', { numeric: true }));
  }, [seriesKey]);

  const author = items.find((item) => item.author)?.author;

  return (
    <div>
      <button type="button" className="yoru-detail-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {es ? 'Volver' : 'Back'}
      </button>

      <div className="yoru-view-head">
        <div className="yoru-series-head">
          <span className="yoru-series-head-cover">
            {items[0]?.cover ? <img src={items[0].cover} alt="" loading="lazy" /> : <span />}
          </span>
          <span>
            <h1 className="yoru-view-title">{seriesKey}</h1>
            <span className="yoru-view-sub">
              {items.length}{' '}
              {es
                ? items.length === 1 ? 'audiolibro' : 'audiolibros'
                : items.length === 1 ? 'audiobook' : 'audiobooks'}
              {author ? ` · ${author}` : ''}
            </span>
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="yoru-empty-note">
          {es
            ? 'De esta serie no queda nada en la lista guardada. Abre Audiolibros para traerla otra vez del servidor.'
            : 'Nothing from this series is left in the saved list. Open Audiobooks to fetch it from the server again.'}
        </p>
      ) : (
        <ul className="yoru-link-list yoru-volume-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button type="button" className="yoru-volume-row" onClick={() => onOpenItem(item)}>
                <span className="yoru-volume-index">{index + 1}</span>
                <span className="yoru-volume-cover">
                  {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span />}
                </span>
                <span className="yoru-volume-text">
                  <span className="yoru-link-title">{item.title}</span>
                  {item.author && <span className="yoru-link-author">{item.author}</span>}
                </span>
                <span className="yoru-volume-listen">
                  <Headphones size={15} aria-hidden="true" />
                  <span>{es ? 'Escuchar' : 'Listen'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El catálogo de audiolibros del servidor, biblioteca a biblioteca. */
export function AudiobookshelfView({
  es,
  onOpenSettings,
  onOpenLocalBook,
  libraryBooks,
  initialItemId,
}: {
  es: boolean;
  onOpenSettings: () => void;
  /** Ficha que hay que abrir al entrar, cuando se llega pulsando una portada de Inicio. */
  initialItemId?: string;
  /** Abre un libro de la biblioteca; con `listen`, con el audiolibro desplegado. */
  onOpenLocalBook?: (bookId: string, listen?: boolean) => void;
  /** La biblioteca local, para poder vincular un audiolibro desde su ficha. */
  libraryBooks?: { id: string; title: string; author?: string }[];
}) {
  const [open, setOpen] = useState<AudiobookItem | null>(null);
  const [libraries, setLibraries] = useState<AudiobookshelfLibrary[] | null>(null);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [items, setItems] = useState<AudiobookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seed, setSeed] = useState(1);
  /** El servidor dejó de dar aunque su cuenta dijera otra cosa. Corta la cascada. */
  const [agotado, setAgotado] = useState(false);

  const configured = isAudiobookshelfConfigured();

  /** El carrusel de aleatorios sale de la caché, la misma que alimenta Inicio. */
  const randomAudio = useMemo(() => sample(getCachedServerCatalog().audiobooks, 10, seed), [seed]);

  /** Abre la ficha de un audiolibro del que solo tenemos el id, como los de la caché. */
  const openById = useCallback((id: string) => {
    getAudiobook(id).then(setOpen).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!configured) return undefined;
    let alive = true;
    setLoading(true);
    getAudiobookLibraries()
      .then((list) => {
        if (!alive) return;
        setLibraries(list);
        setLibraryId((current) => current || list[0]?.id || null);
      })
      .catch((err) => { if (alive) setError(describeServerError(err, es)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [configured, es]);

  /*
    El catálogo, por tandas y en cascada.

    Antes pedía las primeras 48 y ahí se acababa: la cabecera decía «256 audiolibros»
    y la cuadrícula enseñaba 48, sin botón ni nada. Los otros doscientos y pico no
    había forma de verlos.

    Ahora cada tanda se suma a la anterior y la siguiente la pide el centinela de
    abajo al asomar. `pagina` va en base cero, que es como la cuenta el servidor.
  */
  const load = useCallback((id: string, pagina: number) => {
    let alive = true;
    setLoading(true);
    setError('');
    getAudiobooks(id, pagina, AUDIO_PAGE_SIZE)
      .then((page) => {
        if (!alive) return;
        /*
          Una tanda vacía corta la cascada. Si el servidor dice que hay 256 pero deja
          de dar, `items.length` no alcanza nunca a `total` y el centinela pediría
          sin parar. Más vale enseñar lo que hay y decir que se acabó.
        */
        if (pagina > 0 && page.items.length === 0) { setAgotado(true); return; }
        setItems((prev) => (pagina === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      })
      .catch((err) => { if (alive) setError(describeServerError(err, es)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [es]);

  useEffect(() => {
    if (!libraryId) return undefined;
    setItems([]);
    setAgotado(false);
    return load(libraryId, 0);
  }, [libraryId, load]);

  /*
    Igual que en Kavita: lo que el observador necesita se lee de una referencia y no
    de las dependencias, para que no se desmonte en mitad de cada tanda. Y no pide
    nada mientras ya está pidiendo, ni después de un fallo.
  */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const quedan = items.length < total && !agotado;
  const estado = useRef({ libraryId, items, total, loading, error, load, agotado });
  estado.current = { libraryId, items, total, loading, error, load, agotado };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        const ahora = estado.current;
        if (!ahora.libraryId || ahora.loading || ahora.error || ahora.agotado) return;
        if (ahora.items.length >= ahora.total) return;
        ahora.load(ahora.libraryId, Math.floor(ahora.items.length / AUDIO_PAGE_SIZE));
      },
      // Seiscientos píxeles por delante: la tanda siguiente llega antes de que se
      // toque fondo, así que no hay parón al final de la cuadrícula.
      { rootMargin: '600px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [libraryId, quedan]);

  /*
    Se llega desde una portada de Inicio: la ficha se abre sola. El detalle hay que
    pedirlo porque la cuadrícula pide los items en modo reducido, y el carrusel de
    Inicio sale de la caché, que guarda menos todavía.
  */
  useEffect(() => {
    if (!configured || !initialItemId) return undefined;
    let alive = true;
    getAudiobook(initialItemId)
      .then((item) => { if (alive) setOpen(item); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [configured, initialItemId]);

  if (!configured) return <ServerEmptyState kind="audiobookshelf" es={es} onOpenSettings={onOpenSettings} />;

  if (open) {
    return (
      <AudiobookDetail
        item={open}
        es={es}
        onBack={() => setOpen(null)}
        onOpenLocalBook={onOpenLocalBook}
        libraryBooks={libraryBooks}
      />
    );
  }

  return (
    <div>
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Audiolibros' : 'Audiobooks'}</h1>
          <div className="yoru-view-sub">
            {total > 0
              ? `${total} ${es ? (total === 1 ? 'audiolibro' : 'audiolibros') : total === 1 ? 'audiobook' : 'audiobooks'}`
              : es ? 'Tu servidor Audiobookshelf' : 'Your Audiobookshelf server'}
          </div>
        </div>
      </div>

      {/*
        «Audiolibros aleatorios» existía solo en Inicio, que es donde menos falta
        hace: aquí es donde se viene a buscar qué escuchar, y una cuadrícula de 48
        portadas ordenadas siempre igual enseña siempre lo mismo.
        Sale de la caché, así que no cuesta una petición más.
      */}
      {randomAudio.length > 0 && (
        <Rail
          title={es ? 'Audiolibros aleatorios' : 'Random audiobooks'}
          onMore={() => setSeed((value) => value + 1)}
          moreLabel={es ? 'Actualizar' : 'Shuffle'}
          es={es}
        >
          {randomAudio.map((item) => (
            <button
              key={`rnd-${item.id}`}
              type="button"
              className="yoru-poster is-audio"
              title={item.title}
              onClick={() => openById(serverItemId(item))}
            >
              <span className="yoru-poster-frame">
                <img src={item.cover} alt="" loading="lazy" />
                <span className="yoru-poster-play" aria-hidden="true">
                  <Play size={18} />
                </span>
              </span>
              <span className="yoru-poster-title">{item.title}</span>
              {item.author && <span className="yoru-poster-meta">{item.author}</span>}
            </button>
          ))}
        </Rail>
      )}

      {libraries && libraries.length > 1 && (
        <div className="yoru-chip-row">
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              className={`yoru-chip${library.id === libraryId ? ' active' : ''}`}
              onClick={() => setLibraryId(library.id)}
            >
              {library.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="yoru-stats-empty">{error}</p>}

      {loading && !items.length ? (
        <div className="app-section-loading" role="status" aria-live="polite">
          <span className="app-section-loading-indicator" />
          {es ? 'Cargando…' : 'Loading…'}
        </div>
      ) : (
        <div className="yoru-grid is-covers" aria-busy={loading}>
          {items.map((item) => (
            <button key={item.id} type="button" className="yoru-poster" onClick={() => setOpen(item)} title={item.title}>
              <span className="yoru-poster-frame">
                <img src={absCoverUrl(item.id)} alt="" loading="lazy" />
              </span>
              <span className="yoru-poster-title">{item.title}</span>
              {item.author && <span className="yoru-poster-meta">{item.author}</span>}
            </button>
          ))}
        </div>
      )}

      {/*
        El centinela de la cascada. Solo mientras queden audiolibros por traer; el
        botón aparece únicamente si la tanda falló, porque reintentar solo contra un
        servidor que no responde es machacarlo.
      */}
      {quedan && (
        <div ref={sentinelRef} className="yoru-more-zone" aria-hidden={!loading && !error}>
          {loading && items.length > 0 && (
            <span className="yoru-more-loading" role="status" aria-live="polite">
              <Loader2 size={18} className="guide-spin" />
              {es ? 'Trayendo más…' : 'Fetching more…'}
            </span>
          )}
          {!loading && error && libraryId && (
            <button
              type="button"
              className="yoru-btn"
              onClick={() => load(libraryId, Math.floor(items.length / AUDIO_PAGE_SIZE))}
            >
              {es ? 'Reintentar' : 'Try again'}
            </button>
          )}
        </div>
      )}

      {/* Que se ha llegado al final se dice; cortar en seco deja dudando. */}
      {!quedan && items.length > 0 && (
        <p className="yoru-more-end">{es ? 'No hay más audiolibros.' : 'No more audiobooks.'}</p>
      )}

      {!loading && !error && !items.length && (
        <p className="yoru-stats-empty">{es ? 'Esta biblioteca está vacía.' : 'This library is empty.'}</p>
      )}
    </div>
  );
}
