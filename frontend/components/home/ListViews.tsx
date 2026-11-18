import React, { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { BookPoster, EmptyState, EntityCard } from './primitives';
import { byCreatedAt, byLastRead, formatCount, type EntityGroup, type ShelfBook } from './libraryIndex';

/** Cómo se ordena la cuadrícula. «default» es el orden en que llega la lista. */
type GridSort = 'default' | 'added' | 'read' | 'title';

/** Un filtro propio de la vista que usa la cuadrícula (por ejemplo, «con capítulos»). */
export interface GridFilter {
  label: string;
  options: { id: string; label: string; test: (book: ShelfBook) => boolean }[];
}

/** Cuadrícula de libros con buscador, usada por Catálogo, estantes y grupos. */
export function BookGridView({
  title,
  subtitle,
  books,
  es,
  onOpenDetail,
  onBack,
  filter,
}: {
  title: string;
  subtitle?: string;
  books: ShelfBook[];
  es: boolean;
  onOpenDetail: (book: ShelfBook) => void;
  onBack?: () => void;
  /** Un filtro más, al lado del buscador. El primero de sus valores es el de partida. */
  filter?: GridFilter;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<GridSort>('default');
  const [filterId, setFilterId] = useState(() => filter?.options[0]?.id || '');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const option = filter?.options.find((entry) => entry.id === filterId);
    let list = option ? books.filter(option.test) : books;
    if (needle) {
      list = list.filter((book) =>
        [book.title, book.author, book.series].filter(Boolean).join(' ').toLowerCase().includes(needle)
      );
    }
    // Se ordena sobre una copia: la lista que llega es de quien la pasa.
    if (sort === 'added') return [...list].sort(byCreatedAt);
    if (sort === 'read') return [...list].sort(byLastRead);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'ja', { numeric: true }));
    return list;
  }, [books, query, sort, filter, filterId]);

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
        {filter && (
          <div>
            <span className="yoru-control-label" id="grid-filter-label">{filter.label}</span>
            <label className="yoru-control-field">
              <select value={filterId} onChange={(event) => setFilterId(event.target.value)} aria-labelledby="grid-filter-label">
                {filter.options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div>
          <span className="yoru-control-label" id="grid-sort-label">{es ? 'Ordenar' : 'Sort'}</span>
          <label className="yoru-control-field">
            <select value={sort} onChange={(event) => setSort(event.target.value as GridSort)} aria-labelledby="grid-sort-label">
              <option value="default">{es ? 'Como viene' : 'Default'}</option>
              <option value="added">{es ? 'Añadidos recientemente' : 'Recently added'}</option>
              <option value="read">{es ? 'Leídos recientemente' : 'Recently read'}</option>
              <option value="title">{es ? 'Título' : 'Title'}</option>
            </select>
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
