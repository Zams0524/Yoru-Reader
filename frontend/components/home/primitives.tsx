import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBookMenu } from './BookContextMenu';
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
  // El menú del clic derecho, si quien pinta esta portada lo ofrece.
  const openMenu = useBookMenu();
  return (
    <button
      type="button"
      className="yoru-poster"
      onClick={() => onOpen(book)}
      onContextMenu={openMenu ? (event) => openMenu(book, event) : undefined}
      title={book.title}
    >
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

/**
 * Un carrusel, con flechas en lugar de su propia barra de desplazamiento.
 *
 * Antes cada carrusel traía su barra, y en Inicio llegan a ser once: once barras
 * finas, más la de la página y la de la barra lateral. Ahora la barra se esconde y
 * se mueve con las flechas, con la rueda o arrastrando, que es lo que la gente hace.
 *
 * Las flechas solo salen cuando hay algo fuera de la vista, y cada una se apaga al
 * llegar a su extremo: una flecha que no lleva a ninguna parte es ruido.
 */
export function Rail({
  title,
  onMore,
  moreLabel,
  es = true,
  children,
}: {
  title: string;
  onMore?: () => void;
  moreLabel?: string;
  /** Solo para las etiquetas de las flechas, que no se ven pero sí se leen en voz alta. */
  es?: boolean;
  children: React.ReactNode;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    // Un píxel de margen: con zoom del navegador las cuentas no dan exactas y la
    // flecha derecha se quedaba encendida al final del todo.
    const max = track.scrollWidth - track.clientWidth;
    setEdges({ left: track.scrollLeft > 1, right: track.scrollLeft < max - 1 });
  }, []);

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    measure();
    // El contenido llega tarde (portadas del servidor, caché que se refresca) y la
    // anchura cambia al estrechar la ventana: hay que volver a medir en los dos casos.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const child of Array.from(track.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    // Casi una pantalla, no exacta: dejar un trozo a la vista dice hacia dónde sigue.
    track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' });
    /*
      Y volver a medir cuando la animación haya terminado. El evento `scroll` ya lo
      hace, pero no siempre llega: el navegador deja de despacharlo en una pestaña de
      segundo plano, y entonces la flecha se quedaba encendida al llegar al final.
    */
    window.setTimeout(measure, 400);
  };

  const hasArrows = edges.left || edges.right;

  return (
    <section className="yoru-rail">
      <div className="yoru-rail-head">
        <h2 className="yoru-rail-title">{title}</h2>
        <div className="yoru-rail-tools">
          {onMore && (
            <button type="button" className="yoru-rail-more" onClick={onMore}>
              {moreLabel}
            </button>
          )}
          {hasArrows && (
            <>
              <button
                type="button"
                className="yoru-rail-arrow"
                onClick={() => scrollBy(-1)}
                disabled={!edges.left}
                aria-label={es ? 'Anterior' : 'Previous'}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="yoru-rail-arrow"
                onClick={() => scrollBy(1)}
                disabled={!edges.right}
                aria-label={es ? 'Siguiente' : 'Next'}
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="yoru-rail-track" ref={trackRef} onScroll={measure}>
        {children}
      </div>
    </section>
  );
}

export function BookRail({
  title,
  books,
  onOpen,
  onMore,
  moreLabel,
  es = true,
}: {
  title: string;
  books: ShelfBook[];
  onOpen: (book: ShelfBook) => void;
  onMore?: () => void;
  moreLabel?: string;
  es?: boolean;
}) {
  if (books.length === 0) return null;
  return (
    <Rail title={title} onMore={onMore} moreLabel={moreLabel} es={es}>
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
