import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { BookRail, EmptyState, EntityCard, Rail } from './primitives';
import { useServerRails } from './HomeServerSections';
import { useBookActions, useBookMenu } from './BookContextMenu';
import type { ServerItem, ServerSeries } from '../../utils/serverCatalog';
import { getHomeLayout, type RailId } from '../../utils/homeRails';
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
  const menuActions = useBookActions();

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

  const localTitles = useMemo(() => new Set(books.map((book) => book.title)), [books]);
  const serverRails = useServerRails({
    es,
    localTitles,
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
    Inicio / Libros / Audiolibros: filtran esta misma pantalla, sin salir de ella.

    Fueron un filtro, luego pasaron a navegar —porque filtraban a medias: con
    «Audiolibros» puesto seguían saliendo «Añadidos recientemente», «Libros para ti» y
    «Series», que son libros— y ahora vuelven a filtrar, pero de verdad: cada carrusel
    sabe si es de libros o de audio y solo sale el que toca. Lo pidió zams (18 nov
    2026): «el botón de Libros me lleva a catálogo en vez de mostrarme la sección de
    libros ahí mismo». Para ir a la sección entera están el menú de la izquierda y el
    «Ver todo» de debajo de las pestañas.
  */
  const [scope, setScope] = useState<'all' | 'books' | 'audio'>('all');
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

  /*
    Vacío de verdad: ni un libro propio ni nada en ninguno de los dos servidores.

    Antes bastaba con no tener libros locales para que Inicio dijera «tu biblioteca
    está vacía», aunque detrás hubiera un Kavita con sus series y doscientos y pico
    audiolibros esperando. Eso es decirle a alguien que no tiene nada mientras lo
    tiene todo, y encima tapando lo que sí hay.
  */
  const sinLibrosPropios = books.length === 0;
  const sinServidores = Object.keys(serverRails).length === 0;
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

  if (data.continuing.length > 0) {
    localRails.continue = (
      <Rail title={es ? 'Continuar' : 'Continue'} es={es}>
        {data.continuing.map((book) => {
          const percent = Math.min(100, Math.max(0, Math.round(book.progress?.percent ?? 0)));
          // Miniatura de 56 px: aquí el respaldo es solo color, sin el título, que a
          // ese tamaño no se lee. Quién tiene imagen y quién degradado lo decide
          // `coverImage` / `coverTint`, igual que en el resto de la concha.
          const cover = coverImage(book);
          const tint = coverTint(book);
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
                <span className="yoru-continue-state">{es ? 'Novela' : 'Novel'} · {percent} %</span>
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
        })}
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
