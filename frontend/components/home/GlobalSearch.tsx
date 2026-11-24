import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { coverImage, coverTint, searchBooks, type ShelfBook } from './libraryIndex';
import { useServerCatalog } from './HomeServerSections';
import { crearBuscador, useLecturasJapones } from '../../utils/busquedaRomaji';
import { serverItemId, type ServerItem } from '../../utils/serverCatalog';

const MAX_SERVIDOR = 30;

/**
 * Búsqueda global: la biblioteca local y, detrás, lo que hay en Kavita y
 * Audiobookshelf (de la caché del catálogo, sin red). Antes solo miraba lo importado,
 * y en un aparato que lo lee todo del servidor decía «Sin resultados» con el libro en
 * pantalla, en «Añadidos recientemente». Acepta romaji: «re zero» → Ｒｅ：ゼロ….
 */
export default function GlobalSearch({
  books,
  es,
  onClose,
  onPick,
  onPickServer,
}: {
  books: ShelfBook[];
  es: boolean;
  onClose: () => void;
  onPick: (book: ShelfBook) => void;
  /** Abre la ficha de un título del servidor. Sin él, solo se busca en lo local. */
  onPickServer?: (item: ServerItem) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const catalog = useServerCatalog();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cuando Kuromoji termina de cargar, se vuelve a filtrar: entonces los kanji
  // también se encuentran en romaji («isekai» → 異世界).
  const lecturas = useLecturasJapones(query);
  const results = useMemo(() => searchBooks(books, query), [books, query, lecturas]);

  const serverResults = useMemo<ServerItem[]>(() => {
    if (!onPickServer) return [];
    const buscador = crearBuscador(query);
    if (!buscador) return [];
    // Lo ya importado sale arriba, como libro propio: no se repite.
    const propios = new Set(books.map((book) => book.title));
    const vistos = new Set<string>();
    const encontrados: ServerItem[] = [];
    for (const item of [...catalog.kavita, ...catalog.audiobooks]) {
      const clave = `${item.source}:${serverItemId(item)}`;
      if (vistos.has(clave) || propios.has(item.title)) continue;
      vistos.add(clave);
      if (!buscador(item.title, item.author, item.series)) continue;
      encontrados.push(item);
      if (encontrados.length >= MAX_SERVIDOR) break;
    }
    return encontrados;
  }, [catalog, books, query, lecturas, onPickServer]);

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
                {es
                  ? 'Busca por título, autor, serie o colección. También en romaji: «re zero».'
                  : 'Search by title, author, series or collection. Romaji works too: “re zero”.'}
              </div>
            </div>
          ) : results.length === 0 && serverResults.length === 0 ? (
            <div className="yoru-empty">
              <div className="yoru-empty-sub">{es ? 'Sin resultados.' : 'No results.'}</div>
            </div>
          ) : (
            <>
              {results.map((book) => (
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
              ))}
              {serverResults.map((item) => (
                <button
                  key={`${item.source}:${serverItemId(item)}`}
                  type="button"
                  className="yoru-search-row"
                  onClick={() => {
                    onPickServer?.(item);
                    onClose();
                  }}
                >
                  <span className="yoru-search-thumb">
                    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="yoru-search-row-title" style={{ display: 'block' }}>
                      {item.title}
                    </span>
                    <span className="yoru-search-row-sub">
                      {[
                        item.source === 'kavita' ? 'Kavita' : (es ? 'Audiolibro' : 'Audiobook'),
                        item.author,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
