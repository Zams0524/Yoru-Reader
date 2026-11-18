import React, { useEffect, useMemo, useState } from 'react';
import { BookRail, EmptyState, EntityCard, Rail } from './primitives';
import { useServerRails } from './HomeServerSections';
import { useBookMenu } from './BookContextMenu';
import type { ServerItem, ServerSeries } from '../../utils/serverCatalog';
import { getHomeLayout, type RailId } from '../../utils/homeRails';
import { LOCAL_PROGRESS_EVENT, localContinueEntries, type LocalContinueEntry } from '../../utils/serverProgress';
import { kavitaSeriesCoverUrl, kavitaVolumeCoverUrl } from '../../utils/kavitaService';
import { absCoverUrl } from '../../utils/audiobookshelfService';
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

  /*
    El orden de los carruseles lo decide el usuario en Ajustes → Organizar inicio.
    Se lee aquí, antes de cualquier salida temprana, porque son hooks: con la
    biblioteca vacía esta vista devuelve el estado vacío y no llega a pintarlos.
  */
  const [layout, setLayout] = useState(() => getHomeLayout());
  useEffect(() => {
    const onUpdate = () => setLayout(getHomeLayout());
    window.addEventListener('yoru-home-rails-updated', onUpdate);
    return () => window.removeEventListener('yoru-home-rails-updated', onUpdate);
  }, []);

  /*
    Lo empezado en el servidor sin importarlo (tomos de Kavita leídos de paso,
    audiolibros) también va en «Continuar»: es lo que lee este perfil, apuntado en
    el dispositivo, no lo que la cuenta del servidor tenga a medias.
  */
  const [serverContinue, setServerContinue] = useState<LocalContinueEntry[]>(() => localContinueEntries());
  useEffect(() => {
    const onUpdate = () => setServerContinue(localContinueEntries());
    onUpdate();
    window.addEventListener(LOCAL_PROGRESS_EVENT, onUpdate);
    return () => window.removeEventListener(LOCAL_PROGRESS_EVENT, onUpdate);
  }, [books]);

  const localTitles = useMemo(() => new Set(books.map((book) => book.title)), [books]);
  const continuingSeries = useMemo(
    () => new Set(serverContinue.filter((entry) => entry.kind === 'kavita').map((entry) => String((entry as any).seriesId))),
    [serverContinue]
  );
  const serverRails = useServerRails({
    es,
    localTitles,
    skipSeriesIds: continuingSeries,
    onOpenItem: onOpenServerItem,
    onOpenSeries: onOpenServerSeries,
  });

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

  if (books.length === 0 && serverContinue.length === 0) {
    return (
      <EmptyState
        title={es ? 'Tu biblioteca está vacía' : 'Your library is empty'}
        sub={es ? 'Importa una novela para empezar a leer.' : 'Import a novel to start reading.'}
      />
    );
  }


  /*
    Los carruseles de la biblioteca local, cada uno con su identificador, igual que
    los del servidor. Los dos mapas se juntan y se pintan en el orden que el usuario
    haya dejado en Ajustes → Organizar inicio.

    Un carrusel vacío no entra en el mapa: lo que decide si se ve es si tiene algo,
    y solo después lo que el usuario haya ordenado u ocultado.
  */
  const localRails: Partial<Record<RailId, React.ReactNode>> = {};

  if (data.continuing.length > 0 || serverContinue.length > 0) {
    // Libros propios y lo empezado en el servidor, juntos y por fecha: lo último, primero.
    const bookCards = data.continuing.map((book) => ({
      at: String((book as any).lastRead || ''),
      node: (() => {
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
      })(),
    }));

    // Un tomo de Kavita ya importado sale como libro propio: no se repite.
    const serverCards = serverContinue
      .filter((entry) => !(entry.kind === 'kavita' && localTitles.has(entry.title)))
      .map((entry) => {
      const isAudio = entry.kind === 'audiobook';
      // Pulsar abre la ficha: la serie en Kavita (con su «Seguir leyendo»), el tomo
      // en Audiobookshelf. Las dos ya retoman donde lo dejó este perfil.
      const item: ServerItem = entry.kind === 'audiobook'
        ? { id: `abs-${entry.itemId}`, serverId: entry.itemId, title: entry.title, cover: absCoverUrl(entry.itemId), source: 'audiobookshelf', author: entry.author }
        : { id: `kavita-${entry.seriesId}`, serverId: String(entry.seriesId), title: entry.seriesName || entry.title, cover: kavitaSeriesCoverUrl(entry.seriesId), source: 'kavita' };
      const cover = entry.kind === 'kavita' ? kavitaVolumeCoverUrl(entry.volumeId) : item.cover;
      const subtitle = entry.kind === 'audiobook'
        ? (entry.author || (es ? 'Audiolibro' : 'Audiobook'))
        : (entry.seriesName && entry.seriesName !== entry.title ? entry.seriesName : 'Kavita');
      return {
        at: entry.at,
        node: (
          <button
            key={entry.key}
            type="button"
            className="yoru-continue-card"
            onClick={() => onOpenServerItem(item)}
            title={entry.title}
          >
            <span className="yoru-continue-cover">
              {cover ? <img src={cover} alt="" loading="lazy" /> : <span />}
            </span>
            <span className="yoru-continue-body">
              <span className="yoru-continue-title">{entry.title}</span>
              <span className="yoru-continue-author">{subtitle}</span>
              <span className="yoru-continue-state">
                {isAudio ? (es ? 'Audiolibro' : 'Audiobook') : (es ? 'Novela' : 'Novel')} · {entry.percent} %
              </span>
              <span className="yoru-continue-bar">
                <span style={{ width: `${entry.percent}%` }} />
              </span>
            </span>
          </button>
        ),
      };
    });

    localRails.continue = (
      <Rail title={es ? 'Continuar' : 'Continue'} es={es}>
        {[...bookCards, ...serverCards]
          .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
          .map((card) => card.node)}
      </Rail>
    );
  }

  if (data.recent.length > 0) {
    localRails.recent = (
      <BookRail
        title={es ? 'Añadidos recientemente' : 'Recently added'}
        books={data.recent}
        onOpen={onOpenDetail}
        es={es}
        onMore={onGoCatalog}
        moreLabel={es ? 'Ver todo' : 'See all'}
      />
    );
  }

  if (data.forYou.length > 0) {
    localRails['for-you'] = (
      <BookRail title={es ? 'Libros para ti' : 'Books for you'} books={data.forYou} onOpen={onOpenDetail} es={es} />
    );
  }

  if (data.series.length > 0) {
    localRails.series = (
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
    );
  }

  if (data.collections.length > 0) {
    localRails.collections = (
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
    );
  }

  const all = { ...localRails, ...serverRails };
  const hidden = new Set(layout.hidden);

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

      {layout.order
        .filter((id) => !hidden.has(id) && all[id])
        .map((id) => <React.Fragment key={id}>{all[id]}</React.Fragment>)}
    </div>
  );
}
