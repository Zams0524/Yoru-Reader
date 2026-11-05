import React, { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { BookPoster, EmptyState, EntityCard } from './primitives';
import { formatCount, type EntityGroup, type ShelfBook } from './libraryIndex';

/** Cuadrícula de libros con buscador, usada por Catálogo, estantes y grupos. */
export function BookGridView({
  title,
  subtitle,
  books,
  es,
  onOpenDetail,
  onBack,
}: {
  title: string;
  subtitle?: string;
  books: ShelfBook[];
  es: boolean;
  onOpenDetail: (book: ShelfBook) => void;
  onBack?: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((book) =>
      [book.title, book.author, book.series].filter(Boolean).join(' ').toLowerCase().includes(needle)
    );
  }, [books, query]);

  return (
    <div>
      {onBack && (
        <button type="button" className="yoru-detail-back" onClick={onBack}>
          <ArrowLeft size={16} />
          {es ? 'Volver' : 'Back'}
        </button>
      )}

      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{title}</h1>
          <div className="yoru-view-sub">
            {subtitle ?? formatCount(books.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}
          </div>
        </div>
      </div>

      <div className="yoru-controls">
        <div>
          <span className="yoru-control-label" id="grid-search-label">{es ? 'Buscar' : 'Search'}</span>
          <label className="yoru-control-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={es ? 'Buscar por título o autor…' : 'Search by title or author…'}
              aria-labelledby="grid-search-label"
            />
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={es ? 'Nada por aquí' : 'Nothing here'} />
      ) : (
        <div className="yoru-grid is-covers">
          {filtered.map((book) => (
            <BookPoster key={book.id} book={book} onOpen={onOpenDetail} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Lista de series, autores o colecciones. */
export function EntityListView({
  title,
  groups,
  unit,
  es,
  onOpenGroup,
}: {
  title: string;
  groups: EntityGroup[];
  unit: { singular: string; plural: string };
  es: boolean;
  onOpenGroup: (group: EntityGroup) => void;
}) {
  return (
    <div>
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{title}</h1>
          <div className="yoru-view-sub">
            {formatCount(groups.length, es ? 'resultado' : 'result', es ? 'resultados' : 'results')}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={es ? 'Todavía no hay nada' : 'Nothing yet'}
          sub={
            es
              ? 'Añade series, autores o colecciones a tus libros desde sus detalles.'
              : 'Add series, authors or collections to your books from their details.'
          }
        />
      ) : (
        <div className="yoru-entity-grid">
          {groups.map((group) => (
            <EntityCard
              key={group.key}
              group={group}
              subtitle={formatCount(group.books.length, unit.singular, unit.plural)}
              onOpen={onOpenGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}
