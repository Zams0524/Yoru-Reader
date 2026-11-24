import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  SlidersHorizontal,
  Tag,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useBackHandler } from '../../hooks/useBackButton';
import './yoru-shell.css';
import { BookMenuProvider } from './BookContextMenu';
import CollectionModal from './CollectionModal';
import GlobalSearch from './GlobalSearch';
import HomeView from './HomeView';
import BookDetailView from './BookDetailView';
import { BookGridView, EntityListView } from './ListViews';
import { Cover, PosterTitlesContext } from './primitives';
import StatsView from './StatsView';
import ReadListenView from './ReadListenView';
import ProfileView from './ProfileView';
import MembersView from './MembersView';
import NotificationsView from './NotificationsView';
import NovedadesCard from './NovedadesCard';
import { NOTICES_EVENT, pushNotice, unseenNoticeCount } from '../../utils/appNotices';
import { anunciarNovedadEnAvisos } from '../../utils/novedades';
import { AudiobookSeriesView, AudiobookshelfView, ServerEmptyState } from './ServerViews';
import { AudiobookPlayerProvider } from './AudiobookPlayerBar';
import { ServerLibrarySection } from './HomeServerSections';
import {
  audiobookMatchScore,
  getAudiobookLink,
  unambiguousAudiobook,
} from '../../utils/audiobookshelfService';
import { getDynamicCollections, type DynamicCollection } from '../../utils/collections';
import { descartar } from '../../utils/recomendaciones';
import { getCachedServerCatalog } from '../../utils/serverCatalog';
import { isKavitaConfigured } from '../../utils/kavitaService';
import { serverItemId, type ServerItem, type ServerSeries } from '../../utils/serverCatalog';
import yoruMark from '../../assets/yoru-mark.png';
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
  | 'profile'
  | 'members'
  | 'notifications'
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
  /** Avisos sin ver, para el punto de la campana. */
  const [unseenNotices, setUnseenNotices] = useState(() => unseenNoticeCount());

  useEffect(() => {
    const refresh = () => setUnseenNotices(unseenNoticeCount());
    /*
      Por ahora la única tarea larga que avisa al terminar es la instalación de
      diccionarios, que ya lanza su evento. Se apunta aquí, en el shell, porque es lo
      único que está montado siempre: la pantalla de avisos puede no haberse abierto.
    */
    const onDictionaries = () => pushNotice(
      es ? 'Diccionarios actualizados' : 'Dictionaries updated',
      es ? 'Los cambios ya se usan al buscar palabras.' : 'The changes are already used when looking up words.'
    );
    window.addEventListener(NOTICES_EVENT, refresh);
    window.addEventListener('yoru-dictionaries-changed', onDictionaries);
    /*
      Y la versión nueva, si se acaba de actualizar: una vez, y queda en la campana.
      Va después de escuchar el evento, no antes: apuntar el aviso lo lanza, y si
      nadie escucha todavía el punto de la campana se queda apagado hasta reiniciar.
    */
    anunciarNovedadEnAvisos(es);
    return () => {
      window.removeEventListener(NOTICES_EVENT, refresh);
      window.removeEventListener('yoru-dictionaries-changed', onDictionaries);
    };
  }, [es]);

  /** El menú del avatar de la cabecera: Perfil y Ajustes. */
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  /*
    El selector de archivos de «Agregar novelas» vive aquí y no en la ventana de
    colecciones: la ventana se cierra al elegir, y un `<input>` desmontado no entrega
    los archivos. Tampoco se usa el de `Library`, que solo existe mientras el Catálogo
    está montado.
  */
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const onAddBooks = libraryProps.onAddBooks as ((books: any[]) => any) | undefined;

  const importLocalFiles = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (files.length === 0 || !onAddBooks) return;
    setIsImporting(true);
    setServerToast(es ? 'Importando…' : 'Importing…');
    const parsed: any[] = [];
    let failed = 0;
    try {
      const { importBookFile } = await import('../../utils/fileImport');
      for (const file of files) {
        try {
          parsed.push(await importBookFile(file));
        } catch (error) {
          console.error(`Error importing file "${file.name}":`, error);
          failed += 1;
        }
      }
      if (parsed.length > 0) await onAddBooks(parsed);
      if (parsed.length === 0) {
        setServerToast(es ? 'No se pudo importar ningún archivo.' : 'No files could be imported.');
      } else if (failed > 0) {
        setServerToast(es
          ? `${parsed.length} de ${files.length} importados; ${failed} con error.`
          : `${parsed.length} of ${files.length} imported; ${failed} failed.`);
      } else {
        setServerToast(es
          ? (parsed.length === 1 ? 'Novela agregada.' : `${parsed.length} novelas agregadas.`)
          : (parsed.length === 1 ? 'Novel added.' : `${parsed.length} novels added.`));
        // Se lleva al Catálogo, que es donde aparecen: si no, no se ve que entraron.
        setView('catalog');
      }
    } catch (error) {
      console.error('Error saving imported books:', error);
      setServerToast(es ? 'No se pudo guardar la importación.' : 'Could not save the import.');
    } finally {
      setIsImporting(false);
      input.value = '';
    }
  }, [es, onAddBooks]);
  /** La colección dinámica cuyas reglas se están cambiando, si hay alguna. */
  const [editingCollection, setEditingCollection] = useState<DynamicCollection | null>(null);
  /** Sube cada vez que se crea o cambia una colección, para recalcular los grupos. */
  const [collectionsVersion, setCollectionsVersion] = useState(0);

  useEffect(() => {
    const onUpdate = () => setCollectionsVersion((value) => value + 1);
    window.addEventListener('yoru-collections-updated', onUpdate);
    return () => window.removeEventListener('yoru-collections-updated', onUpdate);
  }, []);

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
    // `collectionsVersion` entra a propósito: las colecciones no viven en los libros,
    // así que crear una no cambia `books` y sin esto la barra no se enteraría.
    [books, collectionsVersion]
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

  /*
    De dónde se venía al entrar en Ajustes.

    Ajustes se queda con la ventana entera y se lleva la barra lateral por delante,
    así que la flecha de vuelta es la única salida y tiene que devolver al sitio
    exacto, no a Inicio por defecto: quien entra desde «Audiolibros» a cambiar algo
    quiere volver a los audiolibros.
  */
  const [beforeSettings, setBeforeSettings] = useState<View>('home');

  /** La sección de Ajustes que pidió el propio shell; la de fuera llega por `libraryProps`. */
  const [settingsNav, setSettingsNav] = useState<{ tab: string; section?: string; nonce: number } | null>(null);

  const go = useCallback((next: View, target: typeof serverTarget = null) => {
    setView((current) => {
      if (next === 'settings' && current !== 'settings') setBeforeSettings(current);
      return next;
    });
    setServerTarget(target);
    setSettingsNav(null);
    setIsDrawerOpen(false);
  }, []);

  /**
   * «Editar perfil» abre Ajustes en la sección del perfil.
   *
   * Antes llevaba a Ajustes a secas, igual que el engranaje de al lado: en el teléfono
   * salía la lista de secciones y en el ordenador «Apariencia e idioma», y había que
   * buscar el perfil a mano después de haber pulsado «Editar perfil».
   */
  const openProfileSettings = useCallback(() => {
    go('settings');
    setSettingsNav({ tab: 'settings', section: 'sec-profile', nonce: Date.now() });
  }, [go]);

  /*
    Cada pantalla empieza arriba.

    El lienzo es un único contenedor con scroll que comparten todas las pantallas, y el
    navegador conserva su posición al cambiar lo de dentro: bajabas en Inicio, pasabas
    al Catálogo y aparecía empezado por la mitad. La excepción es volver de la ficha de
    un libro a la pantalla desde la que se abrió, que se queda donde estaba para no
    perder el sitio en una lista larga.
  */
  const canvasRef = useRef<HTMLElement | null>(null);
  const lastView = useRef(view);
  const beforeDetail = useRef<{ view: View; top: number } | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const from = lastView.current;
    lastView.current = view;
    if (!canvas || from === view) return;
    const saved = beforeDetail.current;
    if (view === 'detail') {
      if (from !== 'detail') beforeDetail.current = { view: from, top: canvas.scrollTop };
      canvas.scrollTop = 0;
      return;
    }
    beforeDetail.current = null;
    canvas.scrollTop = from === 'detail' && saved?.view === view ? saved.top : 0;
  }, [view]);

  const exitSettings = useCallback(() => {
    setView(beforeSettings);
    setServerTarget(null);
  }, [beforeSettings]);

  // Escape también sale: es lo que se pulsa sin pensar cuando algo ocupa la ventana.
  useEffect(() => {
    if (view !== 'settings') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, exitSettings]);

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
    [isProfileMenuOpen, () => setIsProfileMenuOpen(false)],
    [isSearchOpen, () => setIsSearchOpen(false)],
    [isDrawerOpen, () => setIsDrawerOpen(false)],
    [view === 'detail', () => go(group ? 'group' : 'home')],
    [view === 'group', () => go(groupBackView(group))],
    // La serie de audiolibros se abre desde Inicio, así que atrás vuelve a Inicio.
    [view === 'audioseries', () => go('home')],
    // Ajustes sale por atrás igual que por su flecha: al sitio del que se venía.
    [view === 'settings', exitSettings],
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
      /*
        «No me interesa» no toca el libro: solo apunta su identificador en una lista del
        perfil. Apartar una recomendación no es borrar nada ni marcar nada, y el libro
        sigue en el catálogo, en su estante y en su serie.
      */
      onNotInterested: (book: ShelfBook) => descartar(book.id),
      onCreateCollection: () => setIsCreatingCollection(true),
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

  /*
    Los libros que se pueden leer y escuchar a la vez: los que tienen su audiolibro.

    Cuentan dos cosas, y hacen falta las dos. Una es el vínculo ya guardado, que
    escribe `setAudiobookLink` cuando el lector encuentra el audio o cuando lo
    vinculas a mano. La otra es el par que todavía no se ha guardado pero existe:
    el vínculo se creaba solo al abrir el libro en el lector, así que un catálogo
    recién emparejado enseñaba esta sección vacía hasta que abrías los veinticinco
    tomos uno por uno. Nadie va a hacer eso.

    El par sin guardar se calcula contra la caché que ya alimenta Inicio —ni una
    petición más— y con la misma regla que usa el lector, para que lo que se promete
    aquí sea exactamente lo que allí va a pasar.
  */
  const listenable = useMemo(() => {
    const audiolibros = getCachedServerCatalog().audiobooks;
    return library.filter((book) => {
      if (getAudiobookLink(book.id)) return true;
      if (audiolibros.length === 0) return false;
      const ordenados = audiolibros
        .map((item) => ({ item, score: audiobookMatchScore(book, item as never) }))
        .sort((a, b) => b.score - a.score);
      return Boolean(unambiguousAudiobook(ordenados));
    });
  }, [library]);

  // El aviso se va solo: es informativo (p. ej. «Importado»), no un dialogo.
  useEffect(() => {
    // Mientras se importa no: un EPUB grande tarda más de cuatro segundos, y el
    // «Importando…» es lo único que dice que la app sigue en ello.
    if (!serverToast || isImporting) return undefined;
    const timer = window.setTimeout(() => setServerToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [serverToast, isImporting]);

  const renderCanvas = () => {
    if (embeddedTab) {
      return (
        <div className={`yoru-shell-embed${view === 'settings' ? ' is-settings' : ''}`}>
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
              /*
                Los libros del servidor, dentro de la Biblioteca y no solo en Inicio:
                para quien lee de Kavita son sus libros igual que los descargados.
              */
              serverSection={view === 'catalog'
                ? (
                  <ServerLibrarySection
                    es={es}
                    onOpenItem={openServerItem}
                    onExplore={() => go('kavita')}
                  />
                )
                : undefined}
              // La petición más reciente manda: la del shell («Editar perfil») o la de
              // fuera (una notificación que pide el repaso o las actualizaciones).
              navigateTo={(settingsNav?.nonce ?? 0) > (libraryProps.navigateTo?.nonce ?? 0)
                ? settingsNav
                : libraryProps.navigateTo}
              /*
                La salida de Ajustes. Se la damos a `Library` porque la flecha va
                dentro de su propia lateral, encima del buscador, y es ella quien la
                pinta; el shell es quien sabe de dónde veníamos.
              */
              onExitSettings={view === 'settings' ? exitSettings : undefined}
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
          collections={groups.collections.map((entry) => entry.key)}
          onSetTags={(book, tags) => onUpdateBookDetails(book.id, { tags })}
          onCreateCollection={() => setIsCreatingCollection(true)}
          onOpenInfo={onOpenInfo}
        />
      );
    }

    if (view === 'group' && group) {
      /*
        Una colección dinámica se mira y, desde la misma pantalla, se afina: es donde se
        ve que la regla cogió lo que no era. Las manuales no llevan botón porque no
        tienen reglas que editar; se cambian metiendo y sacando libros.
      */
      const dinamica = group.kind === 'collection'
        ? getDynamicCollections().find((entry) => entry.name === group.name)
        : undefined;
      return (
        <BookGridView
          title={group.name}
          books={groupBooks}
          es={es}
          onOpenDetail={openDetail}
          onBack={() => go(groupBackView(group))}
          action={dinamica && (
            <button type="button" className="yoru-btn" onClick={() => setEditingCollection(dinamica)}>
              <SlidersHorizontal size={15} />
              {es ? 'Editar reglas' : 'Edit rules'}
            </button>
          )}
        />
      );
    }

    if (view === 'kavita') {
      if (!isKavitaConfigured()) {
        return <ServerEmptyState kind="kavita" es={es} />;
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

    if (view === 'members') {
      return (
        <MembersView es={es} libros={books} onVerPerfil={() => go('profile')} />
      );
    }

    if (view === 'notifications') {
      return <NotificationsView es={es} />;
    }

    if (view === 'profile') {
      const profiles: any[] = libraryProps.profiles || [];
      return (
        <ProfileView
          books={books}
          es={es}
          profile={profiles.find((entry) => entry.id === libraryProps.activeProfileId) || profiles[0]}
          onOpenDetail={openDetail}
          onOpenServerItem={openServerItem}
          onOpenSettings={() => go('settings')}
          onEditProfile={openProfileSettings}
          onUpdateProfile={(profileId, changes) => libraryProps.onUpdateProfile?.(profileId, changes)}
        />
      );
    }

    if (view === 'listen') {
      /*
        Cada novela con su audiolibro al lado, y debajo las de Kavita que ya tienen
        el suyo. La vista decide sola qué enseñar cuando no hay ninguna pareja: nunca
        una pantalla de bienvenida, siempre un camino corto para conseguir la primera.
      */
      return (
        <ReadListenView
          library={library}
          es={es}
          onReadAndListen={(book) => {
            const local = books.find((entry) => entry.id === book.id);
            if (local) onSelectBook(local, undefined, true);
          }}
          onOpenDetail={openDetail}
          onOpenAudiobook={(itemId) => go('audiobooks', { kind: 'audiobook', id: itemId })}
          onOpenKavitaSeries={openServerItem}
          onReadAndListenKavita={libraryProps.onReadAndListenKavita}
          onImport={() => go('catalog')}
          onBrowseKavita={() => go('kavita')}
          onBrowseAudiobooks={() => go('audiobooks')}
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
      <>
      {/* Lo que cambió en esta versión, arriba del todo y solo la primera vez. */}
      <NovedadesCard es={es} />
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
      </>
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
        {navItem('kavita', es ? 'Biblioteca' : 'Library', ServerIcon)}
        {navItem('audiobooks', es ? 'Audiolibros' : 'Audiobooks', Headphones)}
      </div>

      {/*
        Los cuatro estantes y las colecciones del usuario, juntos: desde fuera son lo
        mismo, un montón de libros con nombre. El estante lleva su portada por icono
        cuando tiene libros, para que la barra se parezca a la biblioteca y no a un
        menú.
      */}
      <div className="yoru-shell-nav-section">
        <div className="yoru-shell-nav-label">{es ? 'Colecciones' : 'Collections'}</div>
        {SHELVES.map((entry) => {
          const Icon = entry.icon;
          const count = shelfCounts[entry.id];
          const active = view === 'shelf' && shelf === entry.id;
          const first = shelfBooks(books, entry.id)[0];
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
                {first ? <Cover book={first} /> : <Icon size={18} />}
              </span>
              <span className="yoru-shell-shelf-text">
                <span className="yoru-shell-shelf-name">{es ? entry.es : entry.en}</span>
                <span className="yoru-shell-shelf-sub">
                  {count > 0
                    ? `${es ? 'Estante' : 'Shelf'} · ${count} ${es ? (count === 1 ? 'elemento' : 'elementos') : count === 1 ? 'item' : 'items'}`
                    : es ? 'Estante' : 'Shelf'}
                </span>
              </span>
            </button>
          );
        })}

        {groups.collections.map((entry) => {
          const active = view === 'group' && group?.kind === 'collection' && group.name === entry.key;
          const first = entry.books[0];
          const count = entry.books.length;
          return (
            <button
              key={entry.key}
              type="button"
              className={`yoru-shell-shelf-item${active ? ' active' : ''}`}
              onClick={() => openGroup('collection', entry.key)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="yoru-shell-shelf-icon">
                {first ? <Cover book={first} /> : <Tag size={18} />}
              </span>
              <span className="yoru-shell-shelf-text">
                <span className="yoru-shell-shelf-name">{entry.name}</span>
                <span className="yoru-shell-shelf-sub">
                  {count > 0
                    ? `${es ? 'Colección' : 'Collection'} · ${count} ${es ? (count === 1 ? 'elemento' : 'elementos') : count === 1 ? 'item' : 'items'}`
                    : es ? 'Colección vacía' : 'Empty collection'}
                </span>
              </span>
            </button>
          );
        })}

        <button
          type="button"
          className="yoru-shell-shelf-item is-new"
          // En el teléfono se cierra el cajón: si no, la ventana se abría detrás de él.
          onClick={() => { setIsDrawerOpen(false); setIsCreatingCollection(true); }}
        >
          <span className="yoru-shell-shelf-icon">
            <Plus size={18} />
          </span>
          <span className="yoru-shell-shelf-text">
            <span className="yoru-shell-shelf-name">
              {groups.collections.length
                ? es ? 'Crear colección' : 'Create collection'
                : es ? 'Crea tu primera colección' : 'Create your first collection'}
            </span>
          </span>
        </button>
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
    // «Yo» abre el perfil, que es donde están tus listas; Ajustes queda a un toque, en su botón.
    { key: 'me', label: es ? 'Yo' : 'Me', icon: User, onClick: () => go('profile'), active: view === 'profile' || view === 'settings' },
  ];

  return (
    /*
      El reproductor envuelve el shell entero, no una pantalla. Dentro de la ficha
      moría al salir de ella: el audio se cortaba en cuanto mirabas otra cosa.
    */
    <AudiobookPlayerProvider es={es}>
    {/*
      En Ajustes el shell se aparta: ni cabecera, ni lateral, ni barra de abajo.
      Ajustes ocupa la ventana entera y su propia lateral es la única navegación,
      que es lo que pidió zams. La clase se encarga de esconderlas por CSS en vez
      de no montarlas, para que volver no vuelva a construir media aplicación.
    */}
    <div className={`yoru-shell${view === 'settings' ? ' is-settings-fullscreen' : ''}`}>
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
          <img className="yoru-shell-logo" src={yoruMark} alt="" width={36} height={36} draggable={false} />
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
          {/*
            En el teléfono la lupa no va aquí: «Buscar» ya está en la barra de abajo, al
            alcance del pulgar. Repetida arriba, la cabecera juntaba siete iconos en
            360 px y ninguno respiraba.
          */}
          <button
            type="button"
            className="yoru-shell-icon-btn"
            // El «+» abre la misma ventana que «Crear colección» del lateral: colección
            // manual, dinámica o agregar novelas del aparato. Antes solo llevaba al Catálogo.
            onClick={() => { setIsDrawerOpen(false); setIsCreatingCollection(true); }}
            title={es ? 'Crear colección o agregar novelas' : 'Create collection or add novels'}
            aria-label={es ? 'Crear colección o agregar novelas' : 'Create collection or add novels'}
          >
            <Plus size={20} />
          </button>
          <button
            type="button"
            className="yoru-shell-icon-btn"
            onClick={() => go('members')}
            title={es ? 'Miembros' : 'Members'}
            aria-label={es ? 'Miembros' : 'Members'}
          >
            <Users size={20} />
          </button>
          {/* La campana abre los avisos; antes llevaba a Estadísticas, que ya está en el lateral. */}
          <button
            type="button"
            className="yoru-shell-icon-btn yoru-shell-bell"
            onClick={() => go('notifications')}
            title={es ? 'Notificaciones' : 'Notifications'}
            aria-label={unseenNotices > 0
              ? (es ? `Notificaciones, ${unseenNotices} sin ver` : `Notifications, ${unseenNotices} unseen`)
              : (es ? 'Notificaciones' : 'Notifications')}
          >
            <Bell size={20} />
            {unseenNotices > 0 && <i className="yoru-shell-bell-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="yoru-shell-avatar"
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            title={es ? 'Tu perfil' : 'Your profile'}
            aria-label={es ? 'Tu perfil' : 'Your profile'}
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
          >
            {avatarFor(libraryProps)}
          </button>
          {/*
            El avatar abre un menú corto en vez de saltar a Ajustes: el perfil y los
            ajustes son dos sitios distintos, y antes solo se llegaba a uno.
          */}
          {isProfileMenuOpen && (
            <>
              <button
                type="button"
                className="yoru-menu-scrim"
                aria-label={es ? 'Cerrar menú' : 'Close menu'}
                onClick={() => setIsProfileMenuOpen(false)}
              />
              <div className="yoru-menu yoru-profile-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="yoru-menu-item"
                  onClick={() => { setIsProfileMenuOpen(false); go('profile'); }}
                >
                  <User size={16} />
                  {es ? 'Perfil' : 'Profile'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="yoru-menu-item"
                  onClick={() => { setIsProfileMenuOpen(false); go('settings'); }}
                >
                  <Settings size={16} />
                  {es ? 'Ajustes' : 'Settings'}
                </button>
              </div>
            </>
          )}
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
        <main className="yoru-shell-canvas" ref={canvasRef}>
          {serverToast && (
            <div className="yoru-server-toast" role="status" aria-live="polite">{serverToast}</div>
          )}
          <PosterTitlesContext.Provider value={settings?.showPosterTitles !== false}>
            <BookMenuProvider actions={bookMenuActions}>{renderCanvas()}</BookMenuProvider>
          </PosterTitlesContext.Provider>
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

      {(isCreatingCollection || editingCollection) && (
        <CollectionModal
          books={library}
          es={es}
          editing={editingCollection || undefined}
          onClose={() => { setIsCreatingCollection(false); setEditingCollection(null); }}
          // Recién creada se abre: así se ve que existe, aunque esté vacía.
          onCreated={(name) => openGroup('collection', name)}
          onImportBooks={onAddBooks && !isImporting ? () => importInputRef.current?.click() : undefined}
        />
      )}

      {/* Mismo filtro de formatos que el «Importar» del Catálogo (`Library`). */}
      <input
        type="file"
        accept=".epub,.pdf,.html,.htm,.txt,.rtf,.srt,.vtt,.ass,.ssa,application/epub+zip,application/pdf,text/html,text/plain"
        multiple
        className="hidden-file-input"
        ref={importInputRef}
        onChange={importLocalFiles}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={es ? 'Agregar novelas' : 'Add novels'}
      />
    </div>
    </AudiobookPlayerProvider>
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
