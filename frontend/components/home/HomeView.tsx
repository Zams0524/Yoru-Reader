import React, { useEffect, useMemo, useState } from 'react';
import { BookRail, EmptyState, EntityCard, Rail } from './primitives';
import HomeServerSections from './HomeServerSections';
import type { ServerItem, ServerSeries } from '../../utils/serverCatalog';
import {
  collectionGroups,
  continueReading,
  coverImage,
  coverTint,
  formatCount,
  recentlyAdded,
  seriesGroups,
  suggestions,
  type EntityGroup,
  type ShelfBook,
} from './libraryIndex';

type Filter = 'all' | 'reading' | 'unopened';

/**
 * Vista «Inicio»: la portada de la plantilla (Continuar + carruseles) alimentada con
 * la biblioteca local. Los filtros de la plantilla eran Inicio/Libros/Audiolibros;
 * aquí no hay audiolibros, así que filtran por lo que el usuario ya empezó.
 */
export default function HomeView({
  books,
  es,
  onOpenDetail,
  onContinue,
  onGoCatalog,
  onOpenCollection,
  onOpenSeries,
  onOpenServerItem,
  onOpenServerSeries,
}: {
  books: ShelfBook[];
  es: boolean;
  onOpenDetail: (book: ShelfBook) => void;
  onContinue: (book: ShelfBook) => void;
  onGoCatalog: () => void;
  onOpenCollection: (group: EntityGroup) => void;
  onOpenSeries: (group: EntityGroup) => void;
  /** Abre un título del servidor: la serie en Kavita, el tomo en Audiobookshelf. */
  onOpenServerItem: (item: ServerItem) => void;
  /** Abre una serie de audiolibros, que por ahora es su primer tomo. */
  onOpenServerSeries: (series: ServerSeries) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const data = useMemo(() => {
    const scoped =
      filter === 'reading'
        ? books.filter((book) => book.lastRead)
        : filter === 'unopened'
          ? books.filter((book) => !book.lastRead)
          : books;
    return {
      continuing: continueReading(books),
      recent: recentlyAdded(scoped),
      forYou: suggestions(scoped),
      collections: collectionGroups(scoped).slice(0, 12),
      series: seriesGroups(scoped).filter((group) => group.books.length > 1).slice(0, 12),
    };
  }, [books, filter]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: es ? 'Todo' : 'All' },
    { key: 'reading', label: es ? 'Empezados' : 'Started' },
    { key: 'unopened', label: es ? 'Sin abrir' : 'Unopened' },
  ];
  void chips;
  void filter;

  // Inicio / Libros / Audiolibros, como la maqueta de referencia: filtran por tipo.
  const [scope, setScope] = useState<'all' | 'books' | 'audio'>('all');
  const scopes: { key: 'all' | 'books' | 'audio'; label: string }[] = [
    { key: 'all', label: es ? 'Inicio' : 'Home' },
    { key: 'books', label: es ? 'Libros' : 'Books' },
    { key: 'audio', label: es ? 'Audiolibros' : 'Audiobooks' },
  ];

  if (books.length === 0) {
    return (
      <EmptyState
        title={es ? 'Tu biblioteca está vacía' : 'Your library is empty'}
        sub={es ? 'Importa una novela para empezar a leer.' : 'Import a novel to start reading.'}
      />
    );
  }

  return (
    <div>
      <div className="yoru-chip-row" role="tablist" aria-label={es ? 'Filtrar' : 'Filter'}>
        {scopes.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={scope === item.key}
            className={`yoru-chip${scope === item.key ? ' active' : ''}`}
            onClick={() => setScope(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {scope !== 'audio' && data.continuing.length > 0 && (
        <Rail title={es ? 'Continuar' : 'Continue'}>
          {data.continuing.map((book) => {
            const percent = Math.min(100, Math.max(0, Math.round(book.progress?.percent ?? 0)));
            // Miniatura de 56 px: aquí el respaldo es solo color, sin el título, que a
            // ese tamaño no se lee. Quién tiene imagen y quién degradado lo decide
            // `coverImage` / `coverTint`, igual que en el resto de la concha.
            const cover = coverImage(book);
            const tint = coverTint(book);
            return (
              <button
                key={book.id}
                type="button"
                className="yoru-continue-card"
                onClick={() => onContinue(book)}
                title={book.title}
              >
                <span className="yoru-continue-cover">
                  {cover
                    ? <img src={cover} alt="" loading="lazy" />
                    : <span style={tint ? { background: tint } : undefined} />}
                </span>
                <span className="yoru-continue-body">
                  <span className="yoru-continue-title">{book.title}</span>
                  <span className="yoru-continue-author">{book.author || (es ? 'Sin autor' : 'Unknown author')}</span>
                  <span className="yoru-continue-state">{es ? 'Novela' : 'Novel'} · {percent} %</span>
                  <span className="yoru-continue-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </Rail>
      )}

      <BookRail
        title={es ? 'Añadidos recientemente' : 'Recently added'}
        books={data.recent}
        onOpen={onOpenDetail}
        onMore={onGoCatalog}
        moreLabel={es ? 'Ver todo' : 'See all'}
      />

      <HomeServerSections
        es={es}
        scope={scope}
        localTitles={new Set(books.map((book) => book.title))}
        onOpenItem={onOpenServerItem}
        onOpenSeries={onOpenServerSeries}
      />

      <BookRail
        title={es ? 'Libros para ti' : 'Books for you'}
        books={data.forYou}
        onOpen={onOpenDetail}
      />

      {data.series.length > 0 && (
        <Rail title={es ? 'Series' : 'Series'}>
          {data.series.map((group) => (
            <div key={group.key} style={{ width: 240 }}>
              <EntityCard
                group={group}
                subtitle={formatCount(group.books.length, es ? 'tomo' : 'volume', es ? 'tomos' : 'volumes')}
                onOpen={onOpenSeries}
              />
            </div>
          ))}
        </Rail>
      )}

      {data.collections.length > 0 && (
        <Rail title={es ? 'Descubre colecciones' : 'Discover collections'}>
          {data.collections.map((group) => (
            <div key={group.key} style={{ width: 240 }}>
              <EntityCard
                group={group}
                subtitle={formatCount(group.books.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}
                onOpen={onOpenCollection}
              />
            </div>
          ))}
        </Rail>
      )}
    </div>
  );
}
