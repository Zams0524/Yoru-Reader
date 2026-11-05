import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { coverImage, coverTint, searchBooks, type ShelfBook } from './libraryIndex';

/** Búsqueda global de la plantilla, limitada a la biblioteca local. */
export default function GlobalSearch({
  books,
  es,
  onClose,
  onPick,
}: {
  books: ShelfBook[];
  es: boolean;
  onClose: () => void;
  onPick: (book: ShelfBook) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => searchBooks(books, query), [books, query]);

  return (
    <div
      className="yoru-search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={es ? 'Buscar en la biblioteca' : 'Search the library'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="yoru-search-panel">
        <div className="yoru-search-field">
          <Search size={18} color="var(--text-dark)" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={es ? '¿Qué quieres buscar?' : 'What are you looking for?'}
          />
          <button
            type="button"
            className="yoru-shell-icon-btn"
            onClick={onClose}
            aria-label={es ? 'Cerrar' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="yoru-search-results">
          {query.trim() === '' ? (
            <div className="yoru-empty">
              <div className="yoru-empty-sub">
                {es ? 'Busca por título, autor, serie o colección.' : 'Search by title, author, series or collection.'}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="yoru-empty">
              <div className="yoru-empty-sub">{es ? 'Sin resultados.' : 'No results.'}</div>
            </div>
          ) : (
            results.map((book) => (
              <button
                key={book.id}
                type="button"
                className="yoru-search-row"
                onClick={() => {
                  onPick(book);
                  onClose();
                }}
              >
                <span className="yoru-search-thumb">
                  {/* 34 px: color sí, título no — a este tamaño no se leería. */}
                  {coverImage(book)
                    ? <img src={coverImage(book)} alt="" loading="lazy" />
                    : <span style={coverTint(book) ? { background: coverTint(book) } : undefined} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="yoru-search-row-title" style={{ display: 'block' }}>
                    {book.title}
                  </span>
                  <span className="yoru-search-row-sub">
                    {[book.author, book.series].filter(Boolean).join(' · ') || (es ? 'Novela' : 'Novel')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
