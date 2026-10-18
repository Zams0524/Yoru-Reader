export const TRANSLATIONS: Record<string, Record<string, string>> = {
  es: {
    // Header & Navigation
    library: 'Biblioteca',
    statistics: 'Estadísticas',
    settings: 'Ajustes',
    vocabulary: 'Vocabulario',
    yoruReader: 'YORU READER',

    // Welcome Screen
    welcomeTitle: 'YORU READER',
    welcomeSubtitle: 'Crea tu perfil para empezar a leer japonés',
    profileName: 'Nombre de perfil',
    namePlaceholder: 'Introduce tu nombre...',
    chooseAvatar: 'O elige un avatar rápido:',
    uploadPhoto: 'Subir foto personalizada',
    startReading: 'Comenzar a leer',
    errorLoadImage: 'Error al cargar la imagen.',

    // Library General
    booksRead: 'Libros leídos',
    charactersRead: 'Caracteres leídos',
    timeRead: 'Tiempo de lectura',
    lastRead: 'Última lectura',
    noBooks: 'No hay libros en tu biblioteca. ¡Añade uno para comenzar!',
    addBook: 'Añadir libro',
    importFolder: 'Importar carpeta',
    importFile: 'Importar archivo',
    selectMode: 'Seleccionar',
    cancel: 'Cancelar',
    deleteSelected: 'Eliminar seleccionados',
    markAsRead: 'Marcar como leídos',
    markAsUnread: 'Marcar como no leídos',
    confirmDeleteBooks: '¿Estás seguro de que deseas eliminar los libros seleccionados?',
    confirmDeleteBook: '¿Estás seguro de que deseas eliminar este libro?',
    
    // Sort
    sortBy: 'ORDENAR POR',
    sortAdded: 'Fecha de adición',
    sortTitle: 'Título',
    sortAuthor: 'Autor',
    sortProgress: 'Progreso',
    sortLastRead: 'Última lectura',
    
    // Edit Book Modal
    editInfo: 'Editar información',
    title: 'Título',
    author: 'Autor',
    series: 'Serie',
    volumeNumber: 'Número de volumen/serie',
    save: 'Guardar',
    close: 'Cerrar',

    // Settings
    displaySettings: 'AJUSTES DE PANTALLA',
    interfaceLanguage: 'Idioma de la interfaz',
    showToolbar: 'Mostrar barra de herramientas',
    readerFontSize: 'Tamaño de fuente del lector',
    pitchAccent: 'Acento de tono (Pitch Accent)',
    pitchNone: 'Ninguno',
    pitchColor: 'Color de tono',
    audioOptions: 'OPCIONES DE AUDIO',
    playbackSpeed: 'Velocidad de reproducción',
    playbackVoice: 'Voz para reproducción',
    voiceGender: 'Género de voz',
    genderMale: 'Masculino',
    genderFemale: 'Femenino',
    
    // Yomitan Settings inside Library
    dictionaryTitle: 'DICCIONARIOS OFFLINE',
    dictDesc: 'Sube archivos .zip de diccionarios de Yomitan para buscar vocabulario offline.',
    noDicts: 'No hay diccionarios instalados.',
    dictProgress: 'Progreso de importación',
    uploadDict: 'Subir archivo ZIP de Yomitan',
    
    // Database actions
    databaseActions: 'ACCIONES DE BASE DE DATOS',
    exportLibrary: 'Exportar biblioteca completa',
    importLibrary: 'Importar biblioteca (.json/.zip)',
    clearDatabase: 'Borrar base de datos y reiniciar app',
    confirmClearDatabase: '¡ATENCIÓN! Esto borrará todos tus libros, estadísticas, perfiles y diccionarios permanentemente. ¿Deseas continuar?',
    
    // Vocab Tab
    vocabTitle: 'Vocabulario',
    filterBy: 'FILTRAR POR',
    searchWord: 'Buscar palabra...',
    noSavedWords: 'No se encontraron palabras guardadas.',
    confirmDeleteWord: '¿Quieres eliminar "{word}" de tu vocabulario?',
    wordDeleted: 'Palabra eliminada.',
    loadingMoreVocab: 'Cargando más vocabulario...',
    
    // Statistics
    overview: 'Resumen',
    breakdown: 'Detalle',
    readingHistory: 'Historial de lectura',
    totalReadingTime: 'Tiempo total de lectura',
    dailyAverage: 'Promedio diario',
    uniqueWordsMet: 'Palabras únicas encontradas',
    totalCharacters: 'Caracteres totales leídos',
    noReadingActivity: 'No hay actividad de lectura en este rango.',

    // Reader UI
    backToLibrary: 'Volver a la Biblioteca',
    processingVocab: 'Procesando vocabulario japonés...',
    chapter: 'Capítulo',
    page: 'Página',
    dictLoading: 'Cargando diccionario...',
    noDefFound: 'No se encontró definición en tus diccionarios.',
    mineToAnki: 'Minar a Anki',
    listenPronunciation: 'Escuchar pronunciación',
    statusNew: 'Nuevo',
    statusLearning: 'Estudiando',
    statusKnown: 'Conocido',
    statusStarred: 'Destacado',
    statusIgnored: 'Ignorado',

    // Profile Dropdown
    activeProfile: 'Perfil activo',
    createProfile: 'Crear perfil',
    editProfileName: 'Editar nombre',
    deleteProfile: 'Eliminar perfil',
    confirmDeleteProfile: '¿Estás seguro de que deseas eliminar este perfil? Se perderán todos sus libros e historial.',
    cannotDeleteOnlyProfile: 'No puedes eliminar el único perfil.',
  },
  en: {
    // Header & Navigation
    library: 'Library',
    statistics: 'Statistics',
    settings: 'Settings',
    vocabulary: 'Vocabulary',
    yoruReader: 'YORU READER',

    // Welcome Screen
    welcomeTitle: 'YORU READER',
    welcomeSubtitle: 'Create your profile to start reading Japanese',
    profileName: 'Profile Name',
    namePlaceholder: 'Enter your name...',
    chooseAvatar: 'Or choose a quick avatar:',
    uploadPhoto: 'Upload custom photo',
    startReading: 'Start Reading',
    errorLoadImage: 'Error loading image.',

    // Library General
    booksRead: 'Books read',
    charactersRead: 'Characters read',
    timeRead: 'Time read',
    lastRead: 'Last read',
    noBooks: 'No books in your library. Add one to start!',
    addBook: 'Add book',
    importFolder: 'Import folder',
    importFile: 'Import file',
    selectMode: 'Select',
    cancel: 'Cancel',
    deleteSelected: 'Delete selected',
    markAsRead: 'Mark as read',
    markAsUnread: 'Mark as unread',
    confirmDeleteBooks: 'Are you sure you want to delete the selected books?',
    confirmDeleteBook: 'Are you sure you want to delete this book?',
    
    // Sort
    sortBy: 'SORT BY',
    sortAdded: 'Date added',
    sortTitle: 'Title',
    sortAuthor: 'Author',
    sortProgress: 'Progress',
    sortLastRead: 'Last read',
    
    // Edit Book Modal
    editInfo: 'Edit info',
    title: 'Title',
    author: 'Author',
    series: 'Series',
    volumeNumber: 'Volume/Series number',
    save: 'Save',
    close: 'Close',

    // Settings
    displaySettings: 'DISPLAY SETTINGS',
    interfaceLanguage: 'Interface Language',
    showToolbar: 'Show Toolbar',
    readerFontSize: 'Reader Font Size',
    pitchAccent: 'Pitch Accent',
    pitchNone: 'None',
    pitchColor: 'Pitch Color',
    audioOptions: 'AUDIO OPTIONS',
    playbackSpeed: 'Playback Speed',
    playbackVoice: 'Playback Voice',
    voiceGender: 'Voice Gender',
    genderMale: 'Male',
    genderFemale: 'Female',
    
    // Yomitan Settings inside Library
    dictionaryTitle: 'OFFLINE DICTIONARIES',
    dictDesc: 'Upload Yomitan dictionary .zip files to search vocabulary offline.',
    noDicts: 'No dictionaries installed.',
    dictProgress: 'Import progress',
    uploadDict: 'Upload Yomitan ZIP file',
    
    // Database actions
    databaseActions: 'DATABASE ACTIONS',
    exportLibrary: 'Export entire library',
    importLibrary: 'Import library (.json/.zip)',
    clearDatabase: 'Clear database & reset app',
    confirmClearDatabase: 'ATTENTION! This will permanently delete all your books, stats, profiles, and dictionaries. Do you want to proceed?',
    
    // Vocab Tab
    vocabTitle: 'Vocabulary',
    filterBy: 'FILTER BY',
    searchWord: 'Search word...',
    noSavedWords: 'No saved words found.',
    confirmDeleteWord: 'Do you want to delete "{word}" from your vocabulary?',
    wordDeleted: 'Word deleted.',
    loadingMoreVocab: 'Loading more vocabulary...',
    
    // Statistics
    overview: 'Overview',
    breakdown: 'Breakdown',
    readingHistory: 'Reading history',
    totalReadingTime: 'Total reading time',
    dailyAverage: 'Daily average',
    uniqueWordsMet: 'Unique words met',
    totalCharacters: 'Total characters read',
    noReadingActivity: 'No reading activity in this range.',

    // Reader UI
    backToLibrary: 'Back to Library',
    processingVocab: 'Processing Japanese vocabulary...',
    chapter: 'Chapter',
    page: 'Page',
    dictLoading: 'Loading dictionary...',
    noDefFound: 'No definition found in your dictionaries.',
    mineToAnki: 'Mine to Anki',
    listenPronunciation: 'Listen pronunciation',
    statusNew: 'New',
    statusLearning: 'Learning',
    statusKnown: 'Known',
    statusStarred: 'Starred',
    statusIgnored: 'Ignored',

    // Profile Dropdown
    activeProfile: 'Active profile',
    createProfile: 'Create profile',
    editProfileName: 'Edit name',
    deleteProfile: 'Delete profile',
    confirmDeleteProfile: 'Are you sure you want to delete this profile? All its books and history will be lost.',
    cannotDeleteOnlyProfile: 'You cannot delete the only profile.',
  }
};

export function t(key: string, lang: string = 'en'): string {
  const currentLang = lang === 'en' ? 'en' : 'es';
  return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS['es']?.[key] || key;
}
