import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Settings, X } from 'lucide-react';
import type { KavitaBook, KavitaLibrary, KavitaSeries } from '../types/integrations';
import {
  getKavitaLibraries,
  getKavitaSeries,
  getKavitaVolumes,
  importKavitaBook,
  importedKavitaVolumeIds,
  isKavitaConfigured,
  kavitaSeriesCoverUrl,
  kavitaVolumeTitles,
  kavitaVolumesToBooks,
  searchKavitaSeries,
} from '../utils/kavitaService';
import { getAudiobookLink } from '../utils/audiobookshelfService';
import { describeServerError } from '../utils/serverHttp';
import { useBackHandler } from '../hooks/useBackButton';
import ServerBookDetail, { type LocalMatch } from './home/ServerBookDetail';

interface Props {
  lang: string;
  /** Titles already in the library, to mark imported volumes. */
  libraryTitles: Set<string>;
  onImport: (parsedBooks: any[]) => Promise<void>;
  onClose: () => void;
  onOpenSettings: () => void;
  showToast: (message: string, type?: string) => void;
  /** Abrir el volumen sin guardarlo en la biblioteca. */
  onReadTemporary?: (book: KavitaBook) => Promise<void>;
  /** Montado en el lienzo del shell: sin marco de diálogo ni botón de cerrar. */
  embedded?: boolean;
  /**
   * La biblioteca local, para la vuelta: del tomo del servidor al libro ya descargado
   * y a su audiolibro vinculado. Sin ella la ficha funciona igual, solo que sin esos
   * dos botones.
   */
  libraryBooks?: { id: string; title: string }[];
  /** Abre un libro de la biblioteca; con `listen`, con el audiolibro desplegado. */
  onOpenLocalBook?: (bookId: string, listen?: boolean) => void;
}

const PAGE_SIZE = 30;
type ImportState = 'loading' | 'done' | 'error';

/**
 * "Explore Kavita": the user's Kavita libraries as a cover grid; a series opens its volumes, and
 * each volume can be imported into Yoru's library (downloaded and stored, so it reads offline).
 */
export default function KavitaBrowser({ lang, libraryTitles, onImport, onClose, onOpenSettings, showToast, onReadTemporary, embedded = false, libraryBooks, onOpenLocalBook }: Props) {
  const es = lang === 'es';
  const configured = isKavitaConfigured();
  const [libraries, setLibraries] = useState<KavitaLibrary[]>([]);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [series, setSeries] = useState<KavitaSeries[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KavitaSeries[] | null>(null);
  const [openSeries, setOpenSeries] = useState<KavitaSeries | null>(null);
  const [volumes, setVolumes] = useState<KavitaBook[] | null>(null);
  const [importState, setImportState] = useState<Record<number, ImportState>>({});
  const [readState, setReadState] = useState<Record<number, 'loading' | undefined>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useBackHandler(true, () => (openSeries ? setOpenSeries(null) : onClose()));

  // Libraries; book-type libraries (Book = 2, Light Novel = 4) first.
  useEffect(() => {
    if (!configured) return;
    let current = true;
    setLoading(true);
    getKavitaLibraries()
      .then((list) => {
        if (!current) return;
        const sorted = [...list].sort((a, b) => Number(![2, 4].includes(a.type)) - Number(![2, 4].includes(b.type)));
        setLibraries(sorted);
        setLibraryId(sorted[0]?.id ?? null);
        if (sorted.length === 0) setLoading(false);
      })
      .catch((err) => { if (current) { setError(describeServerError(err, es)); setLoading(false); } });
    return () => { current = false; };
  }, [configured, es]);

  const loadPage = useCallback(async (id: number, nextPage: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await getKavitaSeries(id, nextPage, PAGE_SIZE);
      setSeries((prev) => (nextPage === 1 ? result.items : [...prev, ...result.items]));
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(describeServerError(err, es));
    } finally {
      setLoading(false);
    }
  }, [es]);

  useEffect(() => {
    if (libraryId === null) return;
    setSeries([]);
    void loadPage(libraryId, 1);
  }, [libraryId, loadPage]);

  // Search across every library, a moment after the user stops typing.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(() => {
      searchKavitaSeries(q)
        .then(setSearchResults)
        .catch((err) => setError(describeServerError(err, es)));
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, es]);

  useEffect(() => {
    if (!openSeries) { setVolumes(null); return; }
    let current = true;
    setVolumes(null);
    getKavitaVolumes(openSeries.id)
      .then((list) => { if (current) setVolumes(kavitaVolumesToBooks(openSeries, list, es)); })
      .catch((err) => { if (current) { setError(describeServerError(err, es)); setOpenSeries(null); } });
    return () => { current = false; };
  }, [openSeries, es]);

  /** «Leer»: baja el volumen y lo abre, sin anadirlo a la biblioteca. */
  const readOne = async (book: KavitaBook): Promise<void> => {
    if (!onReadTemporary) return;
    setReadState((prev) => ({ ...prev, [book.volumeId]: 'loading' }));
    try {
      await onReadTemporary(book);
    } catch (err) {
      console.error('[Kavita] Temporary read failed:', err);
      showToast(book.seriesName + ' ' + book.title + ': ' + describeServerError(err, es), 'error');
    } finally {
      setReadState((prev) => ({ ...prev, [book.volumeId]: undefined }));
    }
  };

  const importOne = async (book: KavitaBook): Promise<boolean> => {
    setImportState((prev) => ({ ...prev, [book.volumeId]: 'loading' }));
    try {
      const parsed = await importKavitaBook(book);
      await onImport(parsed);
      setImportState((prev) => ({ ...prev, [book.volumeId]: 'done' }));
      return true;
    } catch (err) {
      console.error('[Kavita] Import failed:', err);
      setImportState((prev) => ({ ...prev, [book.volumeId]: 'error' }));
      showToast(`${book.seriesName} ${book.title}: ${describeServerError(err, es)}`, 'error');
      return false;
    }
  };

  const importAll = async () => {
    if (!volumes) return;
    let count = 0;
    for (const book of volumes) {
      if (importState[book.volumeId] === 'done') continue;
      if (await importOne(book)) count++;
    }
    showToast(es ? `${count} ${count === 1 ? 'volumen importado' : 'volúmenes importados'}.` : `${count} ${count === 1 ? 'volume' : 'volumes'} imported.`, 'success');
  };

  const shown = searchResults ?? series;
  const importedVolumes = useMemo(() => importedKavitaVolumeIds(libraryTitles), [libraryTitles]);

  const renderGrid = () => (
    <>
      {!searchResults && libraries.length > 1 && (
        <div className="media-browser-chips" role="tablist">
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              role="tab"
              aria-selected={library.id === libraryId}
              className={library.id === libraryId ? 'is-active' : ''}
              onClick={() => setLibraryId(library.id)}
            >
              {library.name}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && !loading && !error && (
        <p className="media-browser-empty">{searchResults ? (es ? 'Sin resultados.' : 'No results.') : (es ? 'Esta biblioteca está vacía.' : 'This library is empty.')}</p>
      )}
      <div className="media-browser-grid">
        {shown.map((item) => (
          <button key={`${item.libraryId}-${item.id}`} type="button" className="media-browser-card" onClick={() => setOpenSeries(item)}>
            <span className="media-browser-cover">
              <img src={kavitaSeriesCoverUrl(item.id)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            </span>
            <span className="media-browser-card-title">{item.name}</span>
          </button>
        ))}
      </div>
      {!searchResults && page < totalPages && libraryId !== null && (
        <button type="button" className="media-server-btn media-browser-more" onClick={() => loadPage(libraryId, page + 1)} disabled={loading}>
          {loading ? <Loader2 size={15} className="guide-spin" /> : null} {es ? 'Cargar más' : 'Load more'}
        </button>
      )}
    </>
  );

  const volumeTitles = useMemo(() => kavitaVolumeTitles(libraryTitles), [libraryTitles]);

  /**
   * El libro de la biblioteca que salió de este tomo, si está. El título lo apuntó la
   * propia descarga, así que no hay que adivinarlo comparando nombres.
   */
  const findLocal = useCallback((book: KavitaBook): LocalMatch | null => {
    const title = volumeTitles.get(book.volumeId);
    if (!title) return null;
    const local = (libraryBooks || []).find((entry) => entry.title === title);
    if (!local) return null;
    const link = getAudiobookLink(local.id);
    return {
      id: local.id,
      title: local.title,
      audiobook: link ? { itemId: link.itemId, title: link.title, chapters: link.chapters } : undefined,
    };
  }, [volumeTitles, libraryBooks]);

  // Abrir una serie ya no da una lista de tomos: da su ficha, con lo que el servidor
  // sabe del libro. Leer y Descargar siguen siendo los de aquí.
  const renderSeries = (item: KavitaSeries) => (
    <ServerBookDetail
      series={item}
      volumes={volumes}
      libraryName={libraries.find((library) => library.id === item.libraryId)?.name}
      es={es}
      importState={importState}
      readState={readState}
      importedVolumes={importedVolumes}
      onBack={() => setOpenSeries(null)}
      onRead={onReadTemporary ? (book) => { void readOne(book); } : undefined}
      onImport={(book) => { void importOne(book); }}
      onImportAll={() => { void importAll(); }}
      onOpenSeries={setOpenSeries}
      findLocal={onOpenLocalBook ? findLocal : undefined}
      onOpenLocal={onOpenLocalBook ? (match) => onOpenLocalBook(match.id) : undefined}
      onOpenAudiobook={onOpenLocalBook ? (match) => onOpenLocalBook(match.id, true) : undefined}
    />
  );

  return (
    <div
      className={`media-browser${embedded ? ' is-embedded' : ''}`}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={es ? 'Explorar Kavita' : 'Explore Kavita'}
    >
      <header className="media-browser-header">
        {/* La ficha trae su propio «Volver», así que aquí solo queda el cierre del diálogo. */}
        {!embedded && (
          <button type="button" className="media-browser-icon-btn" onClick={onClose} aria-label={es ? 'Cerrar' : 'Close'}>
            <X size={20} />
          </button>
        )}
        <h2>{es ? 'Explorar Kavita' : 'Explore Kavita'}</h2>
        {configured && !openSeries && (
          <div className="media-browser-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={es ? 'Buscar series…' : 'Search series…'} />
          </div>
        )}
      </header>

      <div className="media-browser-body">
        {!configured ? (
          <div className="media-browser-empty">
            <p>{es ? 'Conecta tu servidor Kavita para explorar tus novelas.' : 'Connect your Kavita server to browse your novels.'}</p>
            <button type="button" className="media-server-btn is-primary" onClick={onOpenSettings}>
              <Settings size={15} /> {es ? 'Configurar servidor' : 'Set up server'}
            </button>
          </div>
        ) : (
          <>
            {error && <p className="media-server-status is-error" role="alert">{error}</p>}
            {openSeries ? renderSeries(openSeries) : renderGrid()}
            {loading && shown.length === 0 && <p className="media-browser-empty"><Loader2 size={18} className="guide-spin" /></p>}
          </>
        )}
      </div>
    </div>
  );
}
