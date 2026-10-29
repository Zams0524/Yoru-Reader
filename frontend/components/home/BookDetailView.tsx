import React, { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Headphones, Info, Play } from 'lucide-react';
import { BookRail, Cover } from './primitives';
import { bookStatus, sameAuthor, sameSeries, type ShelfBook } from './libraryIndex';
import { getAudiobookLink } from '../../utils/audiobookshelfService';

type Tab = 'summary' | 'chapters';

const STATUS_LABELS: Record<string, { es: string; en: string }> = {
  unread: { es: 'Por leer', en: 'To read' },
  reading: { es: 'Leyendo', en: 'Reading' },
  completed: { es: 'Leído', en: 'Finished' },
  paused: { es: 'Pausado', en: 'Paused' },
  planning: { es: 'Planeado', en: 'Planned' },
};

function formatNumber(value: number, es: boolean): string {
  return value.toLocaleString(es ? 'es-ES' : 'en-US');
}

function formatHours(seconds: number, es: boolean): string {
  if (seconds < 60) return es ? 'menos de un minuto' : 'under a minute';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

/**
 * Vista de detalle del libro, adaptada de `#book-detail-view` de la plantilla.
 * La plantilla mostraba sinopsis, ISBN y valoraciones de Kavita; la biblioteca local
 * no guarda esos campos, así que la ficha enseña lo que sí hay: progreso real,
 * caracteres leídos, tiempo de lectura, capítulos y los tomos de la misma serie.
 */
export default function BookDetailView({
  book,
  books,
  es,
  onBack,
  onRead,
  onOpenChapter,
  onListen,
  onOpenDetail,
  onSetStatus,
  onOpenInfo,
}: {
  book: ShelfBook;
  books: ShelfBook[];
  es: boolean;
  onBack: () => void;
  onRead: (book: ShelfBook) => void;
  onOpenChapter: (book: ShelfBook, chapterIndex: number) => void;
  /** Abre el libro con el reproductor del audiolibro ya desplegado. */
  onListen?: (book: ShelfBook) => void;
  onOpenDetail: (book: ShelfBook) => void;
  onSetStatus: (book: ShelfBook, status: string) => void;
  onOpenInfo: (book: ShelfBook) => void;
}) {
  const [tab, setTab] = useState<Tab>('summary');

  const chapters = useMemo(() => (Array.isArray(book.chapters) ? book.chapters : []), [book.chapters]);
  // El audiolibro se vincula desde el lector (⋮ > Escuchar audiolibro); aquí solo se mira.
  const hasAudiobook = useMemo(() => Boolean(getAudiobookLink(book.id)), [book.id]);
  const series = useMemo(() => sameSeries(books, book), [books, book]);
  const byAuthor = useMemo(() => sameAuthor(books, book), [books, book]);

  const percent = Math.min(100, Math.max(0, Math.round(book.progress?.percent ?? 0)));
  const status = bookStatus(book);
  const statusLabel = STATUS_LABELS[status] ? (es ? STATUS_LABELS[status].es : STATUS_LABELS[status].en) : status;
  const started = percent > 0 || Boolean(book.lastRead);

  return (
    <div className="yoru-detail">
      <button type="button" className="yoru-detail-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {es ? 'Volver' : 'Back'}
      </button>

      <div className="yoru-detail-head">
        <div className="yoru-detail-cover">
          <Cover book={book} />
        </div>

        <div className="yoru-detail-info">
          <h1 className="yoru-detail-title">{book.title}</h1>
          <div className="yoru-detail-author">
            {book.author || (es ? 'Autor desconocido' : 'Unknown author')}
            {book.series ? ` · ${book.series}` : ''}
          </div>

          <div className="yoru-detail-badges">
            <span className="yoru-badge">JA</span>
            {chapters.length > 0 && (
              <span className="yoru-badge">
                {chapters.length} {es ? (chapters.length === 1 ? 'capítulo' : 'capítulos') : chapters.length === 1 ? 'chapter' : 'chapters'}
              </span>
            )}
            <span className="yoru-badge">{statusLabel}</span>
            {(book.tags || []).map((tag) => (
              <span key={tag} className="yoru-badge">#{tag}</span>
            ))}
          </div>

          <div className="yoru-detail-actions">
            <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => onRead(book)}>
              {started ? <Play size={16} /> : <BookOpen size={16} />}
              {started ? (es ? 'Continuar' : 'Continue') : es ? 'Leer' : 'Read'}
            </button>
            {onListen && hasAudiobook && (
              <button type="button" className="yoru-btn" onClick={() => onListen(book)}>
                <Headphones size={16} />
                {es ? 'Escuchar audiolibro' : 'Listen to audiobook'}
              </button>
            )}
            {status === 'completed' ? (
              <button type="button" className="yoru-btn" onClick={() => onSetStatus(book, 'reading')}>
                <Check size={16} />
                {es ? 'Marcar como leyendo' : 'Mark as reading'}
              </button>
            ) : (
              <button type="button" className="yoru-btn" onClick={() => onSetStatus(book, 'completed')}>
                <Check size={16} />
                {es ? 'Marcar como leído' : 'Mark as finished'}
              </button>
            )}
            <button type="button" className="yoru-btn" onClick={() => onOpenInfo(book)}>
              <Info size={16} />
              {es ? 'Detalles' : 'Details'}
            </button>
          </div>

          {percent > 0 && (
            <div className="yoru-detail-progress">
              <div className="yoru-detail-progress-bar">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="yoru-detail-progress-text">
                {es ? `${percent} % leído` : `${percent}% read`}
                {book.lastRead
                  ? ` · ${es ? 'última vez' : 'last read'} ${new Date(book.lastRead).toLocaleDateString(es ? 'es-ES' : 'en-US')}`
                  : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="yoru-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'summary'}
          className={`yoru-tab${tab === 'summary' ? ' active' : ''}`}
          onClick={() => setTab('summary')}
        >
          {es ? 'Resumen' : 'Summary'}
        </button>
        {chapters.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chapters'}
            className={`yoru-tab${tab === 'chapters' ? ' active' : ''}`}
            onClick={() => setTab('chapters')}
          >
            {es ? 'Capítulos' : 'Chapters'}
          </button>
        )}
      </div>

      {tab === 'summary' ? (
        <table className="yoru-meta-table">
          <tbody>
            <tr>
              <th>{es ? 'Autor' : 'Author'}</th>
              <td>{book.author || '—'}</td>
            </tr>
            {book.series && (
              <tr>
                <th>{es ? 'Serie' : 'Series'}</th>
                <td>{book.series}</td>
              </tr>
            )}
            <tr>
              <th>{es ? 'Capítulos' : 'Chapters'}</th>
              <td>{chapters.length || '—'}</td>
            </tr>
            <tr>
              <th>{es ? 'Caracteres leídos' : 'Characters read'}</th>
              <td>{formatNumber(book.progress?.charactersRead ?? 0, es)}</td>
            </tr>
            <tr>
              <th>{es ? 'Tiempo de lectura' : 'Reading time'}</th>
              <td>{formatHours(book.progress?.secondsRead ?? 0, es)}</td>
            </tr>
            <tr>
              <th>{es ? 'Añadido' : 'Added'}</th>
              <td>
                {book.createdAt
                  ? new Date(book.createdAt).toLocaleDateString(es ? 'es-ES' : 'en-US')
                  : '—'}
              </td>
            </tr>
            {(book.tags || []).length > 0 && (
              <tr>
                <th>{es ? 'Colecciones' : 'Collections'}</th>
                <td>{(book.tags || []).join(', ')}</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="yoru-chapter-list">
          {chapters.map((chapter: any, index: number) => (
            <button
              key={index}
              type="button"
              className={`yoru-chapter-row${index === (book.progress?.currentChapter ?? -1) ? ' current' : ''}`}
              onClick={() => onOpenChapter(book, index)}
            >
              <span className="yoru-chapter-index">{index + 1}</span>
              <span className="yoru-chapter-title">
                {chapter?.title || chapter?.name || `${es ? 'Capítulo' : 'Chapter'} ${index + 1}`}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 36 }}>
        <BookRail
          title={es ? 'Tomos de la serie' : 'Volumes in this series'}
          books={series}
          onOpen={onOpenDetail}
        />
        <BookRail
          title={es ? 'Más de este autor' : 'More from this author'}
          books={byAuthor}
          onOpen={onOpenDetail}
        />
      </div>
    </div>
  );
}
