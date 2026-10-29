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
import GlobalSearch from './GlobalSearch';
import HomeView from './HomeView';
import BookDetailView from './BookDetailView';
import { BookGridView, EntityListView } from './ListViews';
import StatsView from './StatsView';
import { getAudiobookLink } from '../../utils/audiobookshelfService';
import { OPEN_KAVITA_BROWSER } from '../../utils/kavitaService';
import {
  authorGroups,
  collectionGroups,
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
  // «Explorar Kavita» reutiliza el navegador que ya vive en `Library`: el shell le pide
  // que lo abra por el mismo canal `navigateTo` que usan las notificaciones.
  const [kavitaNonce, setKavitaNonce] = useState(0);
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

  const go = useCallback((next: View) => {
    setView(next);
    setIsDrawerOpen(false);
  }, []);

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
    [view !== 'home', () => go('home')],
  ];
  useBackHandler(
    backSteps.some(([open]) => open),
    () => backSteps.find(([open]) => open)?.[1]()
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
              navigateTo={
                kavitaNonce
                  ? { tab: 'library', section: OPEN_KAVITA_BROWSER, nonce: kavitaNonce }
                  : libraryProps.navigateTo
              }
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
                ? 'Abre un libro, toca ⋮ > Escuchar audiolibro y elige el audiolibro de Audiobookshelf. A partir de ahí aparecerá aquí.'
                : 'Open a book, tap ⋮ > Listen to audiobook and pick its audiobook in Audiobookshelf. From then on it shows up here.'}
            </p>
          </div>
        );
      }
      return (
        <BookGridView
          title={es ? 'Leer y escuchar' : 'Read and listen'}
          subtitle={
            es
              ? `${listenable.length} ${listenable.length === 1 ? 'libro con audiolibro' : 'libros con audiolibro'}`
              : `${listenable.length} ${listenable.length === 1 ? 'book with an audiobook' : 'books with an audiobook'}`
          }
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
        onOpenCollection={(entry) => openGroup('collection', entry.key)}
        onOpenSeries={(entry) => openGroup('series', entry.key)}
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
        {listenable.length > 0
          && navItem('listen', es ? 'Leer y escuchar' : 'Read and listen', Headphones, listenable.length)}
      </div>

      <div className="yoru-shell-nav-section">
        <div className="yoru-shell-nav-label">{es ? 'Explorar' : 'Explore'}</div>
        {navItem('series', es ? 'Series' : 'Series', Layers, groups.series.length)}
        {navItem('authors', es ? 'Autores' : 'Authors', Users, groups.authors.length)}
        {navItem('collections', es ? 'Colecciones' : 'Collections', Tag, groups.collections.length)}
        <button
          type="button"
          className="yoru-shell-nav-item"
          onClick={() => {
            setKavitaNonce((value) => value + 1);
            go('catalog');
          }}
        >
          <ServerIcon size={18} />
          <span className="yoru-shell-nav-text">{es ? 'Explorar Kavita' : 'Explore Kavita'}</span>
        </button>
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
        <main className="yoru-shell-canvas">{renderCanvas()}</main>
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

function avatarFor(libraryProps: Record<string, any>): React.ReactNode {
  const profiles: any[] = libraryProps.profiles || [];
  const active = profiles.find((profile) => profile.id === libraryProps.activeProfileId) || profiles[0];
  if (active?.avatar) return <img src={active.avatar} alt="" />;
  const name: string = active?.name || 'Yoru';
  return <span>{name.slice(0, 1).toUpperCase()}</span>;
}
