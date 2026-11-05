import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Download, Headphones, Loader2, Play } from 'lucide-react';
import type { KavitaBook, KavitaSeries, KavitaSeriesMetadata } from '../../types/integrations';
import {
  getKavitaSeriesByAuthor,
  getKavitaSeriesById,
  getKavitaSeriesMetadata,
  kavitaFormatLabel,
  kavitaSeriesCoverUrl,
} from '../../utils/kavitaService';

/**
 * La ficha de un libro que vive en el servidor, no en la biblioteca.
 *
 * Hasta ahora, abrir una serie de Kavita daba una lista de tomos con dos botones y
 * nada más: el autor, el ilustrador, la editorial, el idioma, el ISBN y la sinopsis
 * llegaban del servidor y se tiraban. Aquí se enseñan.
 *
 * Regla de la casa: **ningún dato ausente ocupa sitio**. Kavita rellena lo que venía
 * en el EPUB y lo que el usuario haya escrito; de una serie a otra cambia mucho. Cada
 * fila, cada pestaña y cada bloque se pregunta si tiene algo que decir antes de
 * pintarse, así que dos fichas del mismo servidor pueden tener distinto alto.
 *
 * Lo que no hay, y es a propósito: valoraciones (Yoru es de una persona, no hay a
 * quién votar) y «títulos similares» (no tenemos con qué calcularlos, y recomendar al
 * azar es peor que no recomendar).
 *
 * Leer y Descargar no se reimplementan: los pone `KavitaBrowser`, que es quien sabe
 * bajar un volumen e importarlo.
 */

export type VolumeAction = 'loading' | 'done' | 'error' | undefined;

/** Un libro de la biblioteca local que salió de este servidor, para ir y volver. */
export interface LocalMatch {
  id: string;
  title: string;
  /** Audiolibro vinculado desde el lector, si lo tiene. */
  audiobook?: { itemId: string; title: string; chapters?: number };
}

interface Props {
  series: KavitaSeries;
  /** Los tomos, ya en orden de lectura. `null` mientras se piden. */
  volumes: KavitaBook[] | null;
  /** Nombre de la biblioteca de Kavita en la que está la serie. */
  libraryName?: string;
  es: boolean;
  importState: Record<number, VolumeAction>;
  readState: Record<number, 'loading' | undefined>;
  importedVolumes: Set<number>;
  onBack: () => void;
  onRead?: (book: KavitaBook) => void;
  onImport: (book: KavitaBook) => void;
  onImportAll: () => void;
  onOpenSeries: (series: KavitaSeries) => void;
  /** Busca en la biblioteca local el libro que salió de este tomo. */
  findLocal?: (book: KavitaBook) => LocalMatch | null;
  /** Abre el libro local, ya importado. */
  onOpenLocal?: (match: LocalMatch) => void;
  /** Abre el libro local con su audiolibro vinculado ya desplegado. */
  onOpenAudiobook?: (match: LocalMatch) => void;
}

type Tab = 'summary' | 'files' | 'history';

const SUMMARY_CLAMP = 420;

const PUBLICATION_STATUS: Record<number, { es: string; en: string }> = {
  0: { es: 'En curso', en: 'Ongoing' },
  1: { es: 'Interrumpida', en: 'Hiatus' },
  2: { es: 'Completada', en: 'Completed' },
  3: { es: 'Cancelada', en: 'Cancelled' },
  4: { es: 'Terminada', en: 'Ended' },
};

function formatNumber(value: number, es: boolean): string {
  return value.toLocaleString(es ? 'es-ES' : 'en-US');
}

function formatDate(value: string | undefined, es: boolean): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() <= 1) return undefined;
  return date.toLocaleDateString(es ? 'es-ES' : 'en-US');
}

function formatBytes(bytes: number | undefined, es: boolean): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} kB`;
  return `${mb.toFixed(1).replace('.', es ? ',' : '.')} MB`;
}

/** El idioma en palabras, en el idioma de la app; si no lo reconoce, la etiqueta cruda. */
function languageName(tag: string | undefined, es: boolean): string | undefined {
  if (!tag) return undefined;
  try {
    const names = new Intl.DisplayNames([es ? 'es' : 'en'], { type: 'language' });
    return names.of(tag) || tag;
  } catch {
    return tag;
  }
}

/**
 * Reparte los ISBN que traen los tomos entre ISBN-13 e ISBN-10 por el número de
 * dígitos, que es lo que de verdad los distingue. Kavita guarda una sola cadena por
 * capítulo y no dice de cuál de los dos se trata.
 */
function splitIsbns(volumes: KavitaBook[]): { isbn13: string[]; isbn10: string[] } {
  const isbn13: string[] = [];
  const isbn10: string[] = [];
  for (const volume of volumes) {
    for (const raw of (volume.isbn || '').split(/[,;\s]+/)) {
      const value = raw.trim();
      if (!value) continue;
      const digits = value.replace(/[^0-9Xx]/g, '');
      const target = digits.length === 13 ? isbn13 : digits.length === 10 ? isbn10 : null;
      if (target && !target.includes(value)) target.push(value);
    }
  }
  return { isbn13, isbn10 };
}

/**
 * Un dato de la rejilla de detalles, que no existe cuando no hay valor.
 *
 * La rejilla, y no una tabla de dos columnas, porque los detalles de un libro son
 * doce datos cortos: en tres columnas se leen de un vistazo y no estiran la página.
 */
function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  if (empty) return null;
  return (
    <div className="yoru-meta-cell">
      <span className="yoru-meta-label">{label}</span>
      <span className="yoru-meta-value">{Array.isArray(value) ? value.join(', ') : value}</span>
    </div>
  );
}

export default function ServerBookDetail({
  series,
  volumes,
  libraryName,
  es,
  importState,
  readState,
  importedVolumes,
  onBack,
  onRead,
  onImport,
  onImportAll,
  onOpenSeries,
  findLocal,
  onOpenLocal,
  onOpenAudiobook,
}: Props) {
  const [metadata, setMetadata] = useState<KavitaSeriesMetadata | null>(null);
  const [full, setFull] = useState<KavitaSeries | null>(null);
  const [byAuthor, setByAuthor] = useState<KavitaSeries[]>([]);
  const [tab, setTab] = useState<Tab>('summary');
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Serie y metadatos a la vez: ninguno depende del otro y así la ficha se completa
  // de una tacada en lugar de en dos saltos visibles.
  useEffect(() => {
    let alive = true;
    setMetadata(null);
    setFull(null);
    setByAuthor([]);
    setTab('summary');
    setSummaryOpen(false);
    void Promise.all([getKavitaSeriesMetadata(series.id), getKavitaSeriesById(series.id)])
      .then(([meta, detail]) => {
        if (!alive) return;
        setMetadata(meta);
        setFull(detail);
        const author = meta.writers[0];
        if (author) {
          void getKavitaSeriesByAuthor(author, series.id).then((list) => { if (alive) setByAuthor(list); });
        }
      });
    return () => { alive = false; };
  }, [series.id]);

  const list = useMemo(() => volumes || [], [volumes]);
  const pages = full?.pages ?? series.pages ?? list.reduce((sum, volume) => sum + (volume.pages || 0), 0);
  const pagesRead = full?.pagesRead ?? series.pagesRead ?? 0;
  const percent = pages > 0 ? Math.min(100, Math.max(0, Math.round((pagesRead / pages) * 100))) : 0;
  const lastRead = formatDate(full?.latestReadDate ?? series.latestReadDate, es);

  // Por dónde seguir: el primer tomo empezado y sin acabar; si no hay ninguno, el
  // primero que quede por leer; y si está todo leído, el primero de la serie.
  const resume = useMemo(() => {
    const started = list.find((volume) => (volume.pagesRead ?? 0) > 0 && (volume.pagesRead ?? 0) < volume.pages);
    const unread = list.find((volume) => !(volume.pagesRead ?? 0));
    return started || unread || list[0] || null;
  }, [list]);

  const { isbn13, isbn10 } = useMemo(() => splitIsbns(list), [list]);
  const withFiles = useMemo(() => list.filter((volume) => (volume.files || []).length > 0), [list]);
  const withHistory = useMemo(
    () => list.filter((volume) => (volume.pagesRead ?? 0) > 0 || volume.lastReadAt),
    [list],
  );
  const published = useMemo(
    () => formatDate(list.find((volume) => volume.releaseDate)?.releaseDate, es),
    [list, es],
  );

  const summary = metadata?.summary || '';
  const longSummary = summary.length > SUMMARY_CLAMP;
  const author = metadata?.writers.join(', ') || '';
  const illustrator = metadata?.coverArtists.join(', ') || '';
  const format = kavitaFormatLabel(full?.format ?? series.format, es);
  const year = metadata?.releaseYear;
  const words = full?.wordCount || series.wordCount || 0;
  const status = metadata?.publicationStatus !== undefined
    ? PUBLICATION_STATUS[metadata.publicationStatus]
    : undefined;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: es ? 'Resumen' : 'Summary' },
    ...(withFiles.length ? [{ id: 'files' as Tab, label: es ? 'Archivo' : 'File' }] : []),
    ...(withHistory.length ? [{ id: 'history' as Tab, label: es ? 'Historial de lectura' : 'Reading history' }] : []),
  ];

  const volumeRow = (volume: KavitaBook) => {
    const state = importState[volume.volumeId];
    const alreadyIn = importedVolumes.has(volume.volumeId);
    const local = findLocal?.(volume) || null;
    const volumePercent = volume.pages > 0
      ? Math.min(100, Math.round(((volume.pagesRead ?? 0) / volume.pages) * 100))
      : 0;
    return (
      <li key={volume.volumeId} className="yoru-server-volume">
        <span className="yoru-server-volume-cover">
          <img src={volume.coverUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          {volumePercent > 0 && (
            <span className="yoru-server-volume-progress"><span style={{ width: `${volumePercent}%` }} /></span>
          )}
        </span>
        <span className="yoru-server-volume-text">
          <strong>{volume.title}</strong>
          <small>
            {[
              volume.pages > 0 ? `${formatNumber(volume.pages, es)} ${es ? 'págs.' : 'pages'}` : '',
              volumePercent > 0 ? (es ? `${volumePercent} % leído` : `${volumePercent}% read`) : '',
            ].filter(Boolean).join(' · ')}
          </small>
        </span>
        <span className="yoru-server-volume-actions">
          {onRead && !alreadyIn && state !== 'done' && (
            <button
              type="button"
              className="yoru-btn yoru-btn-primary"
              onClick={() => onRead(volume)}
              disabled={readState[volume.volumeId] === 'loading' || state === 'loading'}
            >
              {readState[volume.volumeId] === 'loading'
                ? <Loader2 size={15} className="guide-spin" />
                : <BookOpen size={15} />}
              {readState[volume.volumeId] === 'loading' ? (es ? 'Abriendo' : 'Opening') : (es ? 'Leer' : 'Read')}
            </button>
          )}
          {local && onOpenLocal && (
            <button type="button" className="yoru-btn" onClick={() => onOpenLocal(local)}>
              <Play size={15} />
              {es ? 'Abrir el tuyo' : 'Open yours'}
            </button>
          )}
          {local?.audiobook && onOpenAudiobook && (
            <button
              type="button"
              className="yoru-btn"
              onClick={() => onOpenAudiobook(local)}
              title={local.audiobook.title}
            >
              <Headphones size={15} />
              {(local.audiobook.chapters || 0) > 1
                ? (es ? 'Leer escuchando · por capítulos' : 'Read along · by chapter')
                : (es ? 'Leer escuchando' : 'Read along')}
            </button>
          )}
          <button
            type="button"
            className="yoru-btn"
            onClick={() => onImport(volume)}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? <Loader2 size={15} className="guide-spin" />
              : state === 'done' || (alreadyIn && !state) ? <Check size={15} />
              : <Download size={15} />}
            {state === 'loading' ? (es ? 'Descargando' : 'Downloading')
              : state === 'done' || (alreadyIn && !state) ? (es ? 'Descargado' : 'Downloaded')
              : state === 'error' ? (es ? 'Reintentar' : 'Retry')
              : (es ? 'Descargar' : 'Download')}
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="yoru-detail">
      <button type="button" className="yoru-detail-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {es ? 'Volver' : 'Back'}
      </button>

      <div className="yoru-detail-head">
        <div className="yoru-detail-cover">
          <img src={kavitaSeriesCoverUrl(series.id)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        </div>

        <div className="yoru-detail-info">
          <h1 className="yoru-detail-title">{series.name}</h1>
          {series.originalName && series.originalName !== series.name && (
            <div className="yoru-detail-author">{series.originalName}</div>
          )}
          {(author || illustrator) && (
            <div className="yoru-detail-author">
              {author}
              {author && illustrator ? ' · ' : ''}
              {illustrator ? `${es ? 'Ilustración' : 'Art'}: ${illustrator}` : ''}
            </div>
          )}

          <div className="yoru-detail-badges">
            {format && <span className="yoru-badge">{format}</span>}
            {year && <span className="yoru-badge">{year}</span>}
            {pages > 0 && <span className="yoru-badge">{formatNumber(pages, es)} {es ? 'págs.' : 'pages'}</span>}
            {list.length > 0 && (
              <span className="yoru-badge">
                {list.length} {es ? (list.length === 1 ? 'tomo' : 'tomos') : list.length === 1 ? 'volume' : 'volumes'}
              </span>
            )}
            {status && <span className="yoru-badge">{es ? status.es : status.en}</span>}
            {(metadata?.genres || []).slice(0, 3).map((genre) => (
              <span key={genre} className="yoru-badge">#{genre}</span>
            ))}
          </div>

          <div className="yoru-detail-actions">
            {resume && onRead && (
              <button
                type="button"
                className="yoru-btn yoru-btn-primary"
                onClick={() => onRead(resume)}
                disabled={readState[resume.volumeId] === 'loading'}
              >
                {readState[resume.volumeId] === 'loading' ? <Loader2 size={16} className="guide-spin" />
                  : percent > 0 ? <Play size={16} /> : <BookOpen size={16} />}
                {percent > 0
                  ? (es ? `Seguir leyendo · ${percent} %` : `Continue · ${percent}%`)
                  : (es ? 'Leer' : 'Read')}
              </button>
            )}
            {list.length > 1 && (
              <button type="button" className="yoru-btn" onClick={onImportAll}>
                <Download size={16} />
                {es ? `Descargar todos (${list.length})` : `Download all (${list.length})`}
              </button>
            )}
          </div>

          {percent > 0 && (
            <div className="yoru-detail-progress">
              <div className="yoru-detail-progress-bar">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="yoru-detail-progress-text">
                {es
                  ? `${formatNumber(pagesRead, es)} de ${formatNumber(pages, es)} páginas`
                  : `${formatNumber(pagesRead, es)} of ${formatNumber(pages, es)} pages`}
                {lastRead ? ` · ${es ? 'última vez' : 'last read'} ${lastRead}` : ''}
              </div>
            </div>
          )}

        </div>
      </div>

      {summary && (
        <section className="yoru-server-summary">
          <h2 className="yoru-rail-title yoru-server-section">{es ? 'Descripción' : 'Description'}</h2>
          <p className={longSummary && !summaryOpen ? 'is-clamped' : ''}>{summary}</p>
          {longSummary && (
            <button type="button" className="yoru-server-more" onClick={() => setSummaryOpen((open) => !open)}>
              {summaryOpen ? (es ? 'Leer menos' : 'Read less') : (es ? 'Leer más' : 'Read more')}
            </button>
          )}
        </section>
      )}

      {tabs.length > 1 && (
        <div className="yoru-tabs" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`yoru-tab${tab === entry.id ? ' active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'summary' && (
        <>
          <h2 className="yoru-rail-title yoru-server-section is-first">
            {es ? 'Detalles del libro' : 'Book details'}
          </h2>
          <div className="yoru-meta-grid">
            <MetaCell label={es ? 'Formato' : 'Format'} value={format} />
            <MetaCell label={es ? 'Páginas' : 'Pages'} value={pages > 0 ? formatNumber(pages, es) : undefined} />
            <MetaCell label={es ? 'Palabras' : 'Words'} value={words > 0 ? formatNumber(words, es) : undefined} />
            <MetaCell label={es ? 'Idioma' : 'Language'} value={languageName(metadata?.language, es)} />
            <MetaCell label={es ? 'Biblioteca' : 'Library'} value={libraryName} />
            <MetaCell label={es ? 'Editorial' : 'Publisher'} value={metadata?.publishers} />
            <MetaCell label={es ? 'Traducción' : 'Translation'} value={metadata?.translators} />
            <MetaCell label={es ? 'Año' : 'Year'} value={year} />
            <MetaCell label={es ? 'Publicado' : 'Published'} value={published} />
            <MetaCell label={es ? 'Estado' : 'Status'} value={status ? (es ? status.es : status.en) : undefined} />
            <MetaCell label={es ? 'Géneros' : 'Genres'} value={metadata?.genres} />
            <MetaCell label={es ? 'Etiquetas' : 'Tags'} value={metadata?.tags} />
            <MetaCell
              label={es ? 'Enlaces' : 'Links'}
              value={(metadata?.webLinks || []).length > 0
                ? (
                  <>
                    {(metadata?.webLinks || []).map((link) => (
                      <a key={link} href={link} target="_blank" rel="noreferrer" className="yoru-server-link">{link}</a>
                    ))}
                  </>
                )
                : undefined}
            />
          </div>

          {(isbn13.length > 0 || isbn10.length > 0) && (
            <>
              <h2 className="yoru-rail-title yoru-server-section">{es ? 'Identificadores' : 'Identifiers'}</h2>
              <div className="yoru-meta-grid">
                <MetaCell label="ISBN-13" value={isbn13} />
                <MetaCell label="ISBN-10" value={isbn10} />
              </div>
            </>
          )}
        </>
      )}

      {tab === 'files' && (
        <table className="yoru-meta-table">
          <tbody>
            {withFiles.map((volume) => (
              <tr key={volume.volumeId}>
                <th>{volume.title}</th>
                <td>
                  {(volume.files || []).map((file) => (
                    <div key={file.name} className="yoru-server-file">
                      <span className="yoru-server-file-name">{file.name}</span>
                      <small>
                        {[
                          formatBytes(file.bytes, es),
                          file.pages ? `${formatNumber(file.pages, es)} ${es ? 'págs.' : 'pages'}` : '',
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'history' && (
        <table className="yoru-meta-table">
          <tbody>
            {withHistory.map((volume) => {
              const read = volume.pagesRead ?? 0;
              const volumePercent = volume.pages > 0 ? Math.min(100, Math.round((read / volume.pages) * 100)) : 0;
              const when = formatDate(volume.lastReadAt, es);
              return (
                <tr key={volume.volumeId}>
                  <th>{volume.title}</th>
                  <td>
                    {es
                      ? `${formatNumber(read, es)} de ${formatNumber(volume.pages, es)} páginas · ${volumePercent} %`
                      : `${formatNumber(read, es)} of ${formatNumber(volume.pages, es)} pages · ${volumePercent}%`}
                    {when ? ` · ${es ? 'última vez' : 'last read'} ${when}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 className="yoru-rail-title yoru-server-section">
        {es ? 'Tomos de la serie' : 'Volumes in this series'}
      </h2>
      {!volumes ? (
        <p className="yoru-stats-empty"><Loader2 size={16} className="guide-spin" /></p>
      ) : (
        <ul className="yoru-server-volumes">{list.map(volumeRow)}</ul>
      )}

      {byAuthor.length > 0 && (
        <>
          <h2 className="yoru-rail-title yoru-server-section">
            {es ? 'Más de estos autores' : 'More from these authors'}
          </h2>
          <div className="yoru-rail-track">
            {byAuthor.map((other) => (
              <button
                key={other.id}
                type="button"
                className="yoru-poster"
                onClick={() => onOpenSeries(other)}
                title={other.name}
              >
                <span className="yoru-poster-frame">
                  <img src={kavitaSeriesCoverUrl(other.id)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                </span>
                <span className="yoru-poster-title">{other.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
