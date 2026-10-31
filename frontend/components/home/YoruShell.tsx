import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bell,
  CheckCircle2,
  Clock,
  Home,
  Headphones,
  Layers,
  Library as LibraryIcon,
  Menu,
  Plus,
  Search,
  Server as ServerIcon,
  Settings,
  Tag,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useBackHandler } from '../../hooks/useBackButton';
import './yoru-shell.css';
import { BookMenuProvider } from './BookContextMenu';
import GlobalSearch from './GlobalSearch';
import HomeView from './HomeView';
import BookDetailView from './BookDetailView';
import { BookGridView, EntityListView } from './ListViews';
import StatsView from './StatsView';
import { AudiobookSeriesView, AudiobookshelfView, ServerEmptyState } from './ServerViews';
import { audiobookLinkState, getAudiobookLink } from '../../utils/audiobookshelfService';
import { isKavitaConfigured } from '../../utils/kavitaService';
import { serverItemId, type ServerItem, type ServerSeries } from '../../utils/serverCatalog';
import {
  authorGroups,
  collectionGroups,
  isCssGradient,
  seriesGroups,
  shelfBooks,
  visibleBooks,
  type EntityGroup,
  type ShelfBook,
  type ShelfId,
} from './libraryIndex';

// El resto de las props de `Library` llega por el spread de `libraryProps`, un registro
// abierto que TypeScript no puede contar; de ahí el tipo laxo en el componente perezoso.
const Library = React.lazy(() => import('../Library')) as React.LazyExoticComponent<
  React.ComponentType<Record<string, any>>
>;
const KavitaBrowser = React.lazy(() => import('../KavitaBrowser'));

/** Las secciones que el shell dibuja él mismo o delega en la biblioteca antigua. */
type View =
  | 'home'
  | 'catalog'
  | 'statistics'
  | 'srs'
  | 'settings'
  | 'series'
  | 'authors'
  | 'collections'
  | 'listen'
  | 'kavita'
  | 'audiobooks'
  | 'audioseries'
  | 'shelf'
  | 'group'
  | 'detail';

/** Las vistas que se renderizan embebiendo `Library` con la pestaña correspondiente. */
const EMBEDDED_TABS: Partial<Record<View, string>> = {
  catalog: 'library',
  srs: 'srs',
  settings: 'settings',
};

const SHELVES: { id: ShelfId; es: string; en: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'reading', es: 'En curso', en: 'In progress', icon: BookOpen },
  { id: 'want', es: 'Por empezar', en: 'Want to start', icon: BookMarked },
  { id: 'backlog', es: 'Pendiente', en: 'Backlog', icon: Clock },
  { id: 'completed', es: 'Completado', en: 'Completed', icon: CheckCircle2 },
];

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const onChange = () => setIsMobile(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

interface Props {
  books: ShelfBook[];
  settings: any;
  onSelectBook: (...args: any[]) => any;
  onUpdateBookDetails: (...args: any[]) => any;
  onOpenInfo: (...args: any[]) => any;
  initialTab?: string;
  /** El resto de props viaja tal cual a `Library`. */
  libraryProps: Record<string, any>;
}

/**
 * Shell de la interfaz nueva: cabecera global, barra lateral por secciones y lienzo de
 * vistas, tomados de la plantilla `yoru_template/index.html` pero dibujados con los
 * tokens del diseño Yoru. Las secciones que ya existían (biblioteca, SRS, estadísticas
 * y ajustes) se siguen renderizando con `Library`, embebida sin su propia cabecera, para
 * no duplicar funciones que ya funcionan.
 */
export default function YoruShell({
  books,
  settings,
  onSelectBook,
  onUpdateBookDetails,
  onOpenInfo,
  initialTab,
  libraryProps,
}: Props) {
  const es = (settings?.appLanguage ?? 'en') === 'es';
  const isMobile = useIsMobile();

  const [view, setView] = useState<View>(() => {
    const entry = Object.entries(EMBEDDED_TABS).find(([, tab]) => tab === initialTab);
    return (entry?.[0] as View) || 'home';
  });
  const [detailId, setDetailId] = useState<string | null>(null);
  // Aviso corto de las vistas de servidor (importaciones de Kavita, sobre todo).
  const [serverToast, setServerToast] = useState('');
  const [group, setGroup] = useState<{ kind: 'series' | 'author' | 'collection'; name: string } | null>(null);
  const [shelf, setShelf] = useState<ShelfId>('reading');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const library = useMemo(() => visibleBooks(books), [books]);
  const detailBook = useMemo(
    () => (detailId ? books.find((book) => book.id === detailId) ?? null : null),
    [books, detailId]
  );

  const groups = useMemo(
    () => ({
      series: seriesGroups(books),
      authors: authorGroups(books),
      collections: collectionGroups(books),
    }),
    [books]
  );

  const shelfCounts = useMemo(
    () => ({
      reading: shelfBooks(books, 'reading').length,
      want: shelfBooks(books, 'want').length,
      backlog: shelfBooks(books, 'backlog').length,
      completed: shelfBooks(books, 'completed').length,
    }),
    [books]
  );

  /**
   * La ficha de servidor que hay que abrir nada más entrar en su sección. La pone una
   * tarjeta de Inicio y la consume la vista. Navegar a mano la deja en nulo, para que
   * volver a «Audiolibros» por la barra lateral enseñe el catálogo y no la última
   * ficha que se miró.
   */
  const [serverTarget, setServerTarget] = useState<{ kind: 'kavita' | 'audiobook'; id: string } | null>(null);
  /** La serie de audiolibros que se está mirando, por su nombre, que es su clave. */
  const [audioSeries, setAudioSeries] = useState<string | null>(null);

  const go = useCallback((next: View, target: typeof serverTarget = null) => {
    setView(next);
    setServerTarget(target);
    setIsDrawerOpen(false);
  }, []);

  /** Una portada de servidor abre su ficha: la serie en Kavita, el tomo en Audiobookshelf. */
  const openServerItem = useCallback(
    (item: ServerItem) => {
      const id = serverItemId(item);
      if (item.source === 'kavita') go('kavita', { kind: 'kavita', id });
      else go('audiobooks', { kind: 'audiobook', id });
    },
    [go]
  );

  /**
   * Una serie de audiolibros abre la serie entera, no su primer tomo. La tarjeta
   * promete «Serie A · 3 audiolibros»; dejar al usuario en uno solo es peor que no
   * llevarlo a ningún sitio, porque cree que ha llegado.
   */
  const openServerSeries = useCallback((series: ServerSeries) => {
    setAudioSeries(series.key);
    go('audioseries');
  }, [go]);

  const openDetail = useCallback((book: ShelfBook) => {
    setDetailId(book.id);
    setView('detail');
    setIsDrawerOpen(false);
  }, []);

  const openGroup = useCallback((kind: 'series' | 'author' | 'collection', name: string) => {
    setGroup({ kind, name });
    setView('group');
    setIsDrawerOpen(false);
  }, []);

  // Botón atrás de Android: cierra lo último que se abrió, igual que en la biblioteca.
  const backSteps: [boolean, () => void][] = [
    [isSearchOpen, () => setIsSearchOpen(false)],
    [isDrawerOpen, () => setIsDrawerOpen(false)],
    [view === 'detail', () => go(group ? 'group' : 'home')],
    [view === 'group', () => go(groupBackView(group))],
    // La serie de audiolibros se abre desde Inicio, así que atrás vuelve a Inicio.
    [view === 'audioseries', () => go('home')],
    [view !== 'home', () => go('home')],
  ];
  useBackHandler(
    backSteps.some(([open]) => open),
    () => backSteps.find(([open]) => open)?.[1]()
  );

  /**
   * Lo que ofrece el clic derecho sobre un libro. Vive aquí porque aquí están los
   * manejadores: abrir la ficha, abrir el lector y escribir en la biblioteca.
   */
  const bookMenuActions = useMemo(
    () => ({
      es,
      onOpenDetail: openDetail,
      onRead: (book: ShelfBook) => onSelectBook(book),
      collections: groups.collections.map((entry) => entry.key),
      onAddToCollection: (book: ShelfBook, collection: string) => {
        const tags = book.tags ? [...book.tags] : [];
        if (tags.includes(collection)) return;
        tags.push(collection);
        onUpdateBookDetails(book.id, { tags });
      },
      onHideFromContinue: (book: ShelfBook) => onUpdateBookDetails(book.id, { hiddenFromContinue: true }),
    }),
    [es, openDetail, onSelectBook, groups.collections, onUpdateBookDetails]
  );

  const embeddedTab = EMBEDDED_TABS[view];

  const groupBooks = useMemo(() => {
    if (!group) return [];
    const source =
      group.kind === 'series' ? groups.series : group.kind === 'author' ? groups.authors : groups.collections;
    return source.find((entry) => entry.key === group.name)?.books ?? [];
  }, [group, groups]);

  // Los libros que tienen un audiolibro vinculado desde el lector. El vínculo lo guarda
  // `setAudiobookLink` (frontend/utils/audiobookshelfService.ts) por id de libro.
  const listenable = useMemo(
    () => library.filter((book) => Boolean(getAudiobookLink(book.id))),
    [library]
  );

  // El aviso se va solo: es informativo (p. ej. «Importado»), no un dialogo.
  useEffect(() => {
    if (!serverToast) return undefined;
    const timer = window.setTimeout(() => setServerToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [serverToast]);

  const renderCanvas = () => {
    if (embeddedTab) {
      return (
        <div className="yoru-shell-embed">
          <React.Suspense
            fallback={
              <div className="app-section-loading" role="status" aria-live="polite">
                <span className="app-section-loading-indicator" />
                {es ? 'Cargando…' : 'Loading…'}
              </div>
            }
          >
            <Library
              {...libraryProps}
              books={books}
              settings={settings}
              onSelectBook={onSelectBook}
              onUpdateBookDetails={onUpdateBookDetails}
              onOpenInfo={onOpenInfo}
              initialTab={embeddedTab}
              embedded
              navigateTo={libraryProps.navigateTo}
            />
          </React.Suspense>
        </div>
      );
    }

    if (view === 'detail') {
      if (!detailBook) {
        return <BookGridView title={es ? 'Catálogo' : 'Catalog'} books={library} es={es} onOpenDetail={openDetail} />;
      }
      return (
        <BookDetailView
          book={detailBook}
          books={books}
          es={es}
          onBack={() => go(group ? 'group' : 'home')}
          onRead={(book) => onSelectBook(book)}
          onListen={(book) => onSelectBook(book, undefined, true)}
          onOpenChapter={(book, chapterIndex) => onSelectBook(book, chapterIndex)}
          onOpenDetail={openDetail}
          onSetStatus={(book, status) => onUpdateBookDetails(book.id, { status })}
          onOpenInfo={onOpenInfo}
        />
      );
    }

    if (view === 'group' && group) {
      return (
        <BookGridView
          title={group.name}
          books={groupBooks}
          es={es}
          onOpenDetail={openDetail}
          onBack={() => go(groupBackView(group))}
        />
      );
    }

    if (view === 'kavita') {
      if (!isKavitaConfigured()) {
        return <ServerEmptyState kind="kavita" es={es} onOpenSettings={() => go('settings')} />;
      }
      return (
        <React.Suspense
          fallback={
            <div className="app-section-loading" role="status" aria-live="polite">
              <span className="app-section-loading-indicator" />
              {es ? 'Cargando…' : 'Loading…'}
            </div>
          }
        >
          <KavitaBrowser
            lang={es ? 'es' : 'en'}
            libraryTitles={new Set(library.map((book) => book.title))}
            onImport={async (parsed: any[]) => { await libraryProps.onAddBooks?.(parsed); }}
            onClose={() => go('home')}
            onOpenSettings={() => go('settings')}
            showToast={(message: string) => setServerToast(message)}
            onReadTemporary={libraryProps.onReadTemporary}
            initialSeriesId={serverTarget?.kind === 'kavita' ? serverTarget.id : undefined}
            embedded
            libraryBooks={library}
            onOpenLocalBook={(bookId: string, listen?: boolean) => {
              const local = books.find((entry) => entry.id === bookId);
              if (local) onSelectBook(local, undefined, listen || undefined);
            }}
          />
        </React.Suspense>
      );
    }

    if (view === 'audioseries' && audioSeries) {
      return (
        <AudiobookSeriesView
          seriesKey={audioSeries}
          es={es}
          onBack={() => go('home')}
          onOpenItem={openServerItem}
        />
      );
    }

    if (view === 'audiobooks') {
      return (
        <AudiobookshelfView
          es={es}
          onOpenSettings={() => go('settings')}
          initialItemId={serverTarget?.kind === 'audiobook' ? serverTarget.id : undefined}
          libraryBooks={library}
          onOpenLocalBook={(bookId, listen) => {
            const local = books.find((entry) => entry.id === bookId);
            if (local) onSelectBook(local, undefined, listen || undefined);
          }}
        />
      );
    }

    if (view === 'statistics') {
      return <StatsView books={books} es={es} />;
    }

    if (view === 'listen') {
      if (!listenable.length) {
        return (
          <div>
            <div className="yoru-view-head">
              <div>
                <h1 className="yoru-view-title">{es ? 'Leer y escuchar' : 'Read and listen'}</h1>
                <div className="yoru-view-sub">
                  {es ? 'Ningún libro tiene audiolibro todavía' : 'No book has an audiobook yet'}
                </div>
              </div>
            </div>
            <p className="yoru-empty-note">
              {es
                ? 'Aquí viven los libros que tienes en texto y en audio a la vez: los que puedes leer mientras los escuchas. Para que uno aparezca, vincula su audiolibro — desde la ficha del audiolibro, en Audiolibros, o abriendo el libro y eligiéndolo en el reproductor.'
                : 'This is where the books you have as both text and audio live: the ones you can read while listening. To make one show up, link its audiobook — from the audiobook page under Audiobooks, or by opening the book and picking it in the player.'}
            </p>
            <div className="yoru-detail-actions" style={{ marginTop: 18 }}>
              <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => go('audiobooks')}>
                <Headphones size={16} />
                {es ? 'Ver mis audiolibros' : 'See my audiobooks'}
              </button>
              <button type="button" className="yoru-btn" onClick={() => go('catalog')}>
                <LibraryIcon size={16} />
                {es ? 'Ver mi biblioteca' : 'See my library'}
              </button>
            </div>
          </div>
        );
      }
      return (
        <BookGridView
          title={es ? 'Leer y escuchar' : 'Read and listen'}
          subtitle={(() => {
            const withChapters = listenable.filter((book) => audiobookLinkState(book.id) === 'chapters').length;
            const total = listenable.length;
            if (es) {
              const base = `${total} ${total === 1 ? 'libro con audiolibro' : 'libros con audiolibro'}`;
              return withChapters ? `${base} · ${withChapters} con capítulos` : base;
            }
            const base = `${total} ${total === 1 ? 'book with an audiobook' : 'books with an audiobook'}`;
            return withChapters ? `${base} · ${withChapters} with chapters` : base;
          })()}
          books={listenable}
          es={es}
          onOpenDetail={openDetail}
        />
      );
    }

    if (view === 'shelf') {
      const entry = SHELVES.find((item) => item.id === shelf)!;
      return (
        <BookGridView
          title={es ? entry.es : entry.en}
          books={shelfBooks(books, shelf)}
          es={es}
          onOpenDetail={openDetail}
        />
      );
    }

    if (view === 'series') {
      return (
        <EntityListView
          title={es ? 'Series' : 'Series'}
          groups={groups.series}
          unit={{ singular: es ? 'tomo' : 'volume', plural: es ? 'tomos' : 'volumes' }}
          es={es}
          onOpenGroup={(entry: EntityGroup) => openGroup('series', entry.key)}
        />
      );
    }

    if (view === 'authors') {
      return (
        <EntityListView
          title={es ? 'Autores' : 'Authors'}
          groups={groups.authors}
          unit={{ singular: es ? 'libro' : 'book', plural: es ? 'libros' : 'books' }}
          es={es}
          onOpenGroup={(entry: EntityGroup) => openGroup('author', entry.key)}
        />
      );
    }

    if (view === 'collections') {
      return (
        <EntityListView
          title={es ? 'Colecciones' : 'Collections'}
          groups={groups.collections}
          unit={{ singular: es ? 'libro' : 'book', plural: es ? 'libros' : 'books' }}
          es={es}
          onOpenGroup={(entry: EntityGroup) => openGroup('collection', entry.key)}
        />
      );
    }

    return (
      <HomeView
        books={books}
        es={es}
        onOpenDetail={openDetail}
        onContinue={(book) => onSelectBook(book)}
        onGoCatalog={() => go('catalog')}
        onGoAudiobooks={() => go('audiobooks')}
        onOpenCollection={(entry) => openGroup('collection', entry.key)}
        onOpenSeries={(entry) => openGroup('series', entry.key)}
        onOpenServerItem={openServerItem}
        onOpenServerSeries={openServerSeries}
      />
    );
  };

  const navItem = (
    target: View,
    label: string,
    Icon: React.ComponentType<{ size?: number }>,
    count?: number
  ) => (
    <button
      type="button"
      className={`yoru-shell-nav-item${view === target ? ' active' : ''}`}
      onClick={() => go(target)}
      aria-current={view === target ? 'page' : undefined}
    >
      <Icon size={19} />
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && <span className="yoru-shell-nav-count">{count}</span>}
    </button>
  );

  const sidebar = (
    <aside className={`yoru-shell-sidebar${isDrawerOpen ? ' open' : ''}`} aria-label={es ? 'Secciones' : 'Sections'}>
      <div className="yoru-shell-nav-section">
        {navItem('home', es ? 'Inicio' : 'Home', Home)}
        {navItem('catalog', es ? 'Catálogo' : 'Catalog', LibraryIcon, library.length)}
        {navItem('srs', 'Yoru SRS', Zap)}
        {navItem('statistics', es ? 'Estadísticas' : 'Statistics', BarChart3)}
        {/*
          «Leer y escuchar» se queda siempre a la vista, también vacía. Es la sección
          propia de los libros que valen para los dos modos, y escondiéndola cuando
          no hay ninguno nadie llegaba a saber que existía ni cómo llenarla.
        */}
        {navItem('listen', es ? 'Leer y escuchar' : 'Read and listen', Headphones, listenable.length)}
      </div>

      <div className="yoru-shell-nav-section">
        <div className="yoru-shell-nav-label">{es ? 'Explorar' : 'Explore'}</div>
        {navItem('series', es ? 'Series' : 'Series', Layers, groups.series.length)}
        {navItem('authors', es ? 'Autores' : 'Authors', Users, groups.authors.length)}
        {navItem('collections', es ? 'Colecciones' : 'Collections', Tag, groups.collections.length)}
      </div>

      {/* Contenido que vive en los servidores de casa, no en la biblioteca local. */}
      <div className="yoru-shell-nav-section">
        <div className="yoru-shell-nav-label">{es ? 'Servidores' : 'Servers'}</div>
        {navItem('kavita', es ? 'Explorar Kavita' : 'Explore Kavita', ServerIcon)}
        {navItem('audiobooks', es ? 'Audiolibros' : 'Audiobooks', Headphones)}
      </div>

      <div className="yoru-shell-nav-section">
        <div className="yoru-shell-nav-label">{es ? 'Estantes' : 'Shelves'}</div>
        {SHELVES.map((entry) => {
          const Icon = entry.icon;
          const count = shelfCounts[entry.id];
          const active = view === 'shelf' && shelf === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={`yoru-shell-shelf-item${active ? ' active' : ''}`}
              onClick={() => {
                setShelf(entry.id);
                go('shelf');
              }}
              aria-current={active ? 'page' : undefined}
            >
              <span className="yoru-shell-shelf-icon">
                <Icon size={18} />
              </span>
              <span className="yoru-shell-shelf-text">
                <span className="yoru-shell-shelf-name">{es ? entry.es : entry.en}</span>
                <span className="yoru-shell-shelf-sub">
                  {count} {es ? (count === 1 ? 'libro' : 'libros') : count === 1 ? 'book' : 'books'}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="yoru-shell-nav-section">
        {navItem('settings', es ? 'Ajustes' : 'Settings', Settings)}
      </div>
    </aside>
  );

  const bottomNav: { key: string; label: string; icon: React.ComponentType<{ size?: number }>; onClick: () => void; active: boolean }[] = [
    { key: 'home', label: es ? 'Inicio' : 'Home', icon: Home, onClick: () => go('home'), active: view === 'home' },
    { key: 'search', label: es ? 'Buscar' : 'Search', icon: Search, onClick: () => setIsSearchOpen(true), active: isSearchOpen },
    {
      key: 'collections',
      label: es ? 'Colecciones' : 'Collections',
      icon: Tag,
      onClick: () => go('collections'),
      active: view === 'collections' || view === 'group',
    },
    {
      key: 'catalog',
      label: es ? 'Biblioteca' : 'Library',
      icon: LibraryIcon,
      onClick: () => go('catalog'),
      active: view === 'catalog',
    },
    { key: 'me', label: es ? 'Yo' : 'Me', icon: User, onClick: () => go('settings'), active: view === 'settings' },
  ];

  return (
    <div className="yoru-shell">
      <header className="yoru-shell-header">
        {isMobile && (
          <button
            type="button"
            className="yoru-shell-icon-btn"
            onClick={() => setIsDrawerOpen(true)}
            aria-label={es ? 'Abrir menú' : 'Open menu'}
          >
            <Menu size={22} />
          </button>
        )}

        <button type="button" className="yoru-shell-brand" onClick={() => go('home')}>
          <span className="yoru-shell-logo">
            <BookOpen size={20} />
          </span>
          <span className="yoru-shell-brand-text">
            <span className="yoru-shell-brand-title">Yoru</span>
            <span className="yoru-shell-brand-sub">Reader</span>
          </span>
        </button>

        {!isMobile && (
          <div className="yoru-shell-search">
            <button type="button" className="yoru-shell-search-btn" onClick={() => setIsSearchOpen(true)}>
              <Search size={17} />
              <span>{es ? '¿Qué quieres buscar?' : 'What are you looking for?'}</span>
            </button>
          </div>
        )}

        <div className="yoru-shell-actions">
          {isMobile && (
            <button
              type="button"
              className="yoru-shell-icon-btn"
              onClick={() => setIsSearchOpen(true)}
              aria-label={es ? 'Buscar' : 'Search'}
            >
              <Search size={20} />
            </button>
          )}
          <button
            type="button"
            className="yoru-shell-icon-btn"
            onClick={() => go('catalog')}
            title={es ? 'Importar libros' : 'Import books'}
            aria-label={es ? 'Importar libros' : 'Import books'}
          >
            <Plus size={20} />
          </button>
          <button
            type="button"
            className="yoru-shell-icon-btn"
            onClick={() => go('statistics')}
            title={es ? 'Tu progreso' : 'Your progress'}
            aria-label={es ? 'Tu progreso' : 'Your progress'}
          >
            <Bell size={20} />
          </button>
          <button
            type="button"
            className="yoru-shell-avatar"
            onClick={() => go('settings')}
            title={es ? 'Tu perfil' : 'Your profile'}
            aria-label={es ? 'Tu perfil' : 'Your profile'}
          >
            {avatarFor(libraryProps)}
          </button>
        </div>
      </header>

      <div className="yoru-shell-workspace">
        {sidebar}
        {isMobile && isDrawerOpen && (
          <button
            type="button"
            className="yoru-shell-scrim"
            aria-label={es ? 'Cerrar menú' : 'Close menu'}
            onClick={() => setIsDrawerOpen(false)}
          />
        )}
        <main className="yoru-shell-canvas">
          {serverToast && (
            <div className="yoru-server-toast" role="status" aria-live="polite">{serverToast}</div>
          )}
          <BookMenuProvider actions={bookMenuActions}>{renderCanvas()}</BookMenuProvider>
        </main>
      </div>

      <nav className="yoru-shell-bottom-nav" aria-label={es ? 'Navegación principal' : 'Main navigation'}>
        {bottomNav.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              className={`yoru-shell-bottom-btn${entry.active ? ' active' : ''}`}
              onClick={entry.onClick}
              aria-current={entry.active ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>

      {isSearchOpen && (
        <GlobalSearch books={books} es={es} onClose={() => setIsSearchOpen(false)} onPick={openDetail} />
      )}
    </div>
  );
}

function groupBackView(group: { kind: 'series' | 'author' | 'collection' } | null): View {
  if (!group) return 'home';
  return group.kind === 'series' ? 'series' : group.kind === 'author' ? 'authors' : 'collections';
}

/**
 * El avatar del perfil. Un perfil sin foto no guarda un hueco: guarda un degradado
 * CSS (`Library.tsx:1348`), el mismo trato que las portadas. Metido en un `<img src>`
 * daba 404 y dejaba el disco vacío en la cabecera, en todas las pantallas a la vez.
 */
function avatarFor(libraryProps: Record<string, any>): React.ReactNode {
  const profiles: any[] = libraryProps.profiles || [];
  const active = profiles.find((profile) => profile.id === libraryProps.activeProfileId) || profiles[0];
  const name: string = active?.name || 'Yoru';
  const initial = name.slice(0, 1).toUpperCase();
  if (isCssGradient(active?.avatar)) {
    return <span style={{ background: active.avatar }}>{initial}</span>;
  }
  if (active?.avatar) return <img src={active.avatar} alt="" />;
  return <span>{initial}</span>;
}
