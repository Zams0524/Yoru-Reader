import React from 'react';
import { ArrowLeft, BookOpen, FolderPlus, Info, Play, Tag, X } from 'lucide-react';
import type { ShelfBook } from './libraryIndex';

/**
 * El menú de clic derecho sobre un libro.
 *
 * Va por contexto de React y no por props porque las portadas salen en seis sitios
 * (Inicio, catálogo, estantes, grupos, series y autores) a través de `BookPoster`, y
 * pasarle el menú a mano a cada uno habría sido atravesar cinco componentes que no
 * tienen nada que ver con esto.
 *
 * Lo que **no** lleva, porque Yoru no es un navegador ni un Kindle: «abrir en pestaña
 * nueva» y «enviar a Kindle».
 */

export interface BookMenuActions {
  onOpenDetail: (book: ShelfBook) => void;
  onRead: (book: ShelfBook) => void;
  /** Las colecciones que ya existen, para poder meter el libro en una. */
  collections: string[];
  onAddToCollection: (book: ShelfBook, collection: string) => void;
  /** Abre el modal de crear colección, para no dejar el submenú sin salida. */
  onCreateCollection: () => void;
  /** Aparta el libro de «Continuar» sin tocar su progreso. */
  onHideFromContinue: (book: ShelfBook) => void;
  es: boolean;
}

interface MenuState {
  book: ShelfBook;
  x: number;
  y: number;
  /** Verdadero cuando se abrió desde el carrusel «Continuar». */
  fromContinue: boolean;
}

type OpenMenu = (book: ShelfBook, event: React.MouseEvent, options?: { fromContinue?: boolean }) => void;

const BookMenuContext = React.createContext<OpenMenu | null>(null);

/** Para que una portada pueda abrir el menú sin saber quién lo pinta. */
export function useBookMenu(): OpenMenu | null {
  return React.useContext(BookMenuContext);
}

export function BookMenuProvider({
  actions,
  children,
}: {
  actions: BookMenuActions;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = React.useState<MenuState | null>(null);

  const open = React.useCallback<OpenMenu>((book, event, options) => {
    event.preventDefault();
    setMenu({ book, x: event.clientX, y: event.clientY, fromContinue: Boolean(options?.fromContinue) });
  }, []);

  return (
    <BookMenuContext.Provider value={open}>
      {children}
      {menu && <Menu state={menu} actions={actions} onClose={() => setMenu(null)} />}
    </BookMenuContext.Provider>
  );
}

function Menu({
  state,
  actions,
  onClose,
}: {
  state: MenuState;
  actions: BookMenuActions;
  onClose: () => void;
}) {
  const { book, fromContinue } = state;
  const { es } = actions;
  const [page, setPage] = React.useState<'main' | 'collections'>('main');
  const ref = React.useRef<HTMLDivElement>(null);
  const [place, setPlace] = React.useState({ left: state.x, top: state.y, ready: false });

  // Que no se salga de la ventana: se mide ya pintado y se recoloca si hace falta.
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const margin = 8;
    setPlace({
      left: Math.max(margin, Math.min(state.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(state.y, window.innerHeight - height - margin)),
      ready: true,
    });
  }, [state.x, state.y, page]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // El foco espera a que el menú sea visible: a un elemento oculto no se le puede dar.
  React.useEffect(() => {
    if (place.ready) ref.current?.querySelector('button')?.focus();
  }, [page, place.ready]);

  const started = (book.progress?.percent ?? 0) > 0 || Boolean(book.lastRead);
  const run = (action: () => void) => () => { action(); onClose(); };

  return (
    <div
      className="yoru-menu-scrim"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onContextMenu={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        ref={ref}
        className="yoru-menu"
        role="menu"
        aria-label={book.title}
        style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}
      >
        {page === 'main' ? (
          <>
            <div className="yoru-menu-head" title={book.title}>{book.title}</div>

            <button type="button" className="yoru-menu-item" role="menuitem" onClick={run(() => actions.onRead(book))}>
              {started ? <Play size={15} /> : <BookOpen size={15} />}
              {started ? (es ? 'Continuar' : 'Continue') : es ? 'Leer' : 'Read'}
            </button>

            <button
              type="button"
              className="yoru-menu-item"
              role="menuitem"
              onClick={run(() => actions.onOpenDetail(book))}
            >
              <Info size={15} />
              {es ? 'Ver detalles' : 'View details'}
            </button>

            {/*
              Ya siempre sale: si no hay ninguna colección, el submenú ofrece crearla,
              así que la entrada nunca lleva a una lista vacía.
            */}
            <button
              type="button"
              className="yoru-menu-item"
              role="menuitem"
              onClick={() => setPage('collections')}
            >
              <Tag size={15} />
              {es ? 'Añadir a colección' : 'Add to collection'}
              <span className="yoru-menu-more">›</span>
            </button>

            {fromContinue && (
              <>
                <div className="yoru-menu-sep" />
                <button
                  type="button"
                  className="yoru-menu-item"
                  role="menuitem"
                  onClick={run(() => actions.onHideFromContinue(book))}
                >
                  <X size={15} />
                  {es ? 'Quitar de Continuar' : 'Remove from Continue'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button type="button" className="yoru-menu-back" onClick={() => setPage('main')}>
              <ArrowLeft size={14} />
              {es ? 'Añadir a colección' : 'Add to collection'}
            </button>
            {actions.collections.map((collection) => {
              const already = (book.tags || []).includes(collection);
              return (
                <button
                  key={collection}
                  type="button"
                  className="yoru-menu-item"
                  role="menuitem"
                  disabled={already}
                  onClick={run(() => actions.onAddToCollection(book, collection))}
                >
                  <Tag size={15} />
                  {collection}
                  {already && <span className="yoru-menu-more">✓</span>}
                </button>
              );
            })}
            {actions.collections.length > 0 && <div className="yoru-menu-sep" />}
            <button
              type="button"
              className="yoru-menu-item"
              role="menuitem"
              onClick={run(actions.onCreateCollection)}
            >
              <FolderPlus size={15} />
              {es ? 'Nueva colección…' : 'New collection…'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
