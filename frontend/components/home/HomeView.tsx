import React, { useMemo } from 'react';
import { BookRail, EmptyState, EntityCard, Rail } from './primitives';
import HomeServerSections from './HomeServerSections';
import { useBookMenu } from './BookContextMenu';
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

/**
 * Vista «Inicio»: la portada de la app, con «Continuar» y los carruseles de la
 * biblioteca local mezclados con los de los servidores de casa.
 */
export default function HomeView({
  books,
  es,
  onOpenDetail,
  onContinue,
  onGoCatalog,
  onGoAudiobooks,
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
  /** La pestaña «Audiolibros», que ahora lleva a la sección y no filtra esta pantalla. */
  onGoAudiobooks: () => void;
  onOpenCollection: (group: EntityGroup) => void;
  onOpenSeries: (group: EntityGroup) => void;
  /** Abre un título del servidor: la serie en Kavita, el tomo en Audiobookshelf. */
  onOpenServerItem: (item: ServerItem) => void;
  /** Abre la serie de audiolibros, con todos sus tomos. */
  onOpenServerSeries: (series: ServerSeries) => void;
}) {
  const openMenu = useBookMenu();

  const data = useMemo(
    () => ({
      continuing: continueReading(books),
      recent: recentlyAdded(books),
      forYou: suggestions(books),
      collections: collectionGroups(books).slice(0, 12),
      series: seriesGroups(books).filter((group) => group.books.length > 1).slice(0, 12),
    }),
    [books]
  );

  /*
    Inicio / Libros / Audiolibros.

    Antes eran un filtro de esta misma pantalla, y filtraban a medias: con
    «Audiolibros» elegido seguían saliendo «Añadidos recientemente», «Libros para ti»
    y «Series», que son libros locales. Ahora llevan a su sección de verdad, que es lo
    que una pestaña promete. Inicio no navega: ya estás en Inicio.
  */
  const scopes: { key: 'all' | 'books' | 'audio'; label: string; go?: () => void }[] = [
    { key: 'all', label: es ? 'Inicio' : 'Home' },
    { key: 'books', label: es ? 'Libros' : 'Books', go: onGoCatalog },
    { key: 'audio', label: es ? 'Audiolibros' : 'Audiobooks', go: onGoAudiobooks },
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
      <div className="yoru-chip-row" aria-label={es ? 'Secciones' : 'Sections'}>
        {scopes.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`yoru-chip${item.go ? '' : ' active'}`}
            aria-current={item.go ? undefined : 'page'}
            onClick={() => item.go?.()}
          >
            {item.label}
          </button>
        ))}
      </div>

      {data.continuing.length > 0 && (
        <Rail title={es ? 'Continuar' : 'Continue'} es={es}>
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
                // Aquí el menú sí ofrece «Quitar de Continuar»: es el único sitio
                // donde esa acción quiere decir algo.
                onContextMenu={openMenu ? (event) => openMenu(book, event, { fromContinue: true }) : undefined}
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
        es={es}
        onMore={onGoCatalog}
        moreLabel={es ? 'Ver todo' : 'See all'}
      />

      <HomeServerSections
        es={es}
        localTitles={new Set(books.map((book) => book.title))}
        onOpenItem={onOpenServerItem}
        onOpenSeries={onOpenServerSeries}
      />

      <BookRail
        title={es ? 'Libros para ti' : 'Books for you'}
        books={data.forYou}
        onOpen={onOpenDetail}
        es={es}
      />

      {data.series.length > 0 && (
        <Rail title={es ? 'Series' : 'Series'} es={es}>
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
        <Rail title={es ? 'Descubre colecciones' : 'Discover collections'} es={es}>
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
