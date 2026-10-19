import React, { useState, useRef, useEffect, useMemo, useTransition } from 'react';
import { Plus, Info, Trash2, ListChecks, Check, BarChart3, HelpCircle, Pencil, X, ArrowUpDown, Settings, SlidersHorizontal, Calendar, BookOpen, Clock, Flame, Download, Upload, MoreVertical, Search, EyeOff, User, Tag, RotateCcw, CircleSlash, Play, Pause, ChevronDown, ChevronRight, CloudOff, Database, Palette, Cloud, FolderOpen, Globe, Type, Plug, Layers, AlertTriangle, Keyboard, Bug, Megaphone, Maximize, Menu, Zap, RefreshCw, MessageSquare, Sparkles, ArrowLeft, Repeat, CheckCheck, Library as LibraryIcon } from 'lucide-react';
import TutorialGuide from './onboarding/TutorialGuide';
import LibraryQuickBar, { type LibraryView } from './LibraryQuickBar';
import LibraryMoreMenu from './LibraryMoreMenu';
import { db } from '../utils/db';
import { ankiConnectRequest } from '../utils/ankiConnect';
import { importYomitanZip, installBundledDictionary, getInstalledDictionaries, deleteDictionary, exportDictionaryDataToZip, importAllDictionaryData, closeDB, getDB } from '../utils/yomitanDB';
import { tokenizeText } from '../utils/japanese';
import { t } from '../utils/i18n';
import { authorizeGoogleDriveNative, googleDriveService, DEFAULT_GDRIVE_CLIENT_ID, DEFAULT_GDRIVE_CLIENT_SECRET, GDRIVE_ANDROID_CLIENT_ID } from '../utils/googleDriveService';
import { Capacitor } from '@capacitor/core';
import { useConfirm } from './ConfirmModal';
import { updateDiscordLibrary } from '../utils/discordRpc';
import { isNewSrsCard } from '../utils/fsrs';
import AppAbout from './AppAbout';
import { useAppUpdater, isNewerVersion } from '../hooks/useAppUpdater';

const ABOUT_SEARCH_TERMS = 'about acerca de version versión diagnostico diagnóstico diagnostics crash cierres errores informe report';

const SettingsModal = React.lazy(() => import('./SettingsModal'));
const VocabularyModal = React.lazy(() => import('./VocabularyModal'));
const SrsReviewModal = React.lazy(() => import('./SrsReviewModal'));
const ProgressDashboard = React.lazy(() => import('./ProgressDashboard'));
const EARLIEST_BOOK_DATE = new Date(0).toISOString();

interface LibraryProps {
  books: any[];
  onSelectBook: (...args: any[]) => any;
  onAddBooks: (...args: any[]) => any;
  onDeleteBook: (...args: any[]) => any;
  onUpdateBookDetails: (...args: any[]) => any;
  onOpenInfo: (...args: any[]) => any;
  profiles?: any[];
  activeProfileId?: string;
  onSelectProfile: (...args: any[]) => any;
  onAddProfile: (...args: any[]) => any;
  onDeleteProfile: (...args: any[]) => any;
  onBulkDeleteBooks: (...args: any[]) => any;
  onUpdateProfile: (...args: any[]) => any;
  onClearDeletedBooks: (...args: any[]) => any;
  settings?: any;
  onSaveSettings: (...args: any[]) => any;
  wordStatuses?: Record<string, string>;
  initialTab?: string;
}

const resizeImage = (file: File, maxDimension = 128): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result !== 'string') {
        reject(new Error('Image could not be read as a data URL.'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85)); // Compressed JPEG
      };
      img.onerror = reject;
      img.src = result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const Library = React.memo(function Library({ 
  books, 
  onSelectBook, 
  onAddBooks, 
  onDeleteBook, 
  onUpdateBookDetails, 
  onOpenInfo,
  profiles = [],
  activeProfileId = 'profile-default',
  onSelectProfile,
  onAddProfile,
  onDeleteProfile,
  onBulkDeleteBooks,
  onUpdateProfile,
  onClearDeletedBooks,
  settings = {},
  onSaveSettings,
  wordStatuses = {},
  initialTab
}: LibraryProps) {
  const lang = settings.appLanguage || 'en';
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const backupInputRef = useRef(null);
  const profileWidgetRef = useRef(null);
  const customAvatarInputRef = useRef(null);

  const { showConfirm, confirmModal } = useConfirm();
  const [deleteAllState, setDeleteAllState] = useState(null); // null | 'confirm' | 'deleting' | 'success'

  // Updates: downloaded and applied inside the app on every platform (hooks/useAppUpdater.ts).
  const { state: updaterState, mode: updaterMode, check: checkForAppUpdate, updateNow: runAppUpdate, openFallback: openUpdateFallback } = useAppUpdater();
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const updating = updaterState.status === 'downloading' || updaterState.status === 'installing';
  const updateProgress = updaterState.progress?.percent ?? 0;
  const updateAvailable = Boolean(updaterState.kind) && ['available', 'ready', 'error'].includes(updaterState.status);
  const currentAppVersion = updaterState.current.appVersion;
  const latestAppVersion = updaterState.latest?.appVersion;
  const [bindingKeyAction, setBindingKeyAction] = useState(null);
  const [showTutorialModal, setShowTutorialModal] = useState<boolean>(() => !localStorage.getItem('yoru_tutorial_seen_v1'));

  useEffect(() => {
    if (!bindingKeyAction) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const keyName = e.key;
      // Ignore bare modifiers
      if (['control', 'shift', 'alt', 'meta'].includes(keyName.toLowerCase())) {
        return;
      }
      
      // Build string
      const parts = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      if (e.metaKey) parts.push('Meta');
      
      // Standardize printable key representation
      let formattedKey = keyName;
      if (keyName === ' ') formattedKey = 'Space';
      else if (keyName.length === 1) formattedKey = keyName.toUpperCase();
      
      if (!parts.includes(formattedKey)) {
        parts.push(formattedKey);
      }

      const shortcut = parts.join('+');
      
      const customShortcuts = { ...(settings.customShortcuts || {}) };
      customShortcuts[bindingKeyAction] = shortcut;
      onSaveSettings({ ...settings, customShortcuts });
      setBindingKeyAction(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [bindingKeyAction, settings, onSaveSettings]);

  // Desktop builds with backend/updater.cjs are checked from App.tsx (with background download);
  // Android and older desktop builds check here when the library opens.
  useEffect(() => {
    if (updaterMode === 'electron' || updaterMode === 'none') return;
    checkForAppUpdate().then(state => {
      if (state.status === 'available') setShowUpdateBanner(true);
    });
  }, []);

  useEffect(() => {
    if (updaterState.status === 'available' || updaterState.status === 'ready') setShowUpdateBanner(true);
  }, [updaterState.status]);

  useEffect(() => {
    updateDiscordLibrary(settings);
  }, [settings]);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const state = await checkForAppUpdate();
      if (state.status === 'error') {
        showToast(lang === 'es' ? 'No se pudo buscar actualizaciones. Verifica tu conexión a internet.' : 'Could not check for updates. Check your internet connection.', 'error');
      } else if (state.status === 'available' || state.status === 'ready') {
        setShowUpdateBanner(true);
        showToast(lang === 'es' ? 'Nueva actualización encontrada.' : 'New update found.', 'info');
      } else if (state.status === 'up-to-date') {
        showToast(lang === 'es' ? 'Ya tienes la última versión.' : 'You are up to date.', 'success');
      } else if (state.status === 'disabled') {
        showToast(lang === 'es' ? 'Las actualizaciones no están disponibles en esta versión.' : 'Updates are not available in this build.', 'info');
      }
    } catch (err) {
      console.error('Error checking updates:', err);
      showToast(lang === 'es' ? 'Error al buscar actualizaciones.' : 'Error checking for updates.', 'error');
    }
    setCheckingUpdates(false);
  };

  const handleUpdateNow = () => {
    if (updating) return;
    runAppUpdate();
  };

  const updateErrorMessage = updaterState.status === 'error' || updaterState.error === 'android-permission'
    ? (updaterState.error === 'android-permission'
        ? (lang === 'es'
            ? 'Permite «Instalar apps desconocidas» para Yoru Reader y vuelve a pulsar «Actualizar ahora».'
            : 'Allow "Install unknown apps" for Yoru Reader, then tap "Update now" again.')
        : `${lang === 'es' ? 'No se pudo actualizar' : 'Update failed'}: ${updaterState.error || ''}`)
    : null;

  // Book Manager states
  const [isParsing, setIsParsing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState([]);
  const [sortBy, setSortBy] = useState(() => {
    return localStorage.getItem('yoru_sort_by') || 'added';
  });
  const [sortDirection, setSortDirection] = useState(() => {
    return localStorage.getItem('yoru_sort_direction') || 'desc';
  });
  const [groupSort, setGroupSort] = useState(() => {
    return localStorage.getItem('yoru_group_sort') || 'alphabetical';
  });
  const [groupDirection, setGroupDirection] = useState(() => {
    return localStorage.getItem('yoru_group_direction') || 'asc';
  });
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [previewBook, setPreviewBook] = useState(null);
  
  // Mobile responsive layout states
  const checkIsMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    return isAndroidApp || window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  };
  const [isMobile, setIsMobile] = useState(checkIsMobileDevice());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileSettingsSectionOpen, setMobileSettingsSectionOpen] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    const handleResize = () => {
      const mobile = checkIsMobileDevice();
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleTouchStart = (e) => {
    touchStartX.current = e.changedTouches[0].screenX;
    touchEndX.current = e.changedTouches[0].screenX;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.changedTouches[0].screenX;
  };

  const handleTouchEnd = () => {
    const diffX = touchEndX.current - touchStartX.current;
    
    // 1. Left Sidebar Navigation Drawer
    if (diffX > 70 && touchStartX.current < 60 && !isSidebarOpen) {
      setIsSidebarOpen(true);
    }
    if (diffX < -70 && isSidebarOpen) {
      setIsSidebarOpen(false);
    }
    
    // 2. Right Display Settings Drawer (Option Q)
    if (diffX < -70 && touchStartX.current > window.innerWidth - 60 && !isDisplaySettingsOpen) {
      setIsDisplaySettingsOpen(true);
    }
    if (diffX > 70 && isDisplaySettingsOpen) {
      setIsDisplaySettingsOpen(false);
    }
  };

  // Sidebar Navigation states
  const [activeFilter, setActiveFilter] = useState({ type: 'all', value: null });
  const [libraryView, setLibraryView] = useState<LibraryView>(() => {
    try { return localStorage.getItem('yoru_library_view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const changeLibraryView = (view: LibraryView) => {
    setLibraryView(view);
    try { localStorage.setItem('yoru_library_view', view); } catch { /* ignore */ }
  };
    const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Custom themed toast notifications
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const toastTimerRef = useRef(null);

  const showToast = (message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  // Library Display settings (Yoru style)
  const [cardWidth, setCardWidth] = useState(() => {
    return parseInt(localStorage.getItem('yoru_card_width') || '160');
  });
  const [coverFit, setCoverFit] = useState(() => {
    return localStorage.getItem('yoru_cover_fit') || 'cover'; // 'cover' | 'contain'
  });
  const [showCardTitle, setShowCardTitle] = useState(() => {
    return localStorage.getItem('yoru_show_title') !== 'false';
  });
  const [showCardAuthor, setShowCardAuthor] = useState(() => {
    return localStorage.getItem('yoru_show_author') !== 'false';
  });
  const [showCardProgress, setShowCardProgress] = useState(() => {
    return localStorage.getItem('yoru_show_progress') !== 'false';
  });
  const [showCardSeries, setShowCardSeries] = useState(() => {
    return localStorage.getItem('yoru_show_series') !== 'false';
  });
  const [showCardTags, setShowCardTags] = useState(() => {
    return localStorage.getItem('yoru_show_tags') !== 'false';
  });
  const [showCardStatus, setShowCardStatus] = useState(() => {
    return localStorage.getItem('yoru_show_status') !== 'false';
  });
  const [isDetailsDropdownOpen, setIsDetailsDropdownOpen] = useState(false);
  const [groupBy, setGroupBy] = useState(() => {
    return localStorage.getItem('yoru_group_by') || 'none'; // 'none' | 'author'
  });
  const [isDisplaySettingsOpen, setIsDisplaySettingsOpen] = useState(false);
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSectionPending, startSectionTransition] = useTransition();
  const [activeTab, setActiveTabState] = useState(initialTab || 'library'); // 'library' | 'statistics' | 'settings' | 'notes' | 'srs'
  const setActiveTab = (tab: string) => startSectionTransition(() => setActiveTabState(tab));
  const [selectedDeckFilter, setSelectedDeckFilter] = useState<string | null>(null);
  const [srsSubTab, setSrsSubTab] = useState<'decks' | 'stats' | 'notes' | 'history' | 'settings'>('decks');
  const [isDeckPromptOpen, setIsDeckPromptOpen] = useState(false);
  const [deckPromptMode, setDeckPromptMode] = useState<'create' | 'rename' | 'merge'>('create');
  const [deckPromptTargetId, setDeckPromptTargetId] = useState<string | null>(null);
  const [deckPromptValue, setDeckPromptValue] = useState('');
  const [srsCalendarYear, setSrsCalendarYear] = useState(new Date().getFullYear());
  const [separateSuspended, setSeparateSuspended] = useState(false);
  const [notesSearch, setNotesSearch] = useState('');
  const [notesFilterStatus, setNotesFilterStatus] = useState('all');
  const [visibleVocabCount, setVisibleVocabCount] = useState(60);
  const vocabSentinelRef = useRef(null);
  const [notesSort, setNotesSort] = useState('alphabetical');
  const [isNotesSortOpen, setIsNotesSortOpen] = useState(false);
  const [isNotesFilterOpen, setIsNotesFilterOpen] = useState(false);
  const [currentYear, setCurrentYear] = useState(2026);
  const [statsSubTab, setStatsSubTab] = useState('overview'); // 'overview' | 'breakdown' | 'filters'
  const [statsDateFrom, setStatsDateFrom] = useState('2026-07-06');
  const [statsDateTo, setStatsDateTo] = useState('2026-07-06');
  const [statsExcludedBookIds, setStatsExcludedBookIds] = useState([]);
  const [statsTitleFilter, setStatsTitleFilter] = useState('');

  // Yomitan DB states
  const [installedDicts, setInstalledDicts] = useState([]);
  const [dictImportProgress, setDictImportProgress] = useState(0);
  const [dictImportMsg, setDictImportMsg] = useState('');
  const [isImportingDict, setIsImportingDict] = useState(false);
  const [dictImportSuccess, setDictImportSuccess] = useState(false);
  const [freqImportProgress, setFreqImportProgress] = useState(0);
  const [freqImportMsg, setFreqImportMsg] = useState('');
  const [isImportingFreq, setIsImportingFreq] = useState(false);
  const [freqImportSuccess, setFreqImportSuccess] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState<false | 'dict' | 'freq'>(false);
  const [installingBundledAsset, setInstallingBundledAsset] = useState(null);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('sec-general');
  const [activeMenuBookId, setActiveMenuBookId] = useState(null);
  const [menuOpenLeft, setMenuOpenLeft] = useState(false); // true = dropdown opens to the left of trigger
  const [activeHeaderDropdown, setActiveHeaderDropdown] = useState(null); // null | 'import' | 'database' | 'theme' | 'more'
  const [dynamicCoverage, setDynamicCoverage] = useState(null);

  useEffect(() => {
    if (!previewBook) {
      setDynamicCoverage(null);
      return;
    }

    let active = true;
    const calculateCoverage = async () => {
      try {
        const allText = (previewBook.chapters || []).map(c => c.content || '').join('\n');
        if (!allText.trim()) {
          if (active) setDynamicCoverage(0);
          return;
        }

        const paragraphs = await tokenizeText(allText);
        const tokens = paragraphs.flat();

        const uniqueWords = new Set<string>();
        tokens.forEach(tok => {
          if (tok && tok.isWord && tok.basicForm) {
            uniqueWords.add(tok.basicForm);
          }
        });

        if (uniqueWords.size === 0) {
          if (active) setDynamicCoverage(0);
          return;
        }

        let knownCount = 0;
        uniqueWords.forEach(word => {
          const status = wordStatuses[word];
          if (status === 'known' || status === 'starred') {
            knownCount++;
          }
        });

        const pct = Math.round((knownCount / uniqueWords.size) * 100);
        if (active) setDynamicCoverage(pct);
      } catch (err) {
        console.error("Error calculating dynamic vocabulary coverage:", err);
        if (active) setDynamicCoverage(previewBook.vocabularyCoverage || 0);
      }
    };

    calculateCoverage();

    return () => {
      active = false;
    };
  }, [previewBook, wordStatuses]);

  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveMenuBookId(null);
      setActiveHeaderDropdown(null);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    loadInstalledDicts().catch(err => console.warn("Failed to load installed dicts on mount:", err));
    const refreshDictionaries = () => {
      loadInstalledDicts().catch(err => console.warn('Failed to refresh installed dictionaries:', err));
    };
    window.addEventListener('yoru-dictionaries-changed', refreshDictionaries);
    return () => window.removeEventListener('yoru-dictionaries-changed', refreshDictionaries);
  }, []);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadInstalledDicts();
    }
  }, [activeTab]);

  useEffect(() => {
    setVisibleVocabCount(60);
  }, [notesSearch, notesFilterStatus, notesSort]);

  useEffect(() => {
    if (!vocabSentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleVocabCount(prev => prev + 60);
      }
    }, { rootMargin: '200px' });
    observer.observe(vocabSentinelRef.current);
    return () => observer.disconnect();
  }, [activeTab, vocabSentinelRef.current]);

  const isFreqDict = (dict) => {
    if (dict.hasFreqs !== undefined) return dict.hasFreqs && !dict.hasTerms;
    const title = (dict.title || '').toLowerCase();
    return title.includes('freq') || title.includes('frecuencia') || title.includes('meta');
  };

  const isTermDict = (dict) => {
    if (dict.hasTerms !== undefined) return dict.hasTerms;
    return !isFreqDict(dict);
  };

  const sortDicts = (dicts, order) => {
    if (!order || order.length === 0) return dicts;
    return [...dicts].sort((a, b) => {
      const idxA = order.indexOf(a.title);
      const idxB = order.indexOf(b.title);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  };

  const loadInstalledDicts = async () => {
    try {
      const dicts = await getInstalledDictionaries();
      const order = settings.dictionaryOrder || [];
      const sorted = sortDicts(dicts || [], order);
      setInstalledDicts(sorted);
    } catch (e) {
      console.error(e);
    }
  };

  const handleYomitanUpload = async (e, isFreq = false) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const setMsg = isFreq ? setFreqImportMsg : setDictImportMsg;
    const setProg = isFreq ? setFreqImportProgress : setDictImportProgress;
    const setIsImporting = isFreq ? setIsImportingFreq : setIsImportingDict;
    const setSuccess = isFreq ? setFreqImportSuccess : setDictImportSuccess;

    setIsImporting(true);
    setSuccess(false);
    setProg(0);
    setMsg('Iniciando...');
    try {
      await importYomitanZip(file, (msg, prog) => {
        setMsg(msg);
        setProg(prog);
      }, lang === 'es' ? 'es' : 'en');

      // Show success state briefly, then hide bar and reload in background
      setSuccess(true);
      setMsg('¡Instalado correctamente!');
      setProg(100);
      setTimeout(() => {
        setIsImporting(false);
        setSuccess(false);
        setProg(0);
        setMsg('');
        loadInstalledDicts();
      }, 1500);
    } catch (err) {
      setMsg('Error: ' + err.message);
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleDeleteDict = async (title) => {
    const ok = await showConfirm({
      title: lang === 'es' ? '¿Eliminar diccionario?' : 'Delete dictionary?',
      message: lang === 'es' ? `¿Seguro que quieres borrar el diccionario "${title}"?` : `Are you sure you want to delete the dictionary "${title}"?`,
      type: 'danger',
      confirmText: lang === 'es' ? 'Borrar' : 'Delete',
    });
    if (ok) {
      // Immediately remove from state so the UI updates instantly
      setInstalledDicts(prev => prev.filter(d => d.title !== title));
      try {
        await deleteDictionary(title);
      } catch (err) {
        console.error('Error deleting dictionary:', err);
        // Reload on error to restore correct state
        await loadInstalledDicts();
      }
    }
  };

  const handleToggleDict = (title) => {
    const disabled = settings.disabledDictionaries || [];
    let newDisabled;
    if (disabled.includes(title)) {
      newDisabled = disabled.filter(t => t !== title);
    } else {
      newDisabled = [...disabled, title];
    }
    onSaveSettings({
      ...settings,
      disabledDictionaries: newDisabled
    });
  };

  const [draggingIdx, setDraggingIdx] = useState(null);
  const [draggingCategory, setDraggingCategory] = useState(null);

  const handleDragStart = (e, index, category) => {
    setDraggingIdx(index);
    setDraggingCategory(category);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, targetIdx, category) => {
    e.preventDefault();
    if (draggingIdx === null || draggingCategory !== category || draggingIdx === targetIdx) return;
    
    const isFreq = category === 'freq';
    const categoryDicts = installedDicts.filter(d => isFreq ? isFreqDict(d) : isTermDict(d));
    const otherDicts = installedDicts.filter(d => isFreq ? isTermDict(d) : isFreqDict(d));
    
    const reordered = [...categoryDicts];
    const [removed] = reordered.splice(draggingIdx, 1);
    reordered.splice(targetIdx, 0, removed);
    
    const newAll = [];
    let catCounter = 0;
    let otherCounter = 0;
    
    installedDicts.forEach(d => {
      if (isFreq ? isFreqDict(d) : isTermDict(d)) {
        newAll.push(reordered[catCounter++]);
      } else {
        newAll.push(otherDicts[otherCounter++]);
      }
    });
    
    setInstalledDicts(newAll);
    
    onSaveSettings({
      ...settings,
      dictionaryOrder: newAll.map(d => d.title)
    });
    
    setDraggingIdx(targetIdx);
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    setDraggingCategory(null);
  };

  const handleInstallBundledDict = async (assetName, isFreq = false) => {
    const setMsg = isFreq ? setFreqImportMsg : setDictImportMsg;
    const setProg = isFreq ? setFreqImportProgress : setDictImportProgress;
    const setIsImporting = isFreq ? setIsImportingFreq : setIsImportingDict;
    const setSuccess = isFreq ? setFreqImportSuccess : setDictImportSuccess;

    setInstallingBundledAsset(assetName);
    setIsImporting(true);
    setSuccess(false);
    setMsg(lang === 'es' ? 'Cargando archivo integrado...' : 'Loading bundled file...');
    setProg(0);
    
    try {
      setProg(5);
      setMsg(lang === 'es' ? 'Instalando diccionario integrado...' : 'Installing bundled dictionary...');
      await installBundledDictionary(assetName, lang === 'es' ? 'es' : 'en', (msg, prog) => {
        setMsg(msg);
        setProg(prog);
      });
      
      // Show success, then hide bar and reload dicts
      setSuccess(true);
      setMsg(lang === 'es' ? '¡Instalado correctamente!' : 'Installed successfully!');
      setProg(100);
      setIsLibraryModalOpen(false);
      // Reload dicts immediately so they appear in the list right away
      await loadInstalledDicts();
      setTimeout(() => {
        setIsImporting(false);
        setSuccess(false);
        setProg(0);
        setMsg('');
        setInstallingBundledAsset(null);
      }, 1500);
    } catch (err) {
      alert((lang === 'es' ? 'Error instalando diccionario: ' : 'Dictionary install failed: ') + err.message);
      setIsImporting(false);
      setInstallingBundledAsset(null);
    }
  };

  const renderDictList = (isFreq) => {
    const list = installedDicts.filter(d => isFreq ? isFreqDict(d) : isTermDict(d));
    if (list.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px', border: '1px dashed var(--border-light)', borderRadius: '8px', fontSize: '0.85rem' }}>
          {lang === 'es' ? 'Ningún elemento instalado' : 'No items installed'}
        </div>
      );
    }
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {list.map((dict, idx) => {
          const isDisabled = settings.disabledDictionaries?.includes(dict.title);
          const isDragging = draggingCategory === (isFreq ? 'freq' : 'term') && draggingIdx === idx;
          
          return (
            <div 
              key={dict.title}
              draggable
              onDragStart={(e) => handleDragStart(e, idx, isFreq ? 'freq' : 'term')}
              onDragOver={(e) => handleDragOver(e, idx, isFreq ? 'freq' : 'term')}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-card)',
                border: isDragging ? '1px dashed #6366f1' : '1px solid var(--border-light)',
                padding: '12px 16px',
                borderRadius: '8px',
                cursor: 'grab',
                opacity: isDragging ? 0.6 : 1,
                transition: 'background 0.2s, border 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-muted)', cursor: 'grab', display: 'flex', alignItems: 'center' }}>
                  <ArrowUpDown size={16} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dict.title}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dict.description || (lang === 'es' ? 'Sin descripción disponible.' : 'No description available.')}
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', marginLeft: '12px' }}>
                <button 
                  onClick={() => handleToggleDict(dict.title)}
                  style={{
                    background: isDisabled ? 'var(--bg-card-hover)' : '#8b5cf6',
                    border: isDisabled ? '1px solid var(--border-light)' : 'none',
                    color: isDisabled ? 'var(--text-muted)' : '#fff',
                    borderRadius: '16px',
                    minWidth: '32px',
                    height: '32px',
                    padding: '0 10px',
                    gap: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    marginRight: '8px',
                    transition: 'all 0.2s'
                  }}
                  title={isDisabled ? (lang === 'es' ? 'Activar diccionario' : 'Enable dictionary') : (lang === 'es' ? 'Desactivar diccionario' : 'Disable dictionary')}
                  aria-label={isDisabled ? (lang === 'es' ? 'Activar diccionario' : 'Enable dictionary') : (lang === 'es' ? 'Desactivar diccionario' : 'Disable dictionary')}
                >
                  <BookOpen size={14} />
                  <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{isDisabled ? (lang === 'es' ? 'Inactivo' : 'Off') : (lang === 'es' ? 'Activo' : 'On')}</span>
                </button>
                
                <button 
                  onClick={() => handleDeleteDict(dict.title)}
                  style={{
                    background: 'var(--bg-card-hover)',
                    border: '1px solid var(--border-light)',
                    color: '#ef4444',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  title={lang === 'es' ? 'Eliminar' : 'Delete'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderActions = (isFreq) => {
    const isImporting = isFreq ? isImportingFreq : isImportingDict;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setIsLibraryModalOpen(isFreq ? 'freq' : 'dict')}
          style={{
            background: 'linear-gradient(135deg, #ff5e62, #ff9966)',
            border: 'none',
            borderRadius: '9999px',
            color: '#fff',
            padding: '8px 20px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 6px -1px rgba(255, 94, 98, 0.2)',
            transition: 'all 0.2s'
          }}
        >
          <span>{lang === 'es' ? 'Instalar desde nuestra biblioteca' : 'Install from our library'}</span>
        </button>

        <label 
          style={{
            background: '#8b5cf6',
            border: 'none',
            borderRadius: '9999px',
            color: '#fff',
            padding: '8px 20px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: isImporting ? 'not-allowed' : 'pointer',
            opacity: isImporting ? 0.6 : 1,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s'
          }}
        >
          <span>{lang === 'es' ? 'Instalar desde archivo' : 'Install from file'}</span>
          <input 
            type="file" 
            accept=".zip"
            onChange={(e) => handleYomitanUpload(e, isFreq)}
            disabled={isImporting}
            style={{ display: 'none' }}
          />
        </label>

        <button
          type="button"
          onClick={() => alert(lang === 'es' ? 'Puedes importar aquí un paquete de diccionario (.zip) que ya tengas en tu equipo.' : 'You can import a dictionary package (.zip) already stored on your device.')}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            color: 'rgba(255,255,255,0.6)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            marginLeft: 'auto',
            transition: 'all 0.2s'
          }}
        >
          <Info size={16} />
        </button>
      </div>
    );
  };

  const renderLibraryModal = () => {
    const showDicts = isLibraryModalOpen === 'dict';
    const showFreqs = isLibraryModalOpen === 'freq';

    const presetDicts = [
      {
        title: 'JMdict (Español)',
        matchTitle: 'JMdict (Spanish)',
        desc: lang === 'es' ? 'Diccionario integrado de japonés a español.' : 'Bundled Japanese to Spanish dictionary.',
        asset: 'JMdict_spanish.zip'
      },
      {
        title: 'JMdict (English)',
        matchTitle: 'JMdict [',
        desc: lang === 'es' ? 'Diccionario integrado de japonés a inglés.' : 'Bundled Japanese to English dictionary.',
        asset: 'JMdict_english.zip'
      }
    ];

    const presetFreqs = [
      {
        title: 'Netflix Frecuencias',
        matchTitle: 'Netflix',
        desc: 'Frecuencia basada en diálogos y subtítulos de Netflix Japón.',
        asset: 'frequency-netflix.zip'
      },
      {
        title: 'Jiten (Anime) Frecuencias',
        matchTitle: 'Jiten (Anime)',
        desc: 'Frecuencia de vocabulario usado en anime.',
        asset: 'frequency-jiten-anime.zip'
      },
      {
        title: 'Novelas Frecuencias',
        matchTitle: 'Novels',
        desc: 'Frecuencia de vocabulario en novelas literarias y ligeras.',
        asset: 'frequency-novels.zip'
      },
      {
        title: 'Novelas Visuales (VN) Frecuencias',
        matchTitle: 'VN Freq',
        desc: 'Frecuencia de términos de novelas visuales japonesas.',
        asset: 'frequency-visual-novels.zip'
      },
      {
        title: 'YouTube Frecuencias',
        matchTitle: 'Youtube',
        desc: 'Frecuencias de diálogos de vlogs y videos populares de YouTube Japón.',
        asset: 'frequency-youtube.zip'
      },
      {
        title: 'Acento tonal japonés',
        matchTitle: 'アクセント辞典',
        desc: lang === 'es' ? 'Datos locales de acento tonal para mostrar sus gráficos en el popup.' : 'Local pitch accent data used by the reading popup.',
        asset: 'pitch-accent-japanese.zip'
      }
    ];

    return (
      <div 
        onClick={(e) => {
          if (e.target === e.currentTarget) setIsLibraryModalOpen(false);
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
      >
        <div style={{
          background: '#121214',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          width: '540px',
          maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              {lang === 'es' ? 'Biblioteca de Recursos' : 'Resource Library'}
            </h3>
            <button 
              onClick={() => setIsLibraryModalOpen(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Dictionaries Section */}
            {showDicts && (
              <div>
                <h4 style={{ color: '#8b5cf6', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', marginTop: 0 }}>
                  {lang === 'es' ? '📖 Diccionarios de Traducción' : '📖 Translation Dictionaries'}
                </h4>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 0, marginBottom: '12px', lineHeight: '1.4' }}>
                  {lang === 'es'
                    ? 'Los archivos ya vienen dentro de la app y funcionan sin conexión. Pulsa «Añadir» para importarlos a tu biblioteca local.'
                    : 'The files are already included in the app and work offline. Select “Add” to import them into your local library.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {presetDicts.map(d => {
                    const isInstalling = installingBundledAsset === d.asset;
                    const isInstalled = installedDicts.some(installed => installed.title.toLowerCase().startsWith(d.matchTitle.toLowerCase()));

                    return (
                      <div key={d.title} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.88rem' }}>{d.title}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '3px' }}>{d.desc}</div>
                        </div>
                        <button
                          disabled={isImportingDict || isInstalled}
                          onClick={() => handleInstallBundledDict(d.asset, false)}
                          style={{
                            background: isInstalling 
                              ? 'rgba(255,255,255,0.1)' 
                              : isInstalled 
                                ? 'rgba(52, 211, 153, 0.15)' 
                                : 'var(--primary)',
                            color: isInstalled ? '#34d399' : '#fff',
                            border: isInstalled ? '1px solid rgba(52, 211, 153, 0.3)' : 'none',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: isInstalled 
                              ? 'default' 
                              : isImportingDict 
                                ? 'not-allowed' 
                                : 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isInstalling
                            ? (lang === 'es' ? `${dictImportProgress}%` : `${dictImportProgress}%`)
                            : isInstalled 
                              ? (lang === 'es' ? '✓ Instalado' : '✓ Installed') 
                              : (lang === 'es' ? 'Añadir' : 'Add')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Frequencies Section */}
            {showFreqs && (
              <div>
                <h4 style={{ color: '#ff9966', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', marginTop: 0 }}>
                  {lang === 'es' ? '📊 Listas de Palabras Frecuentes' : '📊 Frequency Word Lists'}
                </h4>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 0, marginBottom: '12px', lineHeight: '1.4' }}>
                  {lang === 'es' 
                    ? 'Estas listas vienen incluidas con la aplicación. Instala solo las que quieras usar.'
                    : 'These lists are bundled with the app. Install only the ones you want to use.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {presetFreqs.map(d => {
                    const isInstalling = installingBundledAsset === d.asset;
                    const isInstalled = installedDicts.some(installed => installed.title.toLowerCase().startsWith(d.matchTitle.toLowerCase()));

                    return (
                      <div key={d.title} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.88rem' }}>{d.title}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '3px' }}>{d.desc}</div>
                        </div>
                        <button
                          disabled={isImportingFreq || isInstalled}
                          onClick={() => handleInstallBundledDict(d.asset, true)}
                          style={{
                            background: isInstalling 
                              ? 'rgba(255,255,255,0.1)' 
                              : isInstalled 
                                ? 'rgba(52, 211, 153, 0.15)' 
                                : 'var(--primary)',
                            color: isInstalled ? '#34d399' : '#fff',
                            border: isInstalled ? '1px solid rgba(52, 211, 153, 0.3)' : 'none',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: isInstalled 
                              ? 'default' 
                              : isImportingFreq 
                                ? 'not-allowed' 
                                : 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isInstalling
                            ? `${freqImportProgress}%`
                            : isInstalled 
                              ? (lang === 'es' ? '✓ Instalado' : '✓ Installed') 
                              : (lang === 'es' ? 'Añadir' : 'Add')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  };

  // Synchronize CSS variable for card width and cover fit
  useEffect(() => {
    document.documentElement.style.setProperty('--card-width', `${cardWidth}px`);
    localStorage.setItem('yoru_card_width', cardWidth.toString());
  }, [cardWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty('--cover-fit', coverFit);
    localStorage.setItem('yoru_cover_fit', coverFit);
  }, [coverFit]);

  useEffect(() => {
    localStorage.setItem('yoru_show_title', showCardTitle.toString());
  }, [showCardTitle]);

  useEffect(() => {
    localStorage.setItem('yoru_show_author', showCardAuthor.toString());
  }, [showCardAuthor]);

  useEffect(() => {
    localStorage.setItem('yoru_show_progress', showCardProgress.toString());
  }, [showCardProgress]);

  useEffect(() => {
    localStorage.setItem('yoru_show_series', showCardSeries.toString());
  }, [showCardSeries]);

  useEffect(() => {
    localStorage.setItem('yoru_show_tags', showCardTags.toString());
  }, [showCardTags]);

  useEffect(() => {
    localStorage.setItem('yoru_show_status', showCardStatus.toString());
  }, [showCardStatus]);

  useEffect(() => {
    localStorage.setItem('yoru_group_by', groupBy);
  }, [groupBy]);

  useEffect(() => {
    localStorage.setItem('yoru_sort_by', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('yoru_sort_direction', sortDirection);
  }, [sortDirection]);

  useEffect(() => {
    localStorage.setItem('yoru_group_sort', groupSort);
  }, [groupSort]);

  useEffect(() => {
    localStorage.setItem('yoru_group_direction', groupDirection);
  }, [groupDirection]);

  // Handle keyboard shortcut Q to toggle display settings
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setIsDisplaySettingsOpen(prev => !prev);
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error enabling full-screen mode: ${err.message}`);
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Profile Selector states
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [customAvatarUrl, setCustomAvatarUrl] = useState(null);

  // Profile settings state & refs
  const customProfileSettingsAvatarInputRef = useRef(null);
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfileAvatar, setEditProfileAvatar] = useState('');

  // Google Drive / Cloud Sync States
  const [isGDriveSyncOpen, setIsGDriveSyncOpen] = useState(false);
  const [gDriveClientId, setGDriveClientId] = useState(() => localStorage.getItem('gdrive_client_id') !== null ? localStorage.getItem('gdrive_client_id')! : DEFAULT_GDRIVE_CLIENT_ID);
  const [gDriveClientSecret, setGDriveClientSecret] = useState(() => localStorage.getItem('gdrive_client_secret') !== null ? localStorage.getItem('gdrive_client_secret')! : DEFAULT_GDRIVE_CLIENT_SECRET);
  const [gDriveTokens, setGDriveTokens] = useState(localStorage.getItem('gdrive_tokens') ? JSON.parse(localStorage.getItem('gdrive_tokens')) : null);
  const [gDriveUserEmail, setGDriveUserEmail] = useState(localStorage.getItem('gdrive_user_email') || '');
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(localStorage.getItem('gdrive_autosync_enabled') === 'true');
  const [lastSyncTime, setLastSyncTime] = useState(localStorage.getItem('gdrive_last_sync_time') || '');
  const [gDriveSyncStatus, setGDriveSyncStatus] = useState(localStorage.getItem('gdrive_tokens') ? 'authorized' : 'disconnected'); // 'disconnected', 'authorized', 'syncing'

  // Load and check token on startup, run sync if auto-sync is enabled
  useEffect(() => {
    const initGDriveSync = async () => {
      const tokens = localStorage.getItem('gdrive_tokens') ? JSON.parse(localStorage.getItem('gdrive_tokens')) : null;
      if (tokens && (tokens.refreshToken || (tokens.native && tokens.accessToken))) {
        setGDriveSyncStatus('authorized');
        try {
          // Fetch connected user info
          const info = await googleDriveService.getUserInfo(tokens, gDriveClientId, gDriveClientSecret);
          setGDriveUserEmail(info.email);
          localStorage.setItem('gdrive_user_email', info.email);
          
          if (localStorage.getItem('gdrive_autosync_enabled') === 'true') {
            // Perform automatic background restore if cloud file is newer
            await performCloudSync(tokens, 'download-only');
          }
        } catch (err) {
          console.warn('Failed to validate startup Google Drive tokens:', err);
          // Don't auto-disconnect if it's just offline (no network)
          if (navigator.onLine) {
            setGDriveSyncStatus('disconnected');
            setGDriveUserEmail('');
            localStorage.removeItem('gdrive_tokens');
            localStorage.removeItem('gdrive_user_email');
          }
        }
      }
    };
    initGDriveSync();
  }, []);

  // Connect Google Drive Folder via loopback OAuth Flow
  const handleConnectGDrive = async () => {
    try {
      if (!gDriveClientId.trim()) {
        alert(lang === 'es' ? 'Introduce tu Client ID para continuar.' : 'Please enter your Client ID to continue.');
        return;
      }
      setGDriveSyncStatus('syncing');

      if (Capacitor.getPlatform() === 'android') {
        const androidClientId = GDRIVE_ANDROID_CLIENT_ID;
        const nativeTokens = await authorizeGoogleDriveNative();
        localStorage.setItem('gdrive_client_id', androidClientId);
        localStorage.removeItem('gdrive_client_secret');
        localStorage.setItem('gdrive_tokens', JSON.stringify(nativeTokens));
        setGDriveClientId(androidClientId);
        setGDriveClientSecret('');
        setGDriveTokens(nativeTokens);

        const info = await googleDriveService.getUserInfo(nativeTokens, androidClientId, '');
        localStorage.setItem('gdrive_user_email', info.email);
        setGDriveUserEmail(info.email);
        setGDriveSyncStatus('authorized');
        alert(lang === 'es' ? `¡Cuenta conectada con éxito! (${info.email})` : `Account successfully connected! (${info.email})`);
        await performCloudSync(nativeTokens, 'bidirectional');
        return;
      }

      if (!window.electronAPI || !window.electronAPI.startGoogleOauth) {
        throw new Error(lang === 'es'
          ? 'Conecta Google Drive desde la app de Android o desde la app de escritorio.'
          : 'Connect Google Drive from the Android app or the desktop app.');
      }

      // 1. Run local loopback callback server and open browser
      const oauthResult = await window.electronAPI.startGoogleOauth(gDriveClientId.trim());
      if (!oauthResult || !oauthResult.code) {
        throw new Error('No authorization code returned from loopback server');
      }

      // 2. Exchange authorization code + PKCE verifier for access + refresh token
      const tokenData = await googleDriveService.exchangeCodeForTokens(
        oauthResult.code,
        oauthResult.redirectUri,
        gDriveClientId.trim(),
        gDriveClientSecret.trim(),
        oauthResult.codeVerifier
      );

      // 3. Fetch connected user information
      const info = await googleDriveService.getUserInfo(tokenData, gDriveClientId.trim(), gDriveClientSecret.trim());
      setGDriveUserEmail(info.email);

      // Save credentials & tokens
      localStorage.setItem('gdrive_client_id', gDriveClientId.trim());
      localStorage.setItem('gdrive_client_secret', gDriveClientSecret.trim());
      localStorage.setItem('gdrive_tokens', JSON.stringify(tokenData));
      localStorage.setItem('gdrive_user_email', info.email);

      setGDriveTokens(tokenData);
      setGDriveSyncStatus('authorized');
      alert(lang === 'es' ? `¡Cuenta conectada con éxito! (${info.email})` : `Account successfully connected! (${info.email})`);
    } catch (err) {
      setGDriveSyncStatus(gDriveTokens ? 'authorized' : 'disconnected');
      console.error('Google OAuth connection failed:', err);
      const rawMessage = err instanceof Error ? err.message : String(err);
      if (/UNREGISTERED_ON_API_CONSOLE/i.test(rawMessage)) {
        alert(lang === 'es'
          ? 'Google todavía no reconoce esta app de Android. Hay que registrar un cliente OAuth de tipo Android en Google Cloud (paquete com.yorureader.app + huella SHA-1 del APK). No es un fallo de tu cuenta: reconectar no lo soluciona.'
          : 'Google does not recognize this Android app yet. An Android OAuth client must be registered in Google Cloud (package com.yorureader.app + the APK SHA-1 fingerprint). This is not an account problem: reconnecting will not fix it.');
        return;
      }
      alert((lang === 'es' ? 'Conexión fallida: ' : 'Connection failed: ') + rawMessage);
    }
  };


  // Perform Cloud Upload — Full backup ZIP (mirrors "Get complete local backup" but to Google Drive)
  const handleUploadGDrive = async () => {
    const tokens = localStorage.getItem('gdrive_tokens') ? JSON.parse(localStorage.getItem('gdrive_tokens')) : null;
    if (!tokens) return;
    try {
      setGDriveSyncStatus('syncing');
      document.body.style.cursor = 'wait';

      // 1. Build the same full ZIP as "Get complete local backup"
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const dictionaries = await exportDictionaryDataToZip(zip, (msg, pct) => {
        console.log(`[GDrive Backup] ${msg} (${pct}%)`);
      });

      const metadata = {
        version: 2,
        exportDate: new Date().toISOString(),
        profiles,
        activeProfileId: localStorage.getItem('migaku_reader_active_profile_id') || 'profile-default',
        appLanguage: settings.appLanguage || localStorage.getItem('app_language') || 'en',
        books,
        wordStatuses,
        settings,
        ankiSettings: localStorage.getItem('anki_settings') ? JSON.parse(localStorage.getItem('anki_settings')) : null,
        ankiSettingsV2: localStorage.getItem('anki_settings_v2') ? JSON.parse(localStorage.getItem('anki_settings_v2')) : null,
        dictionaries: dictionaries || [],
      };

      zip.file('metadata.json', JSON.stringify(metadata, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const fileName = `yoru-reader-backup-${new Date().toISOString().slice(0, 10)}.zip`;

      // 2. Upload the ZIP blob to Google Drive
      await googleDriveService.uploadBlobFile(
        tokens,
        gDriveClientId.trim(),
        zipBlob,
        'yoru_reader_full_backup.zip', // fixed name so it overwrites the previous one
        'application/zip',
        gDriveClientSecret.trim()
      );

      const timeStr = new Date().toLocaleString();
      setLastSyncTime(timeStr);
      localStorage.setItem('gdrive_last_sync_time', timeStr);
      setGDriveSyncStatus('authorized');
      alert(lang === 'es'
        ? `✅ Copia de seguridad completa subida a Google Drive con éxito.\nArchivo: yoru_reader_full_backup.zip`
        : `✅ Full backup successfully uploaded to Google Drive.\nFile: yoru_reader_full_backup.zip`);
    } catch (err) {
      setGDriveSyncStatus('authorized');
      console.error('GDrive full backup upload failed:', err);
      alert((lang === 'es' ? 'Error al subir la copia de seguridad: ' : 'Backup upload failed: ') + err.message);
    } finally {
      document.body.style.cursor = 'default';
    }
  };


  // Perform Cloud Download — restores the full backup ZIP from Google Drive
  const handleDownloadGDrive = async () => {
    const tokens = localStorage.getItem('gdrive_tokens') ? JSON.parse(localStorage.getItem('gdrive_tokens')) : null;
    if (!tokens) return;
    try {
      setGDriveSyncStatus('syncing');
      document.body.style.cursor = 'wait';

      // 1. Download the full backup ZIP from Google Drive
      const zipBlob = await googleDriveService.downloadBlobFile(
        tokens,
        gDriveClientId.trim(),
        'yoru_reader_full_backup.zip',
        gDriveClientSecret.trim()
      );

      if (!zipBlob) {
        setGDriveSyncStatus('authorized');
        showToast(lang === 'es'
          ? 'No se encontró ningún archivo de copia de seguridad en Google Drive. Sube una copia primero con el botón "Subir copia completa".'
          : 'No backup file found in Google Drive. Upload one first using "Upload full backup".', 'error');
        return;
      }

      // Proceder directamente sólo notificando
      showToast(lang === 'es'
        ? 'Descargando y restaurando copia de seguridad desde Google Drive...'
        : 'Downloading and restoring backup from Google Drive...', 'info');

      // 2. Parse the ZIP using JSZip (same logic as handleImportLibrary)
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(zipBlob);
      const metaFile = zip.file('metadata.json');
      if (!metaFile) throw new Error('El ZIP de Google Drive no contiene metadatos válidos de Yoru Reader.');

      const metaStr = await metaFile.async('text');
      const importData = JSON.parse(metaStr);

      if (!importData.books && !importData.profiles) {
        throw new Error('El archivo de Google Drive no tiene un formato de respaldo válido.');
      }

      // 3. Restore active profile ID & global language
      if (importData.appLanguage) {
        localStorage.setItem('app_language', importData.appLanguage);
        if (importData.settings) {
          importData.settings.appLanguage = importData.appLanguage;
        }
      }
      if (importData.activeProfileId) {
        localStorage.setItem('migaku_reader_active_profile_id', importData.activeProfileId);
      } else if (importData.profiles && importData.profiles.length > 0) {
        localStorage.setItem('migaku_reader_active_profile_id', importData.profiles[0].id);
      }

      // 4. Merge profiles
      const mergedProfiles = [...profiles];
      if (importData.profiles) {
        importData.profiles.forEach(ip => {
          if (!mergedProfiles.find(p => p.id === ip.id)) mergedProfiles.push(ip);
        });
      }
      db.saveProfiles(mergedProfiles);

      // 5. Merge books
      if (importData.books) {
        const currentBooks = await db.getBooks();
        const mergedBooks = [...currentBooks];
        for (const importBook of importData.books) {
          const index = mergedBooks.findIndex(b => b.id === importBook.id || b.title === importBook.title);
          if (index !== -1) mergedBooks[index] = importBook;
          else mergedBooks.push(importBook);
        }
        await db.saveBooks(mergedBooks);
      }

      // 6. Restore word statuses
      if (importData.wordStatuses) {
        const mergedStatuses = { ...db.getWordStatuses(), ...importData.wordStatuses };
        db.saveWordStatuses(mergedStatuses);
      }

      // 7. Restore settings
      if (importData.settings) db.saveSettings(importData.settings);
      if (importData.ankiSettings) localStorage.setItem('anki_settings', JSON.stringify(importData.ankiSettings));
      if (importData.ankiSettingsV2) localStorage.setItem('anki_settings_v2', JSON.stringify(importData.ankiSettingsV2));

      // 8. Restore dictionary metadata
      if (importData.dictionaries && importData.dictionaries.length > 0) {
        await importAllDictionaryData({ dictionaries: importData.dictionaries, terms: [], frequencies: [] });
      }

      // 9. Restore dictionary term/frequency chunks from ZIP
      const termsInfoFile = zip.file('terms_info.json');
      if (termsInfoFile) {
        const termsInfo = JSON.parse(await termsInfoFile.async('text'));
        for (let c = 0; c < termsInfo.chunkCount; c++) {
          const chunkFile = zip.file(`terms_chunk_${c}.json`);
          if (chunkFile) {
            const chunkData = JSON.parse(await chunkFile.async('text'));
            await importAllDictionaryData({ dictionaries: [], terms: chunkData, frequencies: [] });
          }
        }
      }

      const freqsInfoFile = zip.file('freqs_info.json');
      if (freqsInfoFile) {
        const freqsInfo = JSON.parse(await freqsInfoFile.async('text'));
        for (let c = 0; c < freqsInfo.chunkCount; c++) {
          const chunkFile = zip.file(`freqs_chunk_${c}.json`);
          if (chunkFile) {
            const chunkData = JSON.parse(await chunkFile.async('text'));
            await importAllDictionaryData({ dictionaries: [], terms: [], frequencies: chunkData });
          }
        }
      }

      const timeStr = new Date().toLocaleString();
      localStorage.setItem('gdrive_last_sync_time', timeStr);
      setLastSyncTime(timeStr);

      showToast(lang === 'es'
        ? '✅ Copia de seguridad restaurada con éxito. Reiniciando...'
        : '✅ Backup restored successfully. Restarting...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setGDriveSyncStatus('authorized');
      console.error('GDrive download restore failed:', err);
      alert((lang === 'es' ? 'Error al restaurar desde Google Drive: ' : 'Restore from Google Drive failed: ') + err.message);
    } finally {
      document.body.style.cursor = 'default';
    }
  };


  // Generic background sync helper using API
  const performCloudSync = async (tokens, mode = 'full') => {
    try {
      const importedData = await googleDriveService.downloadSyncFile(
        tokens,
        gDriveClientId.trim(),
        gDriveClientSecret.trim()
      );

      if (!importedData) {
        // If file doesn't exist and not download-only, upload current db
        if (mode !== 'download-only') {
          const fullExport = await db.exportFullDatabase();
          await googleDriveService.uploadSyncFile(
            tokens,
            gDriveClientId.trim(),
            fullExport,
            gDriveClientSecret.trim()
          );
        }
        return;
      }

      // Check modification timestamps if available in backup object
      const cloudTime = importedData.exportDate ? new Date(importedData.exportDate).getTime() : 0;
      const localLastTimeStr = localStorage.getItem('gdrive_last_sync_time');
      const localLastTime = localLastTimeStr ? new Date(localLastTimeStr).getTime() : 0;

      if (cloudTime > localLastTime) {
        // Cloud has newer data, auto-restore
        await db.importFullDatabase(importedData);
        const timeStr = new Date().toLocaleString();
        localStorage.setItem('gdrive_last_sync_time', timeStr);
        console.log("Auto-sincronizada base de datos desde Google Drive.");
        window.location.reload();
      } else if (mode !== 'download-only') {
        // Local is newer, upload current state
        const fullExport = await db.exportFullDatabase();
        await googleDriveService.uploadSyncFile(
          tokens,
          gDriveClientId.trim(),
          fullExport,
          gDriveClientSecret.trim()
        );
        const timeStr = new Date().toLocaleString();
        localStorage.setItem('gdrive_last_sync_time', timeStr);
        setLastSyncTime(timeStr);
      }
    } catch (err) {
      console.error('Background cloud sync failed:', err);
    }
  };

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (profileWidgetRef.current && !profileWidgetRef.current.contains(e.target)) {
        setIsProfileDropdownOpen(false);
        setIsCreatingProfile(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

  const handleCustomAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 128);
      setCustomAvatarUrl(dataUrl);
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? 'Error al procesar la imagen de perfil.' : 'Error processing profile image.');
    }
  };

  const handleEditProfileAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 128);
      setEditProfileAvatar(dataUrl);
    } catch (err) {
      console.error(err);
      alert(lang === 'es' ? 'Error al procesar la imagen de perfil.' : 'Error processing profile image.');
    }
  };

  const handleProfileSettingsSubmit = (e) => {
    e.preventDefault();
    if (!editProfileName.trim()) return;

    onUpdateProfile(activeProfileId, {
      name: editProfileName.trim(),
      avatar: editProfileAvatar,
      avatarEmoji: ''
    });
    setIsProfileSettingsOpen(false);
  };

  const openProfileSettings = () => {
    setEditProfileName(activeProfile?.name || '');
    setEditProfileAvatar(activeProfile?.avatar || '');
    setIsProfileSettingsOpen(true);
    setIsProfileDropdownOpen(false);
  };

  // --- ANKI INTEGRATION & BACKUP HELPERS ---
  const [ankiSettings, setAnkiSettings] = useState(() => {
    const saved = localStorage.getItem('anki_settings');
    return saved ? JSON.parse(saved) : {
      host: 'http://127.0.0.1:8765',
      deck: 'Yoru Cafe',
      noteType: 'Japanese',
      sentenceField: 'Sentence',
      wordField: 'Expression',
      meaningField: 'Meaning'
    };
  });

  const saveAnkiSettings = (key, value) => {
    const updated = { ...ankiSettings, [key]: value };
    setAnkiSettings(updated);
    localStorage.setItem('anki_settings', JSON.stringify(updated));
  };

  const [ankiConnectionStatus, setAnkiConnectionStatus] = useState(null); // 'connected' | 'error' | 'testing' | null
  const [isVocabModalOpen, setIsVocabModalOpen] = useState(false);
  const [isSrsReviewOpen, setIsSrsReviewOpen] = useState(false);
  const [srsUpdateTrigger, setSrsUpdateTrigger] = useState(0);

  const testAnkiConnection = async () => {
    setAnkiConnectionStatus('testing');
    try {
      const data = await ankiConnectRequest<number>(ankiSettings.host, { action: 'version', version: 6 });
      if (data.result !== undefined && data.result !== null) {
        setAnkiConnectionStatus('connected');
      } else {
        setAnkiConnectionStatus('error');
      }
    } catch (err) {
      setAnkiConnectionStatus('error');
    }
  };
  const handleExportLibrary = async () => {
    try {
      document.body.style.cursor = 'wait';
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      const dictionaries = await exportDictionaryDataToZip(zip, (msg, pct) => {
        console.log(`[Export Library] ${msg} (${pct}%)`);
      });
      
      const metadata = {
        version: 2,
        exportDate: new Date().toISOString(),
        profiles: profiles,
        activeProfileId: localStorage.getItem('migaku_reader_active_profile_id') || 'profile-default',
        appLanguage: settings.appLanguage || localStorage.getItem('app_language') || 'en',
        books: books,
        wordStatuses: wordStatuses,
        settings: settings,
        ankiSettings: localStorage.getItem('anki_settings') ? JSON.parse(localStorage.getItem('anki_settings')) : null,
        ankiSettingsV2: localStorage.getItem('anki_settings_v2') ? JSON.parse(localStorage.getItem('anki_settings_v2')) : null,
        dictionaries: dictionaries || []
      };
      
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));
      
      const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      
      // 6. Download the zip
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yoru-reader-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      showToast((lang === 'es' ? 'Error al exportar la biblioteca: ' : 'Error exporting library: ') + e.message, 'error');
    } finally {
      document.body.style.cursor = 'default';
    }
  };

  const handleImportLibrary = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      document.body.style.cursor = 'wait';
      let importData = null;
      let zip = null;
      const isZip = file.name.toLowerCase().endsWith('.zip');

      if (isZip) {
        const JSZip = (await import('jszip')).default;
        zip = await JSZip.loadAsync(file);
        const metaFile = zip.file('metadata.json');
        if (!metaFile) {
          alert(lang === 'es' ? 'El archivo zip no contiene metadatos válidos de Yoru Reader.' : 'The zip file does not contain valid Yoru Reader metadata.');
          return;
        }
        const metaStr = await metaFile.async('text');
        importData = JSON.parse(metaStr);
      } else {
        // Legacy JSON backup support
        const text = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = (evt) => {
            const result = evt.target?.result;
            if (typeof result === 'string') resolve(result);
            else reject(new Error('Backup file could not be read as text.'));
          };
          r.onerror = (err) => reject(err);
          r.readAsText(file);
        });
        importData = JSON.parse(text);
      }

      if (!importData.books && !importData.profiles) {
        alert(lang === 'es' ? 'El archivo no tiene un formato de respaldo válido de Yoru Reader.' : 'The file does not have a valid Yoru Reader backup format.');
        return;
      }

      // Proceder directamente sólo notificando
      showToast(lang === 'es'
        ? 'Restaurando copia de seguridad local...'
        : 'Restoring local backup...', 'info');

      // 1. Restore active profile ID & global language
      if (importData.appLanguage) {
        localStorage.setItem('app_language', importData.appLanguage);
        if (importData.settings) {
          importData.settings.appLanguage = importData.appLanguage;
        }
      }
      if (importData.activeProfileId) {
        localStorage.setItem('migaku_reader_active_profile_id', importData.activeProfileId);
      } else if (importData.profiles && importData.profiles.length > 0) {
        localStorage.setItem('migaku_reader_active_profile_id', importData.profiles[0].id);
      }

        // 2. Merge profiles
        const mergedProfiles = [...profiles];
        if (importData.profiles) {
          importData.profiles.forEach(ip => {
            if (!mergedProfiles.find(p => p.id === ip.id)) {
              mergedProfiles.push(ip);
            }
          });
        }
        db.saveProfiles(mergedProfiles);

        // 3. Merge books
        if (importData.books) {
          const currentBooks = await db.getBooks();
          const mergedBooks = [...currentBooks];
          for (const importBook of importData.books) {
            const index = mergedBooks.findIndex(b => b.id === importBook.id || b.title === importBook.title);
            if (index !== -1) {
              mergedBooks[index] = importBook;
            } else {
              mergedBooks.push(importBook);
            }
          }
          await db.saveBooks(mergedBooks);
        }
        
        // 4. Restore word statuses
        if (importData.wordStatuses) {
          const mergedStatuses = { ...db.getWordStatuses(), ...importData.wordStatuses };
          db.saveWordStatuses(mergedStatuses);
        }

        // 5. Restore settings
        if (importData.settings) {
          db.saveSettings(importData.settings);
        }
        if (importData.ankiSettings) {
          localStorage.setItem('anki_settings', JSON.stringify(importData.ankiSettings));
        }
        if (importData.ankiSettingsV2) {
          localStorage.setItem('anki_settings_v2', JSON.stringify(importData.ankiSettingsV2));
        }

        // 6. Restore Yomitan dictionary metadata
        if (importData.dictionaries && importData.dictionaries.length > 0) {
          await importAllDictionaryData({
            dictionaries: importData.dictionaries,
            terms: [],
            frequencies: []
          });
        }

        // 7. Load chunks of terms and frequencies from Zip if present
        if (isZip && zip) {
          // Load terms chunks
          const termsInfoFile = zip.file('terms_info.json');
          if (termsInfoFile) {
            const termsInfo = JSON.parse(await termsInfoFile.async('text'));
            for (let c = 0; c < termsInfo.chunkCount; c++) {
              const chunkFile = zip.file(`terms_chunk_${c}.json`);
              if (chunkFile) {
                const chunkStr = await chunkFile.async('text');
                const chunkData = JSON.parse(chunkStr);
                await importAllDictionaryData({ dictionaries: [], terms: chunkData, frequencies: [] });
              }
            }
          }

          // Load frequencies chunks
          const freqsInfoFile = zip.file('freqs_info.json');
          if (freqsInfoFile) {
            const freqsInfo = JSON.parse(await freqsInfoFile.async('text'));
            for (let c = 0; c < freqsInfo.chunkCount; c++) {
              const chunkFile = zip.file(`freqs_chunk_${c}.json`);
              if (chunkFile) {
                const chunkStr = await chunkFile.async('text');
                const chunkData = JSON.parse(chunkStr);
                await importAllDictionaryData({ dictionaries: [], terms: [], frequencies: chunkData });
              }
            }
          }
        } else {
          // Fallback legacy dictionary import
          if (importData.terms || importData.frequencies) {
            await importAllDictionaryData({
              dictionaries: [],
              terms: importData.terms || [],
              frequencies: importData.frequencies || []
            });
          }
        }
        
        showToast(lang === 'es' 
          ? '✅ Copia de seguridad importada con éxito. Reiniciando...' 
          : '✅ Backup imported successfully. Restarting...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
    } catch (err) {
      console.error(err);
      showToast((lang === 'es' ? 'Error al restaurar el respaldo: ' : 'Error restoring backup: ') + err.message, 'error');
    } finally {
      document.body.style.cursor = 'default';
    }
  };

  const handleCreateProfileSubmit = (e) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    let avatar = 'linear-gradient(135deg, #1f1f23 0%, #0d0d0f 100%)';
    let emoji = '👤';

    if (customAvatarUrl) {
      avatar = customAvatarUrl;
      emoji = '';
    }

    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      avatar: avatar,
      avatarEmoji: emoji
    };

    onAddProfile(newProfile);
    setIsCreatingProfile(false);
    setNewProfileName('');
    setCustomAvatarUrl(null);
    setIsProfileDropdownOpen(false);
  };

  // Book Edit Details states
  const [editingBook, setEditingBook] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editHideCover, setEditHideCover] = useState(false);
  const [editDescription, setEditDescription] = useState('');

  // Load word statistics from localStorage DB
  const localWordStatuses = db.getWordStatuses();
  const knownWordsCount = Object.values(localWordStatuses).filter(s => s === 'known').length;
  const learningWordsCount = Object.values(localWordStatuses).filter(s => s === 'learning').length;
  const newWordsCount = Object.values(localWordStatuses).filter(s => s === 'new').length;
  const totalWords = knownWordsCount + learningWordsCount + newWordsCount;

  const srsStats = useMemo(() => {
    const statuses = db.getWordStatuses();
    const srsData = db.getSrsData();
    const now = new Date();
    const next7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const next30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const learningWords = Object.keys(statuses).filter(w => statuses[w] === 'learning');
    
    let due = 0;
    let due7d = 0;
    let due30d = 0;
    let newCards = 0;
    let learningCards = 0;
    let youngCards = 0;
    let matureCards = 0;
    
    learningWords.forEach(word => {
      const card = srsData[word];
      if (!card || !card.dueDate) {
        due++;
        due7d++;
        due30d++;
        newCards++;
      } else {
        const dueDate = new Date(card.dueDate);
        if (dueDate <= now) due++;
        if (dueDate <= next7d) due7d++;
        if (dueDate <= next30d) due30d++;
        
        const reps = card.repetitions || 0;
        const interval = card.interval || 0;
        
        if (reps === 0) {
          newCards++;
        } else if (interval === 0) {
          learningCards++;
        } else if (interval < 21) {
          youngCards++;
        } else {
          matureCards++;
        }
      }
    });
    
    return {
      due,
      due7d,
      due30d,
      newCards,
      learningCards,
      youngCards,
      matureCards
    };
  }, [localWordStatuses, srsUpdateTrigger]);

  const dueCount = srsStats.due;

  // Calculate percentages for vocabulary chart
  const knownPercent = totalWords > 0 ? Math.round((knownWordsCount / totalWords) * 100) : 0;
  const learningPercent = totalWords > 0 ? Math.round((learningWordsCount / totalWords) * 100) : 0;
  const newPercent = totalWords > 0 ? Math.round((newWordsCount / totalWords) * 100) : 100; // default to 100% new if empty

  // File upload trigger
  const handleFileUpload = async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (files.length === 0) return;
    const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

    setIsParsing(true);
    const parsedBooks = [];
    let failedCount = 0;
    let lastError = null;

    try {
      const { importBookFile } = await import('../utils/fileImport');
      for (const file of files) {
        try {
          const bookData = await importBookFile(file);
          parsedBooks.push(bookData);
        } catch (err) {
          console.error(`Error importing file "${file.name}":`, err);
          failedCount++;
          lastError = err;
        }
      }

      if (parsedBooks.length > 0) await onAddBooks(parsedBooks);

      if (failedCount > 0) {
        const errorMessage = lastError instanceof Error ? lastError.message : 'Error desconocido';
        const message = lang === 'es'
          ? `${parsedBooks.length} de ${files.length} procesados; ${failedCount} con error. ${errorMessage}`
          : `${parsedBooks.length} of ${files.length} processed; ${failedCount} failed. ${errorMessage}`;
        if (isAndroidApp) showToast(message, 'error');
        else alert(message);
      } else if (parsedBooks.length > 0) {
        if (isAndroidApp) showToast(lang === 'es' ? 'Importación terminada.' : 'Import complete.');
      } else {
        const message = lang === 'es' ? 'No se pudo importar ningún archivo.' : 'No files could be imported.';
        if (isAndroidApp) showToast(message, 'error');
        else alert(message);
      }
    } catch (err) {
      console.error('Error saving imported books:', err);
      const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
      const message = lang === 'es' ? `No se pudo guardar la importación: ${errorMessage}` : `Could not save import: ${errorMessage}`;
      if (isAndroidApp) showToast(message, 'error');
      else alert(message);
    } finally {
      setIsParsing(false);
      (e.target as HTMLInputElement).value = '';
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Toggle book selection in multi-select mode
  const handleCardClick = (book) => {
    if (selectMode) {
      if (selectedBookIds.includes(book.id)) {
        setSelectedBookIds(selectedBookIds.filter(id => id !== book.id));
      } else {
        setSelectedBookIds([...selectedBookIds, book.id]);
      }
    } else {
      setPreviewBook(book);
    }
  };

  // Bulk deletion
  const handleBulkDelete = async () => {
    if (selectedBookIds.length === 0) return;
    const ok = await showConfirm({
      title: lang === 'es' ? '¿Eliminar libros?' : 'Delete books?',
      message: lang === 'es' ? `¿Estás seguro de que quieres eliminar los ${selectedBookIds.length} libros seleccionados?` : `Are you sure you want to delete the ${selectedBookIds.length} selected books?`,
      type: 'danger',
      confirmText: lang === 'es' ? 'Eliminar' : 'Delete',
    });
    if (ok) {
      onBulkDeleteBooks(selectedBookIds);
      setSelectedBookIds([]);
      setSelectMode(false);
    }
  };

  // Toggle select mode
  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedBookIds([]); // reset selection
  };

  const handleSelectAllVisible = () => {
    setSelectedBookIds(filteredBooksList.map(b => b.id));
  };

  const handleClearSelection = () => {
    setSelectedBookIds([]);
  };

  const handleSetSeries = async () => {
    if (selectedBookIds.length === 0) return;
    const series = prompt(lang === 'es' ? "Introduce el nombre de la serie para los libros seleccionados:" : "Enter the series name for the selected books:");
    if (series === null) return;
    for (const bookId of selectedBookIds) {
      await onUpdateBookDetails(bookId, { series: series.trim() });
    }
    showToast(lang === 'es' ? "Serie actualizada con éxito." : "Series successfully updated.", 'success');
  };

  const handleSetAuthor = async () => {
    if (selectedBookIds.length === 0) return;
    const author = prompt(lang === 'es' ? "Introduce el nombre del autor para los libros seleccionados:" : "Enter the author name for the selected books:");
    if (author === null) return;
    for (const bookId of selectedBookIds) {
      await onUpdateBookDetails(bookId, { author: author.trim() });
    }
    showToast(lang === 'es' ? "Autor actualizado con éxito." : "Author successfully updated.", 'success');
  };

  const handleAddTags = async () => {
    if (selectedBookIds.length === 0) return;
    const tag = prompt(lang === 'es' ? "Introduce la etiqueta que deseas añadir:" : "Enter the tag you want to add:");
    if (!tag) return;
    const tagTrim = tag.trim();
    for (const bookId of selectedBookIds) {
      const book = books.find(b => b.id === bookId);
      if (book) {
        const tags = book.tags ? [...book.tags] : [];
        if (!tags.includes(tagTrim)) {
          tags.push(tagTrim);
          await onUpdateBookDetails(bookId, { tags });
        }
      }
    }
    showToast(lang === 'es' ? "Etiquetas añadidas." : "Tags added.", 'success');
  };

  const handleRemoveTags = async () => {
    if (selectedBookIds.length === 0) return;
    const tag = prompt(lang === 'es' ? "Introduce la etiqueta que deseas eliminar:" : "Enter the tag you want to remove:");
    if (!tag) return;
    const tagTrim = tag.trim();
    for (const bookId of selectedBookIds) {
      const book = books.find(b => b.id === bookId);
      if (book && book.tags) {
        const tags = book.tags.filter(t => t !== tagTrim);
        await onUpdateBookDetails(bookId, { tags });
      }
    }
    showToast(lang === 'es' ? "Etiquetas eliminadas." : "Tags removed.", 'success');
  };

  const handleBlurCovers = async () => {
    if (selectedBookIds.length === 0) return;
    for (const bookId of selectedBookIds) {
      const book = books.find(b => b.id === bookId);
      if (book) {
        await onUpdateBookDetails(bookId, { hideCover: !book.hideCover });
      }
    }
    showToast(lang === 'es' ? 'Visibilidad de portadas actualizada.' : 'Covers visibility updated.', 'success');
  };

  const handleMarkAsUnread = async () => {
    if (selectedBookIds.length === 0) return;
    const ok = await showConfirm({
      title: lang === 'es' ? '¿Marcar como no leídos?' : 'Mark as unread?',
      message: lang === 'es' ? "¿Quieres marcar como no leídos los libros seleccionados y reiniciar su progreso?" : "Do you want to mark selected books as unread and reset their progress?",
      type: 'warning',
      confirmText: lang === 'es' ? 'Marcar' : 'Mark',
    });
    if (ok) {
      for (const bookId of selectedBookIds) {
        await onUpdateBookDetails(bookId, {
          progress: { currentChapter: 0, currentPage: 0, percent: 0 },
          status: 'unread'
        });
      }
      showToast(lang === 'es' ? "Progreso reiniciado para los libros seleccionados." : "Progress reset for selected books.", 'success');
    }
  };

  const handleExportSelection = async () => {
    if (selectedBookIds.length === 0) return;
    try {
      const selectedBooks = books.filter(b => selectedBookIds.includes(b.id));
      const exportData = {
        version: 2,
        exportDate: new Date().toISOString(),
        profiles: profiles,
        activeProfileId: localStorage.getItem('migaku_reader_active_profile_id') || 'profile-default',
        books: selectedBooks,
        wordStatuses: wordStatuses,
        settings: settings,
        ankiSettings: localStorage.getItem('anki_settings') ? JSON.parse(localStorage.getItem('anki_settings')) : null,
        ankiSettingsV2: localStorage.getItem('anki_settings_v2') ? JSON.parse(localStorage.getItem('anki_settings_v2')) : null
      };
      const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yoru-reader-selection-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast((lang === 'es' ? 'Error al exportar selección: ' : 'Error exporting selection: ') + e.message, 'error');
    }
  };

  const handleOpenStatistics = () => {
    if (selectedBookIds.length === 0) return;
    const excluded = books.filter(b => !selectedBookIds.includes(b.id)).map(b => b.id);
    setStatsExcludedBookIds(excluded);
    setActiveTab('statistics');
  };

  const handleDeleteStatistics = async () => {
    if (selectedBookIds.length === 0) return;
    const ok = await showConfirm({
      title: lang === 'es' ? '¿Borrar estadísticas?' : 'Clear statistics?',
      message: lang === 'es' ? `¿Seguro que quieres borrar los registros de lectura de ${selectedBookIds.length} libro(s) seleccionado(s)?` : `Are you sure you want to clear the reading records of the ${selectedBookIds.length} selected book(s)?`,
      type: 'danger',
      confirmText: lang === 'es' ? 'Borrar' : 'Clear',
    });
    if (ok) {
      for (const bookId of selectedBookIds) {
        const book = books.find(b => b.id === bookId);
        if (book && book.title) {
          await db.deleteReadingStatsForBook(book.title);
        }
        await onUpdateBookDetails(bookId, {
          progress: { ...((books.find(b => b.id === bookId) || {}).progress || {}), charactersRead: 0, secondsRead: 0 },
          lastRead: null
        });
      }
      showToast(lang === 'es' ? 'Estadísticas de lectura borradas.' : 'Reading statistics cleared.', 'success');
    }
  };

  // Dynamic sorting
  const getSortedBooks = (booksList) => {
    const characterCounts = sortBy === 'characters'
      ? new Map<any, number>(booksList.map(book => [book, (book.chapters || []).reduce((total, chapter) => total + (chapter.text ? chapter.text.length : 0), 0)] as [any, number]))
      : null;

    return [...booksList].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title, 'ja');
          break;
        case 'author':
          const authorA = a.author || 'Desconocido';
          const authorB = b.author || 'Desconocido';
          comparison = authorA.localeCompare(authorB, 'ja');
          break;
        case 'series':
          const seriesA = a.series || 'Sin Serie';
          const seriesB = b.series || 'Sin Serie';
          comparison = seriesA.localeCompare(seriesB, 'ja');
          break;
        case 'characters':
          const charsA = characterCounts?.get(a) || 0;
          const charsB = characterCounts?.get(b) || 0;
          comparison = charsA - charsB;
          break;
        case 'lastUpdate':
          const updateA = a.lastRead || a.createdAt || EARLIEST_BOOK_DATE;
          const updateB = b.lastRead || b.createdAt || EARLIEST_BOOK_DATE;
          comparison = updateA.localeCompare(updateB);
          break;
        case 'lastRead':
          const readA = a.lastRead || '';
          const readB = b.lastRead || '';
          if (!readA && !readB) comparison = 0;
          else if (!readA) comparison = 1; // puts empty lastRead at the bottom
          else if (!readB) comparison = -1;
          else comparison = readA.localeCompare(readB);
          break;
        case 'progress':
          const progA = (a.progress && a.progress.percent) ? a.progress.percent : 0;
          const progB = (b.progress && b.progress.percent) ? b.progress.percent : 0;
          comparison = progA - progB;
          break;
        case 'currentPosition':
          const posA = a.progress ? (a.progress.currentChapter * 100000 + a.progress.currentPage) : 0;
          const posB = b.progress ? (b.progress.currentChapter * 100000 + b.progress.currentPage) : 0;
          comparison = posA - posB;
          break;
        case 'added':
        default:
          const addA = a.createdAt || EARLIEST_BOOK_DATE;
          const addB = b.createdAt || EARLIEST_BOOK_DATE;
          comparison = addA.localeCompare(addB);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };

  // Keep library derivations stable between renders and sort the filtered list once.
  const authorCounts = useMemo(() => books.reduce<Record<string, number>>((counts, book) => {
    if (book.isDeleted) return counts;
    const author = book.author || 'Desconocido';
    counts[author] = (counts[author] || 0) + 1;
    return counts;
  }, {}), [books]);
  const uniqueAuthors = useMemo(() => Object.keys(authorCounts).sort(), [authorCounts]);

  const filteredBooks = useMemo(() => {
    let list = books.filter(book => !book.isDeleted);
    const percent = (book: any) => book.progress?.percent ?? 0;

    switch (activeFilter.type) {
      case 'unread':
        list = list.filter(book => book.status === 'unread' || (!book.status && percent(book) === 0));
        break;
      case 'reading':
        list = list.filter(book => book.status === 'reading' || (!book.status && percent(book) > 0 && percent(book) < 100));
        break;
      case 'completed':
        list = list.filter(book => book.status === 'completed' || (!book.status && percent(book) >= 100));
        break;
      case 'paused':
      case 'dropped':
      case 'planning':
        list = list.filter(book => book.status === activeFilter.type);
        break;
      case 'author':
        list = list.filter(book => (book.author || 'Desconocido') === activeFilter.value);
        break;
      case 'tag':
        list = list.filter(book => activeFilter.value === 'untagged'
          ? !book.tags?.length
          : book.tags?.includes(activeFilter.value));
        break;
      default:
        break;
    }

    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return list;
    return list.filter(book =>
      (book.title || '').toLocaleLowerCase().includes(query) ||
      (book.author || '').toLocaleLowerCase().includes(query)
    );
  }, [books, activeFilter.type, activeFilter.value, searchQuery]);

  const filteredBooksList = useMemo(
    () => getSortedBooks(filteredBooks),
    [filteredBooks, sortBy, sortDirection]
  );
  const currentlyReading = filteredBooksList.filter(book => book.status === 'reading' || (!book.status && (book.progress?.percent ?? 0) > 0 && (book.progress?.percent ?? 0) < 100));
  const notStarted = filteredBooksList.filter(book => book.status === 'unread' || (!book.status && (book.progress?.percent ?? 0) === 0));
  const completed = filteredBooksList.filter(book => book.status === 'completed' || (!book.status && (book.progress?.percent ?? 0) >= 100));
  const allSortedBooks = filteredBooksList;

  const getSectionTitle = () => {
    let base = lang === 'es' ? "Todos los libros" : "All books";
    if (activeFilter.type === 'unread') base = lang === 'es' ? "Sin iniciar" : "Not started";
    else if (activeFilter.type === 'reading') base = lang === 'es' ? "Leyendo actualmente" : "Currently reading";
    else if (activeFilter.type === 'completed') base = lang === 'es' ? "Leídos" : "Read";
    else if (activeFilter.type === 'paused') base = lang === 'es' ? "Pausados" : "Paused";
    else if (activeFilter.type === 'dropped') base = lang === 'es' ? "Dropeados" : "Dropped";
    else if (activeFilter.type === 'planning') base = lang === 'es' ? "Planeados" : "Planned";
    else if (activeFilter.type === 'author') base = lang === 'es' ? `Libros de ${activeFilter.value}` : `Books by ${activeFilter.value}`;
    else if (activeFilter.type === 'tag') base = lang === 'es' ? "Libros sin etiquetas" : "Untagged books";
    
    if (sortBy === 'title') return `${base} (A-Z)`;
    if (sortBy === 'added') return `${base} (${lang === 'es' ? 'Añadido' : 'Added'})`;
    if (sortBy === 'lastRead') return `${base} (${lang === 'es' ? 'Leído recientemente' : 'Recently read'})`;
    return `${base} (${sortBy})`;
  };



  const renderStatusBadge = (book) => {
    const status = book.status || 'unread';
    let color = '';
    let icon = null;
    let tooltip = '';
    
    if (status === 'completed') {
      color = '#10b981'; // emerald green
      icon = (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      );
      tooltip = 'Completado';
    } else if (status === 'reading') {
      color = '#3b82f6'; // blue
      icon = (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      );
      tooltip = 'En progreso';
    } else if (status === 'paused') {
      color = '#f59e0b'; // amber/orange
      icon = (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
        </svg>
      );
      tooltip = 'Pausado';
    } else if (status === 'dropped') {
      color = '#6b7280'; // gray
      icon = (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
      );
      tooltip = 'Dropeado';
    } else if (status === 'planning') {
      color = '#a855f7'; // purple
      icon = (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      );
      tooltip = 'Planeado';
    } else {
      // unread
      return null;
    }
    
    return (
      <div 
        title={tooltip}
        style={{
          position: 'absolute',
          top: '8px',
          right: '40px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          zIndex: 10,
          border: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        {icon}
      </div>
    );
  };

  const renderBookCardMenu = (book) => {
    if (selectMode) return null;
    
    const isMenuOpen = activeMenuBookId === book.id;
    
    return (
      <div className="card-menu-wrapper" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: isMenuOpen ? 9999 : 50 }}>
        <button 
          className="card-menu-trigger-btn"
          onClick={(e) => {
            e.stopPropagation();
            // Detect if trigger is in the right half of screen - open dropdown to the left, else to the right
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuOpenLeft(rect.right > window.innerWidth / 2);
            setActiveMenuBookId(isMenuOpen ? null : book.id);
          }}
          style={{
            background: 'rgba(28, 28, 32, 0.75)',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.85)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <MoreVertical size={14} />
        </button>

        {isMenuOpen && (
          <div 
            className="book-context-menu-dropdown"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '32px',
              ...(menuOpenLeft ? { left: '0' } : { right: '0' }),
              width: '190px',
              maxHeight: '420px',
              overflowY: 'auto',
              background: 'rgba(28, 28, 35, 0.98)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '6px 0',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
              animation: 'tabViewFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              zIndex: 1000
            }}
          >
            <button 
              onClick={() => {
                setActiveMenuBookId(null);
                onOpenInfo(book);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: 'var(--text-main)',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              className="context-menu-item-btn"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={14} style={{ color: 'rgba(255, 255, 255, 0.7)' }} /> {lang === 'es' ? 'Ver detalles' : 'Show details'}
              </div>
            </button>
            
            <button 
              onClick={() => {
                setActiveMenuBookId(null);
                setEditingBook(book);
                setEditTitle(book.title);
                setEditHideCover(book.hideCover === true);
                setEditDescription(book.description || '');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              className="context-menu-item-btn"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Pencil size={14} style={{ color: 'rgba(255, 255, 255, 0.7)' }} /> {lang === 'es' ? 'Editar título' : 'Edit title'}
              </div>
            </button>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
            <div style={{ padding: '2px 0' }}>
              <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', padding: '4px 12px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{lang === 'es' ? 'Estado' : 'Status'}</div>
              {[
                { key: 'reading', label: lang === 'es' ? 'En progreso' : 'In progress', color: '#3b82f6', icon: <Play size={12} fill="currentColor" /> },
                { key: 'completed', label: lang === 'es' ? 'Completado' : 'Completed', color: '#10b981', icon: <Check size={12} strokeWidth={3} /> },
                { key: 'paused', label: lang === 'es' ? 'Pausado' : 'Paused', color: '#f59e0b', icon: <Pause size={12} fill="currentColor" /> },
                { key: 'planning', label: lang === 'es' ? 'Planeado' : 'Planned', color: '#a855f7', icon: <Clock size={12} /> },
                { key: 'dropped', label: lang === 'es' ? 'Dropeado' : 'Dropped', color: '#9ca3af', icon: <X size={12} strokeWidth={3} /> },
                { key: 'unread', label: lang === 'es' ? 'Sin iniciar' : 'Not started', color: '#ef4444', icon: <RotateCcw size={12} /> }
              ].map(opt => {
                const isCurrent = book.status === opt.key || (opt.key === 'unread' && !book.status);
                return (
                  <button 
                    key={opt.key}
                    onClick={async () => {
                      setActiveMenuBookId(null);
                      await onUpdateBookDetails(book.id, { status: opt.key });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '5px 12px',
                      background: isCurrent ? 'rgba(255,255,255,0.06)' : 'none',
                      border: 'none',
                      color: isCurrent ? opt.color : 'rgba(255,255,255,0.8)',
                      fontWeight: isCurrent ? 600 : 400,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s ease'
                    }}
                    className="context-menu-item-btn"
                  >
                    <span style={{ display: 'flex', alignItems: 'center', color: isCurrent ? opt.color : 'rgba(255,255,255,0.4)' }}>{opt.icon}</span>
                    {opt.label}
                  </button>
                );
              })}
            </div>



            <button 
              onClick={async () => {
                setActiveMenuBookId(null);
                const ok = await showConfirm({
                  title: lang === 'es' ? '¿Eliminar novela?' : 'Delete novel?',
                  message: lang === 'es' ? `¿Estás seguro de que quieres eliminar "${book.title}"?` : `Are you sure you want to delete "${book.title}"?`,
                  type: 'danger',
                  confirmText: lang === 'es' ? 'Eliminar' : 'Delete',
                });
                if (ok) {
                  onDeleteBook(book.id);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: '#ef4444',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease',
                gap: '8px'
              }}
              className="context-menu-item-btn"
            >
              <Trash2 size={14} /> {lang === 'es' ? 'Eliminar' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ReadEra-style list rows: cover, title, author, progress and last read.
  const renderBookList = (booksList) => (
    <div className="books-list">
      {booksList.map((book) => {
        const isSelected = selectedBookIds.includes(book.id);
        const percent = book.progress?.percent ?? 0;
        const hasImage = book.cover && !book.cover.startsWith('linear-gradient');
        return (
          <div
            key={book.id}
            className={`book-list-row ${isSelected ? 'selected' : ''} ${selectMode ? 'select-mode-active' : ''}`}
            onClick={() => handleCardClick(book)}
            style={{ position: 'relative', zIndex: activeMenuBookId === book.id ? 500 : 'auto' }}
          >
            <div className="book-list-cover">
              {hasImage ? (
                <img src={book.cover} alt="" loading="lazy" decoding="async" style={book.hideCover ? { filter: 'blur(8px)', opacity: 0.5 } : undefined} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: book.cover || 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' }} />
              )}
              {selectMode && (
                <div className="card-checkbox-container">
                  <Check size={12} className="card-checkbox-icon" />
                </div>
              )}
            </div>
            <div className="book-list-info">
              <div className="book-list-title" title={book.title}>{book.title}</div>
              {(book.author || book.series) && (
                <div className="book-list-meta">{[book.series, book.author].filter(Boolean).join(' · ')}</div>
              )}
              <div className="book-list-progress">
                <div className="book-list-progress-track">
                  <div className="book-list-progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
                <span>{percent}%</span>
              </div>
              {book.lastRead && (
                <div className="book-list-meta">
                  {(lang === 'es' ? 'Leído ' : 'Read ') + new Date(book.lastRead).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
            {renderBookCardMenu(book)}
          </div>
        );
      })}
    </div>
  );

  const renderBookGrid = (booksList) => {
    if (libraryView === 'list') return renderBookList(booksList);
    return (
      <div className="books-grid">
        {booksList.map((book) => {
          const isSelected = selectedBookIds.includes(book.id);
          return (
            <div 
              key={book.id} 
              className={`book-card ${isSelected ? 'selected' : ''} ${selectMode ? 'select-mode-active' : ''}`}
              onClick={() => handleCardClick(book)}
              style={{ position: 'relative', zIndex: activeMenuBookId === book.id ? 500 : 'auto' }}
            >
              {/* Card Context Menu Trigger and Popup */}
              {renderBookCardMenu(book)}

              {/* Status Badge overlay */}
              {!selectMode && renderStatusBadge(book)}

              {/* Checkbox overlay when selectMode is active */}
              {selectMode && (
                <div className="card-checkbox-container">
                  <Check size={12} className="card-checkbox-icon" />
                </div>
              )}

              {/* Book Cover */}
              <div className="book-cover-container">
                {book.cover && !book.cover.startsWith('linear-gradient') ? (
                  <img 
                    src={book.cover} 
                    alt={book.title} 
                    className="book-cover-img"
                    loading="lazy"
                    decoding="async"
                    style={book.hideCover ? { filter: 'blur(12px)', opacity: 0.5 } : undefined}
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                ) : (
                  <div 
                    className="book-cover-placeholder" 
                    style={{ 
                      background: book.cover && book.cover.startsWith('linear-gradient') 
                        ? book.cover 
                        : 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' 
                    }}
                  >
                    <span>{book.title}</span>
                  </div>
                )}

                {/* Progress badge at top left of cover */}
                {showCardProgress && book.progress.percent > 0 && (
                  <div className="book-progress-badge">
                    <span>{book.progress.percent}%</span>
                  </div>
                )}

                {/* Vocab Coverage indicator (if unstarted and present) */}
                {book.progress.percent === 0 && book.vocabularyCoverage && (
                  <div className="book-progress-badge" style={{ color: '#248ff2', borderColor: 'rgba(36, 143, 242, 0.3)' }}>
                    <span>{book.vocabularyCoverage}%</span>
                  </div>
                )}

                {/* Progress bar at bottom of cover */}
                {showCardProgress && book.progress.percent > 0 && (
                  <div className="book-progress-bar-container">
                    <div 
                      className="book-progress-bar" 
                      style={{ width: `${book.progress.percent}%` }}
                    ></div>
                  </div>
                )}
              </div>

              {/* Book Details */}
              {(showCardTitle || showCardAuthor || showCardSeries || showCardTags) && (
                <div className="book-info" style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {showCardTitle && <h4 className="book-title" title={book.title} style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{book.title}</h4>}
                  {showCardSeries && book.series && <p className="book-series" style={{ margin: 0, fontSize: '0.72rem', color: 'var(--primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{book.series}</p>}
                  {showCardAuthor && <p className="book-author" style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{book.author}</p>}
                  {showCardTags && book.tags && book.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                      {book.tags.slice(0, 2).map(tag => (
                                <span key={tag} style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          };

  const renderGroupedBooks = (booksToGroup: any[], getGroupName: (book: any) => string) => {
    const groups = new Map<string, any[]>();
    booksToGroup.forEach(book => {
      const name = getGroupName(book).trim() || (lang === 'es' ? 'Sin clasificar' : 'Uncategorized');
      const group = groups.get(name) || [];
      group.push(book);
      groups.set(name, group);
    });

    return (
      <div className="library-grouped-view">
        {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([name, groupBooks]) => (
          <section className="library-section" key={name}>
            <div className="section-header">
              <h2 className="section-title">{name}</h2>
              <span className="section-count">{groupBooks.length}</span>
            </div>
            {renderBookGrid(groupBooks)}
          </section>
        ))}
      </div>
    );
  };

  const renderGroupedByAuthor = () => renderGroupedBooks(
    filteredBooksList,
    book => book.author || (lang === 'es' ? 'Desconocido' : 'Unknown author'),
  );

  const renderGroupedBySeries = () => renderGroupedBooks(
    filteredBooksList,
    book => book.series || (lang === 'es' ? 'Sin serie' : 'No series'),
  );

  const renderStatisticsTab = () => {
    return (
      <div 
        className="stats-tab-content"
        style={{
          width: '100%',
          minHeight: '100vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: '110px',
          boxSizing: 'border-box'
        }}
      >
        <React.Suspense fallback={<div className="app-section-loading" role="status" aria-live="polite" style={{ minHeight: '260px' }}><span className="app-section-loading-indicator" />{lang === 'es' ? 'Cargando estadísticas...' : 'Loading statistics...'}</div>}>
          <ProgressDashboard books={books} lang={lang} excludedBookIds={statsExcludedBookIds} />
        </React.Suspense>
      </div>
    );
  };

  const handleDeleteAllData = async () => {
    setDeleteAllState('confirm');
  };

  const executeDeleteAllData = async () => {
    setDeleteAllState('deleting');
    
    // Give the UI a brief moment to update and render the spinner before starting blocking operations
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    
    // Helper: delete a single DB with timeout so it never hangs forever
    const deleteDBWithTimeout = (name, timeoutMs = 4000) =>
      new Promise<void>(resolve => {
        const timer = setTimeout(resolve, timeoutMs); // safety timeout
        try {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => { clearTimeout(timer); resolve(); };
          req.onerror = () => { clearTimeout(timer); resolve(); };
          req.onblocked = () => {
            // DB is blocked — resolve anyway after a short extra wait
            clearTimeout(timer);
            setTimeout(resolve, 500);
          };
        } catch(e) {
          clearTimeout(timer);
          resolve();
        }
      });

    try {
      // 1. Close active connections first (prevents "blocked" events)
      try { await db.close(); } catch(e) {}
      try { await closeDB(); } catch(e) {}
      
      // 2. Collect all DB names to delete
      let allDbNames = ['YoruReaderStore', 'yoru_yomitan_db', 'books-db'];
      try {
        const dbs = await indexedDB.databases();
        const extraNames = dbs.map(d => d.name).filter(Boolean);
        allDbNames = [...new Set([...allDbNames, ...extraNames])];
      } catch(e) { /* indexedDB.databases() may not be supported */ }

      // 3. Delete all databases in parallel
      await Promise.all(allDbNames.map(name => deleteDBWithTimeout(name)));
      
    } catch (e) {
      console.error('Error deleting databases:', e);
    }

    // 4. Clear all localStorage
    localStorage.clear();
    
    setDeleteAllState('success');
    
    // Automatic reload after a short delay
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  const renderDeleteAllModal = () => {
    if (!deleteAllState) return null;

    const isConfirm = deleteAllState === 'confirm';
    const isDeleting = deleteAllState === 'deleting';
    const isSuccess = deleteAllState === 'success';

    return (
      <div 
        className="modal-overlay" 
        style={{ zIndex: 10000 }}
        onClick={() => {
          if (isConfirm) setDeleteAllState(null);
        }}
      >
        <div 
          className="settings-modal" 
          style={{ width: '95%', maxWidth: '440px', padding: '28px', position: 'relative' }}
          onClick={(e) => e.stopPropagation()}
        >
          {isConfirm && (
            <button 
              className="close-modal-btn" 
              onClick={() => setDeleteAllState(null)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '1.4rem' }}>
              {isConfirm && '⚠️'}
              {isDeleting && '⏳'}
              {isSuccess && '✓'}
            </span>
            <h3 className="modal-title" style={{ margin: 0, color: isConfirm ? '#ef4444' : isSuccess ? '#4ade80' : '#fff' }}>
              {isConfirm && (lang === 'es' ? 'Eliminar todos los datos' : 'Delete all data')}
              {isDeleting && (lang === 'es' ? 'Eliminando datos...' : 'Deleting data...')}
              {isSuccess && (lang === 'es' ? 'Datos eliminados con éxito' : 'Data deleted successfully')}
            </h3>
          </div>

          <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)', lineHeight: '1.6', marginBottom: '24px', textAlign: 'left' }}>
            {isConfirm && (
              <>
                <p style={{ margin: '0 0 10px 0' }}>
                  {lang === 'es' 
                    ? '¿Seguro que quieres eliminar TODOS los datos de la aplicación? Esta acción es irreversible.' 
                    : 'Are you sure you want to delete ALL application data? This action is irreversible.'}
                </p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
                  {lang === 'es' 
                    ? 'Se borrarán todos los libros, historiales, perfiles y diccionarios instalados. ¿Estás COMPLETAMENTE seguro?' 
                    : 'All books, histories, profiles, and installed dictionaries will be deleted. Are you COMPLETELY sure?'}
                </p>
              </>
            )}
            
            {isDeleting && (
              <>
                <p style={{ margin: '0 0 10px 0', textAlign: 'center' }}>
                  {lang === 'es' 
                    ? 'Esto puede tardar un momento. Por favor, no cierres la aplicación.' 
                    : 'This may take a moment. Please do not close the application.'}
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
                  <div className="yoru-delete-spinner" style={{
                    width: '36px',
                    height: '36px',
                    border: '3px solid rgba(255, 224, 0, 0.1)',
                    borderTop: '3px solid var(--primary)',
                    borderRadius: '50%',
                    animation: 'yoruDeleteSpin 0.8s linear infinite'
                  }} />
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                  {lang === 'es' ? 'Borrando IndexedDB y almacenamiento local...' : 'Wiping IndexedDB and local storage...'}
                </p>
              </>
            )}

            {isSuccess && (
              <>
                <p style={{ margin: '0 0 10px 0', textAlign: 'center' }}>
                  {lang === 'es' 
                    ? 'Todos los datos han sido eliminados de este dispositivo.' 
                    : 'All data has been wiped from this device.'}
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'rgba(74, 222, 128, 0.1)',
                    border: '2px solid #4ade80',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#4ade80',
                    fontSize: '1.4rem'
                  }}>
                    ✓
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                  {lang === 'es' ? 'Reiniciando la aplicación...' : 'Restarting application...'}
                </p>
              </>
            )}
          </div>

          {isConfirm && (
            <div className="create-profile-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                type="button" 
                className="create-profile-cancel" 
                onClick={() => setDeleteAllState(null)}
                style={{ flex: 'none', padding: '0 20px', height: '36px' }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button 
                type="button" 
                className="create-profile-save"
                onClick={executeDeleteAllData}
                style={{ 
                  flex: 'none', 
                  padding: '0 20px', 
                  height: '36px', 
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)', 
                  color: '#fff',
                  boxShadow: '0 2px 10px rgba(239, 68, 68, 0.2)'
                }}
              >
                {lang === 'es' ? 'Sí, borrar todo' : 'Yes, delete all'}
              </button>
            </div>
          )}

        </div>

        <style>{`
          @keyframes yoruDeleteSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  };

  
  const renderMasScreen = () => {
    return (
      <div className="mas-screen-container" style={{ animation: 'fadeIn 0.2s ease-out' }}>
        <h1 className="mas-screen-title">{lang === 'es' ? 'Más' : 'More'}</h1>

        {/* Update progress card if downloading or installing */}
        {updating && (
          <div className="mas-card-installing">
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: '3px solid rgba(255, 224, 0, 0.2)',
              borderTopColor: '#FFE000',
              animation: 'spin 1s linear infinite'
            }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
                {lang === 'es' ? 'Instalando actualización de Yoru' : 'Installing Yoru update'}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#a0a0b0' }}>
                {lang === 'es' ? 'Confirma el mensaje de instalación de Android.' : 'Complete any Android confirmation prompt.'}
              </span>
            </div>
          </div>
        )}

        {/* Main Settings Group 1 */}
        <div className="mas-item-group">
          {/* Yoru Account / Cloud Sync */}
          <div 
            className="mas-list-item"
            onClick={() => {
              if (gDriveTokens) {
                showToast(lang === 'es' ? 'Sincronización activa con Google Drive' : 'Cloud sync active with Google Drive', 'info');
              } else {
                setIsGDriveSyncOpen(true);
              }
            }}
          >
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <User size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {gDriveTokens ? (gDriveTokens.name || 'Google Drive') : (lang === 'es' ? 'Cuenta Yoru / Google Drive' : 'Yoru account')}
                </div>
                <div className="mas-item-subtitle">
                  {gDriveTokens ? (lang === 'es' ? 'Sincronización en la nube activa' : 'Cloud sync active') : (lang === 'es' ? 'Inicia sesión para sincronizar y guardar' : 'Sign in for cloud sync and backups')}
                </div>
              </div>
            </div>
            <ChevronRight size={18} color="#8a8a9a" />
          </div>

          {/* Solo descargados toggle */}
          <div className="mas-list-item">
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <CloudOff size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {lang === 'es' ? 'Solo descargados' : 'Downloaded only'}
                </div>
                <div className="mas-item-subtitle">
                  {lang === 'es' ? 'Filtra las novelas en tu biblioteca' : 'Filters all entries in your library'}
                </div>
              </div>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={downloadedOnly}
                onChange={(e) => setDownloadedOnly(e.target.checked)}
              />
              <span className="slider-round" />
            </label>
          </div>

          {/* Modo incognito toggle */}
          <div className="mas-list-item">
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <EyeOff size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {lang === 'es' ? 'Modo incógnito' : 'Incognito mode'}
                </div>
                <div className="mas-item-subtitle">
                  {lang === 'es' ? 'Pausa el historial de lectura' : 'Pause reading history & stats'}
                </div>
              </div>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={incognitoMode}
                onChange={(e) => setIncognitoMode(e.target.checked)}
              />
              <span className="slider-round" />
            </label>
          </div>
        </div>

        {/* Navigation Group 2 */}
        <div className="mas-item-group">
          {/* Yoru SRS */}
          <div 
            className="mas-list-item"
            onClick={() => setActiveTab('srs')}
          >
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <Zap size={20} />
              </div>
              <div>
                <div className="mas-item-title">Yoru SRS</div>
                <div className="mas-item-subtitle">
                  {lang === 'es' ? 'Repaso de tarjetas y mazos de estudio' : 'Study decks and spaced repetition'}
                </div>
              </div>
            </div>
            <ChevronRight size={18} color="#8a8a9a" />
          </div>

          {/* Diccionarios */}
          <div 
            className="mas-list-item"
            onClick={() => {
              setActiveSettingsSection('sec-dictionaries');
              setMobileSettingsSectionOpen(true);
            }}
          >
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <Search size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {lang === 'es' ? 'Diccionarios' : 'Dictionaries'}
                </div>
                <div className="mas-item-subtitle">
                  {lang === 'es' ? 'JMdict, Kanjidic, Pitch Accent y audio' : 'Manage Yomitan DB & audio'}
                </div>
              </div>
            </div>
            <ChevronRight size={18} color="#8a8a9a" />
          </div>

          {/* Ajustes de Lectura */}
          <div 
            className="mas-list-item"
            onClick={() => {
              setActiveSettingsSection('sec-general');
              setMobileSettingsSectionOpen(true);
            }}
          >
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <BookOpen size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {lang === 'es' ? 'Ajustes del Lector' : 'Reader Settings'}
                </div>
                <div className="mas-item-subtitle">
                  {lang === 'es' ? 'Temas, tipografía y visualización' : 'Themes, typography & layout'}
                </div>
              </div>
            </div>
            <ChevronRight size={18} color="#8a8a9a" />
          </div>

          {/* Información y Actualizaciones */}
          <div 
            className="mas-list-item"
            onClick={() => {
              setActiveSettingsSection('sec-updates');
              setMobileSettingsSectionOpen(true);
            }}
          >
            <div className="mas-item-left">
              <div className="mas-item-icon">
                <Info size={20} />
              </div>
              <div>
                <div className="mas-item-title">
                  {lang === 'es' ? 'Información y Actualizaciones' : 'About & Updates'}
                </div>
                <div className="mas-item-subtitle">
                  v{currentAppVersion} • {lang === 'es' ? 'Buscar nueva versión' : 'Check for updates'}
                </div>
              </div>
            </div>
            <ChevronRight size={18} color="#8a8a9a" />
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsTab = () => {
    // About / Diagnostics is a developer tool: only on Android and only for the "Zams" profile.
    const showDiagnostics = Capacitor.getPlatform() === 'android'
      && (settings.profileName || '').trim().toLowerCase() === 'zams';
    // Phones have no physical keyboard: hide the shortcuts section there.
    const showKeyboardShortcuts = !isMobile && Capacitor.getPlatform() !== 'android';
    const handleSliderChange = (val) => {
      onSaveSettings({ ...settings, fontSize: val });
    };

    const renderSliderControl = (label, value, min, max, step, formatValue, onChange) => {
      const numericVal = parseFloat(value);
      const handleDecrement = () => {
        const newVal = Math.max(min, numericVal - step);
        onChange(newVal);
      };
      const handleIncrement = () => {
        const newVal = Math.min(max, numericVal + step);
        onChange(newVal);
      };
      const percentage = ((numericVal - min) / (max - min)) * 100;
      
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '12px', boxSizing: 'border-box', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 500, color: 'var(--text-main)' }}>{label}</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{formatValue(numericVal)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', marginTop: '4px' }}>
            <button 
              onClick={handleDecrement}
              disabled={numericVal <= min}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                border: '1px solid var(--border-light)',
                background: 'transparent',
                color: 'var(--text-main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: numericVal <= min ? 'not-allowed' : 'pointer',
                opacity: numericVal <= min ? 0.3 : 1,
                fontSize: '1rem',
                fontWeight: '300',
                fontFamily: 'monospace',
                outline: 'none',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { if (numericVal > min) e.currentTarget.style.background = 'rgba(255, 224, 0, 0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              -
            </button>
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input 
                type="range"
                min={min}
                max={max}
                step={step}
                value={numericVal}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  width: '100%',
                  height: '4px',
                  background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentage}%, var(--border-light) ${percentage}%, var(--border-light) 100%)`,
                  accentColor: 'var(--primary)',
                  borderRadius: '2px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              />
            </div>
            <button 
              onClick={handleIncrement}
              disabled={numericVal >= max}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                border: '1px solid var(--border-light)',
                background: 'transparent',
                color: 'var(--text-main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: numericVal >= max ? 'not-allowed' : 'pointer',
                opacity: numericVal >= max ? 0.3 : 1,
                fontSize: '1rem',
                fontWeight: '300',
                fontFamily: 'monospace',
                outline: 'none',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { if (numericVal < max) e.currentTarget.style.background = 'rgba(255, 224, 0, 0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              +
            </button>
          </div>
        </div>
      );
    };

    const scrollToSection = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    const matchesSearch = (tagsStr) => {
      if (!settingsSearchQuery) return true;
      const terms = settingsSearchQuery.toLowerCase().split(/\s+/);
      return terms.every(term => tagsStr.toLowerCase().includes(term));
    };

    const renderSidebarBtn = (sectionId, label, IconComponent, searchKeywords) => {
      if (!matchesSearch(searchKeywords)) return null;
      const isActive = activeSettingsSection === sectionId;
      return (
        <button
          onClick={() => {
            setActiveSettingsSection(sectionId);
            setSettingsSearchQuery('');
            if (isMobile) {
              setMobileSettingsSectionOpen(true);
            } else {
              scrollToSection(sectionId);
            }
          }}
          style={{
            background: isActive ? 'rgba(255, 224, 0, 0.08)' : 'none',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            borderRadius: '6px',
            fontSize: '0.86rem',
            color: isActive ? 'var(--primary)' : 'var(--text-muted)',
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            fontWeight: isActive ? '600' : '500',
            transition: 'all 0.15s ease'
          }}
        >
          {IconComponent && <IconComponent size={15} style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />}
          <span>{label}</span>
        </button>
      );
    };

    const showSidebar = !isMobile || !mobileSettingsSectionOpen;
    const showContent = !isMobile || mobileSettingsSectionOpen;

    return (
      <div className="tab-view-container settings-view-panel yomitan-settings-layout" style={{ display: 'flex', gap: isMobile ? '0' : '24px', alignItems: 'stretch', height: '100%', width: '100%', margin: '0' }}>
        {/* Left Sidebar */}
        {showSidebar && (
          <div className="yomitan-settings-sidebar" style={{ width: isMobile ? '100%' : '250px', borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)', paddingRight: isMobile ? '0' : '20px', display: 'flex', flexDirection: 'column', gap: '20px', flexShrink: 0, overflowY: 'auto', height: '100%' }}>
            <h2 className="settings-page-heading" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', margin: '10px 0 0 0' }}>{lang === 'es' ? 'Configuración' : 'Settings'}</h2>
            
            <div className="yomitan-search-wrapper" style={{ position: 'relative', width: '100%' }}>
              <input 
                type="text" 
                placeholder={lang === 'es' ? 'Buscar...' : 'Search...'} 
                value={settingsSearchQuery}
                onChange={(e) => setSettingsSearchQuery(e.target.value)}
                style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px 12px 8px 32px', fontSize: '0.85rem', color: 'var(--text-main)', outline: 'none' }}
              />
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
              </span>
              {!isMobile && <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '2px 5px', borderRadius: '4px', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>CTRL F</span>}
            </div>
  
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              {/* General Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', fontWeight: 700, color: '#888899', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  <Settings size={13} style={{ color: 'rgba(255,255,255,0.4)' }} /> <span>{lang === 'es' ? 'General' : 'General'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '14px', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  {renderSidebarBtn('sec-general', lang === 'es' ? 'Apariencia e Idioma' : 'Appearance & Language', Palette, 'tema theme idioma lang interface language tutorial guia atajos general')}
                  {renderSidebarBtn('sec-dicts', lang === 'es' ? 'Diccionarios' : 'Dictionaries', BookOpen, 'diccionario dictionary offline jmdict frecuencia meta meta_bank zip')}
                  {showKeyboardShortcuts && renderSidebarBtn('sec-keybindings', lang === 'es' ? 'Atajos de teclado' : 'Keyboard Shortcuts', Keyboard, 'keybins keybindings atajos teclado shortcuts keys full screen pantalla completa')}
                </div>
              </div>
  
              {/* Reading Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', fontWeight: 700, color: '#888899', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  <BookOpen size={13} style={{ color: 'rgba(255,255,255,0.4)' }} /> <span>{lang === 'es' ? 'Lectura' : 'Reading'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '14px', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  {renderSidebarBtn('sec-text-style', lang === 'es' ? 'Estilo de texto' : 'Text Style', Type, 'size texto text style font voz audio speed velocidad genero furigana traduccion translation learning status display highlight oracion cursor hover highlights')}
                  {renderSidebarBtn('sec-stats', lang === 'es' ? 'Estadísticas' : 'Statistics', BarChart3, 'stats config estadisticas tracking delete books annotations enabled')}
                  {renderSidebarBtn('sec-reading-day', lang === 'es' ? 'Día de lectura' : 'Reading Day', Calendar, 'reading day dia lectura start hours limites horas nocturno')}
                </div>
              </div>

              {/* Integration Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', fontWeight: 700, color: '#888899', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  <Plug size={13} style={{ color: 'rgba(255,255,255,0.4)' }} /> <span>{lang === 'es' ? 'Integración' : 'Integration'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '14px', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  {renderSidebarBtn('sec-vocab-manage', lang === 'es' ? 'Gestión de Vocabulario y Anki' : 'Vocabulary & Anki Management', Database, 'vocabulario vocabulary import export jpdb anki file frequency')}
                  {renderSidebarBtn('sec-cloud-sync', lang === 'es' ? 'Sincronización Cloud' : 'Cloud Sync', Cloud, 'sync merge sincronizar combinar conflicto storage sync settings gdrive drive cloud cloud-sync')}
                  {!isMobile && renderSidebarBtn('sec-discord', 'Discord', MessageSquare, 'discord rpc presence enabled timer icon stats blacklist')}
                </div>
              </div>
  
              {/* Data Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', fontWeight: 700, color: '#888899', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  <Database size={13} style={{ color: 'rgba(255,255,255,0.4)' }} /> <span>{lang === 'es' ? 'Datos' : 'Data'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '14px', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  {renderSidebarBtn('sec-backup', lang === 'es' ? 'Copias de seguridad' : 'Backups', FolderOpen, 'backup import export catalogo perfil copia seguridad')}
                  {renderSidebarBtn('sec-updates', lang === 'es' ? 'Actualizaciones' : 'Updates', RefreshCw, 'updates update actualizaciones actualizar version check beta')}
                  {showDiagnostics && renderSidebarBtn('sec-about', lang === 'es' ? 'Acerca de / Diagnóstico' : 'About / Diagnostics', Info, ABOUT_SEARCH_TERMS)}
                  {renderSidebarBtn('sec-danger', lang === 'es' ? 'Zona de peligro' : 'Danger Zone', AlertTriangle, 'danger zone eliminar borrar todos datos irreversible reset clear storage')}
                </div>
              </div>
            </div>
            
            {/* Dashboard de Estado */}
            <div style={{ marginTop: '20px', padding: '14px', background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lang === 'es' ? 'Estado del Lector' : 'Reader Status'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{lang === 'es' ? 'Perfil:' : 'Profile:'}</span>
                  <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{settings.profileName || 'Zams'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{lang === 'es' ? 'Diccionarios:' : 'Dictionaries:'}</span>
                  <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{installedDicts.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{lang === 'es' ? 'Libros:' : 'Books:'}</span>
                  <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{books.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{lang === 'es' ? 'Google Drive:' : 'Google Drive:'}</span>
                  <span style={{ color: gDriveTokens ? '#34d399' : 'var(--text-muted)', fontWeight: 600 }}>
                    {gDriveTokens ? (lang === 'es' ? 'Conectado' : 'Connected') : (lang === 'es' ? 'Desconectado' : 'Disconnected')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
  
        {/* Right Content Pane */}
        {showContent && (
          <div className="yomitan-settings-pane" style={{ flex: 1, overflowY: 'auto', paddingRight: '10px', display: 'flex', flexDirection: 'column', gap: '24px', scrollBehavior: 'smooth', height: '100%', paddingBottom: '100px' }}>
            {isMobile && (
              <button 
                type="button"
                className="settings-back-btn" 
                onClick={() => setMobileSettingsSectionOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  color: '#fff',
                  padding: '8px 16px',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  marginBottom: '16px',
                  alignSelf: 'flex-start',
                  fontWeight: 600
                }}
              >
                ← {lang === 'es' ? 'Volver' : 'Back'}
              </button>
            )}
          
          {showDiagnostics && matchesSearch(ABOUT_SEARCH_TERMS) && (settingsSearchQuery || activeSettingsSection === 'sec-about') && (
            <div id="sec-about" className="settings-section-card" style={{ minWidth: 0 }}>
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={18} style={{ flexShrink: 0 }} />
                <span>{lang === 'es' ? 'Acerca de / Diagnóstico' : 'About / Diagnostics'}</span>
              </h3>
              <AppAbout lang={lang} />
            </div>
          )}

          {/* Card: General (Apariencia, Idioma y Guía) */}
          {matchesSearch('tema theme active dark light sepia idioma lang language interface interfaceLanguage tutorial guia atajos general') && (settingsSearchQuery || activeSettingsSection === 'sec-general' || activeSettingsSection === 'sec-theme' || activeSettingsSection === 'sec-language-interface') && (
            <div id="sec-general" style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
              {/* Banner: Actualizaciones del Sistema */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(124, 58, 237, 0.03) 100%)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '240px', flex: 1 }}>
                  <div style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#c084fc',
                    flexShrink: 0
                  }}>
                    <span style={{ fontSize: '1.3rem' }}>⚡</span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.96rem', color: '#fff' }}>
                      {lang === 'es' ? 'Actualizaciones del Sistema' : 'System Updates'}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#a0a0b0', marginTop: '2px' }}>
                      {lang === 'es' 
                        ? 'Comprueba e instala las últimas actualizaciones en vivo con un solo clic.' 
                        : 'Check and install the latest live updates with one click.'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('yoru-check-updates-manual'))}
                  style={{
                    padding: '10px 20px',
                    background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <RefreshCw size={15} />
                  <span>{lang === 'es' ? 'Buscar Actualizaciones' : 'Check for Updates'}</span>
                </button>
              </div>
              {/* Banner: Guía y Tutorial */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(255, 224, 0, 0.08) 0%, rgba(255, 180, 0, 0.03) 100%)',
                border: '1px solid rgba(255, 224, 0, 0.25)',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '240px', flex: 1 }}>
                  <div style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(255, 224, 0, 0.15)',
                    border: '1px solid rgba(255, 224, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFE000',
                    flexShrink: 0
                  }}>
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.96rem', color: '#fff' }}>
                      {lang === 'es' ? 'Guía Rápida y Tutorial de Yoru Reader' : 'Yoru Reader Quick Guide & Tutorial'}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#a0a0b0', marginTop: '2px' }}>
                      {lang === 'es' 
                        ? 'Vuelve a ver la guía: diccionario, lectura en voz alta, Yoru SRS y opciones de lectura.'
                        : 'See the guide again: dictionary, read aloud, Yoru SRS and reading options.'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowTutorialModal(true)}
                  style={{
                    padding: '10px 20px',
                    background: '#FFE000',
                    color: '#000',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 14px rgba(255, 224, 0, 0.3)',
                    transition: 'all 0.15s',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <Sparkles size={16} />
                  <span>{lang === 'es' ? 'Ver Tutorial' : 'View Tutorial'}</span>
                </button>
              </div>

              {/* Apariencia e Idioma Card */}
              <div className="settings-section-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Palette size={18} style={{ color: 'var(--primary)' }} />
                  <span>{lang === 'es' ? 'Apariencia e Idioma' : 'Appearance & Language'}</span>
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff', marginBottom: '4px' }}>
                      {lang === 'es' ? 'Tema del Lector' : 'Reader Theme'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#888899', marginBottom: '10px' }}>
                      {lang === 'es' ? 'Apariencia visual para el catálogo y el lector.' : 'Visual style for catalog and reading mode.'}
                    </div>
                    <select 
                      value={settings.theme || 'dark'}
                      onChange={(e) => onSaveSettings({ ...settings, theme: e.target.value })}
                      className="migaku-select"
                      style={{ width: '100%' }}
                    >
                      <option value="dark">{lang === 'es' ? 'Oscuro Yoru (por defecto)' : 'Dark Yoru (default)'}</option>
                      <option value="sepia">{lang === 'es' ? 'Sepia Relajante' : 'Warm Sepia'}</option>
                      <option value="light">{lang === 'es' ? 'Claro Clásico' : 'Classic Light'}</option>
                    </select>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff', marginBottom: '4px' }}>
                      {lang === 'es' ? 'Idioma de la Interfaz' : 'Interface Language'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#888899', marginBottom: '10px' }}>
                      {lang === 'es' ? 'Idioma general de menús y opciones.' : 'Language for menus and app settings.'}
                    </div>
                    <select 
                      value={settings.appLanguage || 'en'}
                      onChange={(e) => {
                        const selectedLang = e.target.value;
                        localStorage.setItem('app_language', selectedLang);
                        onSaveSettings({ ...settings, appLanguage: selectedLang });
                      }}
                      className="migaku-select"
                      style={{ width: '100%' }}
                    >
                      <option value="es">Español 🇪🇸</option>
                      <option value="en">English 🇺🇸</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Card: Atajos de teclado */}
          {showKeyboardShortcuts && matchesSearch('keybins keybindings atajos teclado shortcuts keys full screen pantalla completa') && (settingsSearchQuery || activeSettingsSection === 'sec-keybindings') && (
            <div id="sec-keybindings" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Keyboard size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Atajos de teclado' : 'Keyboard Shortcuts'}</span>
              </h3>
              <p className="settings-card-desc">
                {lang === 'es' 
                  ? 'Personaliza los atajos de teclado del lector. Haz clic en el botón de un atajo y presiona una tecla para cambiarlo.' 
                  : 'Customize reader keyboard shortcuts. Click a shortcut button and press a key to change it.'}
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {(() => {
                  const bindings = settings.keybindings || {
                    toggleFullscreen: 'f',
                    nextPage: 'ArrowRight',
                    prevPage: 'ArrowLeft',
                    toggleMenu: 'Escape',
                    readAloud: 't'
                  };

                  const list = [
                    { id: 'toggleFullscreen', label: lang === 'es' ? 'Pantalla completa' : 'Full screen' },
                    { id: 'nextPage', label: lang === 'es' ? 'Página siguiente' : 'Next page' },
                    { id: 'prevPage', label: lang === 'es' ? 'Página anterior' : 'Previous page' },
                    { id: 'toggleMenu', label: lang === 'es' ? 'Mostrar/Ocultar Menú' : 'Toggle Menu' },
                    { id: 'readAloud', label: lang === 'es' ? 'Leer en voz alta (TTS)' : 'Read aloud (TTS)' }
                  ];

                  return list.map(item => {
                    const isRecording = bindingKeyAction === item.id;
                    const val = bindings[item.id];
                    let displayVal = val;
                    if (val === ' ') displayVal = 'Space';
                    if (val === 'ArrowRight') displayVal = '→';
                    if (val === 'ArrowLeft') displayVal = '←';
                    if (val === 'ArrowUp') displayVal = '↑';
                    if (val === 'ArrowDown') displayVal = '↓';

                    return (
                      <div key={item.id} className="settings-row-control" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
                        <span className="settings-label-text" style={{ fontSize: '0.88rem' }}>{item.label}</span>
                        <button
                          type="button"
                          onClick={() => setBindingKeyAction(isRecording ? null : item.id)}
                          style={{
                            background: isRecording ? 'rgba(226, 192, 98, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                            border: isRecording ? '1px solid #e2c062' : '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '6px',
                            color: isRecording ? '#e2c062' : 'rgba(255, 255, 255, 0.9)',
                            padding: '6px 14px',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            minWidth: '100px',
                            textAlign: 'center',
                            fontFamily: 'monospace',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isRecording ? (lang === 'es' ? 'Presiona...' : 'Press key...') : displayVal}
                        </button>
                      </div>
                    );
                  });
                })()}

                {/* Reset button */}
                <button
                  type="button"
                  onClick={() => {
                    onSaveSettings({
                      ...settings,
                      keybindings: {
                        toggleFullscreen: 'f',
                        nextPage: 'ArrowRight',
                        prevPage: 'ArrowLeft',
                        toggleMenu: 'Escape',
                        readAloud: 't'
                      }
                    });
                    // Fallback to alert if showToast is not directly accessible here
                    alert(lang === 'es' ? 'Atajos restablecidos por defecto.' : 'Shortcuts reset to defaults.');
                  }}
                  style={{
                    marginTop: '8px',
                    alignSelf: 'flex-start',
                    background: 'transparent',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-muted)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  {lang === 'es' ? 'Restablecer valores predeterminados' : 'Reset to default values'}
                </button>
              </div>
            </div>
          )}

          {/* Card: Text Style */}
          {matchesSearch('size texto text style font voz audio speed velocidad genero viewmode writingmode margins vertical layout justify vpal indent') && (settingsSearchQuery || activeSettingsSection === 'sec-text-style') && (
            <div id="sec-text-style" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Type size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Estilo de texto y Lector' : 'Text Style & Reader'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Modifica el tamaño de la tipografía, dirección de lectura, velocidad de audio y comportamiento del lector.' : 'Modify typography size, reading direction, audio speed and reader behavior.'}</p>
              

              {/* Tema del libro (Book theme) */}
              <div className="settings-row-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span className="settings-label-text">{lang === 'es' ? 'Tema del libro' : 'Book theme'}</span>
                  <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)' }}>
                    {lang === 'es' ? 'Se aplica únicamente a la página de lectura' : 'Applies only to the book page'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '4px' }}>
                  <button 
                    onClick={() => onSaveSettings({ ...settings, theme: 'light' })}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border: settings.theme === 'light' ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                      background: '#ffffff',
                      color: '#000000',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '1rem' }}>Aa</span>
                    <span>{lang === 'es' ? 'Blanco' : 'White'}</span>
                  </button>
                  <button 
                    onClick={() => onSaveSettings({ ...settings, theme: 'sepia' })}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border: settings.theme === 'sepia' ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                      background: '#f4ecd8',
                      color: '#5b4636',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '1rem' }}>Aa</span>
                    <span>{lang === 'es' ? 'Crema' : 'Paper'}</span>
                  </button>
                  <button 
                    onClick={() => onSaveSettings({ ...settings, theme: 'dark' })}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border: settings.theme === 'dark' ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                      background: '#08080a',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '1rem' }}>Aa</span>
                    <span>{lang === 'es' ? 'Oscuro' : 'Dark'}</span>
                  </button>
                </div>
              </div>

              {/* Zoom de texto */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Zoom de texto del lector' : 'Reader text zoom'}</span>
                <select
                  value={settings.fontSize || 36}
                  onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                  className="migaku-select"
                >
                  <option value="18">75%</option>
                  <option value="22">85%</option>
                  <option value="26">90%</option>
                  <option value="30">95%</option>
                  <option value="36">100% ({lang === 'es' ? 'Por defecto' : 'Default'})</option>
                  <option value="40">110%</option>
                  <option value="44">120%</option>
                  <option value="48">130%</option>
                </select>
              </div>

              {/* Modo de visualización (View Mode) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Modo de visualización' : 'View Mode'}</span>
                <select
                  value={settings.viewMode || 'paginated'}
                  onChange={(e) => onSaveSettings({ ...settings, viewMode: e.target.value })}
                  className="migaku-select"
                >
                  <option value="paginated">{lang === 'es' ? 'Paginado' : 'Paginated'}</option>
                  <option value="continuous">{lang === 'es' ? 'Continuo' : 'Continuous'}</option>
                </select>
              </div>

              {/* Dirección de escritura (Writing Mode) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Dirección de escritura' : 'Writing Mode'}</span>
                <select
                  value={settings.writingMode || 'vertical-rl'}
                  onChange={(e) => onSaveSettings({ ...settings, writingMode: e.target.value })}
                  className="migaku-select"
                >
                  <option value="vertical-rl">{lang === 'es' ? 'Vertical (Escritura japonesa)' : 'Vertical (Japanese layout)'}</option>
                  <option value="horizontal-tb">{lang === 'es' ? 'Horizontal (Escritura occidental)' : 'Horizontal (Western layout)'}</option>
                </select>
              </div>

              {/* Interlineado (Line Height) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Interlineado' : 'Line Height'}</span>
                <select
                  value={settings.lineHeight || '1.65'}
                  onChange={(e) => onSaveSettings({ ...settings, lineHeight: e.target.value })}
                  className="migaku-select"
                >
                  <option value="1.3">1.3x</option>
                  <option value="1.5">1.5x</option>
                  <option value="1.65">1.65x ({lang === 'es' ? 'Por defecto' : 'Default'})</option>
                  <option value="1.8">1.8x</option>
                  <option value="2.0">2.0x</option>
                </select>
              </div>

              {/* Sangría de párrafo (Paragraph Indentation) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Sangría de párrafo' : 'Paragraph Indentation'}</span>
                <select
                  value={settings.textIndentation || '0'}
                  onChange={(e) => onSaveSettings({ ...settings, textIndentation: e.target.value })}
                  className="migaku-select"
                >
                  <option value="0">{lang === 'es' ? 'Sin sangría' : 'No indent'}</option>
                  <option value="1">1em</option>
                  <option value="2">2em</option>
                </select>
              </div>

              {/* Margen lateral (Margins) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Margen del lector (px)' : 'Reader margin (px)'}</span>
                <select
                  value={settings.firstDimensionMargin || '0'}
                  onChange={(e) => onSaveSettings({ ...settings, firstDimensionMargin: e.target.value })}
                  className="migaku-select"
                >
                  <option value="0">{lang === 'es' ? 'Por defecto' : 'Default'}</option>
                  <option value="10">10px</option>
                  <option value="20">20px</option>
                  <option value="30">30px</option>
                  <option value="40">40px</option>
                  <option value="50">50px</option>
                </select>
              </div>

              {/* Formato del editor (Publisher formatting) */}
              <div className="settings-row-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span className="settings-label-text">{lang === 'es' ? 'Formato del editor' : 'Publisher formatting'}</span>
                  <label className="migaku-switch">
                    <input 
                      type="checkbox" 
                      checked={settings.prioritizeReaderStyles === false}
                      onChange={(e) => onSaveSettings({ ...settings, prioritizeReaderStyles: !e.target.checked })}
                    />
                    <span className="migaku-switch-slider"></span>
                  </label>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', marginTop: '-2px' }}>
                  {lang === 'es' ? 'Conservar el diseño y la tipografía del libro original siempre que sea posible.' : 'Keep book layout and typography where possible.'}
                </span>
              </div>

              {/* Progreso del pie de página (Footer progress) */}
              <div className="settings-row-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span className="settings-label-text">{lang === 'es' ? 'Progreso en pie de página' : 'Footer progress'}</span>
                  <label className="migaku-switch">
                    <input 
                      type="checkbox" 
                      checked={settings.showFooterProgress === true}
                      onChange={(e) => onSaveSettings({ ...settings, showFooterProgress: e.target.checked })}
                    />
                    <span className="migaku-switch-slider"></span>
                  </label>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', marginTop: '-2px' }}>
                  {lang === 'es' ? 'Mostrar la delgada línea de progreso del capítulo al final de la pantalla.' : 'Show the thin chapter progress line.'}
                </span>
              </div>

              {/* Justificación de texto (enableTextJustification) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Justificar texto' : 'Justify text'}</span>
                <label className="migaku-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.enableTextJustification === true}
                    onChange={(e) => onSaveSettings({ ...settings, enableTextJustification: e.target.checked })}
                  />
                  <span className="migaku-switch-slider"></span>
                </label>
              </div>

              {/* Habilitar VPAL (enableFontVPAL) */}
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Habilitar VPAL (Métrica de fuente proporcional)' : 'Enable Font VPAL (Proportional metrics)'}</span>
                <label className="migaku-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.enableFontVPAL === true}
                    onChange={(e) => onSaveSettings({ ...settings, enableFontVPAL: e.target.checked })}
                  />
                  <span className="migaku-switch-slider"></span>
                </label>
              </div>

              
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {lang === 'es' ? 'Sesión de Lectura' : 'Reading Session'}
              </h4>

              {/* Pause when hidden checkbox card */}
              {(() => {
                const renderCheckboxCard = (title, desc, isChecked, onToggle) => (
                  <div 
                    onClick={onToggle}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      marginBottom: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <span style={{ fontSize: '0.86rem', fontWeight: 500, color: '#ffffff' }}>{title}</span>
                      {desc && <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '2px' }}>{desc}</span>}
                    </div>
                    <div style={{
                      width: '18px',
                      height: '18px',
                      border: isChecked ? 'none' : '1.5px solid rgba(255, 255, 255, 0.45)',
                      borderRadius: '4px',
                      background: isChecked ? '#5b6abf' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s',
                      flexShrink: 0
                    }}>
                      {isChecked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </div>
                );

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Pause when hidden */}
                    {renderCheckboxCard(
                      lang === 'es' ? 'Pausar al ocultar' : 'Pause when hidden',
                      lang === 'es' ? 'Pausar las sesiones de lectura activas cuando la pestaña o aplicación pasa a segundo plano.' : 'Pause active sessions when the tab or app goes to the background.',
                      settings.trackerAutoPause !== 'off',
                      () => onSaveSettings({ ...settings, trackerAutoPause: settings.trackerAutoPause !== 'off' ? 'off' : 'moderate' })
                    )}

                    {/* Pause after inactivity */}
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box', marginBottom: '10px' }}>
                      <span style={{ fontSize: '0.86rem', fontWeight: 500, color: '#ffffff' }}>
                        {lang === 'es' ? 'Pausar tras inactividad' : 'Pause after inactivity'}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '-4px' }}>
                        {lang === 'es' ? 'La falta de cambios en el contador de caracteres durante el intervalo pausará la sesión.' : 'No position changes for the selected duration pauses the session.'}
                      </span>
                      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '3px', width: '100%', border: '1px solid rgba(255,255,255,0.08)', marginTop: '4px' }}>
                        {[
                          { label: lang === 'es' ? 'Desactivado' : 'Off', value: 0 },
                          { label: '30s', value: 0.5 },
                          { label: '60s', value: 1 },
                          { label: '120s', value: 2 }
                        ].map((opt) => {
                          const isActive = settings.trackerIdleTime === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => onSaveSettings({ ...settings, trackerIdleTime: opt.value })}
                              style={{
                                flex: 1,
                                background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                                color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '8px 0',
                                fontSize: '0.82rem',
                                fontWeight: isActive ? '600' : '400',
                                cursor: 'pointer',
                                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                                transition: 'all 0.15s',
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recover on launch */}
                    {renderCheckboxCard(
                      lang === 'es' ? 'Recuperar al iniciar' : 'Recover on launch',
                      lang === 'es' ? 'Restaurar la sesión inacabada más reciente en estado pausado al siguiente inicio.' : 'Restore the most recent unfinished session in a paused state on next launch.',
                      settings.recoverOnLaunch === true,
                      () => onSaveSettings({ ...settings, recoverOnLaunch: !settings.recoverOnLaunch })
                    )}
                  </div>
                );
              })()}
            </div>
          )}



          {/* Card: Estadísticas */}
          {matchesSearch('stats config estadisticas tracking delete books annotations enabled') && (settingsSearchQuery || activeSettingsSection === 'sec-stats') && (
            <div id="sec-stats" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart3 size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Estadísticas' : 'Statistics'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Configura el almacenamiento del historial de lectura y las acciones de limpieza.' : 'Configure the storage of reading history and cleanup actions.'}</p>
              
              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Conservar estadísticas al eliminar libro' : 'Keep stats on book deletion'}</span>
                <label className="migaku-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.keepStatsOnDelete !== false}
                    onChange={(e) => onSaveSettings({ ...settings, keepStatsOnDelete: e.target.checked })}
                  />
                  <span className="migaku-switch-slider"></span>
                </label>
              </div>

              <div style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await showConfirm({
                      title: lang === 'es' ? '¿Limpiar estadísticas?' : 'Clear statistics?',
                      message: lang === 'es' ? '¿Limpiar estadísticas de libros ya eliminados?' : 'Clear stats for already deleted books?',
                      type: 'warning',
                      confirmText: lang === 'es' ? 'Limpiar' : 'Clear',
                    });
                    if (ok) {
                      await onClearDeletedBooks();
                      showToast(lang === 'es' ? 'Limpieza completada.' : 'Cleanup done.', 'success');
                    }
                  }}
                  style={{ width: '100%', padding: '8px 10px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Trash2 size={14} /> <span>{lang === 'es' ? 'Estadísticas de libros eliminados' : 'Deleted-book statistics'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Card: Día de lectura */}
          {matchesSearch('reading day dia lectura start hours limites horas nocturno') && (settingsSearchQuery || activeSettingsSection === 'sec-reading-day') && (
            <div id="sec-reading-day" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Día de lectura' : 'Reading Day'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Establece los límites horarios para el cálculo del historial de lectura diario.' : 'Sets calendar hour boundaries for daily reading history calculations.'}</p>
              
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span className="settings-label-text">{lang === 'es' ? 'Hora de inicio del día' : 'Start Day Hour'}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700 }}>
                    {String(settings.startDayHour || 0).padStart(2, '0')}:00
                  </span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="23" 
                  step="1"
                  value={settings.startDayHour || 0} 
                  onChange={(e) => onSaveSettings({ ...settings, startDayHour: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.3)', marginTop: '8px', lineHeight: 1.3 }}>
                  {lang === 'es' 
                    ? 'Ajusta a qué hora comienza un nuevo día. Útil si lees después de medianoche y deseas que se contabilice en el día anterior.' 
                    : 'Configure at what hour a new reading day starts. Useful for night readers.'}
                </p>
              </div>
            </div>
          )}

          {/* Card: Sincronización Cloud */}
          {matchesSearch('sync merge sincronizar combinar conflicto storage sync settings gdrive drive cloud cloud-sync') && (settingsSearchQuery || activeSettingsSection === 'sec-cloud-sync') && (
            <div id="sec-cloud-sync" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cloud size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Sincronización Cloud' : 'Cloud Sync'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Configura la sincronización con almacenamiento en la nube y cómo se resuelven los conflictos.' : 'Configure cloud storage synchronization and how metadata conflicts are resolved.'}</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', padding: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Destino de sincronización de almacenamiento' : 'Storage Sync Target'}</span>
                  <span style={{ color: gDriveTokens ? '#34d399' : 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
                    {gDriveTokens ? 'Google Drive' : (lang === 'es' ? 'Ninguno' : 'None')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Destino de sincronización de ajustes' : 'Settings Sync Target'}</span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                    {lang === 'es' ? 'Perfil local' : 'Local Profile'}
                  </span>
                </div>
              </div>

              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Combinación de estadísticas' : 'Statistics Merge'}</span>
                <select 
                  value={settings.statsMergeOption || 'merge'}
                  onChange={(e) => onSaveSettings({ ...settings, statsMergeOption: e.target.value })}
                  className="migaku-select"
                >
                  <option value="merge">{lang === 'es' ? 'Combinar (Merge)' : 'Merge'}</option>
                  <option value="replace">{lang === 'es' ? 'Reemplazar (Replace)' : 'Replace'}</option>
                </select>
              </div>

              <div className="settings-row-control">
                <span className="settings-label-text">{lang === 'es' ? 'Combinación de objetivos de lectura' : 'Reading Goals Merge'}</span>
                <select 
                  value={settings.goalsMergeOption || 'merge'}
                  onChange={(e) => onSaveSettings({ ...settings, goalsMergeOption: e.target.value })}
                  className="migaku-select"
                >
                  <option value="merge">{lang === 'es' ? 'Combinar (Merge)' : 'Merge'}</option>
                  <option value="replace">{lang === 'es' ? 'Reemplazar (Replace)' : 'Replace'}</option>
                </select>
              </div>

              {/* Botón e inputs de Google Drive */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                

                <button 
                  type="button"
                  onClick={handleConnectGDrive}
                  disabled={gDriveSyncStatus === 'syncing'}
                  className="reset-filter-btn"
                  style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Settings size={14} /> <span>{gDriveTokens ? (lang === 'es' ? 'Re-conectar cuenta' : 'Re-connect account') : (lang === 'es' ? 'Vincular Google Drive' : 'Link Google Drive')}</span>
                </button>

                {gDriveTokens && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        type="button"
                        onClick={handleUploadGDrive}
                        disabled={gDriveSyncStatus === 'syncing'}
                        className="reset-filter-btn"
                        style={{ flex: 1, justifyContent: 'center', background: 'rgba(52, 211, 153, 0.05)', borderColor: '#34d399', color: '#34d399', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <Upload size={14} /> <span>{lang === 'es' ? 'Subir copia completa' : 'Upload backup'}</span>
                      </button>
                      <button 
                        type="button"
                        onClick={handleDownloadGDrive}
                        disabled={gDriveSyncStatus === 'syncing'}
                        className="reset-filter-btn"
                        style={{ flex: 1, justifyContent: 'center', background: 'rgba(251, 191, 36, 0.05)', borderColor: '#fbbf24', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <Download size={14} /> <span>{lang === 'es' ? 'Descargar' : 'Download'}</span>
                      </button>
                    </div>
                    {lastSyncTime && (
                      <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                        {lang === 'es' ? 'Última sincronización:' : 'Last sync:'} {lastSyncTime}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card: Discord Rich Presence */}
          {!isMobile && matchesSearch('discord rpc presence enabled timer icon stats blacklist') && (settingsSearchQuery || activeSettingsSection === 'sec-discord') && (
            <div id="sec-discord" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Discord Rich Presence' : 'Discord Rich Presence'}</span>
              </h3>
              <p className="settings-card-desc">
                {lang === 'es' 
                  ? 'Configura la integración de presencia en Discord.' 
                  : 'Configure the Discord presence integration.'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
                {/* Enabled */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  <span>{lang === 'es' ? 'Habilitar Discord Rich Presence:' : 'Enable Discord Rich Presence:'}</span>
                  <input 
                    type="checkbox" 
                    checked={settings.discordEnabled || false}
                    onChange={(e) => onSaveSettings({ ...settings, discordEnabled: e.target.checked })}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </div>

                {/* Inactivity Timer */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {lang === 'es' ? 'Temporizador de inactividad (segundos):' : 'Inactivity Timer (seconds):'}
                  </label>
                  <input
                    type="number"
                    value={settings.discordInactivityTimer !== undefined ? settings.discordInactivityTimer : 300}
                    onChange={(e) => onSaveSettings({ ...settings, discordInactivityTimer: parseInt(e.target.value) || 0 })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                      width: '100%'
                    }}
                  />
                </div>

                {/* Icon */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {lang === 'es' ? 'Icono:' : 'Icon:'}
                  </label>
                  <select
                    value={settings.discordIcon || 'Yoru'}
                    onChange={(e) => onSaveSettings({ ...settings, discordIcon: e.target.value })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                      width: '100%',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Yoru">Yoru</option>
                    <option value="Cute">Cute</option>
                    <option value="Jacked">Jacked</option>
                    <option value="Cursed">Cursed</option>
                  </select>
                </div>

                {/* Show Stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {lang === 'es' ? 'Mostrar Estadísticas:' : 'Show Stats:'}
                  </label>
                  <select
                    value={settings.discordShowStats || 'None'}
                    onChange={(e) => onSaveSettings({ ...settings, discordShowStats: e.target.value })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                      width: '100%',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="None">{lang === 'es' ? 'Ninguna' : 'None'}</option>
                    <option value="Characters per Hour">{lang === 'es' ? 'Caracteres por hora' : 'Characters per Hour'}</option>
                    <option value="Total Characters">{lang === 'es' ? 'Caracteres totales' : 'Total Characters'}</option>
                    <option value="Cards Mined">{lang === 'es' ? 'Tarjetas creadas' : 'Cards Mined'}</option>
                    <option value="Active Reading Time">{lang === 'es' ? 'Tiempo activo de lectura' : 'Active Reading Time'}</option>
                  </select>
                </div>

                {/* Blacklisted Scenes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {lang === 'es' ? 'Novelas/Escenas en lista negra:' : 'Blacklisted Novels/Scenes:'}
                  </label>
                  <textarea
                    value={settings.discordBlacklist || ''}
                    onChange={(e) => onSaveSettings({ ...settings, discordBlacklist: e.target.value })}
                    placeholder={lang === 'es' ? 'Escribe nombres de libros a ignorar, uno por línea...' : 'Enter book names to ignore, one per line...'}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                      width: '100%',
                      height: '120px',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Card: Vocabulary Management */}
          {matchesSearch('vocabulario vocabulary import export jpdb anki file frequency') && (settingsSearchQuery || activeSettingsSection === 'sec-vocab-manage') && (
            <div id="sec-vocab-manage" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Gestión de Vocabulario' : 'Vocabulary Management'}</span>
              </h3>
              <p className="settings-card-desc">
                {lang === 'es'
                  ? 'Importa, exporta y gestiona tu base de datos de palabras conocidas y en estudio. Sincroniza desde AnkiConnect, JPDB, archivos de texto o listas de frecuencia.'
                  : 'Import, export, and manage your known and learning word database. Sync from AnkiConnect, JPDB, text files, or frequency lists.'}
              </p>
              <button 
                type="button" 
                className="reset-filter-btn"
                onClick={() => setIsVocabModalOpen(true)}
                style={{ background: 'rgba(255, 224, 0, 0.06)', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}
              >
                <Database size={15} /> {lang === 'es' ? 'Abrir Panel de Vocabulario' : 'Open Vocabulary Panel'}
              </button>
            </div>
          )}

          {/* Card: Backup */}
          {matchesSearch('backup import export catalogo perfil copia seguridad') && (settingsSearchQuery || activeSettingsSection === 'sec-backup') && (
            <div id="sec-backup" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderOpen size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Copias de seguridad' : 'Backups'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Guarda todo tu catálogo, historial de lectura, perfiles y configuraciones de Anki en un archivo local (se excluyen los diccionarios para mantener el archivo ligero).' : 'Export all your library books, reading statistics, profiles, and configurations to a local backup file.'}</p>
              
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                <button 
                  type="button" 
                  className="reset-filter-btn"
                  onClick={handleExportLibrary}
                  style={{ background: 'rgba(255, 224, 0, 0.06)', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <Download size={16} /> {lang === 'es' ? 'Exportar Biblioteca' : 'Export Library'}
                </button>
                
                <label className="reset-filter-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <Upload size={16} /> {lang === 'es' ? 'Importar Respaldo' : 'Import Backup'}
                  <input 
                    type="file" 
                    accept=".json,.zip"
                    onChange={handleImportLibrary}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Card: Dictionaries */}
          {matchesSearch('diccionario dictionary offline jmdict frecuencia meta meta_bank zip') && (settingsSearchQuery || activeSettingsSection === 'sec-dicts') && (
            <div id="sec-dicts" style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' }}>
              
              {/* Card 1: Dictionaries */}
              <div className="settings-section-card">
                <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                  <span>{lang === 'es' ? 'Diccionarios' : 'Dictionaries'}</span>
                </h3>
                <p className="settings-card-desc">
                  {lang === 'es' 
                    ? 'Los diccionarios son útiles para buscar el significado de las palabras y añadirlas a tus tarjetas de estudio. Arrastra y suelta los elementos de la siguiente lista para cambiar el orden de aparición de tus diccionarios en los resultados de búsqueda.'
                    : 'Dictionaries are useful for looking up word meanings and adding them to your study cards. Drag and drop the items in the list below to change the order in which your dictionaries appear in search results.'}
                </p>
                
                {isImportingDict && (
                  <div style={{ margin: '16px 0', background: dictImportSuccess ? 'rgba(34,197,94,0.08)' : 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: dictImportSuccess ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent', transition: 'all 0.3s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: dictImportSuccess ? '#4ade80' : 'var(--text-muted)' }}>
                      <span>{dictImportSuccess ? '✓ ' : ''}{dictImportMsg}</span>
                      <span>{dictImportProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${dictImportProgress}%`, height: '100%', background: dictImportSuccess ? '#4ade80' : 'var(--primary)', transition: 'width 0.2s, background 0.3s' }}></div>
                    </div>
                    {!dictImportSuccess && (
                      <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: '8px', textAlign: 'center', lineHeight: '1.3' }}>
                        {lang === 'es' 
                          ? '⏳ Esto puede tardar de 1 a 2 minutos para diccionarios grandes. Por favor, no cierres la aplicación.' 
                          : '⏳ This may take 1-2 minutes for large dictionaries. Please do not close the application.'}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '16px' }}>
                  {renderDictList(false)}
                </div>

                {renderActions(false)}
              </div>

              {/* Card 2: Frequencies */}
              <div className="settings-section-card">
                <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ListChecks size={18} style={{ color: 'var(--primary)' }} />
                  <span>{lang === 'es' ? 'Listas de palabras frecuentes' : 'Frequency Word Lists'}</span>
                </h3>
                <p className="settings-card-desc">
                  {lang === 'es'
                    ? 'Asignamos a las palabras puntuaciones de 1 a 5 estrellas para mostrar con qué frecuencia se utilizan en diferentes contextos.'
                    : 'We assign words 1 to 5 star ratings to show how frequently they are used in different contexts.'}
                </p>
                <div style={{ background: 'rgba(99, 102, 241, 0.05)', borderLeft: '3px solid #8b5cf6', padding: '10px 14px', borderRadius: '4px', margin: '12px 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', lineHeight: '1.4' }}>
                  <strong>{lang === 'es' ? 'Nota:' : 'Note:'}</strong> {lang === 'es' 
                    ? 'utilizamos la lista de palabras frecuentes más importante para las estadísticas de la página y para resaltar palabras en las oraciones recomendadas.'
                    : 'we use the most important frequency list for page statistics and to highlight words in recommended sentences.'}
                </div>

                {isImportingFreq && (
                  <div style={{ margin: '16px 0', background: freqImportSuccess ? 'rgba(34,197,94,0.08)' : 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: freqImportSuccess ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent', transition: 'all 0.3s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: freqImportSuccess ? '#4ade80' : 'var(--text-muted)' }}>
                      <span>{freqImportSuccess ? '✓ ' : ''}{freqImportMsg}</span>
                      <span>{freqImportProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${freqImportProgress}%`, height: '100%', background: freqImportSuccess ? '#4ade80' : 'var(--primary)', transition: 'width 0.2s, background 0.3s' }}></div>
                    </div>
                    {!freqImportSuccess && (
                      <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: '8px', textAlign: 'center', lineHeight: '1.3' }}>
                        {lang === 'es' 
                          ? '⏳ Esto puede tardar un momento. Por favor, no cierres la aplicación.' 
                          : '⏳ This may take a moment. Please do not close the application.'}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '16px' }}>
                  {renderDictList(true)}
                </div>

                {renderActions(true)}
              </div>

            </div>
          )}

          {/* Card: Actualizaciones */}
          {matchesSearch('updates update actualizaciones actualizar version check beta') && (settingsSearchQuery || activeSettingsSection === 'sec-updates') && (() => {
            const isAndroidUpdater = updaterMode === 'android';
            const latest = updaterState.latest;
            const appOutdated = Boolean(latest) && isNewerVersion(latest.appVersion, updaterState.current.appVersion);
            // When the installer is outdated, the new interface comes inside it.
            const uiOutdated = Boolean(latest?.hotVersion) && isNewerVersion(latest.hotVersion, updaterState.current.hotVersion);
            const ready = updaterState.status === 'ready';
            const canUpdate = updateAvailable && !updating;
            const versionCard = (title: string, current?: string, latestVersion?: string, outdated = false) => (
              <div style={{
                background: 'var(--bg-card)',
                border: `1px solid ${outdated ? 'rgba(16, 185, 129, 0.45)' : 'var(--border-light)'}`,
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)' }}>{title}</span>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? 'Actual: ' : 'Current: '}{current || '—'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? 'Última: ' : 'Latest: '}{latestVersion || '—'}
                  </div>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: outdated ? '#10b981' : '#3b82f6' }}>
                  {outdated
                    ? (lang === 'es' ? 'Disponible' : 'Available')
                    : latest ? (lang === 'es' ? 'Actualizado' : 'Up to date') : '—'}
                </span>
              </div>
            );
            const progressLabel = updaterState.status === 'installing'
              ? (isAndroidUpdater
                  ? (lang === 'es' ? 'Confirma la instalación en el aviso de Android.' : 'Confirm the install in the Android prompt.')
                  : (lang === 'es' ? 'Instalando y reiniciando Yoru Reader...' : 'Installing and restarting Yoru Reader...'))
              : ready
                ? (lang === 'es' ? 'Descarga completada.' : 'Download complete.')
                : updateProgress >= 0
                  ? (lang === 'es' ? 'Descargando actualización...' : 'Downloading update...')
                  : (lang === 'es' ? 'Descargando actualización (tamaño desconocido)...' : 'Downloading update (unknown size)...');
            const updateButtonLabel = updaterState.status === 'downloading'
              ? (lang === 'es' ? `Descargando (${Math.max(0, updateProgress)}%)...` : `Downloading (${Math.max(0, updateProgress)}%)...`)
              : updaterState.status === 'installing'
                ? (lang === 'es' ? 'Instalando...' : 'Installing...')
                : ready && updaterState.kind === 'ota'
                  ? (lang === 'es' ? 'Aplicar ahora' : 'Apply now')
                  : ready
                    ? (isAndroidUpdater ? (lang === 'es' ? 'Instalar' : 'Install') : (lang === 'es' ? 'Reiniciar e instalar' : 'Restart and install'))
                    : (lang === 'es' ? 'Actualizar ahora' : 'Update now');
            return (
            <div id="sec-updates" className="settings-section-card">
              <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={18} style={{ color: 'var(--primary)' }} />
                <span>{lang === 'es' ? 'Actualizaciones' : 'Updates'}</span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
                {/* Auto Update Checkbox */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  <span>{lang === 'es' ? 'Actualización automática:' : 'Automatic updates:'}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoUpdate || false}
                    onChange={(e) => onSaveSettings({ ...settings, autoUpdate: e.target.checked })}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </div>

                {/* Beta Updates Checkbox */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  <span>{lang === 'es' ? 'Actualizaciones beta:' : 'Beta updates:'}</span>
                  <input
                    type="checkbox"
                    checked={settings.betaUpdates || false}
                    onChange={(e) => onSaveSettings({ ...settings, betaUpdates: e.target.checked })}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 4px 0', lineHeight: 1.4 }}>
                  {isAndroidUpdater
                    ? (lang === 'es'
                        ? 'La nueva versión se descarga dentro de la app; Android solo te pedirá confirmar la instalación.'
                        : 'The new version downloads inside the app; Android only asks you to confirm the install.')
                    : (lang === 'es'
                        ? 'Las actualizaciones se descargan e instalan dentro de la app. Con la actualización automática se descargan en segundo plano y se instalan al cerrar Yoru Reader.'
                        : 'Updates download and install inside the app. With automatic updates on, they download in the background and install when you close Yoru Reader.')}
                </p>

                {versionCard(
                  isAndroidUpdater ? (lang === 'es' ? 'Aplicación Android' : 'Android app') : (lang === 'es' ? 'Aplicación de escritorio' : 'Desktop app'),
                  updaterState.current.appVersion,
                  latest?.appVersion,
                  appOutdated
                )}

                {!isAndroidUpdater && versionCard(
                  lang === 'es' ? 'Interfaz (actualización rápida)' : 'Interface (quick update)',
                  updaterState.current.hotVersion,
                  latest?.hotVersion,
                  uiOutdated
                )}

                {/* Progress Bar */}
                {(updating || ready) && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>{progressLabel}</span>
                      <span>{updateProgress >= 0 ? `${updateProgress}%` : ''}</span>
                    </div>
                    <div style={{
                      width: '100%',
                      height: '6px',
                      background: 'var(--border-light)',
                      borderRadius: '3px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${updateProgress >= 0 ? updateProgress : 0}%`,
                        height: '100%',
                        background: ready || updaterState.status === 'installing' ? '#10b981' : 'var(--primary)',
                        transition: 'width 0.2s ease-out'
                      }} />
                    </div>
                  </div>
                )}

                {updateErrorMessage && (
                  <div style={{ fontSize: '0.82rem', color: '#f87171', lineHeight: 1.4 }}>
                    {updateErrorMessage}
                    {updaterState.status === 'error' && (
                      <>
                        {' '}
                        <button
                          type="button"
                          onClick={() => openUpdateFallback()}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}
                        >
                          {lang === 'es' ? 'Descargar manualmente' : 'Download manually'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdates || updating}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: (checkingUpdates || updating) ? 'not-allowed' : 'pointer',
                      background: 'rgba(37, 99, 235, 0.1)',
                      border: '1px solid #2563eb',
                      color: '#3b82f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                  >
                    {checkingUpdates ? (lang === 'es' ? 'Buscando...' : 'Checking...') : (lang === 'es' ? 'Buscar actualizaciones' : 'Check for updates')}
                  </button>

                  <button
                    type="button"
                    onClick={handleUpdateNow}
                    disabled={!canUpdate}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      background: canUpdate ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-card)',
                      border: canUpdate ? '1px solid #10b981' : '1px solid var(--border-light)',
                      color: canUpdate ? '#10b981' : 'var(--text-muted)',
                      cursor: canUpdate ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                  >
                    {updateButtonLabel}
                  </button>
                </div>
              </div>
            </div>
            );
          })()}

          {/* Card: Danger Zone */}
          {matchesSearch('danger zone eliminar borrar todos datos irreversible reset clear storage') && (settingsSearchQuery || activeSettingsSection === 'sec-danger') && (
            <div id="sec-danger" className="settings-section-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.02)' }}>
              <h3 className="settings-card-title" style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} style={{ color: '#ef4444' }} />
                <span>{lang === 'es' ? 'Zona de peligro' : 'Danger Zone'}</span>
              </h3>
              <p className="settings-card-desc">{lang === 'es' ? 'Acciones destructivas e irreversibles sobre los datos almacenados en la aplicación.' : 'Irreversible destructive actions on stored application data.'}</p>
              
              <div style={{ marginTop: '16px' }}>
                <button 
                  type="button" 
                  className="reset-filter-btn"
                  onClick={handleDeleteAllData}
                  style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <AlertTriangle size={14} /> <span>{lang === 'es' ? 'Eliminar todos los datos' : 'Delete all data'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

  const handleCreateDeck = () => {
    setDeckPromptMode('create');
    setDeckPromptTargetId(null);
    setDeckPromptValue('');
    setIsDeckPromptOpen(true);
  };

  const handleDeckPromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = deckPromptValue.trim();
    if (!trimmed) return;

    if (deckPromptMode === 'create') {
      db.saveSrsCard(`_deck_${trimmed}`, {
        word: `_deck_${trimmed}`,
        source: trimmed,
        state: 0,
        dueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        due: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isPlaceholder: true
      });
      setSrsUpdateTrigger(t => t + 1);
      showToast(lang === 'es' ? `Mazo "${trimmed}" creado con éxito` : `Deck "${trimmed}" created successfully`, 'success');
    } else if (deckPromptMode === 'rename' && deckPromptTargetId) {
      const oldName = deckPromptTargetId;
      const newName = trimmed;
      if (oldName !== newName) {
        // Delete old placeholder card
        db.saveSrsCard(`_deck_${oldName}`, null);
        // Create new placeholder card
        db.saveSrsCard(`_deck_${newName}`, {
          word: `_deck_${newName}`,
          source: newName,
          state: 0,
          dueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          due: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          isPlaceholder: true
        });
        // Update all cards belonging to the old deck
        const srsData = db.getSrsData();
        Object.entries(srsData).forEach(([word, card]: [string, any]) => {
          if (card && card.source === oldName) {
            card.source = newName;
            db.saveSrsCard(word, card);
          }
        });
        setSrsUpdateTrigger(t => t + 1);
        showToast(lang === 'es' ? 'Mazo renombrado' : 'Deck renamed', 'success');
      }
    } else if (deckPromptMode === 'merge' && deckPromptTargetId) {
      const sourceName = deckPromptTargetId;
      const targetName = trimmed;
      if (sourceName !== targetName) {
        if (confirm(lang === 'es'
          ? `¿Estás seguro de que deseas fusionar todo el contenido del mazo "${sourceName}" dentro del mazo "${targetName}"? El mazo "${sourceName}" será eliminado.`
          : `Are you sure you want to merge all content from deck "${sourceName}" into deck "${targetName}"? The deck "${sourceName}" will be deleted.`
        )) {
          // Delete placeholder of source mazo
          db.saveSrsCard(`_deck_${sourceName}`, null);
          
          // Ensure target mazo has a placeholder card if not the default
          if (targetName !== 'Yoru Reader') {
            db.saveSrsCard(`_deck_${targetName}`, {
              word: `_deck_${targetName}`,
              source: targetName,
              state: 0,
              dueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              due: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              isPlaceholder: true
            });
          }

          // Move all cards from source to target
          const srsData = db.getSrsData();
          Object.entries(srsData).forEach(([word, card]: [string, any]) => {
            if (card && card.source === sourceName) {
              card.source = targetName;
              db.saveSrsCard(word, card);
            }
          });

          setSrsUpdateTrigger(t => t + 1);
          showToast(lang === 'es' ? 'Mazos fusionados con éxito' : 'Decks merged successfully', 'success');
        }
      }
    }

    setIsDeckPromptOpen(false);
  };

  const handleDeckPromptDelete = () => {
    if (deckPromptTargetId) {
      const deckName = deckPromptTargetId;
      if (confirm(lang === 'es' ? `¿Estás seguro de que deseas eliminar el mazo "${deckName}"?` : `Are you sure you want to delete the deck "${deckName}"?`)) {
        // Delete the placeholder card
        db.saveSrsCard(`_deck_${deckName}`, null);
        const srsData = db.getSrsData();
        delete srsData[`_deck_${deckName}`];
        Object.entries(srsData).forEach(([word, card]: [string, any]) => {
          if (card && card.source === deckName) {
            delete srsData[word];
          }
        });
        db.saveSrsData(srsData);
        setSrsUpdateTrigger(t => t + 1);
        showToast(lang === 'es' ? 'Mazo eliminado' : 'Deck deleted', 'info');
        setIsDeckPromptOpen(false);
      }
    }
  };

  const renderSrsTab = () => {
    const statuses = db.getWordStatuses();
    const srsData = db.getSrsData();
    const now = new Date();
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const getCardDueDate = (card: any): Date | null => {
      for (const value of [card?.due, card?.dueDate]) {
        if (!value) continue;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isFinite(date.getTime())) return date;
      }
      return null;
    };
    
    const getYearCalendarCells = (year: number) => {
      const yearCells = [];
      const jan1 = new Date(year, 0, 1);
      const startDay = jan1.getDay();
      const alignOffset = (startDay + 6) % 7;
      const startDate = new Date(year, 0, 1);
      startDate.setDate(startDate.getDate() - alignOffset);

      const tempDate = new Date(startDate);
      for (let col = 0; col < 54; col++) {
        const weekCells = [];
        for (let row = 0; row < 7; row++) {
          const ymd = localDate(tempDate);
          const cellYear = tempDate.getFullYear();
          const isActive = cellYear === year && activity.activityDays.includes(ymd);
          weekCells.push({ ymd, isActive, date: new Date(tempDate), isCurrentYear: cellYear === year });
          tempDate.setDate(tempDate.getDate() + 1);
        }
        if (weekCells.some(c => c.isCurrentYear)) {
          yearCells.push(weekCells);
        }
      }
      return yearCells;
    };

    const getYearMonthLabels = (yearCells: any[][]) => {
      const labels: { colIndex: number; label: string }[] = [];
      let lastMonth = -1;
      yearCells.forEach((week, colIndex) => {
        const firstOfMonth = week.find(cell => cell.isCurrentYear && cell.date.getDate() === 1);
        if (!firstOfMonth) return;
        const m = firstOfMonth.date.getMonth();
        if (m !== lastMonth) {
          lastMonth = m;
          const name = firstOfMonth.date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short' });
          labels.push({ colIndex, label: name.charAt(0).toUpperCase() + name.slice(1) });
        }
      });
      return labels;
    };

    // Group cards into decks by card.source
    const decks: Record<string, { 
      newCount: number; 
      learningCount: number; 
      reviewCount: number;
      totalCards: number;
      totalNew: number;
      totalLearning: number;
      totalRelearning: number;
      totalYoung: number;
      totalMature: number;
    }> = {};
    let totalDueCount = 0;
    
    const todayStr = localDate(now);
    const history = db.getSrsHistory();
    const todayHistory = history.filter((entry: any) => entry.timestamp
      && Number.isFinite(new Date(entry.timestamp).getTime())
      && localDate(new Date(entry.timestamp)) === todayStr);
    const dailyStats = db.getSrsDailyReviewStats()[todayStr];
    const newCardsStudiedToday = new Set([
      ...todayHistory.filter((entry: any) => entry.isNew && entry.word).map((entry: any) => entry.word),
      ...(Array.isArray(dailyStats?.newWords) ? dailyStats.newWords : []),
    ]);
    const reviewsFromHistory = todayHistory.filter((entry: any) => entry.reviewState !== undefined
      ? entry.reviewState === 2
      : !entry.isNew).length;
    const reviewsDoneToday = Math.max(reviewsFromHistory, Number(dailyStats?.reviews) || 0);
    const configuredNewLimit = Number(settings.srsNewCardsPerDay ?? 20);
    const newLimit = Number.isFinite(configuredNewLimit) ? Math.max(0, Math.floor(configuredNewLimit)) : 20;
    const newCardsLeftToday = Math.max(0, newLimit - newCardsStudiedToday.size);
    const configuredReviewLimit = Number(settings.srsMaxReviewsPerDay ?? 200);
    const maxReviewsLimit = Number.isFinite(configuredReviewLimit) ? Math.max(0, Math.floor(configuredReviewLimit)) : 200;
    const reviewsLeftToday = Math.max(0, maxReviewsLimit - reviewsDoneToday);
    let newCardsRemainingToday = newCardsLeftToday;
    let reviewsRemainingToday = reviewsLeftToday;

    const initDeck = (name: string) => {
      if (!decks[name]) {
        decks[name] = { 
          newCount: 0, 
          learningCount: 0, 
          reviewCount: 0,
          totalCards: 0,
          totalNew: 0,
          totalLearning: 0,
          totalRelearning: 0,
          totalYoung: 0,
          totalMature: 0
        };
      }
    };

    // 1. Register all user custom decks from _deck_ keys and card sources
    Object.entries(srsData).forEach(([word, card]: [string, any]) => {
      if (word.startsWith('_deck_')) {
        const deckName = word.substring(6).trim();
        if (deckName) initDeck(deckName);
      } else if (card && !['known', 'ignored', 'blacklisted'].includes(statuses[word])) {
        const deckName = (card.source || 'Yoru Reader').trim();
        if (deckName) initDeck(deckName);
      }
    });

    // 2. Process all cards that are in 'learning' status
    Object.entries(srsData).forEach(([word, card]: [string, any]) => {
      if (word.startsWith('_deck_')) return;
      if (card && !['known', 'ignored', 'blacklisted'].includes(statuses[word])) {
        const deckName = (card.source || 'Yoru Reader').trim();
        if (!deckName) return;
        initDeck(deckName);
        
        decks[deckName].totalCards++;
        
        const state = card.state;
        // Count totals per card state (non-due + due)
        const isNewCard = isNewSrsCard(card);
        if (isNewCard) {
          decks[deckName].totalNew++;
        } else if (state === 1) {
          decks[deckName].totalLearning++;
        } else if (state === 3) {
          decks[deckName].totalRelearning++;
        } else if (state === 2) {
          const interval = card.scheduled_days || card.scheduledDays || 0;
          if (interval >= 21) {
            decks[deckName].totalMature++;
          } else {
            decks[deckName].totalYoung++;
          }
        } else {
          decks[deckName].totalNew++;
        }

        // Count due cards
        const dueDate = getCardDueDate(card);
        const isDue = !dueDate || dueDate <= now;
        if (isDue) {
          if (isNewCard) {
            if (newCardsRemainingToday > 0) {
              decks[deckName].newCount++;
              totalDueCount++;
              newCardsRemainingToday--;
            }
          } else if (state === 1 || state === 3) {
            decks[deckName].learningCount++;
            totalDueCount++;
          } else {
            if (reviewsRemainingToday > 0) {
              totalDueCount++;
              decks[deckName].reviewCount++;
              reviewsRemainingToday--;
            }
          }
        }
      }
    });

    const deckList = Object.entries(decks).map(([name, counts]) => ({
      name,
      ...counts
    })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    let totalNewCount = 0;
    let totalLearnCount = 0;
    let totalReviewCount = 0;
    deckList.forEach(d => {
      totalNewCount += d.newCount || 0;
      totalLearnCount += d.learningCount || 0;
      totalReviewCount += d.reviewCount || 0;
    });

    // Fetch studied history activity and streak
    const activity = (() => {
      const activityDays = new Set<string>();
      let cardsStudiedToday = 0;

      const dailyReviews = db.getSrsDailyReviews();
      Object.entries(dailyReviews).forEach(([ymd, count]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !(Number(count) > 0)) return;
        const date = new Date(`${ymd}T00:00:00`);
        if (Number.isFinite(date.getTime()) && localDate(date) === ymd) activityDays.add(ymd);
      });

      const studiedToday = new Set<string>();
      Object.entries(srsData).forEach(([word, card]: [string, any]) => {
        if (!card || word.startsWith('_deck_')) return;
        const lastReview = card.last_review || card.lastReview;
        if (!lastReview) return;
        const reviewDate = new Date(lastReview);
        if (!Number.isFinite(reviewDate.getTime())) return;
        const ymd = localDate(reviewDate);
        activityDays.add(ymd);
        if (ymd === todayStr) studiedToday.add(word);
      });
      cardsStudiedToday = studiedToday.size;
      
      let streak = 0;
      const check = new Date();
      while (true) {
        const ymd = localDate(check);
        if (activityDays.has(ymd)) {
          streak++;
          check.setDate(check.getDate() - 1);
        } else {
          if (streak === 0) {
            check.setDate(check.getDate() - 1);
            if (activityDays.has(localDate(check))) {
              streak = 1;
              check.setDate(check.getDate() - 1);
              while (true) {
                if (activityDays.has(localDate(check))) {
                  streak++;
                  check.setDate(check.getDate() - 1);
                } else break;
              }
            }
          }
          break;
        }
      }
      return { cardsStudiedToday, streak, activityDays: Array.from(activityDays) };
    })();


    const renderActivityCalendar = () => (
      <div 
        style={{ 
          background: 'var(--bg-card)', 
          border: '1px solid var(--border-light)', 
          borderRadius: '16px', 
          padding: '24px', 
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05)',
          marginTop: '24px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📅</span>
            <span>{lang === 'es' ? 'Calendario de Actividad' : 'Activity Calendar'}</span>
          </h3>
          
          {/* Year Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setSrsCalendarYear(y => y - 1); }}
              style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-light)', borderRadius: '6px', color: '#fff', width: '26px', height: '26px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
            >
              &lt;
            </button>
            <span style={{ fontSize: '0.85rem', fontWeight: 850, color: '#fff', minWidth: '40px', textAlign: 'center' }}>{srsCalendarYear}</span>
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setSrsCalendarYear(y => y + 1); }}
              style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-light)', borderRadius: '6px', color: '#fff', width: '26px', height: '26px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
            >
              &gt;
            </button>
          </div>

          <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>
              {lang === 'es' ? 'Racha actual: ' : 'Current streak: '}
              <span style={{ color: '#c084fc', fontWeight: 800 }}>{activity.streak} {lang === 'es' ? 'días' : 'days'}</span>
            </span>
            <span>•</span>
            <span>
              {lang === 'es' ? 'Repasadas hoy: ' : 'Reviewed today: '}
              <span style={{ color: '#c084fc', fontWeight: 800 }}>{activity.cardsStudiedToday}</span>
            </span>
          </div>
        </div>
        
        {/* Year Heatmap Grid */}
        <div className="srs-calendar-scroll" style={{ overflowX: 'auto', padding: '10px 0 5px 0' }}>
          <div style={{ minWidth: '680px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            
            {/* Month Labels aligned to 54 columns */}
            <div style={{ display: 'flex', position: 'relative', height: '16px', marginLeft: '18px', marginBottom: '4px' }}>
              {(() => {
                const yearCells = getYearCalendarCells(srsCalendarYear);
                const monthLabels = getYearMonthLabels(yearCells);
                return monthLabels.map((lbl, idx) => (
                  <span 
                    key={idx} 
                    style={{ 
                      position: 'absolute', 
                      left: `${lbl.colIndex * 12.2}px`, 
                      fontSize: '0.62rem', 
                      color: 'var(--text-muted)', 
                      fontWeight: 800, 
                      textTransform: 'uppercase' 
                    }}
                  >
                    {lbl.label}
                  </span>
                ));
              })()}
            </div>

            {/* Calendar Grid cells */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {Array.from({ length: 7 }).map((_, rowIndex) => {
                const yearCells = getYearCalendarCells(srsCalendarYear);
                return (
                  <div key={rowIndex} style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', width: '12px', textAlign: 'right', marginRight: '6px', fontWeight: 'bold' }}>
                      {rowIndex === 0 ? 'L' : rowIndex === 2 ? 'M' : rowIndex === 4 ? 'V' : rowIndex === 6 ? 'D' : ''}
                    </span>
                    {yearCells.map((week, colIndex) => {
                      const cell = week[rowIndex];
                      if (!cell) return <div key={colIndex} style={{ width: '9px', height: '9px' }} />;
                      return (
                        <div 
                          key={colIndex} 
                          title={cell.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (cell.isActive ? ' (Activo)' : ' (Inactivo)')}
                          style={{
                            width: '9px',
                            height: '9px',
                            borderRadius: '2px',
                            background: cell.isActive ? 'rgba(168, 85, 247, 0.85)' : 'rgba(255, 255, 255, 0.03)',
                            border: cell.isActive ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid rgba(255, 255, 255, 0.02)',
                            transition: 'all 0.15s ease',
                            opacity: cell.isCurrentYear ? 1 : 0.15
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    );

    // --- Study Stats Calculations ---
    const studyTimeTodaySeconds = Number(localStorage.getItem(`yoru_reader_srs_study_time_${todayStr}`) || 0);

    const formatStudyTime = (seconds: number) => {
      if (seconds < 60) {
        return lang === 'es' ? `${seconds} segundos` : `${seconds} seconds`;
      }
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      if (secs === 0) {
        return lang === 'es' ? `${mins} minutos` : `${mins} minutes`;
      }
      return lang === 'es' 
        ? `${mins} min ${secs} seg` 
        : `${mins} min ${secs} sec`;
    };

    const avgSecondsPerCard = activity.cardsStudiedToday > 0 
      ? Math.round(studyTimeTodaySeconds / activity.cardsStudiedToday) 
      : 0;

    // --- Forecast Calculations (Next 7 days) ---
    const forecastCounts = Array(7).fill(0);
    Object.values(srsData).forEach((card: any) => {
      if (!card || card.word?.startsWith('_deck_')) return;
      if (statuses[card.word] !== 'learning') return;

      const dueTime = card.dueDate ? new Date(card.dueDate).getTime() : 0;
      if (!dueTime) return;

      const diffTime = dueTime - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 0) {
        forecastCounts[0]++;
      } else if (diffDays < 7) {
        forecastCounts[diffDays]++;
      }
    });

    const maxForecast = Math.max(...forecastCounts, 1);



    // --- Card Count Breakdown Calculations ---
    let countNew = 0;
    let countLearning = 0;
    let countRelearning = 0;
    let countYoung = 0;
    let countMature = 0;

    Object.entries(srsData).forEach(([word, card]: [string, any]) => {
      if (word.startsWith('_deck_') || !card) return;
      
      if (separateSuspended) {
        const status = statuses[word];
        if (status === 'ignored' || status === 'known' || status === 'blacklisted') return;
      }

      const state = card.state;
      if (isNewSrsCard(card)) {
        countNew++;
      } else if (state === 1) {
        countLearning++;
      } else if (state === 3) {
        countRelearning++;
      } else if (state === 2) {
        const interval = card.scheduled_days || card.scheduledDays || 0;
        if (interval >= 21) {
          countMature++;
        } else {
          countYoung++;
        }
      } else {
        countNew++;
      }
    });

    const totalSrsCardsCount = countNew + countLearning + countRelearning + countYoung + countMature;
    
    const pctNew = totalSrsCardsCount > 0 ? (countNew / totalSrsCardsCount) * 100 : 0;
    const pctLearning = totalSrsCardsCount > 0 ? (countLearning / totalSrsCardsCount) * 100 : 0;
    const pctRelearning = totalSrsCardsCount > 0 ? (countRelearning / totalSrsCardsCount) * 100 : 0;
    const pctYoung = totalSrsCardsCount > 0 ? (countYoung / totalSrsCardsCount) * 100 : 0;
    const pctMature = totalSrsCardsCount > 0 ? (countMature / totalSrsCardsCount) * 100 : 0;

    let currentPct = 0;
    const stops = [];
    
    if (pctNew > 0) {
      stops.push(`#3b82f6 ${currentPct}% ${currentPct + pctNew}%`);
      currentPct += pctNew;
    }
    if (pctLearning > 0) {
      stops.push(`#f59e0b ${currentPct}% ${currentPct + pctLearning}%`);
      currentPct += pctLearning;
    }
    if (pctRelearning > 0) {
      stops.push(`#ef4444 ${currentPct}% ${currentPct + pctRelearning}%`);
      currentPct += pctRelearning;
    }
    if (pctYoung > 0) {
      stops.push(`#86efac ${currentPct}% ${currentPct + pctYoung}%`);
      currentPct += pctYoung;
    }
    if (pctMature > 0) {
      stops.push(`#22c55e ${currentPct}% ${currentPct + pctMature}%`);
      currentPct += pctMature;
    }

    const gradientString = stops.length > 0 
      ? `conic-gradient(${stops.join(', ')})` 
      : 'rgba(255, 255, 255, 0.05)';

    return (
      <div className="tab-view-container srs-view-panel" style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem 6rem 1rem', height: 'calc(100vh - 64px)', overflowY: 'auto', boxSizing: 'border-box' }}>
        {/* Top Navigation Row */}
        <div className="srs-dashboard-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div className="srs-subtabs-container" style={{
            display: 'inline-flex',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-light)',
            borderRadius: '24px',
            padding: '4px',
            gap: '2px',
            alignItems: 'center'
          }}>
            {/* Mazos button */}
            <button
              type="button"
              onClick={() => setSrsSubTab('decks')}
              style={{
                background: srsSubTab === 'decks' ? 'rgba(255, 255, 255, 0.08)' : 'none',
                border: 'none',
                color: srsSubTab === 'decks' ? 'var(--primary)' : 'var(--text-main)',
                fontSize: '0.82rem',
                fontWeight: srsSubTab === 'decks' ? 700 : 500,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '18px',
                transition: 'all 0.15s ease'
              }}
            >
              {lang === 'es' ? 'Mazos' : 'Decks'}
            </button>

            {/* Explorar (notes) button */}
            <button
              type="button"
              onClick={() => setSrsSubTab('notes')}
              style={{
                background: srsSubTab === 'notes' ? 'rgba(255, 255, 255, 0.08)' : 'none',
                border: 'none',
                color: srsSubTab === 'notes' ? 'var(--primary)' : 'var(--text-main)',
                fontSize: '0.82rem',
                fontWeight: srsSubTab === 'notes' ? 700 : 500,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '18px',
                transition: 'all 0.15s ease'
              }}
            >
              {lang === 'es' ? 'Tarjetas' : 'Cards'}
            </button>

            {/* Estadísticas button */}
            <button
              type="button"
              onClick={() => setSrsSubTab('stats')}
              style={{
                background: srsSubTab === 'stats' ? 'rgba(255, 255, 255, 0.08)' : 'none',
                border: 'none',
                color: srsSubTab === 'stats' ? 'var(--primary)' : 'var(--text-main)',
                fontSize: '0.82rem',
                fontWeight: srsSubTab === 'stats' ? 700 : 500,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '18px',
                transition: 'all 0.15s ease'
              }}
            >
              {lang === 'es' ? 'Estadísticas' : 'Stats'}
            </button>

            {/* Historial button */}
            <button
              type="button"
              onClick={() => setSrsSubTab('history')}
              style={{
                background: srsSubTab === 'history' ? 'rgba(255, 255, 255, 0.08)' : 'none',
                border: 'none',
                color: srsSubTab === 'history' ? 'var(--primary)' : 'var(--text-main)',
                fontSize: '0.82rem',
                fontWeight: srsSubTab === 'history' ? 700 : 500,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '18px',
                transition: 'all 0.15s ease'
              }}
            >
              {lang === 'es' ? 'Historial' : 'History'}
            </button>

            {/* Ajustes button */}
            <button
              type="button"
              onClick={() => setSrsSubTab('settings')}
              style={{
                background: srsSubTab === 'settings' ? 'rgba(255, 255, 255, 0.08)' : 'none',
                border: 'none',
                color: srsSubTab === 'settings' ? 'var(--primary)' : 'var(--text-main)',
                fontSize: '0.82rem',
                fontWeight: srsSubTab === 'settings' ? 700 : 500,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '18px',
                transition: 'all 0.15s ease'
              }}
            >
              {lang === 'es' ? 'Ajustes' : 'Settings'}
            </button>
          </div>

          {/* Quick Actions */}
          <div className="srs-quick-actions" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCreateDeck}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-main)',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '20px',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)' }}
            >
              + {lang === 'es' ? 'Mazo' : 'Deck'}
            </button>

            <button
              type="button"
              onClick={() => setIsVocabModalOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-main)',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '20px',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)' }}
            >
              {lang === 'es' ? 'Sincronizar' : 'Sync'}
            </button>
          </div>
        </div>

        {srsSubTab === 'decks' && (
          <>
            {/* Header Dashboard Card */}
            <div className="vocab-dashboard-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
              <div>
                <h2 style={{ margin: '0 0 4px 0', fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {lang === 'es' ? 'Repaso de Yoru SRS' : 'Yoru SRS Reviews'}
                </h2>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {lang === 'es' ? `Tienes ${totalDueCount} tarjetas pendientes hoy` : `You have ${totalDueCount} reviews pending today`}
                </p>
              </div>
              
              {totalDueCount > 0 && (
                <button
                  type="button"
                  className="vocab-action-btn"
                  onClick={() => {
                    setSelectedDeckFilter(null);
                    setIsSrsReviewOpen(true);
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                    border: 'none',
                    color: '#ffffff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    padding: '10px 20px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 14px rgba(168, 85, 247, 0.3)'
                  }}
                >
                  <Zap size={15} fill="rgba(255,255,255,0.2)" />
                  <span>{lang === 'es' ? 'Repasar Todo' : 'Review All'}</span>
                </button>
              )}
            </div>

            {/* Deck List (Mazos) */}
            <div className="srs-deck-list" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-light)', paddingBottom: '10px' }}>
                🗂️ {lang === 'es' ? 'Mazos de Aprendizaje' : 'Learning Decks'}
              </h3>
              
              <div className="srs-deck-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
                {deckList.length === 0 ? (
                  <div className="srs-empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)', background: 'var(--bg-card-hover)', border: '1px dashed var(--border-light)', borderRadius: '12px' }}>
                    <Zap size={24} style={{ color: 'rgba(255,255,255,0.1)', marginBottom: '8px' }} />
                    <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600 }}>
                      {lang === 'es' ? 'No tienes palabras en el sistema de repaso' : 'No words in the review system'}
                    </p>
                    <p className="srs-empty-hint">
                      {isMobile
                        ? (lang === 'es' ? 'Abre un libro, toca una palabra y guárdala en un mazo para empezar.' : 'Open a book, tap a word, and save it to a deck to get started.')
                        : (lang === 'es' ? 'Abre un libro, haz clic en una palabra y guárdala en un mazo para empezar.' : 'Open a book, click a word, and save it to a deck to get started.')}
                    </p>
                  </div>
                ) : (
                  deckList.map((deck) => {
                    const isDue = deck.newCount > 0 || deck.learningCount > 0 || deck.reviewCount > 0;
                    
                    const total = deck.totalCards;
                    const mature = deck.totalMature;
                    const young = deck.totalYoung;
                    const learning = deck.totalLearning + deck.totalRelearning;
                    const newCards = deck.totalNew;
                    const known = mature + young;
                    const combined = known + learning;
                    
                    const pctMature = total > 0 ? (mature / total) * 100 : 0;
                    const pctKnown = total > 0 ? (known / total) * 100 : 0;
                    const pctCombined = total > 0 ? (combined / total) * 100 : 0;

                    return (
                      <div
                        className="srs-deck-card"
                        key={deck.name} 
                        style={{ 
                          background: 'rgba(255, 255, 255, 0.01)', 
                          border: '1px solid var(--border-light)', 
                          borderRadius: '16px',
                          padding: '16px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '12px',
                          transition: 'all 0.15s ease-in-out'
                        }}
                      >
                        {/* Top Info Row */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              <FolderOpen size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={deck.name}>
                                {deck.name}
                              </span>
                            </div>

                            {/* Due Counters Badge pills */}
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                              {deck.newCount > 0 && (
                                <span style={{ background: '#3b82f6', color: '#ffffff', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }} title={lang === 'es' ? 'Nuevas pendientes' : 'New cards due'}>
                                  {deck.newCount}
                                </span>
                              )}
                              {deck.learningCount > 0 && (
                                <span style={{ background: '#f59e0b', color: '#ffffff', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }} title={lang === 'es' ? 'En aprendizaje pendientes' : 'Learning cards due'}>
                                  {deck.learningCount}
                                </span>
                              )}
                              {deck.reviewCount > 0 && (
                                <span style={{ background: '#22c55e', color: '#ffffff', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }} title={lang === 'es' ? 'Repasos pendientes' : 'Reviews due'}>
                                  {deck.reviewCount}
                                </span>
                              )}
                              {deck.newCount === 0 && deck.learningCount === 0 && deck.reviewCount === 0 && (
                                <span style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }}>
                                  ✓
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Progress Bar & Detailed breakdown */}
                          {total > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {/* Colored Progress Bar */}
                              <div 
                                title={`${pctMature.toFixed(1)}% mature\n${pctKnown.toFixed(1)}% known (young + mature)`}
                                style={{ 
                                  position: 'relative', 
                                  width: '100%', 
                                  backgroundColor: 'rgba(255,255,255,0.02)', 
                                  borderRadius: '6px', 
                                  height: '14px', 
                                  overflow: 'hidden',
                                  border: '1px solid var(--border-light)'
                                }}
                              >
                                {/* Combined (learning + relearning + young + mature) */}
                                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: 'rgba(245, 158, 11, 0.12)', width: `${pctCombined}%`, transition: 'width 0.4s ease' }} />
                                {/* Known (young + mature) */}
                                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: 'rgba(134, 239, 172, 0.15)', width: `${pctKnown}%`, transition: 'width 0.4s ease' }} />
                                {/* Mature */}
                                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: 'rgba(34, 197, 94, 0.7)', width: `${pctMature}%`, transition: 'width 0.4s ease' }} />
                                
                                {/* Labels Overlay */}
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px', fontSize: '0.6rem', fontWeight: 800, color: '#ffffff', textShadow: '0 1px 1px rgba(0,0,0,0.7)' }}>
                                  <span>{pctMature.toFixed(0)}% {lang === 'es' ? 'maduras' : 'mature'}</span>
                                  <span>{pctKnown.toFixed(0)}% {lang === 'es' ? 'conocidas' : 'known'}</span>
                                </div>
                              </div>

                              {/* Numbers list */}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                <span>{total} {lang === 'es' ? 'totales' : 'total'}</span>
                                <span>·</span>
                                <span style={{ color: '#3b82f6' }}>{newCards} {lang === 'es' ? 'nuevas' : 'new'}</span>
                                <span>·</span>
                                <span style={{ color: '#f59e0b' }}>{learning} {lang === 'es' ? 'aprender' : 'learn'}</span>
                                <span>·</span>
                                <span style={{ color: '#86efac' }}>{young} {lang === 'es' ? 'joven' : 'young'}</span>
                                <span>·</span>
                                <span style={{ color: '#22c55e' }}>{mature} {lang === 'es' ? 'madura' : 'mature'}</span>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              {lang === 'es' ? 'Sin tarjetas en este mazo' : 'No cards in this deck'}
                            </div>
                          )}
                        </div>

                        {/* Bottom Action Controls */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '10px', marginTop: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!isDue) return; // Prevent review if completed
                              setSelectedDeckFilter(deck.name);
                              setIsSrsReviewOpen(true);
                            }}
                            disabled={deck.totalCards === 0}
                            title={deck.totalCards > 0 && !isDue ? (lang === 'es' ? 'Completado por hoy' : 'Completed for today') : undefined}
                            style={{
                              background: isDue 
                                ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' 
                                : (deck.totalCards > 0 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255,255,255,0.02)'),
                              border: isDue 
                                ? 'none' 
                                : (deck.totalCards > 0 ? '1px solid rgba(34, 197, 94, 0.3)' : 'none'),
                              color: isDue 
                                ? '#ffffff' 
                                : (deck.totalCards > 0 ? '#22c55e' : 'var(--text-muted)'),
                              borderRadius: '8px',
                              padding: '6px 14px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              cursor: (deck.totalCards > 0 && isDue) ? 'pointer' : 'not-allowed',
                              boxShadow: isDue ? '0 2px 8px rgba(168, 85, 247, 0.2)' : 'none',
                              transition: 'all 0.15s'
                            }}
                          >
                            {isDue ? (
                              <Play size={12} fill="#ffffff" />
                            ) : (
                              deck.totalCards > 0 ? <Check size={12} style={{ color: '#22c55e' }} /> : <Play size={12} />
                            )}
                            <span>
                              {isDue 
                                ? (lang === 'es' ? 'Repasar' : 'Review') 
                                : (deck.totalCards > 0 ? (lang === 'es' ? 'Completado' : 'Completed') : (lang === 'es' ? 'Repasar' : 'Review'))
                              }
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeckPromptMode('rename');
                              setDeckPromptTargetId(deck.name);
                              setDeckPromptValue(deck.name);
                              setIsDeckPromptOpen(true);
                            }}
                            style={{
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              color: 'var(--text-muted)',
                              borderRadius: '8px',
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s'
                            }}
                            title={lang === 'es' ? 'Opciones de mazo' : 'Deck options'}
                          >
                            <Settings size={12} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeckPromptMode('merge');
                              setDeckPromptTargetId(deck.name);
                              setDeckPromptValue('');
                              setIsDeckPromptOpen(true);
                            }}
                            style={{
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              color: 'var(--text-muted)',
                              borderRadius: '8px',
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s'
                            }}
                            title={lang === 'es' ? 'Fusionar con otro mazo' : 'Merge with another deck'}
                          >
                            <Layers size={12} />
                          </button>
                        </div>

                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Heatmap below decks list */}
            {renderActivityCalendar()}
          </>
        )}

        {srsSubTab === 'notes' && renderNotesTab(true)}

        {srsSubTab === 'stats' && (
          <>
            {/* 2-Column Layout: Hoy + Pronóstico */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              
              {/* Column 1: Hoy */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '180px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px' }}>
                  {lang === 'es' ? 'Hoy' : 'Today'}
                </h4>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                    {lang === 'es' ? (
                      <>
                        Estudiadas <strong style={{ color: '#a855f7', fontSize: '1rem' }}>{activity.cardsStudiedToday}</strong> tarjetas en <strong style={{ color: '#a855f7' }}>{formatStudyTime(studyTimeTodaySeconds)}</strong> hoy.
                      </>
                    ) : (
                      <>
                        Studied <strong style={{ color: '#a855f7', fontSize: '1rem' }}>{activity.cardsStudiedToday}</strong> cards in <strong style={{ color: '#a855f7' }}>{formatStudyTime(studyTimeTodaySeconds)}</strong> today.
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {lang === 'es' ? `Velocidad promedio: ${avgSecondsPerCard}s/tarjeta` : `Average speed: ${avgSecondsPerCard}s/card`}
                  </div>
                </div>
              </div>

              {/* Column 2: Pronóstico */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '180px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px' }}>
                  {lang === 'es' ? 'Pronóstico' : 'Forecast'}
                </h4>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: '110px', gap: '6px', padding: '5px 0', justifyContent: 'space-between' }}>
                    {forecastCounts.map((count, idx) => {
                      const pct = (count / maxForecast) * 80;
                      const dayLabel = idx === 0 ? (lang === 'es' ? 'Hoy' : 'Today') : idx === 1 ? (lang === 'es' ? 'Mañ' : 'Tom') : `+${idx}d`;
                      return (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%' }}>
                          <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '2px' }}>{count}</span>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%', background: 'rgba(255,255,255,0.02)', borderRadius: '3px' }}>
                            <div style={{
                              width: '100%',
                              height: `${pct}%`,
                              background: 'linear-gradient(to top, #7c3aed, #a855f7)',
                              borderRadius: '3px',
                              transition: 'height 0.3s ease'
                            }} title={`${count} reviews`} />
                          </div>
                          <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 'bold' }}>{dayLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>

            {/* Conteo de Tarjetas */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  📊 {lang === 'es' ? 'Conteo de Tarjetas' : 'Card Count'}
                </h3>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={separateSuspended}
                    onChange={(e) => setSeparateSuspended(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>{lang === 'es' ? 'Separar tarjetas suspendidas/enterradas' : 'Separate suspended/buried cards'}</span>
                </label>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', justifyContent: 'center', alignItems: 'center', padding: '20px 0' }}>
                {/* Donut Chart */}
                <div style={{
                  width: '180px',
                  height: '180px',
                  borderRadius: '50%',
                  background: gradientString,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)'
                }}>
                  <div style={{
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    background: '#16161c',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {lang === 'es' ? 'Tarjetas' : 'Cards'}
                    </span>
                    <span style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-main)' }}>
                      {totalSrsCardsCount}
                    </span>
                  </div>
                </div>

                {/* Color Legend & Stats List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{lang === 'es' ? 'Nuevas' : 'New'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{countNew} ({pctNew.toFixed(0)}%)</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f59e0b', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{lang === 'es' ? 'Aprendiendo' : 'Learning'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{countLearning} ({pctLearning.toFixed(0)}%)</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{lang === 'es' ? 'Reaprendiendo' : 'Relearning'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{countRelearning} ({pctRelearning.toFixed(0)}%)</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#86efac', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{lang === 'es' ? 'Jóvenes' : 'Young'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{countYoung} ({pctYoung.toFixed(0)}%)</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{lang === 'es' ? 'Maduras' : 'Mature'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{countMature} ({pctMature.toFixed(0)}%)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Full-width Year Calendar */}
            {renderActivityCalendar()}
          </>
        )}

        {srsSubTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {lang === 'es' ? 'Historial de Repasos' : 'Review History'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (confirm(lang === 'es' ? '¿Estás seguro de que deseas limpiar el historial de repasos?' : 'Are you sure you want to clear the review history?')) {
                    db.clearSrsHistory();
                    setSrsUpdateTrigger(t => t + 1);
                    showToast(lang === 'es' ? 'Historial limpiado' : 'History cleared', 'info');
                  }
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '5px 12px',
                  borderRadius: '16px',
                  transition: 'all 0.15s'
                }}
              >
                {lang === 'es' ? 'Limpiar Historial' : 'Clear History'}
              </button>
            </div>

            {(() => {
              const history = db.getSrsHistory();
              if (history.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontStyle: 'italic', background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px' }}>
                    {lang === 'es' ? 'Aún no hay repasos registrados en esta sesión.' : 'No reviews registered in this session yet.'}
                  </div>
                );
              }

              const getGradeBadge = (grade: number) => {
                const grades: Record<number, { text: string; bg: string; color: string }> = {
                  1: { text: lang === 'es' ? 'Otra vez' : 'Again', bg: 'rgba(239, 68, 68, 0.12)', color: '#f87171' },
                  2: { text: lang === 'es' ? 'Difícil' : 'Hard', bg: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24' },
                  3: { text: lang === 'es' ? 'Bien' : 'Good', bg: 'rgba(34, 197, 94, 0.12)', color: '#4ade80' },
                  4: { text: lang === 'es' ? 'Fácil' : 'Easy', bg: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa' }
                };
                const val = grades[grade] || { text: 'Unknown', bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' };
                return (
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, background: val.bg, color: val.color, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {val.text}
                  </span>
                );
              };

              return (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-light)', background: 'rgba(255,255,255,0.01)' }}>
                          <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'Palabra' : 'Word'}</th>
                          <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'Mazo' : 'Deck'}</th>
                          <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'Calificación' : 'Grade'}</th>
                          <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'Intervalo' : 'Interval'}</th>
                          <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'Fecha' : 'Date'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((entry: any, idx: number) => {
                          const displayWord = entry.word.includes(':') ? entry.word.split(':')[0] : entry.word;
                          const relativeTime = (() => {
                            const diff = Date.now() - new Date(entry.timestamp).getTime();
                            const mins = Math.floor(diff / 60000);
                            const hours = Math.floor(mins / 60);
                            if (mins < 1) return lang === 'es' ? 'Hace un momento' : 'Just now';
                            if (mins < 60) return lang === 'es' ? `Hace ${mins}m` : `${mins}m ago`;
                            if (hours < 24) return lang === 'es' ? `Hace ${hours}h` : `${hours}h ago`;
                            return new Date(entry.timestamp).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US');
                          })();
                          return (
                            <tr key={idx} style={{ borderBottom: idx < history.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                              <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-japanese)', fontSize: '0.95rem' }}>{displayWord}</td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 500 }}>{entry.deckName}</td>
                              <td style={{ padding: '12px 16px' }}>{getGradeBadge(entry.grade)}</td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-main)', fontWeight: 650 }}>{entry.interval}d</td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{relativeTime}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {srsSubTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {lang === 'es' ? 'Ajustes de SRS' : 'SRS Settings'}
            </h3>

            {/* Limits Section */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lang === 'es' ? 'Límites Diarios de Sesión' : 'Daily Session Limits'}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                    {lang === 'es' ? 'Tarjetas nuevas por día' : 'New cards per day'}
                  </label>
                  <input
                    type="number"
                    value={settings.srsNewCardsPerDay !== undefined ? settings.srsNewCardsPerDay : 20}
                    onChange={(e) => onSaveSettings({ ...settings, srsNewCardsPerDay: Math.max(0, Number(e.target.value) || 0) })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-light)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: '#fff',
                      fontSize: '0.9rem',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                    {lang === 'es' ? 'Máximo de repasos por día' : 'Maximum reviews per day'}
                  </label>
                  <input
                    type="number"
                    value={settings.srsMaxReviewsPerDay !== undefined ? settings.srsMaxReviewsPerDay : 200}
                    onChange={(e) => onSaveSettings({ ...settings, srsMaxReviewsPerDay: Math.max(0, Number(e.target.value) || 0) })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-light)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: '#fff',
                      fontSize: '0.9rem',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* FSRS Configuration Section */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lang === 'es' ? 'Parámetros del Algoritmo FSRS-6' : 'FSRS-6 Algorithm Parameters'}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                    {lang === 'es' ? 'Retención solicitada (FSRS)' : 'Requested retention (FSRS)'}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="range"
                      min="0.70"
                      max="0.99"
                      step="0.01"
                      value={settings.fsrsRetentionRate !== undefined ? settings.fsrsRetentionRate : 0.90}
                      onChange={(e) => onSaveSettings({ ...settings, fsrsRetentionRate: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: 'var(--primary)' }}
                    />
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', minWidth: '40px' }}>
                      {((settings.fsrsRetentionRate !== undefined ? settings.fsrsRetentionRate : 0.90) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                    {lang === 'es' ? 'Intervalo máximo (Días)' : 'Maximum interval (Days)'}
                  </label>
                  <input
                    type="number"
                    value={settings.fsrsMaxInterval !== undefined ? settings.fsrsMaxInterval : 36500}
                    onChange={(e) => onSaveSettings({ ...settings, fsrsMaxInterval: Math.max(1, Number(e.target.value) || 1) })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-light)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: '#fff',
                      fontSize: '0.9rem',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="enableFuzzCheckbox"
                  checked={settings.fsrsEnableFuzz !== false}
                  onChange={(e) => onSaveSettings({ ...settings, fsrsEnableFuzz: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <label htmlFor="enableFuzzCheckbox" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}>
                  {lang === 'es' ? 'Habilitar Fuzz (dispersión aleatoria de intervalos para evitar acumulación)' : 'Enable Fuzz (randomly disperse intervals to prevent study spikes)'}
                </label>
              </div>
            </div>

            {/* Audio Section */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lang === 'es' ? 'Preferencias de Audio' : 'Audio Preferences'}
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="autoTtsCheckbox"
                  checked={settings.autoTTS === true}
                  onChange={(e) => onSaveSettings({ ...settings, autoTTS: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <label htmlFor="autoTtsCheckbox" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}>
                  {lang === 'es' ? 'Reproducir audio automáticamente al mostrar la respuesta (Auto-TTS)' : 'Play audio automatically upon revealing the answer (Auto-TTS)'}
                </label>
              </div>
            </div>

            {/* Keyboard Shortcuts Section (desktop only: phones have no keyboard) */}
            {!isMobile && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lang === 'es' ? 'Atajos de Teclado del Repaso' : 'Review Keyboard Shortcuts'}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Mostrar Respuesta' : 'Reveal Answer'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>[Espacio] / [Enter]</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Calificar: Otra vez (Again)' : 'Grade: Again'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>1</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Calificar: Difícil (Hard)' : 'Grade: Hard'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>2</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Calificar: Bien (Good)' : 'Grade: Good'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>3</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Calificar: Fácil (Easy)' : 'Grade: Easy'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>4</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Ignorar / Ocultar' : 'Blacklist / Ignore'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>B</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span>{lang === 'es' ? 'Marcar como conocido (Máster)' : 'Mark as known (Master)'}</span>
                  <kbd style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#fff', border: '1px solid var(--border-light)' }}>M</kbd>
                </div>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderNotesTab = (isSubTab: boolean = false) => {
    const allWordStatuses = db.getWordStatuses();
    const srsData = db.getSrsData();
    const now = new Date();

    // 1. Calculate lists and stats
    const allUniqueWords = new Set([
      ...Object.keys(allWordStatuses),
      ...Object.keys(srsData).filter(w => !w.startsWith('_deck_'))
    ]);

    const wordsList = Array.from(allUniqueWords).map(word => {
      const status = allWordStatuses[word] || 'learning';
      let statusText = lang === 'es' ? 'Nuevo' : 'New';
      let statusClass = 'new';
      if (status === 'learning') {
        statusText = lang === 'es' ? 'Aprendiendo' : 'Learning';
        statusClass = 'learning';
      } else if (status === 'known') {
        statusText = lang === 'es' ? 'Conocido' : 'Known';
        statusClass = 'known';
      } else if (status === 'starred') {
        statusText = lang === 'es' ? 'Destacado' : 'Starred';
        statusClass = 'starred';
      } else if (status === 'ignored') {
        statusText = lang === 'es' ? 'Ignorado' : 'Ignored';
        statusClass = 'ignored';
      }
      return { word, status, statusText, statusClass };
    });

    const allSrsCards = Object.entries(srsData).filter(([w, c]) => !w.startsWith('_deck_') && c);
    
    // Counts
    const countAll = wordsList.length;
    const countDue = allSrsCards.filter(([w, c]: [string, any]) => {
      return c.dueDate && new Date(c.dueDate) <= now && allWordStatuses[w] === 'learning';
    }).length;
    const countLeeches = allSrsCards.filter(([w, c]: [string, any]) => c.lapses >= 4).length;
    const countLearning = allSrsCards.filter(([w, c]: [string, any]) => c.state === 1).length;
    const countReview = allSrsCards.filter(([w, c]: [string, any]) => c.state === 2).length;
    const countRelearning = allSrsCards.filter(([w, c]: [string, any]) => c.state === 3).length;
    const countMastered = allSrsCards.filter(([w, c]: [string, any]) => c.state === 2 && (c.scheduled_days >= 21 || c.interval >= 21)).length;
    const countSuspended = Object.values(allWordStatuses).filter(s => s === 'ignored').length;
    const countBlacklisted = countSuspended;

    // 2. Filter list
    const filteredWords = wordsList.filter(item => {
      const matchSearch = item.word.toLowerCase().includes(notesSearch.toLowerCase());
      if (!matchSearch) return false;

      const card = srsData[item.word];
      if (notesFilterStatus === 'all') return true;
      if (notesFilterStatus === 'due') {
        return card && card.dueDate && new Date(card.dueDate) <= now && item.status === 'learning';
      }
      if (notesFilterStatus === 'leeches') {
        return card && card.lapses >= 4;
      }
      if (notesFilterStatus === 'learning') {
        return card && card.state === 1;
      }
      if (notesFilterStatus === 'review') {
        return card && card.state === 2;
      }
      if (notesFilterStatus === 'relearning') {
        return card && card.state === 3;
      }
      if (notesFilterStatus === 'mastered') {
        return card && card.state === 2 && (card.scheduled_days >= 21 || card.interval >= 21);
      }
      if (notesFilterStatus === 'suspended') {
        return item.status === 'ignored';
      }
      if (notesFilterStatus === 'blacklisted') {
        return item.status === 'ignored';
      }
      return true;
    });

    // 3. Sort list
    const sortedWords = [...filteredWords].sort((a, b) => {
      if (notesSort === 'alphabetical') {
        return a.word.localeCompare(b.word, 'ja');
      } else if (notesSort === 'alphabetical-desc') {
        return b.word.localeCompare(a.word, 'ja');
      }
      return a.word.localeCompare(b.word, 'ja');
    });

    return (
      <div 
        className={isSubTab ? "" : "tab-view-container notes-view-panel"} 
        style={isSubTab ? { padding: '10px 0' } : { maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem 6rem 1rem', height: 'calc(100vh - 64px)', overflowY: 'auto', boxSizing: 'border-box' }}
      >
        {/* Back to Yoru SRS Link */}
        {!isSubTab && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('srs')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary)',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              ← {lang === 'es' ? 'Volver a Yoru SRS' : 'Back to Yoru SRS'}
            </button>
          </div>
        )}

        {/* Jiten Title & Count */}
        <div style={{ marginBottom: '18px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 6px 0', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            {lang === 'es' ? 'Mis Tarjetas' : 'My Cards'}
            <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>({countAll})</span>
          </h2>
        </div>

        {/* Jiten Filter Pills Row */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
          {(() => {
            const renderPill = (type: string, esLabel: string, enLabel: string, count: number, activeColor: string, textColor: string) => {
              const isActive = notesFilterStatus === type;
              const label = lang === 'es' ? esLabel : enLabel;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNotesFilterStatus(type)}
                  style={{
                    background: isActive ? activeColor : 'rgba(255, 255, 255, 0.02)',
                    border: isActive ? `1px solid ${activeColor}` : '1px solid var(--border-light)',
                    color: isActive ? '#ffffff' : textColor,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    padding: '6px 14px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.12s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                  }}
                >
                  <span>{label}</span>
                  {count > 0 && <span style={{ opacity: 0.75, fontSize: '0.7rem' }}>{count}</span>}
                </button>
              );
            };

            return (
              <>
                {renderPill('all', 'Todas', 'All', countAll, '#a855f7', '#c084fc')}
                {renderPill('due', 'Pendientes', 'Due', countDue, '#ef4444', '#f87171')}
                {renderPill('leeches', 'Leeches', 'Leeches', countLeeches, '#f97316', '#fb923c')}
                {renderPill('learning', 'Aprendiendo', 'Learning', countLearning, '#eab308', '#fde047')}
                {renderPill('review', 'Repaso', 'Review', countReview, '#22c55e', '#4ade80')}
                {renderPill('relearning', 'Reaprendizaje', 'Relearning', countRelearning, '#f43f5e', '#fb7185')}
                {renderPill('mastered', 'Graduadas', 'Mastered', countMastered, '#14b8a6', '#2dd4bf')}
                {renderPill('suspended', 'Suspendidas', 'Suspended', countSuspended, 'var(--text-muted)', 'var(--text-muted)')}
                {renderPill('blacklisted', 'Lista Negra', 'Blacklisted', countBlacklisted, 'var(--text-muted)', 'var(--text-muted)')}
              </>
            );
          })()}
        </div>

        {/* Search & Sort Controls Row */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              placeholder={lang === 'es' ? 'Buscar palabra...' : 'Search word...'}
              value={notesSearch}
              onChange={(e) => setNotesSearch(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-light)',
                borderRadius: '10px',
                padding: '10px 12px 10px 38px',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <Search size={15} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>

          <button
            type="button"
            onClick={() => {
              setNotesSort(s => s === 'alphabetical' ? 'alphabetical-desc' : 'alphabetical');
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: 'var(--text-main)',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '40px',
              boxSizing: 'border-box',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
          >
            <ArrowUpDown size={14} />
            <span>{notesSort === 'alphabetical' ? 'A-Z' : 'Z-A'}</span>
          </button>
        </div>
        
        {/* Word Grid Output */}
        {sortedWords.length === 0 ? (
          <p className="no-stats-text" style={{ padding: '40px 0', textAlign: 'center' }}>{lang === 'es' ? 'No se encontraron palabras guardadas.' : 'No saved words found.'}</p>
        ) : (
          <>
            <div className="notes-words-grid">
              {sortedWords.slice(0, visibleVocabCount).map((item, idx) => (
                <div key={idx} className="note-word-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span className="note-word-text">{item.word}</span>
                    <span className={`note-word-status-badge ${item.statusClass}`}>{item.statusText}</span>
                  </div>
                  <div className="note-word-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button 
                      type="button"
                      className="profile-delete-btn"
                      onClick={async () => {
                        const ok = await showConfirm({
                          title: lang === 'es' ? '¿Eliminar palabra?' : 'Delete word?',
                          message: lang === 'es' ? `¿Quieres eliminar "${item.word}" de tu vocabulario?` : `Do you want to delete "${item.word}" from your vocabulary?`,
                          type: 'danger',
                          confirmText: lang === 'es' ? 'Eliminar' : 'Delete',
                        });
                        if (ok) {
                          db.setWordStatus(item.word, 'unknown');
                          await showConfirm({
                            title: lang === 'es' ? 'Palabra eliminada' : 'Word deleted',
                            message: lang === 'es' ? 'Palabra eliminada con éxito. La aplicación se recargará ahora.' : 'Word deleted successfully. The application will reload now.',
                            type: 'info',
                            confirmText: lang === 'es' ? 'Entendido' : 'OK',
                            cancelText: '',
                          });
                          window.location.reload();
                        }
                      }}
                      title={lang === 'es' ? 'Eliminar de mi lista' : 'Delete from my list'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {sortedWords.length > visibleVocabCount && (
              <div ref={vocabSentinelRef} style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', margin: '20px 0' }}>
                {lang === 'es' ? 'Cargando más vocabulario...' : 'Loading more vocabulary...'}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div 
      className="library-container"
      aria-busy={isSectionPending}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* File pickers live outside the desktop-only header so Android can always open them. */}
      <input
        type="file"
        accept=".epub,.pdf,.html,.htm,.txt,.rtf,.srt,.vtt,.ass,.ssa,application/epub+zip,application/pdf,text/html,text/plain"
        multiple
        className="hidden-file-input"
        ref={fileInputRef}
        onChange={handleFileUpload}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={lang === 'es' ? 'Importar libros' : 'Import books'}
      />
      <input
        type="file"
        {...({ webkitdirectory: '', directory: '' } as any)}
        multiple
        className="hidden-file-input"
        ref={folderInputRef}
        onChange={handleFileUpload}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={lang === 'es' ? 'Importar carpeta' : 'Import folder'}
      />
      <input
        type="file"
        accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
        className="hidden-file-input"
        ref={backupInputRef}
        onChange={handleImportLibrary}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={lang === 'es' ? 'Importar copia de seguridad' : 'Import backup'}
      />

      {/* 1. Sticky Header — Yoru Cafe style */}
      {isMobile ? (
        <header className="mobile-top-app-bar">
          {activeTab === 'settings' ? (
            <button
              className="mobile-icon-btn mobile-leading-btn"
              onClick={() => setActiveTab('library')}
              title={lang === 'es' ? 'Volver' : 'Back'}
              aria-label={lang === 'es' ? 'Volver' : 'Back'}
            >
              <ArrowLeft size={22} />
            </button>
          ) : (
            <button
              className="mobile-icon-btn mobile-leading-btn"
              onClick={() => {
                // The menu lives on the library screen (ReadEra-style drawer).
                if (activeTab !== 'library') setActiveTab('library');
                setIsSidebarOpen(true);
              }}
              title={lang === 'es' ? 'Menú' : 'Menu'}
              aria-label={lang === 'es' ? 'Abrir menú' : 'Open menu'}
            >
              <Menu size={22} />
            </button>
          )}
          <h1 className="mobile-top-title">
            {activeTab === 'library' ? (lang === 'es' ? 'Novelas' : 'Novel') :
             activeTab === 'srs' ? 'Yoru SRS' :
             activeTab === 'statistics' ? (lang === 'es' ? 'Estadísticas' : 'Progress') :
             (lang === 'es' ? 'Configuración' : 'Settings')}
          </h1>
          <div className="mobile-top-actions">
            {activeTab === 'library' && (
              <>
                <button className="mobile-icon-btn" onClick={triggerFileInput} title={lang === 'es' ? 'Importar libro' : 'Import book'} aria-label={lang === 'es' ? 'Importar libro' : 'Import book'}>
                  <Plus size={24} />
                </button>
                <button
                  className="mobile-icon-btn"
                  onClick={() => setIsLibraryMenuOpen(true)}
                  title={lang === 'es' ? 'Opciones' : 'Options'}
                  aria-label={lang === 'es' ? 'Opciones de la biblioteca' : 'Library options'}
                  aria-haspopup="menu"
                  aria-expanded={isLibraryMenuOpen}
                >
                  <MoreVertical size={20} />
                </button>
              </>
            )}
            {activeTab === 'srs' && (
              <button className="mobile-icon-btn" onClick={() => setActiveTab('settings')} title="Settings">
                <Settings size={20} />
              </button>
            )}
            {activeTab === 'statistics' && (
              <button className="mobile-icon-btn" onClick={() => setIsDetailsDropdownOpen(!isDetailsDropdownOpen)} title="Options">
                <MoreVertical size={20} />
              </button>
            )}
          </div>
        </header>
      ) : (
      <header className="library-header">
        {/* Left: brand name in neon yellow like Yoru Cafe + mobile menu button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isMobile && activeTab === 'library' && (
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              type="button"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-main)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px'
              }}
            >
              <Menu size={20} />
            </button>
          )}
          {!isMobile && <span className="library-brand-name">YORU READER</span>}
        </div>

        {/* Center: Navigation Tabs */}
        <nav className="header-navigation-tabs">
          <button 
            className={`nav-tab-btn ${activeTab === 'library' ? 'active' : ''}`}
            title={lang === 'es' ? 'Biblioteca' : 'Library'}
            onClick={() => setActiveTab('library')}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <BookOpen size={15} /> <span>{t('library', lang)}</span>
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'srs' ? 'active' : ''}`}
            title="Yoru SRS"
            onClick={() => setActiveTab('srs')}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Zap size={15} /> <span>Yoru SRS</span>
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'statistics' ? 'active' : ''}`}
            title={lang === 'es' ? 'Estadísticas' : 'Statistics'}
            onClick={() => setActiveTab('statistics')}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <BarChart3 size={15} /> <span>{t('statistics', lang)}</span>
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            title={lang === 'es' ? 'Ajustes' : 'Settings'}
            onClick={() => setActiveTab('settings')}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Settings size={15} /> <span>{t('settings', lang)}</span>
          </button>
        </nav>

        {/* Right: action buttons */}
        <div className="library-header-actions">
          {/* 1. Import Dropdown */}
          <div className="header-action-dropdown-container">
            <button 
              className={`header-action-btn-text ${activeHeaderDropdown === 'import' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveHeaderDropdown(activeHeaderDropdown === 'import' ? null : 'import');
              }}
              type="button"
            >
              <Upload size={16} />
              <span>{lang === 'es' ? 'Importar' : 'Import'}</span>
              <ChevronDown size={14} />
            </button>
            {activeHeaderDropdown === 'import' && (
              <div className="header-action-dropdown-menu align-left">
                <button 
                  className="header-action-dropdown-item"
                  onClick={() => {
                    setActiveHeaderDropdown(null);
                    fileInputRef.current.click();
                  }}
                  type="button"
                >
                  <div className="header-action-dropdown-item-header">
                    <Plus size={14} style={{ color: 'var(--primary)' }} />
                    <span>{lang === 'es' ? 'Importar archivo(s)' : 'Import File(s)'}</span>
                  </div>
                  <div className="header-action-dropdown-item-desc">
                    {lang === 'es' ? 'Archivos EPUB, PDF, HTML y texto' : 'EPUB, PDF, HTML, and text files'}
                  </div>
                </button>
                <button 
                  className="header-action-dropdown-item"
                  onClick={() => {
                    setActiveHeaderDropdown(null);
                    folderInputRef.current.click();
                  }}
                  type="button"
                >
                  <div className="header-action-dropdown-item-header">
                    <FolderOpen size={14} style={{ color: 'var(--primary)' }} />
                    <span>{lang === 'es' ? 'Importar carpeta(s)' : 'Import Folder(s)'}</span>
                  </div>
                  <div className="header-action-dropdown-item-desc">
                    {lang === 'es' ? 'Todos los libros de una carpeta' : 'All supported books in a folder'}
                  </div>
                </button>
                <button 
                  className="header-action-dropdown-item"
                  onClick={() => {
                    setActiveHeaderDropdown(null);
                    backupInputRef.current.click();
                  }}
                  type="button"
                >
                  <div className="header-action-dropdown-item-header">
                    <Upload size={14} style={{ color: 'var(--primary)' }} />
                    <span>{lang === 'es' ? 'Importar copia de seguridad' : 'Import Backup'}</span>
                  </div>
                  <div className="header-action-dropdown-item-desc">
                    {lang === 'es' ? 'Restaurar desde un archivo ZIP' : 'Restore from a zipped backup'}
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* 2. Database Dropdown */}
          {/* 3. Sincronización Google Drive */}
          <button 
            className="header-display-settings-btn"
            onClick={() => setIsGDriveSyncOpen(true)}
            title={lang === 'es' ? 'Sincronizar con Google Drive' : 'Google Drive Sync'}
            type="button"
          >
            <Database size={18} />
          </button>



          {/* 4. Display Settings Cog */}
          <button 
            className={`header-display-settings-btn ${isDisplaySettingsOpen ? 'active' : ''}`}
            onClick={() => setIsDisplaySettingsOpen(!isDisplaySettingsOpen)}
            title={lang === 'es' ? 'Ajustes de visualización (Q)' : 'Display Settings (Q)'}
            type="button"
          >
            <SlidersHorizontal size={18} />
          </button>

          {/* Cool Glowing Version Badge (Top Right) */}
          <div 
            onClick={() => {
              setActiveTab('settings');
              setActiveSettingsSection('sec-general');
            }}
            title={lang === 'es' ? 'Versión Actual: v1.1.4 (Clic para ver ajustes y actualizaciones)' : 'Current Version: v1.1.4 (Click for settings & updates)'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '20px',
              background: 'rgba(255, 224, 0, 0.08)',
              border: '1px solid rgba(255, 224, 0, 0.28)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3), 0 0 12px rgba(255, 224, 0, 0.15)',
              userSelect: 'none',
              marginLeft: '4px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 224, 0, 0.16)';
              e.currentTarget.style.borderColor = 'rgba(255, 224, 0, 0.5)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 224, 0, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(255, 224, 0, 0.28)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFE000', boxShadow: '0 0 6px #FFE000' }} />
            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#FFE000', letterSpacing: '0.04em' }}>
              v{currentAppVersion}
            </span>
          </div>

          {/* Profile Selector Widget */}
          <div className="header-profile-widget" ref={profileWidgetRef}>
            <div 
              className="active-profile-trigger" 
              onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
            >
              <div className="active-profile-avatar-wrapper">
                {activeProfile?.avatar.startsWith('/') || activeProfile?.avatar.startsWith('data:') ? (
                  <img src={activeProfile.avatar} alt={activeProfile.name} className="active-profile-avatar" />
                ) : (
                  <div className="active-profile-avatar-emoji" style={{ background: activeProfile?.avatar || 'var(--yc-yellow-dim)' }}>
                    {activeProfile?.avatarEmoji || '👤'}
                  </div>
                )}
              </div>
              <span className="active-profile-name">{activeProfile?.name}</span>
            </div>

            {/* Profiles Dropdown */}
            {isProfileDropdownOpen && (
              <div className="profiles-dropdown-menu">
                <div className="dropdown-title">{lang === 'es' ? 'Perfiles' : 'Profiles'}</div>
                <div className="profiles-list">
                  {profiles.map(p => {
                    const isActive = p.id === activeProfileId;
                    return (
                      <div 
                        key={p.id} 
                        className={`profile-item-row ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          if (!isActive) {
                            onSelectProfile(p.id);
                            setIsProfileDropdownOpen(false);
                          }
                        }}
                      >
                        <div className="profile-item-avatar-wrapper">
                          {p.avatar.startsWith('/') || p.avatar.startsWith('data:') ? (
                            <img src={p.avatar} alt={p.name} className="profile-item-avatar" />
                          ) : (
                            <div className="profile-item-avatar-emoji" style={{ background: p.avatar }}>
                              {p.avatarEmoji || '👤'}
                            </div>
                          )}
                        </div>
                        <span className="profile-item-name">{p.name}</span>
                        {!isActive && profiles.length > 1 && (
                          <button 
                            className="profile-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteProfile(p.id);
                            }}
                            title={lang === 'es' ? 'Eliminar Perfil' : 'Delete Profile'}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isCreatingProfile ? (
                  <form onSubmit={handleCreateProfileSubmit} className="create-profile-form">
                    <input 
                      type="text" 
                      placeholder={lang === 'es' ? 'Nombre del perfil...' : 'Profile name...'} 
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      className="create-profile-input"
                      required
                      autoFocus
                    />
                    
                    {/* Hidden file input for custom profile avatar */}
                    <input 
                      type="file" 
                      accept="image/*"
                      ref={customAvatarInputRef}
                      onChange={handleCustomAvatarChange}
                      style={{ display: 'none' }}
                    />

                    <div className="avatar-selection-label">{lang === 'es' ? 'Foto de perfil:' : 'Profile picture:'}</div>
                    <div className="custom-avatar-uploader-container">
                      {customAvatarUrl ? (
                        <div 
                          className="custom-avatar-preview-circle"
                          onClick={() => customAvatarInputRef.current.click()}
                          title={lang === 'es' ? 'Cambiar foto de perfil' : 'Change profile picture'}
                        >
                          <img src={customAvatarUrl} alt="Preview" className="avatar-preview-image" />
                          <div className="avatar-preview-overlay">📷</div>
                        </div>
                      ) : (
                        <div 
                          className="custom-avatar-placeholder-circle"
                          onClick={() => customAvatarInputRef.current.click()}
                          title={lang === 'es' ? 'Subir foto de perfil' : 'Upload profile picture'}
                        >
                          <span className="placeholder-icon">📷</span>
                          <span className="placeholder-text">{lang === 'es' ? 'Subir foto' : 'Upload image'}</span>
                        </div>
                      )}
                    </div>
                    
                    {customAvatarUrl && (
                      <button
                        type="button"
                        className="change-custom-avatar-btn"
                        onClick={() => customAvatarInputRef.current.click()}
                      >
                        {lang === 'es' ? 'Subir otra foto' : 'Upload another image'}
                      </button>
                    )}

                    <div className="create-profile-actions">
                      <button 
                        type="button" 
                        className="create-profile-cancel" 
                        onClick={() => {
                          setIsCreatingProfile(false);
                          setCustomAvatarUrl(null);
                        }}
                      >
                        {lang === 'es' ? 'Cancelar' : 'Cancel'}
                      </button>
                      <button type="submit" className="create-profile-save">
                        {lang === 'es' ? 'Crear' : 'Create'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="profile-dropdown-footer-actions" style={{ justifyContent: 'center' }}>
                    <button
                      className="profile-dropdown-settings-btn"
                      onClick={openProfileSettings}
                      title={lang === 'es' ? 'Configuración del Perfil' : 'Profile Settings'}
                      type="button"
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                    >
                      <Settings size={14} />
                      <span>{lang === 'es' ? 'Configuración del Perfil' : 'Profile Settings'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      )}



      {/* Yomitan style Select Mode Panel */}
      {activeTab === 'library' && selectMode && (
        <div 
          className="yomitan-select-mode-panel"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '320px',
            background: 'rgba(22, 22, 28, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>{lang === 'es' ? 'Modo Selección' : 'Select Mode'}</span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
                {selectedBookIds.length} {lang === 'es' ? (selectedBookIds.length === 1 ? 'libro seleccionado' : 'libros seleccionados') : (selectedBookIds.length === 1 ? 'book selected' : 'books selected')}
              </span>
            </div>
            <button 
              onClick={() => {
                setSelectMode(false);
                setSelectedBookIds([]);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
                borderRadius: '4px',
                transition: 'all 0.15s ease'
              }}
              className="panel-close-btn"
            >
              <X size={16} />
            </button>
          </div>

          {/* Grid Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button 
              onClick={handleSelectAllVisible}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left' }}
            >
              <Check size={14} style={{ color: 'var(--primary)' }} /> {lang === 'es' ? 'Seleccionar visibles' : 'Select visible'}
            </button>

            <button 
              onClick={handleClearSelection}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left' }}
            >
              <CircleSlash size={14} style={{ color: 'rgba(255,255,255,0.5)' }} /> {lang === 'es' ? 'Limpiar' : 'Clear'}
            </button>

            <button 
              onClick={handleSetSeries}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <BookOpen size={14} style={{ color: '#60a5fa' }} /> {lang === 'es' ? 'Establecer serie' : 'Set series'}
            </button>

            <button 
              onClick={handleSetAuthor}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <User size={14} style={{ color: '#a78bfa' }} /> {lang === 'es' ? 'Establecer autor' : 'Set author'}
            </button>

            <button 
              onClick={handleAddTags}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <Tag size={14} style={{ color: '#34d399' }} /> {lang === 'es' ? 'Añadir etiquetas' : 'Add tags'}
            </button>

            <button 
              onClick={handleRemoveTags}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <Tag size={14} style={{ color: '#f87171' }} /> {lang === 'es' ? 'Quitar etiquetas' : 'Remove tags'}
            </button>

            <button 
              onClick={handleBlurCovers}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <EyeOff size={14} style={{ color: '#fbbf24' }} /> {lang === 'es' ? 'Desenfocar portadas' : 'Blur covers'}
            </button>

            <button 
              onClick={handleMarkAsUnread}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <RotateCcw size={14} style={{ color: '#38bdf8' }} /> {lang === 'es' ? 'Marcar como no leído' : 'Mark as unread'}
            </button>

            <button 
              onClick={handleExportSelection}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <Download size={14} style={{ color: '#fb7185' }} /> {lang === 'es' ? 'Exportar selección' : 'Export selection'}
            </button>

            <button 
              onClick={handleOpenStatistics}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <BarChart3 size={14} style={{ color: '#fb923c' }} /> {lang === 'es' ? 'Ver estadísticas' : 'View statistics'}
            </button>

            <button 
              onClick={handleDeleteStatistics}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <Calendar size={14} style={{ color: '#f43f5e' }} /> {lang === 'es' ? 'Borrar estadísticas' : 'Clear statistics'}
            </button>

            <button 
              onClick={handleBulkDelete}
              disabled={selectedBookIds.length === 0}
              className="select-panel-action-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', color: '#f87171', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', opacity: selectedBookIds.length === 0 ? 0.4 : 1, pointerEvents: selectedBookIds.length === 0 ? 'none' : 'auto' }}
            >
              <Trash2 size={14} /> {lang === 'es' ? 'Eliminar seleccionados' : 'Delete selected'}
            </button>
          </div>
        </div>
      )}

      {/* 2. Two-column Sidebar + Main Content Layout */}
      {activeTab === 'library' && (
        <div className="library-layout-wrapper">
          {isMobile && (
            <div 
              className={`sidebar-overlay ${isSidebarOpen ? 'active' : ''}`}
              onClick={() => setIsSidebarOpen(false)}
            />
          )}
          <aside 
            className={`library-sidebar ${isSidebarOpen ? 'open' : ''}`}
            onClick={(e) => {
              if (isMobile && (e.target as HTMLElement).closest('.sidebar-item')) {
                setIsSidebarOpen(false);
              }
            }}
          >
              {/* Search Input */}
              <div className="sidebar-search-container">
                <input
                  type="text"
                  placeholder={lang === 'es' ? "Buscar por título o autor..." : "Search by title or author..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="sidebar-search-input"
                />
              </div>

              {/* Library Section */}
              <div className="sidebar-group">
                <div className="sidebar-group-title">{lang === 'es' ? 'Biblioteca' : 'Library'}</div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'all', value: null })}
                >
                  <span className="sidebar-item-label"><BookOpen size={17} />{lang === 'es' ? 'Todos los libros' : 'All books'}</span>
                  <span className="sidebar-item-count">{books.length}</span>
                </div>
                 <div 
                  className={`sidebar-item ${activeFilter.type === 'unread' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'unread', value: null })}
                >
                  <span className="sidebar-item-label"><Clock size={17} />{lang === 'es' ? 'Por leer' : 'To read'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'unread' || (!b.status && b.progress.percent === 0)).length}
                  </span>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'reading' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'reading', value: null })}
                >
                  <span className="sidebar-item-label"><Repeat size={17} />{lang === 'es' ? 'Leyendo ahora' : 'Reading now'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'reading' || (!b.status && b.progress.percent > 0 && b.progress.percent < 100)).length}
                  </span>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'completed' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'completed', value: null })}
                >
                  <span className="sidebar-item-label"><CheckCheck size={17} />{lang === 'es' ? 'Leídos' : 'Have read'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'completed' || (!b.status && b.progress.percent >= 100)).length}
                  </span>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'paused' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'paused', value: null })}
                >
                  <span className="sidebar-item-label"><Pause size={17} />{lang === 'es' ? 'Pausados' : 'Paused'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'paused').length}
                  </span>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'dropped' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'dropped', value: null })}
                >
                  <span className="sidebar-item-label"><CircleSlash size={17} />{lang === 'es' ? 'Dropeados' : 'Dropped'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'dropped').length}
                  </span>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'planning' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'planning', value: null })}
                >
                  <span className="sidebar-item-label"><Calendar size={17} />{lang === 'es' ? 'Planeados' : 'Planned'}</span>
                  <span className="sidebar-item-count">
                    {books.filter(b => b.status === 'planning').length}
                  </span>
                </div>
              </div>

              {/* Authors Section */}
              {uniqueAuthors.length > 0 && (
                <div className="sidebar-group">
                  <div className="sidebar-group-title">{lang === 'es' ? 'Autores' : 'Authors'}</div>
                  {uniqueAuthors.map(author => (
                    <div 
                      key={author}
                      className={`sidebar-item ${activeFilter.type === 'author' && activeFilter.value === author ? 'active' : ''}`}
                      onClick={() => setActiveFilter({ type: 'author', value: author })}
                    >
                      <span className="truncate">{author}</span>
                      <span className="sidebar-item-count">{authorCounts[author]}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tags Section */}
              <div className="sidebar-group">
                <div className="sidebar-group-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{lang === 'es' ? 'Colecciones' : 'Collections'}</span>
                  <button
                    title={lang === 'es' ? "Nueva colección" : "New collection"}
                    onClick={async () => {
                      const tag = prompt(lang === 'es' ? 'Nueva colección:' : 'New collection:');
                      if (!tag || !tag.trim()) return;
                      const tagTrim = tag.trim();
                      if (selectedBookIds.length > 0) {
                        for (const bookId of selectedBookIds) {
                          const b = books.find(bk => bk.id === bookId);
                          if (b) {
                            const tags = b.tags ? [...b.tags] : [];
                            if (!tags.includes(tagTrim)) {
                              tags.push(tagTrim);
                              await onUpdateBookDetails(bookId, { tags });
                            }
                          }
                        }
                      } else {
                        const allBookIds = filteredBooksList.map(b => b.id);
                        const targetIds = allBookIds.length > 0 ? [allBookIds[0]] : [];
                        if (targetIds.length === 0) {
                          alert(lang === 'es' ? 'Selecciona primero algunos libros con el Modo Selección para asignarles la etiqueta.' : 'First select some books using Select Mode to assign them this tag.');
                          return;
                        }
                        alert(lang === 'es' ? 'Usa el Modo Selección para asignar etiquetas a libros específicos.' : 'Use Select Mode to assign tags to specific books.');
                      }
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '50%',
                      width: '18px',
                      height: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: '0.75rem',
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0
                    }}
                  >
                    +
                  </button>
                </div>
                <div 
                  className={`sidebar-item ${activeFilter.type === 'tag' && activeFilter.value === 'untagged' ? 'active' : ''}`}
                  onClick={() => setActiveFilter({ type: 'tag', value: 'untagged' })}
                >
                  <span className="sidebar-item-label"><LibraryIcon size={17} />{lang === 'es' ? 'Sin colección' : 'No collection'}</span>
                  <span className="sidebar-item-count">{books.filter(b => !b.tags || b.tags.length === 0).length}</span>
                </div>
                {(() => {
                  const tagCounts = {};
                  books.forEach(b => {
                    if (b.tags && b.tags.length > 0) {
                      b.tags.forEach(t => {
                        tagCounts[t] = (tagCounts[t] || 0) + 1;
                      });
                    }
                  });
                  return Object.keys(tagCounts).sort().map(tag => (
                    <div
                      key={tag}
                      className={`sidebar-item ${activeFilter.type === 'tag' && activeFilter.value === tag ? 'active' : ''}`}
                      onClick={() => setActiveFilter({ type: 'tag', value: tag })}
                    >
                      <span className="truncate"># {tag}</span>
                      <span className="sidebar-item-count">{tagCounts[tag]}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Footer: account and app settings (Settings left the bottom bar) */}
              <div className="sidebar-group sidebar-footer-group">
                <div
                  className="sidebar-item"
                  onClick={() => {
                    if (gDriveTokens) {
                      showToast(lang === 'es' ? 'Sincronizado con Google Drive' : 'Synced with Google Drive', 'info');
                    } else {
                      setIsGDriveSyncOpen(true);
                    }
                  }}
                >
                  <span className="sidebar-item-label">
                    <Cloud size={17} color={gDriveTokens ? '#4ade80' : undefined} />
                    Google Drive
                  </span>
                  <span className="sidebar-item-count">{gDriveTokens ? (lang === 'es' ? 'Conectado' : 'Connected') : ''}</span>
                </div>
                <div
                  className="sidebar-item"
                  onClick={() => {
                    setIsSidebarOpen(false);
                    setActiveTab('settings');
                  }}
                >
                  <span className="sidebar-item-label">
                    <Settings size={17} />
                    {lang === 'es' ? 'Ajustes' : 'Settings'}
                  </span>
                </div>
              </div>
            </aside>

          <main className="library-main-content">
            {showUpdateBanner && (
              <div style={{
                background: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid rgba(37, 99, 235, 0.3)',
                borderRadius: '12px',
                padding: '14px 18px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                animation: 'fadeIn 0.3s ease-out'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <RefreshCw size={20} className="animate-spin" style={{ color: '#3b82f6', animationDuration: '4s', flexShrink: 0 }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {updaterState.kind === 'ota'
                        ? (lang === 'es' ? '¡Actualización rápida de Yoru disponible!' : 'Yoru quick update available!')
                        : (lang === 'es' ? '¡Nueva versión de Yoru Reader disponible!' : 'New Yoru Reader version available!')}
                    </h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      {lang === 'es'
                        ? `La versión v${updaterState.kind === 'ota' ? updaterState.latest?.hotVersion : latestAppVersion} se descarga e instala desde aquí, sin salir de la app.`
                        : `Version v${updaterState.kind === 'ota' ? updaterState.latest?.hotVersion : latestAppVersion} downloads and installs from here, without leaving the app.`}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleUpdateNow}
                    disabled={updating}
                    style={{
                      background: '#10b981',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: updating ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {updaterState.status === 'downloading' ? (
                      <span>{lang === 'es' ? `Descargando (${Math.max(0, updateProgress)}%)...` : `Downloading (${Math.max(0, updateProgress)}%)...`}</span>
                    ) : updaterState.status === 'installing' ? (
                      <span>{lang === 'es' ? 'Instalando...' : 'Installing...'}</span>
                    ) : updaterState.status === 'ready' ? (
                      <span>{updaterState.kind === 'ota' ? (lang === 'es' ? 'Aplicar ahora' : 'Apply now') : updaterMode === 'android' ? (lang === 'es' ? 'Instalar' : 'Install') : (lang === 'es' ? 'Reiniciar e instalar' : 'Restart and install')}</span>
                    ) : (
                      <span>{lang === 'es' ? '⚡ Actualizar ahora' : '⚡ Update now'}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('settings');
                      setActiveSettingsSection('sec-updates');
                    }}
                    style={{
                      background: 'rgba(37, 99, 235, 0.2)',
                      border: '1px solid #2563eb',
                      color: '#3b82f6',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {lang === 'es' ? 'Ver detalles' : 'View details'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUpdateBanner(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={lang === 'es' ? 'Cerrar' : 'Close'}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}
            {books.length === 0 ? (
              <div className="library-empty-hero">
                {/* Left: decorative book cover stack */}
                <div className="empty-hero-covers">
                  <div className="empty-cover-card empty-cover-card--back" />
                  <div className="empty-cover-card empty-cover-card--mid" />
                  <div className="empty-cover-card empty-cover-card--front">
                    <span className="empty-cover-icon">📖</span>
                  </div>
                </div>

                {/* Right: info + actions */}
                <div className="empty-hero-right">
                  <div className="empty-info-panel">
                    <p><strong>{lang === 'es' ? 'Formatos compatibles:' : 'Supported formats:'}</strong><br />epub, pdf, html, txt, rtf, {lang === 'es' ? 'subtítulos' : 'subtitles'}</p>
                    <p><strong>{lang === 'es' ? 'Formatos de subtítulos:' : 'Subtitle formats:'}</strong><br />srt, vtt, ass, ssa</p>
                  </div>

                  <div className="empty-hero-actions">
                    <button className="empty-add-btn" onClick={triggerFileInput}>
                      <span style={{ marginRight: '8px' }}>📄</span>
                      {lang === 'es' ? 'Añadir desde archivo' : 'Add from file'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <LibraryQuickBar
                  books={books}
                  activeFilter={activeFilter}
                  onFilter={(filter) => setActiveFilter(filter as any)}
                  view={libraryView}
                  onViewChange={changeLibraryView}
                  lang={lang}
                />
                {filteredBooksList.length === 0 ? (
                  <div className="library-no-results">
                    <p>{lang === 'es' ? 'No se encontraron libros para esta categoría o búsqueda.' : 'No books found for this category or search.'}</p>
                    <button 
                      className="reset-filter-btn"
                      onClick={() => {
                        setActiveFilter({ type: 'all', value: null });
                        setSearchQuery('');
                      }}
                    >
                      {lang === 'es' ? 'Restablecer filtros' : 'Reset filters'}
                    </button>
                  </div>
                ) : (
                  <>
                    {groupBy === 'author' ? (
                      renderGroupedByAuthor()
                    ) : groupBy === 'series' ? (
                      renderGroupedBySeries()
                    ) : sortBy === 'added' && activeFilter.type === 'all' ? (
                      <>
                        {/* Leyendo Actualmente */}
                        {currentlyReading.length > 0 && (
                          <div className="library-section">
                            <div className="section-header">
                              <h2 className="section-title">{lang === 'es' ? 'Leyendo actualmente' : 'Currently reading'}</h2>
                              <span className="section-count">{currentlyReading.length}</span>
                            </div>
                            {renderBookGrid(currentlyReading)}
                          </div>
                        )}

                        {/* Sin Iniciar */}
                        {notStarted.length > 0 && (
                          <div className="library-section">
                            <div className="section-header">
                              <h2 className="section-title">{lang === 'es' ? 'Sin iniciar' : 'Not started'}</h2>
                              <span className="section-count">{notStarted.length}</span>
                            </div>
                            {renderBookGrid(notStarted)}
                          </div>
                        )}

                        {/* Leídos */}
                        {completed.length > 0 && (
                          <div className="library-section">
                            <div className="section-header">
                              <h2 className="section-title">{lang === 'es' ? 'Leídos' : 'Read'}</h2>
                              <span className="section-count">{completed.length}</span>
                            </div>
                            {renderBookGrid(completed)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="library-section">
                        <div className="section-header">
                          <h2 className="section-title">{getSectionTitle()}</h2>
                          <span className="section-count">{filteredBooksList.length}</span>
                        </div>
                        {renderBookGrid(filteredBooksList)}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {activeTab === 'statistics' && renderStatisticsTab()}
      {activeTab === 'settings' && renderSettingsTab()}
      {activeTab === 'notes' && renderNotesTab()}
      {activeTab === 'srs' && renderSrsTab()}

      {/* Bottom Navigation Bar for Mobile (hidden during an SRS review, which is full screen and sits below it) */}
      {isMobile && !isSrsReviewOpen && (
        <nav className="bottom-navigation-bar" aria-label={lang === 'es' ? 'Navegación principal' : 'Main navigation'}>
          <button 
            className={`bottom-tab-btn ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
            type="button"
            aria-current={activeTab === 'library' ? 'page' : undefined}
          >
            <BookOpen size={18} />
            <span>{t('library', lang)}</span>
          </button>
          <button 
            className={`bottom-tab-btn ${activeTab === 'srs' ? 'active' : ''}`}
            onClick={() => setActiveTab('srs')}
            type="button"
            aria-current={activeTab === 'srs' ? 'page' : undefined}
          >
            <Zap size={18} />
            <span>Yoru SRS</span>
          </button>
          <button 
            className={`bottom-tab-btn ${activeTab === 'statistics' ? 'active' : ''}`}
            onClick={() => setActiveTab('statistics')}
            type="button"
            aria-current={activeTab === 'statistics' ? 'page' : undefined}
          >
            <BarChart3 size={18} />
            <span>{t('statistics', lang)}</span>
          </button>
        </nav>
      )}

      {isLibraryMenuOpen && (
        <LibraryMoreMenu
          lang={lang}
          sortBy={sortBy}
          onSortBy={setSortBy}
          sortDirection={sortDirection}
          onSortDirection={setSortDirection}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          details={[
            { key: 'title', label: lang === 'es' ? 'Título' : 'Title', value: showCardTitle, onChange: setShowCardTitle },
            { key: 'author', label: lang === 'es' ? 'Autor' : 'Author', value: showCardAuthor, onChange: setShowCardAuthor },
            { key: 'series', label: lang === 'es' ? 'Serie' : 'Series', value: showCardSeries, onChange: setShowCardSeries },
            { key: 'tags', label: lang === 'es' ? 'Colecciones' : 'Collections', value: showCardTags, onChange: setShowCardTags },
            { key: 'progress', label: lang === 'es' ? 'Progreso' : 'Progress', value: showCardProgress, onChange: setShowCardProgress },
            { key: 'status', label: lang === 'es' ? 'Estado' : 'Status', value: showCardStatus, onChange: setShowCardStatus },
          ]}
          onSelectBooks={() => { if (!selectMode) toggleSelectMode(); }}
          onMoreOptions={() => setIsDisplaySettingsOpen(true)}
          onClose={() => setIsLibraryMenuOpen(false)}
        />
      )}

      {/* Display Settings Drawer */}
      <aside className={`display-settings-drawer ${isDisplaySettingsOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <span className="drawer-title" style={{ color: 'var(--text-main)', fontSize: '0.9rem', textTransform: 'none', fontWeight: 650, letterSpacing: 'normal', textShadow: 'none' }}>{lang === 'es' ? 'Ajustes de visualización' : 'Library display settings'}</span>
          <button 
            className="drawer-close-btn" 
            onClick={() => {
              setIsDisplaySettingsOpen(false);
              setIsDetailsDropdownOpen(false);
            }}
            title={lang === 'es' ? 'Cerrar (Q)' : 'Close (Q)'}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="drawer-content" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* DISPLAY GROUP */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px' }}>{lang === 'es' ? 'Visualización' : 'Display'}</div>
            
            {/* Details */}
            <div className="drawer-section drawer-section--in-menu" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Detalles' : 'Details'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Elige qué bloques de información se muestran debajo de la portada.' : 'Choose which info blocks are shown under book card covers.'}>?</span>
              </div>
              
              {(() => {
                const detailsCount = (showCardTitle ? 1 : 0) + (showCardSeries ? 1 : 0) + (showCardAuthor ? 1 : 0) + (showCardTags ? 1 : 0) + (showCardProgress ? 1 : 0) + (showCardStatus ? 1 : 0);
                return (
                  <div style={{ position: 'relative' }}>
                    <button
                       type="button"
                      className="drawer-select"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onClick={() => setIsDetailsDropdownOpen(!isDetailsDropdownOpen)}
                    >
                      <span className="truncate" style={{ maxWidth: '190px' }}>
                        {[
                          showCardTitle && (lang === 'es' ? "Título" : "Title"),
                          showCardSeries && (lang === 'es' ? "Serie" : "Series"),
                          showCardAuthor && (lang === 'es' ? "Autor" : "Author"),
                          showCardTags && (lang === 'es' ? "Etiquetas" : "Tags"),
                          showCardProgress && (lang === 'es' ? "Progreso" : "Progress"),
                          showCardStatus && (lang === 'es' ? "Estado" : "Status")
                        ].filter(Boolean).join(', ') || (lang === 'es' ? "Ninguno" : "None")}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.7rem', background: 'var(--bg-card-hover)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-muted)' }}>
                          {detailsCount}/6
                        </span>
                        <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    </button>
                    
                    {isDetailsDropdownOpen && (
                      <div 
                        style={{
                          position: 'absolute',
                          top: '42px',
                          left: 0,
                          width: '100%',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-light)',
                          borderRadius: '8px',
                          padding: '10px',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                          zIndex: 100,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        {[
                          { key: 'title', label: lang === 'es' ? 'Título' : 'Title', value: showCardTitle, setter: setShowCardTitle },
                          { key: 'series', label: lang === 'es' ? 'Serie' : 'Series', value: showCardSeries, setter: setShowCardSeries },
                          { key: 'author', label: lang === 'es' ? 'Autor' : 'Author', value: showCardAuthor, setter: setShowCardAuthor },
                          { key: 'tags', label: lang === 'es' ? 'Etiquetas' : 'Tags', value: showCardTags, setter: setShowCardTags },
                          { key: 'progress', label: lang === 'es' ? 'Progreso' : 'Progress', value: showCardProgress, setter: setShowCardProgress },
                          { key: 'status', label: lang === 'es' ? 'Estado' : 'Status', value: showCardStatus, setter: setShowCardStatus }
                        ].map(opt => (
                          <label 
                            key={opt.key} 
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer', userSelect: 'none' }}
                          >
                            <input 
                              type="checkbox" 
                              checked={opt.value} 
                              onChange={(e) => opt.setter(e.target.checked)}
                              style={{ width: '14px', height: '14px', accentColor: 'var(--primary)' }}
                            />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Cover Image */}
            <div className="drawer-section" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Imagen de portada' : 'Cover Image'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Escalar y ajustar las imágenes de portada dentro de las tarjetas.' : 'Scale and fit book cover images inside their cards.'}>?</span>
              </div>
              <div className="drawer-segmented-control">
                <button
                  type="button"
                  className={`drawer-segmented-btn ${coverFit === 'cover' ? 'active' : ''}`}
                  onClick={() => setCoverFit('cover')}
                >
                  {lang === 'es' ? 'Rellenar' : 'Fill'}
                </button>
                <button
                  type="button"
                  className={`drawer-segmented-btn ${coverFit === 'contain' ? 'active' : ''}`}
                  onClick={() => setCoverFit('contain')}
                >
                  {lang === 'es' ? 'Ajustar' : 'Fit'}
                </button>
              </div>
            </div>

            {/* Card Size */}
            <div className="drawer-section" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Tamaño de tarjeta' : 'Card Size'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Redimensionar la escala de las tarjetas de libros.' : 'Resize the book cards scale in the library view.'}>?</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'PEQUEÑO' : 'SMALL'}</span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="range" 
                    min="120" 
                    max="240" 
                    step="8"
                    value={cardWidth} 
                    onChange={(e) => setCardWidth(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer', height: '4px', background: 'var(--border-light)', borderRadius: '2px' }}
                  />
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>{lang === 'es' ? 'GRANDE' : 'LARGE'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <span style={{ fontSize: '0.72rem', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '3px 10px', color: 'var(--text-main)', fontWeight: 600 }}>
                  {cardWidth} px
                </span>
                <button
                  type="button"
                  onClick={() => setCardWidth(160)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {lang === 'es' ? 'Restablecer' : 'Reset'}
                </button>
              </div>
            </div>

            {/* Group By */}
            <div className="drawer-section drawer-section--in-menu" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Agrupar por' : 'Group By'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Agrupar tarjetas en filas horizontales por serie o autor.' : 'Group book cards into horizontal lanes by series or author.'}>?</span>
              </div>
              <div className="drawer-segmented-control">
                {[
                  { value: 'none', label: lang === 'es' ? 'Ninguno' : 'None' },
                  { value: 'series', label: lang === 'es' ? 'Serie' : 'Series' },
                  { value: 'author', label: lang === 'es' ? 'Autor' : 'Author' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`drawer-segmented-btn ${groupBy === opt.value ? 'active' : ''}`}
                    onClick={() => setGroupBy(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SORTING GROUP (on phones it lives in the ⋮ menu) */}
          <div className="drawer-section--in-menu">
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px' }}>{lang === 'es' ? 'Ordenamiento' : 'Sorting'}</div>
            
            {/* Sort By */}
            <div className="drawer-section" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Ordenar por' : 'Sort By'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Elige el criterio de ordenación para los libros.' : 'Choose the sorting criteria for books inside each grid or section.'}>?</span>
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="drawer-select"
              >
                <option value="added">{lang === 'es' ? 'Añadido' : 'Added'}</option>
                <option value="title">{lang === 'es' ? 'Título' : 'Title'}</option>
                <option value="author">{lang === 'es' ? 'Autor' : 'Author'}</option>
                <option value="series">{lang === 'es' ? 'Serie' : 'Series'}</option>
                <option value="characters">{lang === 'es' ? 'Caracteres' : 'Characters'}</option>
                <option value="lastUpdate">{lang === 'es' ? 'Última actualización' : 'Last update'}</option>
                <option value="lastRead">{lang === 'es' ? 'Último leído' : 'Last read'}</option>
                <option value="progress">{lang === 'es' ? 'Progreso' : 'Progress'}</option>
                <option value="currentPosition">{lang === 'es' ? 'Posición actual' : 'Current position'}</option>
              </select>
            </div>

            {/* Direction */}
            <div className="drawer-section" style={{ marginBottom: '14px' }}>
              <div className="drawer-label-row">
                <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Dirección' : 'Direction'}</span>
                <span className="drawer-info-icon" title={lang === 'es' ? 'Ordenar elementos en orden ascendente o descendente.' : 'Sort elements in ascending or descending order.'}>?</span>
              </div>
              <div className="drawer-segmented-control">
                <button
                  type="button"
                  className={`drawer-segmented-btn ${sortDirection === 'asc' ? 'active' : ''}`}
                  onClick={() => setSortDirection('asc')}
                >
                  {lang === 'es' ? 'Ascendente' : 'Ascending'}
                </button>
                <button
                  type="button"
                  className={`drawer-segmented-btn ${sortDirection === 'desc' ? 'active' : ''}`}
                  onClick={() => setSortDirection('desc')}
                >
                  {lang === 'es' ? 'Descendente' : 'Descending'}
                </button>
              </div>
            </div>

            {/* Group Sort & Group Direction (only visible if grouped) */}
            {groupBy !== 'none' && (
              <>
                {/* Group Sort */}
                <div className="drawer-section" style={{ marginBottom: '14px' }}>
                  <div className="drawer-label-row">
                    <span className="drawer-section-label" style={{ color: 'var(--text-main)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Orden del grupo' : 'Group Sort'}</span>
                    <span className="drawer-info-icon" title={lang === 'es' ? 'Cómo se ordenan las filas de agrupación.' : 'How the grouping lanes themselves are ordered.'}>?</span>
                  </div>
                  <select
                    value={groupSort}
                    onChange={(e) => setGroupSort(e.target.value)}
                    className="drawer-select"
                  >
                    <option value="alphabetical">{lang === 'es' ? 'Alfabético' : 'Alphabetical'}</option>
                    <option value="date">{lang === 'es' ? 'Fecha' : 'Date'}</option>
                  </select>
                </div>

                {/* Group Direction */}
                <div className="drawer-section" style={{ marginBottom: '14px' }}>
                  <div className="drawer-label-row">
                    <span className="drawer-section-label" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 600, marginBottom: 0 }}>{lang === 'es' ? 'Dirección del grupo' : 'Group Direction'}</span>
                    <span className="drawer-info-icon" title={lang === 'es' ? 'Orden ascendente o descendente para las filas de agrupación.' : 'Ascending or descending order for grouping lanes.'}>?</span>
                  </div>
                  <div className="drawer-segmented-control">
                    <button
                      type="button"
                      className={`drawer-segmented-btn ${groupDirection === 'asc' ? 'active' : ''}`}
                      onClick={() => setGroupDirection('asc')}
                    >
                      {lang === 'es' ? 'Ascendente' : 'Ascending'}
                    </button>
                    <button
                      type="button"
                      className={`drawer-segmented-btn ${groupDirection === 'desc' ? 'active' : ''}`}
                      onClick={() => setGroupDirection('desc')}
                    >
                      {lang === 'es' ? 'Descendente' : 'Descending'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Loading Overlay while parsing */}
      {isParsing && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="settings-modal" style={{ textAlign: 'center', width: '260px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
            <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>Importando archivo...</p>
          </div>
        </div>
      )}

      {/* Reading Statistics Modal */}
      {isStatsOpen && (
        <div className="modal-overlay" onClick={() => setIsStatsOpen(false)} style={{ zIndex: 1100 }}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Estadísticas de Aprendizaje</h3>
              <button className="close-modal-btn" onClick={() => setIsStatsOpen(false)}>
                <Check size={20} />
              </button>
            </div>

            <div className="stats-grid">
              <div className="stats-card">
                <div className="stats-val">{books.length}</div>
                <div className="stats-label">Libros</div>
              </div>
              <div className="stats-card">
                <div className="stats-val">{books.filter(b => b.progress.percent >= 100).length}</div>
                <div className="stats-label">Leídos</div>
              </div>
              <div className="stats-card">
                <div className="stats-val" style={{ color: 'var(--status-known)' }}>{knownWordsCount}</div>
                <div className="stats-label">Conocidas</div>
              </div>
              <div className="stats-card">
                <div className="stats-val" style={{ color: 'var(--status-learning)' }}>{learningWordsCount}</div>
                <div className="stats-label">Estudiando</div>
              </div>
            </div>

            {/* Vocabulary Ratio Chart */}
            <div className="stats-chart-placeholder">
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px' }}>
                COBERTURA DE VOCABULARIO
              </h4>
              
              <div className="chart-bar-row">
                <div className="chart-bar-label-row">
                  <span>Conocido (💎)</span>
                  <span>{knownWordsCount} ({knownPercent}%)</span>
                </div>
                <div className="chart-bar-container">
                  <div className="chart-bar-fill" style={{ width: `${knownPercent}%`, background: 'var(--status-known)' }}></div>
                </div>
              </div>

              <div className="chart-bar-row">
                <div className="chart-bar-label-row">
                  <span>Estudiando (⚡)</span>
                  <span>{learningWordsCount} ({learningPercent}%)</span>
                </div>
                <div className="chart-bar-container">
                  <div className="chart-bar-fill" style={{ width: `${learningPercent}%`, background: 'var(--status-learning)' }}></div>
                </div>
              </div>

              <div className="chart-bar-row" style={{ marginBottom: 0 }}>
                <div className="chart-bar-label-row">
                  <span>Nuevas / Sin iniciar</span>
                  <span>{newWordsCount} ({newPercent}%)</span>
                </div>
                <div className="chart-bar-container">
                  <div className="chart-bar-fill" style={{ width: `${newPercent}%`, background: 'var(--status-new)' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Book Detail Preview Modal */}
      {previewBook && (
        <div className="modal-overlay" onClick={() => setPreviewBook(null)} style={{ zIndex: 1150 }}>
          <div className="book-preview-modal" onClick={(e) => e.stopPropagation()}>

            <div className="preview-cover-container">
              {previewBook.cover && !previewBook.hideCover && !previewBook.cover.startsWith('linear-gradient') ? (
                <img 
                  src={previewBook.cover} 
                  alt={previewBook.title} 
                  className="preview-cover-img"
                  onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/150x220?text=Lector'; }}
                />
              ) : (
                <div 
                  className="preview-cover-placeholder" 
                  style={{ 
                    background: previewBook.cover && previewBook.cover.startsWith('linear-gradient') 
                      ? previewBook.cover 
                      : 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' 
                  }}
                >
                  <span>{previewBook.title}</span>
                </div>
              )}
            </div>

            <h3 className="preview-book-title">{previewBook.title}</h3>

            <p className="preview-book-description">
              {previewBook.description || (previewBook.author && previewBook.author !== 'Desconocido' 
                ? (lang === 'es' ? `Novela de ${previewBook.author}.` : `Novel by ${previewBook.author}.`)
                : (lang === 'es' ? 'Sin descripción' : 'No description'))}
            </p>

            <div className="preview-modal-actions">
              <button 
                className="preview-start-btn"
                onClick={() => {
                  onSelectBook(previewBook);
                  setPreviewBook(null);
                }}
              >
                {lang === 'es' ? 'Comenzar a leer' : 'Start Reading'}
              </button>
              
              <button 
                className="preview-delete-btn"
                onClick={async () => {
                  const ok = await showConfirm({
                    title: lang === 'es' ? '¿Eliminar novela?' : 'Delete novel?',
                    message: lang === 'es' ? `¿Estás seguro de que quieres eliminar "${previewBook.title}" de la biblioteca?` : `Are you sure you want to delete "${previewBook.title}" from the library?`,
                    type: 'danger',
                    confirmText: lang === 'es' ? 'Eliminar' : 'Delete',
                  });
                  if (ok) {
                    onDeleteBook(previewBook.id);
                    setPreviewBook(null);
                  }
                }}
              >
                <Trash2 size={16} style={{ marginRight: '6px' }} />
                {lang === 'es' ? 'Eliminar de la biblioteca' : 'Delete from library'} ({Math.round(((previewBook.chapters || []).reduce((sum, ch) => sum + (ch.content || '').length, 0) * 2) / 1024) || 2048}kb)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Book Edit Details Modal (Migaku replica) */}
      {editingBook && (
        <div className="modal-overlay" onClick={() => setEditingBook(null)} style={{ zIndex: 1200 }}>
          <div className="book-edit-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-edit-modal-btn" onClick={() => setEditingBook(null)}>
              <X size={20} />
            </button>

            <div className="edit-cover-container">
              {editingBook.cover && !editingBook.cover.startsWith('linear-gradient') ? (
                <img 
                  src={editingBook.cover} 
                  alt={editTitle} 
                  className="edit-cover-img"
                  onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/150x220?text=Lector'; }}
                />
              ) : (
                <div className="edit-cover-placeholder" style={{ background: editingBook.cover || 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' }}>
                  <span>{editTitle}</span>
                </div>
              )}
            </div>

            <div className="edit-form-content">
              {/* Título */}
              <div className="edit-form-row">
                <label className="edit-form-label">{lang === 'es' ? 'Título' : 'Title'}</label>
                <input 
                  type="text" 
                  value={editTitle} 
                  onChange={(e) => setEditTitle(e.target.value)} 
                  className="edit-form-input"
                  placeholder={lang === 'es' ? 'Introducir título' : 'Enter title...'}
                />
              </div>

              {/* Ocultar imagen de portada */}
              <div className="edit-form-row inline-row">
                <label className="edit-form-label">{lang === 'es' ? 'Ocultar imagen de portada' : 'Hide cover image'}</label>
                <label className="migaku-switch">
                  <input 
                    type="checkbox" 
                    checked={editHideCover}
                    onChange={(e) => setEditHideCover(e.target.checked)}
                  />
                  <span className="migaku-switch-slider"></span>
                </label>
              </div>

              {/* Descripción */}
              <div className="edit-form-row">
                <label className="edit-form-label">{lang === 'es' ? 'Descripción (opcional)' : 'Description (optional)'}</label>
                <textarea 
                  value={editDescription} 
                  onChange={(e) => setEditDescription(e.target.value)} 
                  className="edit-form-textarea"
                  placeholder={lang === 'es' ? 'Introducir descripción' : 'Enter description...'}
                  rows={4}
                />
              </div>

              {/* Guardar detalles */}
              <button 
                className="edit-save-btn"
                onClick={() => {
                  if (editTitle.trim()) {
                    const updatedData = { 
                      title: editTitle.trim(), 
                      hideCover: editHideCover, 
                      description: editDescription.trim() 
                    };
                    onUpdateBookDetails(editingBook.id, updatedData);
                    
                    // Actualizar el estado de previewBook para mostrar cambios inmediatamente
                    if (previewBook && previewBook.id === editingBook.id) {
                      setPreviewBook({ ...previewBook, ...updatedData });
                    }
                    
                    setEditingBook(null);
                  }
                }}
              >
                {lang === 'es' ? 'Guardar detalles' : 'Save details'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Settings Modal Overlay */}
      {isProfileSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsProfileSettingsOpen(false)} style={{ zIndex: 1200 }}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ width: '90%', maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title">{lang === 'es' ? 'Configuración del Perfil' : 'Profile Settings'}</h3>
              <button className="close-modal-btn" onClick={() => setIsProfileSettingsOpen(false)} style={{ background: 'transparent' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleProfileSettingsSubmit} className="edit-form-content">
              {/* Hidden file input for custom profile avatar */}
              <input 
                type="file" 
                accept="image/*"
                ref={customProfileSettingsAvatarInputRef}
                onChange={handleEditProfileAvatarChange}
                style={{ display: 'none' }}
              />

              <div className="avatar-selection-label" style={{ textAlign: 'center', marginBottom: '8px' }}>{lang === 'es' ? 'Foto de perfil:' : 'Profile picture:'}</div>
              <div className="custom-avatar-uploader-container" style={{ marginBottom: '16px' }}>
                <div 
                  className="custom-avatar-preview-circle"
                  onClick={() => customProfileSettingsAvatarInputRef.current.click()}
                  title={lang === 'es' ? 'Cambiar foto de perfil' : 'Change profile picture'}
                  style={{ width: '90px', height: '90px' }}
                >
                  {editProfileAvatar && (editProfileAvatar.startsWith('/') || editProfileAvatar.startsWith('data:')) ? (
                    <img src={editProfileAvatar} alt="Preview" className="avatar-preview-image" />
                  ) : (
                    <div className="active-profile-avatar-emoji" style={{ background: editProfileAvatar || 'var(--yc-yellow-dim)', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
                      👤
                    </div>
                  )}
                  <div className="avatar-preview-overlay">📷</div>
                </div>
              </div>

              <div className="edit-form-row">
                <label className="edit-form-label">{lang === 'es' ? 'Nombre del perfil' : 'Profile name'}</label>
                <input 
                  type="text" 
                  className="edit-form-input"
                  value={editProfileName}
                  onChange={(e) => setEditProfileName(e.target.value)}
                  placeholder={lang === 'es' ? 'Nombre...' : 'Name...'}
                  required
                />
              </div>

              <div className="create-profile-actions" style={{ marginTop: '16px' }}>
                <button 
                  type="button" 
                  className="create-profile-cancel" 
                  onClick={() => setIsProfileSettingsOpen(false)}
                >
                  {lang === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
                <button type="submit" className="create-profile-save">
                  {lang === 'es' ? 'Guardar' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Drive / Cloud Sync Modal */}
      {isGDriveSyncOpen && (
        <div className="modal-overlay" onClick={() => setIsGDriveSyncOpen(false)} style={{ zIndex: 1200 }}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ width: '90%', maxWidth: '420px', padding: '24px', background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
            <div className="modal-header" style={{ marginBottom: '20px' }}>
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                <Cloud size={20} style={{ color: '#4285F4' }} />
                <span>{lang === 'es' ? 'Sincronización Google Drive' : 'Google Drive Sync'}</span>
              </h3>
              <button className="close-modal-btn" onClick={() => setIsGDriveSyncOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5, marginBottom: '20px' }}>
              {lang === 'es' 
                ? 'Sincroniza tus libros, progreso y vocabulario directamente con tu cuenta de Google Drive utilizando la API oficial.' 
                : 'Sync your books, progress, and vocabulary directly with your Google Drive account using the official API.'}
            </div>

            {/* Connection Status Card */}
            <div style={{ 
              background: 'var(--bg-card)', 
              border: '1px solid var(--border-light)', 
              borderRadius: '12px', 
              padding: '16px', 
              marginBottom: '20px' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {lang === 'es' ? 'ESTADO' : 'STATUS'}
                </span>
                <span style={{ 
                  fontSize: '0.75rem', 
                  fontWeight: 700, 
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: gDriveSyncStatus === 'authorized' ? 'rgba(52, 211, 153, 0.1)' : gDriveSyncStatus === 'syncing' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: gDriveSyncStatus === 'authorized' ? '#34d399' : gDriveSyncStatus === 'syncing' ? '#fbbf24' : '#f87171'
                }}>
                  {gDriveSyncStatus === 'authorized' ? (lang === 'es' ? 'Conectado' : 'Connected') :
                   gDriveSyncStatus === 'syncing' ? (lang === 'es' ? 'Sincronizando...' : 'Syncing...') :
                   (lang === 'es' ? 'Desconectado' : 'Disconnected')}
                </span>
              </div>

              {gDriveTokens ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>✅</span> <span>{lang === 'es' ? 'Cuenta vinculada' : 'Account linked'}</span>
                  </div>
                  {lastSyncTime && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {lang === 'es' ? 'Última sincronización:' : 'Last sync:'} {lastSyncTime}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {lang === 'es' ? 'Ninguna cuenta conectada' : 'No account connected'}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              <button 
                type="button"
                onClick={handleConnectGDrive}
                disabled={gDriveSyncStatus === 'syncing'}
                className="vocab-action-btn"
                style={{ width: '100%', padding: '12px', justifyContent: 'center', gap: '8px', fontSize: '0.85rem' }}
              >
                <span>🔑</span> {gDriveTokens ? (lang === 'es' ? 'Re-conectar cuenta' : 'Re-connect account') : (lang === 'es' ? 'Conectar cuenta' : 'Connect account')}
              </button>

              {gDriveTokens && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button 
                      type="button"
                      onClick={handleUploadGDrive}
                      disabled={gDriveSyncStatus === 'syncing'}
                      className="vocab-action-btn"
                      style={{ padding: '12px', justifyContent: 'center', gap: '6px', fontSize: '0.85rem', background: 'rgba(66, 133, 244, 0.1)', color: '#4285F4', border: '1px solid rgba(66, 133, 244, 0.2)' }}
                    >
                      <span>📤</span> {lang === 'es' ? 'Subir copia completa' : 'Upload full backup'}
                    </button>
                    <button 
                      type="button"
                      onClick={handleDownloadGDrive}
                      disabled={gDriveSyncStatus === 'syncing'}
                      className="vocab-action-btn"
                      style={{ padding: '12px', justifyContent: 'center', gap: '6px', fontSize: '0.85rem', background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.2)' }}
                    >
                      <span>📥</span> {lang === 'es' ? 'Descargar' : 'Download'}
                    </button>
                  </div>

                  {/* Auto-Sync Toggle Option */}
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '12px', 
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    marginTop: '10px'
                  }}>
                    <span style={{ fontSize: '0.8rem', color: '#fff', fontWeight: 600 }}>
                      {lang === 'es' ? 'Sincronización automática' : 'Auto-Sync on startup'}
                    </span>
                    <input 
                      type="checkbox"
                      checked={isAutoSyncEnabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setIsAutoSyncEnabled(val);
                        localStorage.setItem('gdrive_autosync_enabled', val ? 'true' : 'false');
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                  </label>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="button"
                className="create-profile-cancel"
                onClick={() => setIsGDriveSyncOpen(false)}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                {lang === 'es' ? 'Cerrar' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      <React.Suspense fallback={null}>
        {isVocabModalOpen && (
          <VocabularyModal isOpen={isVocabModalOpen} onClose={() => setIsVocabModalOpen(false)} />
        )}
        {isSrsReviewOpen && (
          <SrsReviewModal isOpen={isSrsReviewOpen} filterDeck={selectedDeckFilter} onClose={() => { setIsSrsReviewOpen(false); setSrsUpdateTrigger(t => t + 1); }} />
        )}
      </React.Suspense>

      <React.Suspense fallback={null}>
        {isSettingsOpen && (
          <SettingsModal 
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSaveSettings={onSaveSettings}
            onExportLibrary={handleExportLibrary}
            onTriggerImportBackup={() => backupInputRef.current.click()}
            libraryViewProps={{
              showCardTitle, setShowCardTitle,
              showCardSeries, setShowCardSeries,
              showCardAuthor, setShowCardAuthor,
              showCardTags, setShowCardTags,
              showCardProgress, setShowCardProgress,
              showCardStatus, setShowCardStatus,
              coverFit, setCoverFit,
              cardWidth, setCardWidth
            }}
            gDriveProps={{
              gDriveClientId, setGDriveClientId,
              gDriveClientSecret, setGDriveClientSecret, gDriveTokens, gDriveSyncStatus,
              lastSyncTime,
              isAutoSyncEnabled, setIsAutoSyncEnabled,
              handleConnectGDrive,
              handleUploadBackupToGDrive: handleUploadGDrive,
              handleDownloadBackupFromGDrive: handleDownloadGDrive
            }}
            onOpenTutorial={() => setShowTutorialModal(true)}
          />
        )}
      </React.Suspense>

      {/* Onboarding Mini-Tutorial Modal */}
      <TutorialGuide
        isOpen={showTutorialModal}
        onClose={() => setShowTutorialModal(false)}
        onImportBook={triggerFileInput}
        lang={lang === 'es' ? 'es' : 'en'}
      />

      {/* Direct Dictionary Resource Library Modal */}
      {isLibraryModalOpen && renderLibraryModal()}

      {/* Custom Toast Notification Styled with App Theme */}
      {toast.show && (
        <div className="yoru-toast" style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: '#18181b',
          color: '#ffffff',
          padding: '10px 16px',
          borderRadius: '4px',
          border: toast.type === 'success' ? '1px solid #34d399' : toast.type === 'info' ? '1px solid #60a5fa' : '1px solid #ef4444',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          fontFamily: 'system-ui, sans-serif',
          fontSize: '0.82rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'toastIn 0.2s ease-out forwards'
        }}>
          <span style={{ 
            width: '6px', 
            height: '6px', 
            borderRadius: '50%', 
            background: toast.type === 'success' ? '#34d399' : toast.type === 'info' ? '#60a5fa' : '#ef4444',
            display: 'inline-block' 
          }} />
          <span>{toast.message}</span>
        </div>
      )}
      {isDeckPromptOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001
        }}>
          <form 
            onSubmit={handleDeckPromptSubmit}
            style={{
              background: '#16161c',
              border: '1px solid var(--border-light)',
              borderRadius: '16px',
              padding: '24px',
              width: '380px',
              maxWidth: '90%',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>
              {deckPromptMode === 'create' 
                ? (lang === 'es' ? 'Crear Nuevo Mazo' : 'Create New Deck')
                : deckPromptMode === 'rename'
                  ? (lang === 'es' ? 'Renombrar Mazo' : 'Rename Deck')
                  : (lang === 'es' ? 'Fusionar Mazo' : 'Merge Decks')
              }
            </h3>

            {deckPromptMode === 'merge' ? (
              <select
                value={deckPromptValue}
                onChange={(e) => setDeckPromptValue(e.target.value)}
                required
                style={{
                  background: '#1c1c24',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '100%'
                }}
              >
                <option value="" disabled style={{ background: '#16161c' }}>
                  {lang === 'es' ? 'Seleccionar mazo destino...' : 'Select target deck...'}
                </option>
                {(() => {
                  const srsData = db.getSrsData();
                  const deckNames = new Set<string>();
                  Object.entries(srsData).forEach(([word, card]: [string, any]) => {
                    if (word.startsWith('_deck_')) {
                      const dName = word.substring(6).trim();
                      if (dName) deckNames.add(dName);
                    } else if (card && card.source && !word.startsWith('_')) {
                      deckNames.add(card.source.trim());
                    }
                  });
                  return Array.from(deckNames)
                    .filter(name => name !== deckPromptTargetId)
                    .sort((a, b) => a.localeCompare(b, 'ja'))
                    .map(name => (
                      <option key={name} value={name} style={{ background: '#16161c' }}>
                        {name}
                      </option>
                    ));
                })()}
              </select>
            ) : (
              <input 
                type="text"
                value={deckPromptValue}
                onChange={(e) => setDeckPromptValue(e.target.value)}
                placeholder={lang === 'es' ? 'Nombre del mazo...' : 'Deck name...'}
                required
                autoFocus
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                className="create-profile-cancel"
                onClick={() => setIsDeckPromptOpen(false)}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>

              {deckPromptMode === 'rename' && (
                <button
                  type="button"
                  onClick={handleDeckPromptDelete}
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid #ef4444',
                    color: '#f87171',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {lang === 'es' ? 'Eliminar' : 'Delete'}
                </button>
              )}

              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {deckPromptMode === 'create'
                  ? (lang === 'es' ? 'Crear' : 'Create')
                  : deckPromptMode === 'rename'
                    ? (lang === 'es' ? 'Guardar' : 'Save')
                    : (lang === 'es' ? 'Fusionar' : 'Merge')
                }
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteAllState && renderDeleteAllModal()}
      {confirmModal}
    </div>
  );
});

export default Library;
