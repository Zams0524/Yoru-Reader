import React, { useEffect, useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';
import { BookPoster, BookRail, Cover, EmptyState, EntityCard, Rail } from './primitives';
import {
  ServerCard,
  ServerCollectionCard,
  ServerContinueCard,
  useApartados,
  useServerCatalog,
  useServerRails,
} from './HomeServerSections';
import { useBookActions, useBookMenu } from './BookContextMenu';
import type { ServerCollection, ServerItem, ServerSeries } from '../../utils/serverCatalog';
import { getHomeLayout, type RailId } from '../../utils/homeRails';
import { motivoTexto, RECS_EVENT } from '../../utils/recomendaciones';
import { restanteDeLibro } from '../../utils/historialLibro';
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
  suggestionsWithReason,
  visibleBooks,
  type EntityGroup,
  type ShelfBook,
} from './libraryIndex';

/** «2 h 10», «35 min»: lo que queda, corto, para que quepa en una tarjeta. */
function restanteCorto(seconds: number): string {
  const horas = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (horas === 0) return `${Math.max(1, mins)} min`;
  return mins === 0 ? `${horas} h` : `${horas} h ${mins} min`;
}

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
  onOpenServerCollection,
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
  /** Abre una colección del servidor (Kavita o Audiobookshelf), con todos sus títulos. */
  onOpenServerCollection: (collection: ServerCollection) => void;
}) {
  const openMenu = useBookMenu();
  const menuActions = useBookActions();
  const { apartar, estaApartado } = useApartados();

  /*
    El orden de los carruseles lo decide el usuario en Ajustes → Organizar inicio.
    Se lee aquí, antes de cualquier salida temprana, porque son hooks: sin nada que
    enseñar esta vista devuelve el estado vacío y no llega a pintarlos.
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

  /*
    Un libro borrado sigue en la lista (se guarda marcado, para no perder sus
    estadísticas), pero ya no está en la biblioteca. Contarlo aquí hacía dos cosas
    raras al borrar: su título seguía tapando la serie del servidor —así que lo
    borrado desaparecía de Inicio del todo, también de las filas de Kavita— y, borrado
    el último libro, Inicio no se daba por vacío.
  */
  const propios = useMemo(() => visibleBooks(books), [books]);
  const localTitles = useMemo(() => new Set(propios.map((book) => book.title)), [propios]);
  /*
    Lo que ya sale en «Continuar», para que las filas del servidor no lo repitan:
    las series de Kavita y los audiolibros a medias de este perfil. Sin esto, el
    audiolibro que estás oyendo salía dos veces en la pestaña «Audiolibros», en
    «Continuar» y en «Seguir escuchando».
  */
  const continuingSeries = useMemo(
    () => new Set(serverContinue.map((entry) => (entry.kind === 'kavita' ? String(entry.seriesId) : entry.itemId))),
    [serverContinue]
  );
  const [scope, setScope] = useState<'all' | 'books' | 'audio'>('all');
  const catalog = useServerCatalog();
  const serverRails = useServerRails({
    es,
    localTitles,
    skipSeriesIds: continuingSeries,
    scope,
    onOpenItem: onOpenServerItem,
    onOpenSeries: onOpenServerSeries,
  });

  /*
    Apartar una recomendación tiene que quitarla ya. Lo apartado no está en los libros,
    así que un cambio ahí no repinta nada por sí solo: se escucha el aviso y se recuenta.
  */
  const [recsVersion, setRecsVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setRecsVersion((previo) => previo + 1);
    window.addEventListener(RECS_EVENT, onUpdate);
    return () => window.removeEventListener(RECS_EVENT, onUpdate);
  }, []);

  const data = useMemo(
    () => ({
      continuing: continueReading(books),
      recent: recentlyAdded(books),
      forYou: suggestionsWithReason(books),
      collections: collectionGroups(books).slice(0, 12),
      series: seriesGroups(books).filter((group) => group.books.length > 1).slice(0, 12),
    }),
    [books, recsVersion]
  );

  /*
    Inicio / Libros / Audiolibros: filtran esta misma pantalla, sin salir de ella.

    Fueron un filtro, luego pasaron a navegar —porque filtraban a medias: con
    «Audiolibros» puesto seguían saliendo «Añadidos recientemente», «Libros para ti» y
    «Series», que son libros— y ahora vuelven a filtrar, pero de verdad: cada carrusel
    sabe si es de libros o de audio y solo sale el que toca. Lo pidió zams (18 nov
    2026): «el botón de Libros me lleva a catálogo en vez de mostrarme la sección de
    libros ahí mismo». Para ir a la sección entera están el menú de la izquierda y el
    «Ver todo» de debajo de las pestañas.
  */
  const scopes: { key: 'all' | 'books' | 'audio'; label: string }[] = [
    { key: 'all', label: es ? 'Inicio' : 'Home' },
    { key: 'books', label: es ? 'Libros' : 'Books' },
    { key: 'audio', label: es ? 'Audiolibros' : 'Audiobooks' },
  ];

  /** Los carruseles que son de audio; el resto son de libros. */
  const RAILES_DE_AUDIO = new Set<RailId>([
    'server-audio-continue',
    'server-list',
    'server-foryou-audio',
    'server-audio-series',
    'server-random-audio',
  ]);
  /** Los que llevan de las dos cosas: se construyen ya filtrados por la pestaña. */
  const RAILES_MIXTOS = new Set<RailId>(['continue', 'recent', 'server-popular', 'collections']);

  /*
    Vacío de verdad: ni un libro propio ni nada en ninguno de los dos servidores.

    Antes bastaba con no tener libros locales para que Inicio dijera «tu biblioteca
    está vacía», aunque detrás hubiera un Kavita con sus series y doscientos y pico
    audiolibros esperando. Eso es decirle a alguien que no tiene nada mientras lo
    tiene todo, y encima tapando lo que sí hay.
  */
  const sinLibrosPropios = propios.length === 0 && serverContinue.length === 0;
  const sinServidores = Object.keys(serverRails).length === 0
    && catalog.recent.length === 0
    && catalog.collections.length === 0;
  if (sinLibrosPropios && sinServidores) {
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
          /*
            Y lo que falta para acabarlo, al lado del porcentaje. Un «45 %» dice cuánto
            llevas; lo que se quiere saber al volver a un libro es si se termina esta
            tarde. Se estima con lo que el libro ya guarda —caracteres, tiempo y
            porcentaje—, sin leer los partes diarios: son varias tarjetas y saldría una
            lectura de IndexedDB por cada una.
          */
          const queda = restanteDeLibro(book);
          return (
            <span key={book.id} className="yoru-continue-slot">
            <button
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
                <span className="yoru-continue-state">
                  {es ? 'Novela' : 'Novel'} · {percent} %
                  {queda ? (es ? ` · quedan ${restanteCorto(queda.segundos)}` : ` · ${restanteCorto(queda.segundos)} left`) : ''}
                </span>
                <span className="yoru-continue-bar">
                  <span style={{ width: `${percent}%` }} />
                </span>
              </span>
            </button>
            {/*
              La misma acción que «Quitar de Continuar» del menú, pero a un clic.
              El menú del clic derecho no se ve, y zams fue a quitar un libro de aquí
              pulsando encima (18 nov 2026): lo único que pasaba era que se abría.
            */}
            {menuActions && (
              <button
                type="button"
                className="yoru-continue-remove"
                title={es ? 'Quitar de Continuar' : 'Remove from Continue'}
                aria-label={es ? 'Quitar de Continuar' : 'Remove from Continue'}
                onClick={(event) => {
                  event.stopPropagation();
                  menuActions.onHideFromContinue(book);
                }}
              >
                <X size={14} />
              </button>
            )}
            </span>
          );
      })(),
    }));

    /*
      Lo del servidor que lleva a medias este perfil: tomos y audiolibros. Los
      audiolibros vuelven aquí porque su avance tiene que verse arriba, al lado del de
      las novelas; lo pidió zams (18 nov 2026). Lo que no quiere es verlos en la
      pestaña «Libros», y de eso se encarga el filtro de abajo, no esta lista.

      Un tomo de Kavita ya importado sale como libro propio: no se repite. Y lo
      apartado a mano de las filas de «continuar» tampoco vuelve por aquí.
    */
    const serverCards = serverContinue
      .filter((entry) => !(entry.kind === 'kavita' && localTitles.has(entry.title)))
      .map((entry) => {
      // Pulsar abre la ficha: la serie en Kavita (con su «Seguir leyendo»), el tomo
      // en Audiobookshelf. Las dos retoman donde lo dejó este perfil.
      const esAudio = entry.kind === 'audiobook';
      const seriesId = entry.kind === 'kavita' ? entry.seriesId : 0;
      const seriesName = entry.kind === 'kavita' ? entry.seriesName : undefined;
      const item: ServerItem = esAudio
        ? {
          id: `abs-${entry.kind === 'audiobook' ? entry.itemId : ''}`,
          serverId: entry.kind === 'audiobook' ? entry.itemId : '',
          title: entry.title,
          cover: absCoverUrl(entry.kind === 'audiobook' ? entry.itemId : ''),
          source: 'audiobookshelf',
          author: entry.kind === 'audiobook' ? entry.author : undefined,
          percent: entry.percent,
        }
        : {
          id: `kavita-${seriesId}`,
          serverId: String(seriesId),
          title: entry.title,
          // La portada es la del tomo que se está leyendo, no la de la serie.
          cover: kavitaVolumeCoverUrl(entry.kind === 'kavita' ? entry.volumeId : 0),
          source: 'kavita',
          series: seriesName && seriesName !== entry.title ? seriesName : 'Kavita',
          percent: entry.percent,
        };
      return {
        at: entry.at,
        esAudio,
        // Apartado solo cuenta si no se ha avanzado después de apartarlo.
        hidden: estaApartado(item.id, entry.at),
        node: (
          <ServerContinueCard
            key={entry.key}
            item={item}
            es={es}
            onOpen={() => onOpenServerItem(esAudio ? item : { ...item, title: seriesName || entry.title })}
            onHide={() => apartar(item.id)}
          />
        ),
      };
    })
      .filter((card) => !card.hidden);

    /*
      La pestaña manda sobre el contenido de la fila: en «Libros» no salen los
      audiolibros —que es lo que molestaba— y en «Audiolibros» solo salen ellos. Si no
      queda nada, la fila no se pinta.
    */
    const continueCards = [
      ...bookCards.map((card) => ({ ...card, esAudio: false })),
      ...serverCards,
    ]
      .filter((card) => (scope === 'books' ? !card.esAudio : scope === 'audio' ? card.esAudio : true))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    if (continueCards.length > 0) {
      localRails.continue = (
        <Rail title={es ? 'Continuar' : 'Continue'} es={es}>
          {continueCards.map((card) => card.node)}
        </Rail>
      );
    }
  }

  /*
    Lo del servidor que toca en esta pestaña: en «Libros», Kavita; en «Audiolibros»,
    Audiobookshelf. Lo usan las filas que mezclan lo propio con lo del servidor.
  */
  const enPestana = (source: 'kavita' | 'audiobookshelf') => (
    scope === 'books' ? source === 'kavita' : scope === 'audio' ? source === 'audiobookshelf' : true
  );

  /*
    «Añadidos recientemente»: lo último que importaste y, detrás, lo último que entró
    en los servidores. Antes solo eran los libros importados, y en un aparato que lee
    todo de Kavita y Audiobookshelf —el teléfono de zams— la fila no salía nunca. Lo
    pidió zams (24 nov 2026) al comparar su Inicio con el de Nanahoshi. Un tomo de
    Kavita que ya está importado no se repite.
  */
  const recentLocal = scope === 'audio' ? [] : data.recent;
  const recentServer = catalog.recent.filter((item) => enPestana(item.source) && !localTitles.has(item.title));
  if (recentLocal.length > 0 || recentServer.length > 0) {
    localRails.recent = (
      <Rail
        title={es ? 'Añadidos recientemente' : 'Recently added'}
        es={es}
        onMore={recentLocal.length > 0 ? onGoCatalog : undefined}
        moreLabel={es ? 'Ver todo' : 'See all'}
      >
        {recentLocal.map((book) => (
          <BookPoster key={book.id} book={book} onOpen={onOpenDetail} />
        ))}
        {recentServer.map((item) => (
          <ServerCard key={item.id} item={item} es={es} onOpen={onOpenServerItem} />
        ))}
      </Rail>
    );
  }

  if (data.forYou.length > 0) {
    /*
      El motivo va donde iba el autor: «Sigue <serie>», «De <autor>, que ya lees». Una
      fila de portadas sin motivo no se distingue de una lista al azar, y cuando acierta
      tampoco se nota. Y con el clic derecho se aparta la que no interesa.
    */
    const motivos = new Map(data.forYou.map((entry) => [entry.book.id, motivoTexto(entry.reason, es)]));
    localRails['for-you'] = (
      <BookRail
        title={es ? 'Libros para ti' : 'Books for you'}
        books={data.forYou.map((entry) => entry.book)}
        onOpen={onOpenDetail}
        es={es}
        subtitleOf={(book) => motivos.get(book.id)}
        menuOptions={{ fromSuggestions: true }}
      />
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

  /*
    «Descubre colecciones»: las tuyas y las de los servidores. Igual que con los
    recientes, sin libros importados la fila no salía aunque Kavita o Audiobookshelf
    tuvieran colecciones hechas.
  */
  const collectionsLocal = scope === 'audio' ? [] : data.collections;
  const collectionsServer = catalog.collections.filter((entry) => enPestana(entry.source));
  if (collectionsLocal.length > 0 || collectionsServer.length > 0) {
    localRails.collections = (
      <Rail title={es ? 'Descubre colecciones' : 'Discover collections'} es={es}>
        {/*
          Las colecciones propias con la misma tarjeta que las del servidor. Antes iban
          en una caja de 240 px que la fila encogía, y una vacía salía como una tira
          estrecha sin portada al lado de las del servidor (zams, 23 nov 2026).
        */}
        {collectionsLocal.map((group) => (
          <button
            key={group.key}
            type="button"
            className="yoru-series-stack"
            title={group.name}
            onClick={() => onOpenCollection(group)}
          >
            <span className="yoru-series-stack-frame">
              {group.books.slice(1, 3).map((book, index) => (
                <span key={book.id} className={`yoru-series-stack-back is-${index + 1}`}>
                  <Cover book={book} />
                </span>
              ))}
              {group.books[0] ? (
                <span className="yoru-series-stack-front"><Cover book={group.books[0]} /></span>
              ) : (
                <span className="yoru-series-stack-front yoru-series-stack-empty"><Tag size={28} aria-hidden="true" /></span>
              )}
            </span>
            <span className="yoru-poster-title">{group.name}</span>
            <span className="yoru-poster-meta">
              {formatCount(group.books.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}
            </span>
          </button>
        ))}
        {collectionsServer.map((entry) => (
          <ServerCollectionCard key={entry.key} collection={entry} es={es} onOpen={onOpenServerCollection} />
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
            className={`yoru-chip${scope === item.key ? ' active' : ''}`}
            aria-current={scope === item.key ? 'page' : undefined}
            onClick={() => setScope(item.key)}
          >
            {item.label}
          </button>
        ))}
        {scope !== 'all' && (
          <button
            type="button"
            className="yoru-chip-link"
            onClick={() => (scope === 'books' ? onGoCatalog() : onGoAudiobooks())}
          >
            {es ? 'Ver todo' : 'See all'}
          </button>
        )}
      </div>

      {/*
        Con servidor y sin libros propios, «importa una novela» sigue siendo verdad,
        pero es una nota al pie: lo que se viene a ver es el catálogo.
      */}
      {sinLibrosPropios && (
        <p className="yoru-home-hint">
          {es
            ? 'Esto es lo que hay en tus servidores. Importa una novela y también aparecerá aquí.'
            : 'This is what your servers have. Import a novel and it will show up here too.'}
        </p>
      )}

      {(() => {
        const visibles = layout.order.filter((id) => {
          if (hidden.has(id) || !all[id]) return false;
          /*
            «Continuar» lleva las dos cosas, y lo que filtra es su contenido, no el
            carrusel entero: con «Audiolibros» puesto trae los audiolibros a medias, y
            con «Libros», los tomos. Si en esa pestaña no le queda nada, no se ha
            construido y ya no está aquí.

            Lo mismo con las filas que mezclan libros y audiolibros del servidor:
            recientes, populares y colecciones.
          */
          if (RAILES_MIXTOS.has(id)) return true;
          if (scope === 'books') return !RAILES_DE_AUDIO.has(id);
          if (scope === 'audio') return RAILES_DE_AUDIO.has(id);
          return true;
        });
        // Filtrar y no enseñar nada deja la pantalla en blanco sin decir por qué.
        if (visibles.length === 0) {
          return (
            <EmptyState
              title={scope === 'audio'
                ? (es ? 'Aún no hay audiolibros aquí' : 'No audiobooks here yet')
                : (es ? 'Aún no hay libros aquí' : 'No books here yet')}
              sub={scope === 'audio'
                ? (es ? 'Conecta Audiobookshelf para verlos en Inicio.' : 'Connect Audiobookshelf to see them on Home.')
                : (es ? 'Importa una novela o conecta Kavita.' : 'Import a novel or connect Kavita.')}
            />
          );
        }
        return visibles.map((id) => <React.Fragment key={id}>{all[id]}</React.Fragment>);
      })()}
    </div>
  );
}
