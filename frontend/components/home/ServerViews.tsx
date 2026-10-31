import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Headphones, Link2, Loader2, Pause, Play, RotateCcw, RotateCw, Server, Settings as SettingsIcon, Unlink } from 'lucide-react';
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
import { getCachedServerCatalog, type ServerItem } from '../../utils/serverCatalog';
import { useAudiobookPlayback } from './useAudiobookPlayback';

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
  const playback = useAudiobookPlayback(item.id, es);

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
  const duration = playback.session?.duration || full.duration || saved?.duration || 0;
  const listening = playback.phase.kind === 'ready';
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
  const description = full.description || '';
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
            <div className="yoru-detail-author">{es ? 'Narra' : 'Narrated by'} {full.narrator}</div>
          )}

          <div className="yoru-detail-badges">
            {formatDuration(full.duration, es) && <span className="yoru-badge">{formatDuration(full.duration, es)}</span>}
            {chapters.length > 1 && (
              <span className="yoru-badge">
                {chapters.length} {es ? 'capítulos' : 'chapters'}
              </span>
            )}
            {full.publishedYear && <span className="yoru-badge">{full.publishedYear}</span>}
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
              onClick={() => (playback.playing ? playback.pause() : playback.start())}
              disabled={playback.phase.kind === 'loading'}
            >
              {playback.phase.kind === 'loading' ? <Loader2 size={16} className="guide-spin" />
                : playback.playing ? <Pause size={16} />
                : <Play size={16} />}
              {playback.phase.kind === 'loading' ? (es ? 'Preparando' : 'Preparing')
                : playback.playing ? (es ? 'Pausar' : 'Pause')
                : percent > 0 ? (es ? `Continuar · ${percent} %` : `Continue · ${percent}%`)
                : (es ? 'Escuchar' : 'Listen')}
            </button>
            {linkedBookId && onOpenLocalBook && (
              <>
                <button type="button" className="yoru-btn" onClick={() => onOpenLocalBook(linkedBookId, true)}>
                  <Headphones size={16} />
                  {es ? 'Leer escuchando' : 'Read along'}
                </button>
                <button type="button" className="yoru-btn" onClick={() => onOpenLocalBook(linkedBookId)}>
                  <BookOpen size={16} />
                  {es ? 'Abrir el libro' : 'Open the book'}
                </button>
              </>
            )}
          </div>

          {playback.phase.kind === 'error' && (
            <p className="yoru-stats-empty" role="alert">{playback.phase.message}</p>
          )}

          {listening && playback.session && (
            <div className="yoru-ab-player">
              <audio
                ref={playback.audioRef}
                preload="metadata"
                onLoadedMetadata={playback.handlers.onLoadedMetadata}
                onTimeUpdate={playback.handlers.onTimeUpdate}
                onPlay={playback.handlers.onPlay}
                onPause={playback.handlers.onPause}
                onEnded={playback.handlers.onEnded}
              />
              <div className="yoru-ab-seek">
                <span>{formatClock(position)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(duration))}
                  value={Math.floor(position)}
                  onChange={(e) => playback.seekTo(Number(e.target.value))}
                  aria-label={es ? 'Posición' : 'Position'}
                />
                <span>-{formatClock(Math.max(0, duration - position))}</span>
              </div>
              <div className="yoru-ab-controls">
                <button type="button" className="yoru-btn" onClick={() => playback.seekTo(position - 15)}>
                  <RotateCcw size={16} /> 15
                </button>
                <button
                  type="button"
                  className="yoru-btn yoru-btn-primary"
                  onClick={() => (playback.playing ? playback.pause() : playback.play())}
                  aria-label={playback.playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Reproducir' : 'Play')}
                >
                  {playback.playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button type="button" className="yoru-btn" onClick={() => playback.seekTo(position + 30)}>
                  <RotateCw size={16} /> 30
                </button>
                <button type="button" className="yoru-btn" onClick={playback.nextRate} aria-label={es ? 'Velocidad' : 'Speed'}>
                  {playback.rate}×
                </button>
              </div>
            </div>
          )}

          {description && (
            <div className="yoru-server-summary">
              <p className={longDescription && !descriptionOpen ? 'is-clamped' : ''}>{description}</p>
              {longDescription && (
                <button type="button" className="yoru-server-more" onClick={() => setDescriptionOpen((open) => !open)}>
                  {descriptionOpen ? (es ? 'Leer menos' : 'Read less') : (es ? 'Leer más' : 'Read more')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

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

      {loading && (
        <p className="yoru-stats-empty"><Loader2 size={16} className="guide-spin" /></p>
      )}

      {chapters.length > 1 && (
        <>
          <h2 className="yoru-rail-title yoru-server-section">{es ? 'Capítulos' : 'Chapters'}</h2>
          {/* Estaban ahí con sus duraciones pidiendo que los pulsaras, y no hacían nada. */}
          <div className="yoru-chapter-list">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                type="button"
                className={`yoru-chapter-row${index === nowChapter ? ' current' : ''}`}
                onClick={() => playback.start(chapter.start)}
              >
                <span className="yoru-chapter-index">{index + 1}</span>
                <span className="yoru-chapter-title">{chapter.title}</span>
                <span className="yoru-chapter-time">{formatDuration(chapter.end - chapter.start, es)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/*
        Vincular con un libro vive aquí abajo, no arriba: se hace una vez por
        audiolibro y no es a lo que se viene. Donde de verdad vive «leer escuchando»
        es en su propia sección de la barra lateral.
      */}
      <div className="yoru-server-section">
        {linkedBookId ? (
          <button
            type="button"
            className="yoru-server-more"
            onClick={() => { setAudiobookLink(linkedBookId, null); setLinkedBookId(null); }}
          >
            <Unlink size={14} /> {es ? 'Deshacer el vínculo con el libro' : 'Unlink from the book'}
          </button>
        ) : (
          <button type="button" className="yoru-server-more" onClick={() => setLinking((open) => !open)}>
            <Link2 size={14} /> {es ? 'Vincular con un libro tuyo' : 'Link to one of your books'}
          </button>
        )}

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

  const configured = isAudiobookshelfConfigured();

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

  const load = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError('');
    getAudiobooks(id, 0, 48)
      .then((page) => { if (alive) { setItems(page.items); setTotal(page.total); } })
      .catch((err) => { if (alive) setError(describeServerError(err, es)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [es]);

  useEffect(() => {
    if (!libraryId) return undefined;
    return load(libraryId);
  }, [libraryId, load]);

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
        <div className="yoru-grid is-covers">
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

      {!loading && !error && !items.length && (
        <p className="yoru-stats-empty">{es ? 'Esta biblioteca está vacía.' : 'This library is empty.'}</p>
      )}
    </div>
  );
}
