import React from 'react';
import { coverImage, coverTint, type EntityGroup, type ShelfBook } from './libraryIndex';

/**
 * Portada con respaldo tipográfico cuando el libro no tiene imagen o la esconde.
 *
 * Qué cuenta como imagen lo decide `coverImage`, no esta vista: un libro sin portada
 * guarda un degradado CSS en `cover`, que no es una URL. Si lo trae, el respaldo se
 * tiñe con él, que es el color que el catálogo lleva enseñando desde siempre.
 */
export function Cover({ book, className }: { book: ShelfBook; className?: string }) {
  const src = coverImage(book);
  if (!src) {
    const tint = coverTint(book);
    return (
      <div
        className={`yoru-poster-fallback${tint ? ' is-tinted' : ''} ${className || ''}`}
        style={tint ? { background: tint } : undefined}
      >
        {book.title.slice(0, 24)}
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" className={className} />;
}

export function BookPoster({
  book,
  subtitle,
  onOpen,
}: {
  book: ShelfBook;
  subtitle?: string;
  onOpen: (book: ShelfBook) => void;
}) {
  const percent = Math.min(100, Math.max(0, Math.round(book.progress?.percent ?? 0)));
  return (
    <button type="button" className="yoru-poster" onClick={() => onOpen(book)} title={book.title}>
      <span className="yoru-poster-frame">
        <Cover book={book} />
        {percent > 0 && (
          <span className="yoru-poster-progress">
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
      <span className="yoru-poster-title">{book.title}</span>
      {subtitle !== '' && <span className="yoru-poster-meta">{subtitle ?? book.author ?? ''}</span>}
    </button>
  );
}

export function Rail({
  title,
  onMore,
  moreLabel,
  children,
}: {
  title: string;
  onMore?: () => void;
  moreLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="yoru-rail">
      <div className="yoru-rail-head">
        <h2 className="yoru-rail-title">{title}</h2>
        {onMore && (
          <button type="button" className="yoru-rail-more" onClick={onMore}>
            {moreLabel}
          </button>
        )}
      </div>
      <div className="yoru-rail-track">{children}</div>
    </section>
  );
}

export function BookRail({
  title,
  books,
  onOpen,
  onMore,
  moreLabel,
}: {
  title: string;
  books: ShelfBook[];
  onOpen: (book: ShelfBook) => void;
  onMore?: () => void;
  moreLabel?: string;
}) {
  if (books.length === 0) return null;
  return (
    <Rail title={title} onMore={onMore} moreLabel={moreLabel}>
      {books.map((book) => (
        <BookPoster key={book.id} book={book} onOpen={onOpen} />
      ))}
    </Rail>
  );
}

/** Tarjeta de serie / autor / colección: tres portadas apiladas y el recuento. */
export function EntityCard({
  group,
  subtitle,
  onOpen,
}: {
  group: EntityGroup;
  subtitle: string;
  onOpen: (group: EntityGroup) => void;
}) {
  const [main, left, right] = group.books;
  return (
    <button type="button" className="yoru-entity-card" onClick={() => onOpen(group)} title={group.name}>
      <span className="yoru-entity-stack">
        {left && (
          <span className="stack-cover stack-left">
            <Cover book={left} />
          </span>
        )}
        {right && (
          <span className="stack-cover stack-right">
            <Cover book={right} />
          </span>
        )}
        {main && (
          <span className="stack-main">
            <Cover book={main} />
          </span>
        )}
      </span>
      <span className="yoru-entity-name">{group.name}</span>
      <span className="yoru-entity-sub">{subtitle}</span>
    </button>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="yoru-empty">
      <div className="yoru-empty-title">{title}</div>
      {sub && <div className="yoru-empty-sub">{sub}</div>}
    </div>
  );
}
