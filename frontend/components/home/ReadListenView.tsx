import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Headphones, Plus, Search, Server as ServerIcon } from 'lucide-react';
import { Cover, EmptyState } from './primitives';
import type { ShelfBook } from './libraryIndex';
import { absCoverUrl, getAudiobookLink } from '../../utils/audiobookshelfService';
import { kavitaSeriesCoverUrl } from '../../utils/kavitaService';
import { buscandoKavitaParaAudios, KAVITA_PARA_AUDIOS_EVENT, getKavitaParaAudios, refrescarKavitaParaAudios } from '../../utils/kavitaParaAudios';
import { getCachedServerCatalog, serverItemId, type ServerItem } from '../../utils/serverCatalog';
import { getLocalAudiobookProgress } from '../../utils/serverProgress';
import { crearBuscador, useLecturasJapones } from '../../utils/busquedaRomaji';
import {
  parejasDeBiblioteca,
  parejasDeKavita,
  type AudioDePareja,
  type ParejaBiblioteca,
  type ParejaKavita,
  type SerieDePareja,
} from '../../utils/paresLecturaAudio';

/**
 * «Leer y escuchar»: cada novela con su audiolibro al lado.
 *
 * Antes esta sección era la cuadrícula del catálogo filtrada: salía la portada de la
 * novela y nada decía cuál era su audiolibro, ni por dónde ibas en él. Ahora cada
 * fila es la pareja —las dos portadas, los dos avances— y desde ella se hace
 * cualquiera de las tres cosas: leer escuchando, solo leer o solo escuchar.
 *
 * Debajo van las novelas de Kavita que ya tienen su audiolibro en Audiobookshelf pero
 * todavía no se han traído al aparato, obra por obra y con sus tomos: son las
 * siguientes candidatas, y hasta ahora no había forma de saber cuáles eran sin ir
 * comparando los dos servidores a ojo.
 */

/** Lo que `openServerItem` necesita para abrir una entrada de Kavita. */
function kavitaItem(serie: SerieDePareja): ServerItem {
  return {
    id: `kavita-${serie.serieId}`,
    serverId: serie.serieId,
    title: serie.title,
    cover: kavitaSeriesCoverUrl(Number(serie.serieId)),
    source: 'kavita',
  };
}

function audioPercent(itemId: string, continueAudio: ServerItem[]): number {
  const local = getLocalAudiobookProgress(itemId);
  if (local && local.duration > 0) {
    return Math.min(100, Math.max(0, Math.round((local.currentTime / local.duration) * 100)));
  }
  const server = continueAudio.find((item) => serverItemId(item) === itemId);
  return Math.min(100, Math.max(0, Math.round(server?.percent || 0)));
}

function ProgressLine({ icon, label, percent }: { icon: React.ReactNode; label: string; percent: number }) {
  return (
    <div className="yoru-pair-progress">
      <span className="yoru-pair-progress-label">{icon}{label}</span>
      <span className="yoru-pair-progress-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      <span className="yoru-pair-progress-value">{percent} %</span>
    </div>
  );
}

/** La portada del audiolibro; si el servidor no la da, queda el icono sobre el fondo. */
function AudioCover({ itemId }: { itemId: string }) {
  const [failed, setFailed] = useState(false);
  const src = absCoverUrl(itemId);
  if (!src || failed) {
    return <span className="yoru-pair-audio-fallback"><Headphones size={22} aria-hidden="true" /></span>;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export default function ReadListenView({
  library,
  es,
  onReadAndListen,
  onOpenDetail,
  onOpenAudiobook,
  onOpenKavitaSeries,
  onReadAndListenKavita,
  onImport,
  onBrowseKavita,
  onBrowseAudiobooks,
}: {
  library: ShelfBook[];
  es: boolean;
  /** Abre la novela con su audiolibro sonando. */
  onReadAndListen: (book: ShelfBook) => void;
  onOpenDetail: (book: ShelfBook) => void;
  /** Abre la ficha del audiolibro, para escucharlo sin el texto. */
  onOpenAudiobook: (itemId: string) => void;
  onOpenKavitaSeries: (item: ServerItem) => void;
  /** Baja el tomo de Kavita, lo abre y pone a sonar su audiolibro. */
  onReadAndListenKavita?: (serieId: string, audio: { itemId: string; title: string }) => Promise<void>;
  onImport: () => void;
  onBrowseKavita: () => void;
  onBrowseAudiobooks: () => void;
}) {
  const [query, setQuery] = useState('');
  /*
    Abrir un tomo de Kavita tarda: hay que bajarlo y prepararlo. Mientras, su botón lo
    dice y los demás esperan, para que un segundo toque no lance otra descarga.
  */
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [falloAlAbrir, setFalloAlAbrir] = useState('');
  const leerYEscuchar = async (tomo: ParejaKavita['tomos'][number]) => {
    if (abriendo) return;
    if (!onReadAndListenKavita) { onOpenKavitaSeries(kavitaItem(tomo.serie)); return; }
    setAbriendo(tomo.serie.serieId);
    setFalloAlAbrir('');
    try {
      await onReadAndListenKavita(tomo.serie.serieId, { itemId: tomo.audio.itemId, title: tomo.audio.title });
    } catch (error) {
      setFalloAlAbrir(error instanceof Error && error.message
        ? error.message
        : (es ? 'No se pudo abrir ese tomo.' : 'That volume could not be opened.'));
    } finally {
      setAbriendo(null);
    }
  };
  // La caché del catálogo se rellena en segundo plano: cuando llega, se vuelve a emparejar.
  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setCatalogVersion((value) => value + 1);
    window.addEventListener('yoru-server-catalog-updated', refresh);
    window.addEventListener(KAVITA_PARA_AUDIOS_EVENT, refresh);
    return () => {
      window.removeEventListener('yoru-server-catalog-updated', refresh);
      window.removeEventListener(KAVITA_PARA_AUDIOS_EVENT, refresh);
    };
  }, []);

  const { parejas, deKavita, continueAudio } = useMemo(() => {
    const catalog = getCachedServerCatalog();
    const audiolibros: AudioDePareja[] = catalog.audiobooks.map((item) => ({
      itemId: serverItemId(item),
      title: item.title,
      author: item.author,
    }));
    return {
      parejas: parejasDeBiblioteca(library, audiolibros, getAudiobookLink),
      deKavita: parejasDeKavita(audiolibros, getKavitaParaAudios(), library.map((book) => book.title)),
      continueAudio: catalog.continueAudio,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, catalogVersion]);

  // Lo guardado se pinta ya; si toca, se vuelve a preguntar a Kavita por detrás.
  useEffect(() => {
    void refrescarKavitaParaAudios(getCachedServerCatalog().audiobooks.map((item) => ({
      itemId: serverItemId(item),
      title: item.title,
      author: item.author,
    })));
  }, [catalogVersion]);

  // En romaji también («re zero» → Ｒｅ：ゼロ…), ver `busquedaRomaji.ts`.
  const needle = query.trim();
  const lecturas = useLecturasJapones(needle);
  const visibles = useMemo<ParejaBiblioteca<ShelfBook>[]>(() => {
    const buscador = crearBuscador(needle);
    if (!buscador) return parejas;
    return parejas.filter(({ libro, audio }) => buscador(libro.title, libro.author, libro.series, audio.title));
  }, [parejas, needle, lecturas]);
  const kavitaVisibles = useMemo<ParejaKavita[]>(() => {
    const buscador = crearBuscador(needle);
    if (!buscador) return deKavita;
    return deKavita.filter(({ obra, tomos }) => buscador(obra, ...tomos.map((tomo) => tomo.audio.title)));
  }, [deKavita, needle, lecturas]);

  const total = parejas.length;
  // Los tomos de Kavita también son novelas con su audiolibro: sin contarlos, el
  // encabezado decía «0» encima de una lista con veinticuatro.
  const cuenta = total + deKavita.reduce((suma, { tomos }) => suma + tomos.length, 0);
  // Sin parejas todavía y con la pregunta a Kavita en marcha: no es que no haya, es
  // que aún no se sabe. Decir «ninguna» ahí era mentir durante los primeros segundos.
  const buscando = total === 0 && deKavita.length === 0 && buscandoKavitaParaAudios();
  const subtitle = buscando
    ? (es ? 'Buscando en Kavita las novelas de tus audiolibros…' : 'Looking in Kavita for the novels of your audiobooks…')
    : total === 0 && deKavita.length === 0
    ? (es
        ? 'Ninguna novela tiene su audiolibro todavía. Abre un libro y elige su audiolibro en el reproductor, o vincúlalo desde Audiolibros.'
        : 'No novel has its audiobook yet. Open a book and pick its audiobook in the player, or link it from Audiobooks.')
    : es
      ? `${cuenta} ${cuenta === 1 ? 'novela con su audiolibro' : 'novelas con su audiolibro'}`
      : `${cuenta} ${cuenta === 1 ? 'novel with its audiobook' : 'novels with their audiobook'}`;

  return (
    <div>
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Leer y escuchar' : 'Read and listen'}</h1>
          <div className="yoru-view-sub">{subtitle}</div>
        </div>
      </div>

      {total + deKavita.length > 4 && (
        <div className="yoru-controls">
          <div>
            <span className="yoru-control-label" id="pair-search-label">{es ? 'Buscar' : 'Search'}</span>
            <label className="yoru-control-field">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={es ? 'Buscar por título o autor…' : 'Search by title or author…'}
                aria-labelledby="pair-search-label"
              />
            </label>
          </div>
        </div>
      )}

      {total === 0 && deKavita.length === 0 && !buscando && (
        <div className="yoru-detail-actions">
          {library.length === 0 && (
            <button type="button" className="yoru-btn yoru-btn-primary" onClick={onImport}>
              <Plus size={16} />
              {es ? 'Importar un libro' : 'Import a book'}
            </button>
          )}
          <button type="button" className="yoru-btn" onClick={onBrowseKavita}>
            <ServerIcon size={16} />
            {es ? 'Traer una novela de Kavita' : 'Get a novel from Kavita'}
          </button>
          <button type="button" className="yoru-btn" onClick={onBrowseAudiobooks}>
            <Headphones size={16} />
            {es ? 'Ver mis audiolibros' : 'See my audiobooks'}
          </button>
        </div>
      )}

      {visibles.length > 0 && (
        <div className="yoru-pair-list">
          {visibles.map(({ libro, audio, conCapitulos }) => {
            const leido = Math.min(100, Math.max(0, Math.round(libro.progress?.percent ?? 0)));
            const escuchado = audioPercent(audio.itemId, continueAudio);
            return (
              <article key={libro.id} className="yoru-pair">
                <div className="yoru-pair-covers">
                  <button
                    type="button"
                    className="yoru-pair-cover is-book"
                    onClick={() => onOpenDetail(libro)}
                    title={es ? `Ficha de ${libro.title}` : `${libro.title} details`}
                  >
                    <Cover book={libro} />
                  </button>
                  <button
                    type="button"
                    className="yoru-pair-cover is-audio"
                    onClick={() => onOpenAudiobook(audio.itemId)}
                    title={es ? `Audiolibro: ${audio.title}` : `Audiobook: ${audio.title}`}
                  >
                    <AudioCover itemId={audio.itemId} />
                  </button>
                </div>
                <div className="yoru-pair-body">
                  <h2 className="yoru-pair-title">{libro.title}</h2>
                  <div className="yoru-pair-meta">
                    {libro.author && <span>{libro.author}</span>}
                    {conCapitulos && <span className="yoru-badge">{es ? 'Con capítulos' : 'With chapters'}</span>}
                  </div>
                  <div className="yoru-pair-audio-title">
                    <Headphones size={13} aria-hidden="true" />
                    {audio.title || (es ? 'Audiolibro vinculado' : 'Linked audiobook')}
                  </div>
                  <ProgressLine icon={<BookOpen size={13} aria-hidden="true" />} label={es ? 'Leído' : 'Read'} percent={leido} />
                  <ProgressLine icon={<Headphones size={13} aria-hidden="true" />} label={es ? 'Escuchado' : 'Listened'} percent={escuchado} />
                  <div className="yoru-pair-actions">
                    <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => onReadAndListen(libro)}>
                      <Headphones size={15} />
                      {es ? 'Leer y escuchar' : 'Read and listen'}
                    </button>
                    <button type="button" className="yoru-btn" onClick={() => onOpenAudiobook(audio.itemId)}>
                      {es ? 'Solo escuchar' : 'Listen only'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {kavitaVisibles.length > 0 && (
        <section className="yoru-pair-section">
          <h2 className="yoru-pair-section-title">{es ? 'En Kavita, con audiolibro' : 'On Kavita, with an audiobook'}</h2>
          <p className="yoru-view-sub">
            {es
              ? 'Estas novelas del servidor ya tienen su audiolibro. Toca un tomo y se abre con el audio sonando.'
              : 'These novels on the server already have their audiobook. Tap a volume and it opens with the audio playing.'}
          </p>
          {falloAlAbrir && <p className="yoru-pair-error" role="alert">{falloAlAbrir}</p>}
          <div className="yoru-pair-list">
            {kavitaVisibles.map(({ obra, tomos }) => {
              const primero = tomos[0];
              const portada = kavitaSeriesCoverUrl(Number(primero.serie.serieId));
              return (
                <article key={obra} className="yoru-pair">
                  <div className="yoru-pair-covers">
                    <button
                      type="button"
                      className="yoru-pair-cover is-book"
                      onClick={() => onOpenKavitaSeries(kavitaItem(primero.serie))}
                      title={primero.serie.title}
                    >
                      {portada
                        ? <img src={portada} alt="" loading="lazy" />
                        : <span className="yoru-pair-audio-fallback"><BookOpen size={22} aria-hidden="true" /></span>}
                    </button>
                    <button
                      type="button"
                      className="yoru-pair-cover is-audio"
                      onClick={() => onOpenAudiobook(primero.audio.itemId)}
                      title={es ? `Audiolibro: ${primero.audio.title}` : `Audiobook: ${primero.audio.title}`}
                    >
                      <AudioCover itemId={primero.audio.itemId} />
                    </button>
                  </div>
                  <div className="yoru-pair-body">
                    <h2 className="yoru-pair-title">{obra}</h2>
                    <div className="yoru-pair-audio-title">
                      <Headphones size={13} aria-hidden="true" />
                      {tomos.length === 1
                        ? (es ? 'Tiene su audiolibro' : 'Has its audiobook')
                        : (es ? `${tomos.length} tomos con audio` : `${tomos.length} volumes with audio`)}
                    </div>
                    {/*
                      Con varios tomos, cada uno es un botón que abre ese tomo ya sonando:
                      un toque, y se lee escuchando. La ficha de Kavita sigue en la portada.
                    */}
                    {tomos.length > 1 && (
                      <div className="yoru-pair-volumes">
                        {tomos.map((tomo) => (
                          <button
                            key={tomo.serie.serieId}
                            type="button"
                            className={`yoru-pair-volume${abriendo === tomo.serie.serieId ? ' is-opening' : ''}`}
                            onClick={() => { void leerYEscuchar(tomo); }}
                            disabled={abriendo !== null}
                            aria-busy={abriendo === tomo.serie.serieId}
                            title={es ? `Leer y escuchar: ${tomo.serie.title}` : `Read and listen: ${tomo.serie.title}`}
                          >
                            {abriendo === tomo.serie.serieId ? '…' : (tomo.tomo ?? '·')}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="yoru-pair-actions">
                      <button
                        type="button"
                        className="yoru-btn yoru-btn-primary"
                        onClick={() => { void leerYEscuchar(primero); }}
                        disabled={abriendo !== null}
                        aria-busy={abriendo === primero.serie.serieId}
                      >
                        <Headphones size={15} />
                        {abriendo === primero.serie.serieId
                          ? (es ? 'Abriendo…' : 'Opening…')
                          : tomos.length === 1 || primero.tomo === null
                            ? (es ? 'Leer y escuchar' : 'Read and listen')
                            : (es ? `Leer y escuchar el tomo ${primero.tomo}` : `Read and listen to volume ${primero.tomo}`)}
                      </button>
                      <button type="button" className="yoru-btn" onClick={() => onOpenAudiobook(primero.audio.itemId)}>
                        {es ? 'Solo escuchar' : 'Listen only'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {needle && visibles.length === 0 && kavitaVisibles.length === 0 && (
        <EmptyState title={es ? 'Nada por aquí' : 'Nothing here'} />
      )}
    </div>
  );
}
