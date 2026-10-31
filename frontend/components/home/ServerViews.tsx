import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Headphones, Link2, Loader2, Server, Settings as SettingsIcon, Unlink } from 'lucide-react';
import {
  absCoverUrl,
  audiobookMatchScore,
  bookIdForAudiobook,
  getAudiobook,
  getAudiobookLibraries,
  getAudiobooks,
  isAudiobookshelfConfigured,
  setAudiobookLink,
} from '../../utils/audiobookshelfService';
import type { AudiobookItem, AudiobookshelfLibrary } from '../../types/integrations';
import { describeServerError } from '../../utils/serverHttp';

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

  // La cuadrícula pide los items en modo reducido, así que el detalle hay que pedirlo
  // aparte; mientras llega se enseña lo que ya se tenía en lugar de una pantalla vacía.
  useEffect(() => {
    let alive = true;
    setFull(item);
    setLoading(true);
    setDescriptionOpen(false);
    setLinking(false);
    setLinkedBookId(bookIdForAudiobook(item.id));
    getAudiobook(item.id)
      .then((detail) => { if (alive) setFull(detail); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [item]);

  const chapters = full.chapters || [];

  /**
   * Los libros de la biblioteca a los que podría pertenecer este audiolibro, los que
   * mejor casan primero. El parecido lo calcula la misma función que usa el lector
   * para proponer un audiolibro, solo que mirando al revés.
   */
  const candidates = useMemo(() => {
    const books = libraryBooks || [];
    return [...books]
      .map((book) => ({ book, score: audiobookMatchScore(book, full) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.book);
  }, [libraryBooks, full]);
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
            Sin vínculo esta ficha no tenía un solo botón, y una pantalla sin nada
            que pulsar parece rota aunque no lo esté. El vínculo se hacía solo desde
            el lector, estando ya dentro del libro; aquí, mirando el audiolibro, es
            donde más apetece hacerlo, así que también se puede.
          */}
          {linkedBookId && onOpenLocalBook ? (
            <div className="yoru-detail-actions">
              <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => onOpenLocalBook(linkedBookId, true)}>
                <Headphones size={16} />
                {es ? 'Leer escuchando' : 'Read along'}
              </button>
              <button type="button" className="yoru-btn" onClick={() => onOpenLocalBook(linkedBookId)}>
                <BookOpen size={16} />
                {es ? 'Abrir el libro' : 'Open the book'}
              </button>
              <button type="button" className="yoru-btn" onClick={() => { setAudiobookLink(linkedBookId, null); setLinkedBookId(null); }}>
                <Unlink size={16} />
                {es ? 'Deshacer el vínculo' : 'Unlink'}
              </button>
            </div>
          ) : (
            <div className="yoru-detail-actions">
              <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => setLinking((open) => !open)}>
                <Link2 size={16} />
                {es ? 'Vincular con un libro tuyo' : 'Link to one of your books'}
              </button>
            </div>
          )}

          {!linkedBookId && linking && (
            candidates.length > 0 ? (
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
            ) : (
              <p className="yoru-empty-note">
                {es
                  ? 'No hay ningún libro en tu biblioteca al que vincularlo. Descárgalo primero desde Explorar Kavita; si este audiolibro no tiene libro, no hay nada que leer mientras suena.'
                  : 'There is no book in your library to link it to. Download it from Explore Kavita first; if this audiobook has no book, there is nothing to read along with.'}
              </p>
            )
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
          <div className="yoru-chapter-list">
            {chapters.map((chapter, index) => (
              <div key={chapter.id} className="yoru-chapter-row">
                <span className="yoru-chapter-index">{index + 1}</span>
                <span className="yoru-chapter-title">{chapter.title}</span>
                <span className="yoru-chapter-time">{formatDuration(chapter.end - chapter.start, es)}</span>
              </div>
            ))}
          </div>
        </>
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
}: {
  es: boolean;
  onOpenSettings: () => void;
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
