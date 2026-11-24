import React, { useMemo, useState } from 'react';
import { ArrowLeft, Search, Shuffle } from 'lucide-react';
import { BookPoster, EmptyState, EntityCard } from './primitives';
import { byCreatedAt, byLastRead, formatCount, type EntityGroup, type ShelfBook } from './libraryIndex';
import type { ServerGroup } from '../../utils/serverEntities';

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
  action,
}: {
  title: string;
  subtitle?: string;
  books: ShelfBook[];
  es: boolean;
  onOpenDetail: (book: ShelfBook) => void;
  onBack?: () => void;
  /** Un filtro más, al lado del buscador. El primero de sus valores es el de partida. */
  filter?: GridFilter;
  /** Un botón propio de la vista, en la cabecera (por ejemplo, «Editar reglas»). */
  action?: React.ReactNode;
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
        {/*
          «Sorpréndeme» abre uno al azar de lo que haya filtrado, no de la biblioteca
          entera: dentro de una colección o de un estante, lo que se pide es uno de
          *esos*. Con uno solo sobra el botón, porque ya se está viendo.
        */}
        <div className="yoru-view-head-actions">
          {action}
          {filtered.length > 1 && (
            <button
              type="button"
              className="yoru-btn"
              onClick={() => onOpenDetail(filtered[Math.floor(Math.random() * filtered.length)])}
            >
              <Shuffle size={15} />
              {es ? 'Sorpréndeme' : 'Surprise me'}
            </button>
          )}
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
  serverGroups,
  serverLoading,
  onOpenServerGroup,
}: {
  title: string;
  groups: EntityGroup[];
  unit: { singular: string; plural: string };
  es: boolean;
  onOpenGroup: (group: EntityGroup) => void;
  /**
   * Lo mismo, pero de los servidores de casa (Kavita y Audiobookshelf). Series y
   * autores no son solo de lo importado: con todo en el servidor, la sección salía
   * vacía aunque hubiera doscientas series a un toque.
   */
  serverGroups?: ServerGroup[];
  /** Se está trayendo el listado del servidor y todavía no hay nada guardado. */
  serverLoading?: boolean;
  onOpenServerGroup?: (group: ServerGroup) => void;
}) {
  const server = serverGroups || [];
  const total = groups.length + server.length;
  const both = groups.length > 0 && server.length > 0;
  return (
    <div>
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{title}</h1>
          <div className="yoru-view-sub">
            {formatCount(total, es ? 'resultado' : 'result', es ? 'resultados' : 'results')}
          </div>
        </div>
      </div>

      {total === 0 ? (
        serverLoading ? (
          <div className="app-section-loading" role="status" aria-live="polite">
            <span className="app-section-loading-indicator" />
            {es ? 'Buscando en el servidor…' : 'Looking on the server…'}
          </div>
        ) : (
          <EmptyState
            title={es ? 'Todavía no hay nada' : 'Nothing yet'}
            sub={
              es
                ? 'Añade series, autores o colecciones a tus libros desde sus detalles.'
                : 'Add series, authors or collections to your books from their details.'
            }
          />
        )
      ) : (
        <>
          {groups.length > 0 && (
            <>
              {both && <h2 className="yoru-entity-section">{es ? 'En tu biblioteca' : 'In your library'}</h2>}
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
            </>
          )}
          {server.length > 0 && (
            <>
              {both && <h2 className="yoru-entity-section">{es ? 'En el servidor' : 'On the server'}</h2>}
              <div className="yoru-entity-grid">
                {server.map((group) => (
                  <ServerEntityCard key={group.key} group={group} es={es} onOpen={onOpenServerGroup} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** La tarjeta de una serie o un autor del servidor: la misma pila de portadas. */
function ServerEntityCard({
  group,
  es,
  onOpen,
}: {
  group: ServerGroup;
  es: boolean;
  onOpen?: (group: ServerGroup) => void;
}) {
  const [main, left, right] = group.items;
  const kavita = group.items.filter((item) => item.source === 'kavita').length;
  const audio = group.items.length - kavita;
  const parts: string[] = [];
  if (kavita > 0) parts.push(formatCount(kavita, 'serie', 'series'));
  if (audio > 0) parts.push(formatCount(audio, es ? 'audiolibro' : 'audiobook', es ? 'audiolibros' : 'audiobooks'));
  // Una serie de Kavita es un título solo: lo que dice algo es su autor y de dónde viene.
  const subtitle = group.key.startsWith('kavita:')
    ? [main?.author, 'Kavita'].filter(Boolean).join(' · ')
    : parts.join(' · ');
  return (
    <button type="button" className="yoru-entity-card" onClick={() => onOpen?.(group)} title={group.name}>
      <span className="yoru-entity-stack">
        {left && (
          <span className="stack-cover stack-left">
            <img src={left.cover} alt="" loading="lazy" />
          </span>
        )}
        {right && (
          <span className="stack-cover stack-right">
            <img src={right.cover} alt="" loading="lazy" />
          </span>
        )}
        {main && (
          <span className="stack-main">
            <img src={main.cover} alt="" loading="lazy" />
          </span>
        )}
      </span>
      <span className="yoru-entity-name">{group.name}</span>
      <span className="yoru-entity-sub">{subtitle}</span>
    </button>
  );
}
