export interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    es: string[];
    en: string[];
  };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.3',
    date: '2026-07-09',
    changes: {
      es: [
        'Ajuste inteligente del popup del diccionario: ahora aparece sobre la palabra cuando se hace clic en la mitad inferior de la pantalla para evitar recortes.',
        'Detección de colisiones reactiva en tiempo real: si el popup de definición excede el borde inferior de la pantalla, sube de inmediato sobre la palabra.',
        'Corrección de conflicto CSS: solucionado un problema de animación popIn que forzaba al popup a quedarse siempre abajo de la palabra.',
        'Cero saltos de texto al pasar el cursor: se eliminó el movimiento de renglón del texto al hacer hover sobre palabras (causado por el checkmark de Migaku).',
        'Nuevos modales de confirmación Yoru Café: eliminadas todas las alertas alert/confirm del sistema operativo, reemplazadas por diálogos premium oscuros de la app.',
        'Notificaciones toast de biblioteca: avisos no intrusivos al borrar o importar múltiples libros.',
        'Sincronización inteligente de Anki (Marcar como Conocido): busca la palabra en todos tus mazos probando nombres comunes de campos (Expression, Vocabulary-Kanji, Word, etc.) para evitar duplicados. Si la tarjeta no existe, crea una nueva tarjeta básica y la madura automáticamente en Anki.',
        'Preservación de idioma: el idioma seleccionado de la app ahora se incluye en los respaldos JSON para restaurarlo automáticamente al importar.',
        'Optimización extrema: caché en memoria de Yomitan y eliminación de re-renders redundantes al cambiar de página.',
      ],
      en: [
        'Smart dictionary popup placement: now renders above the clicked word when in the lower half of the screen to prevent off-screen cutoff.',
        'Reactive collision detection: if the popup exceeds the bottom screen boundary, it immediately flips above the word at runtime.',
        'Fixed CSS animation conflict: resolved a keyframe override that forced the popup below the word regardless of positioning math.',
        'Zero text jumping on hover: eliminated layout shifting when hovering over words (previously caused by the hover checkmark pseudo-element).',
        'New Yoru Cafe confirmation modals: replaced all system-native alert/confirm popups with custom glassmorphic modal overlays.',
        'Non-intrusive library toast notifications: smooth, silent notifications for bulk actions like importing or deleting books.',
        'Intelligent Anki sync for Known status: queries Anki across all decks/fields (Expression, Vocabulary-Kanji, Word, etc.) to prevent duplicates, and automatically creates + matures a basic note if it does not exist.',
        'Language settings backup: selected application language is now persisted in backups and correctly restored during profile import.',
        'High-performance optimizations: in-memory Yomitan query caching and reader render-loop cleanup for instant page turns.',
      ]
    }
  },
  {
    version: '1.0.1',
    date: '2026-07-08',
    changes: {
      es: [
        'Corregido el problema de la clausura obsoleta al minar palabras con el atajo de teclado "m". Ahora las definiciones se envían correctamente a Anki.',
        'Añadida sección de información de la versión y registro de cambios (changelog) en la configuración.'
      ],
      en: [
        'Fixed stale closure issue when mining words using the "m" keyboard shortcut. Definitions are now successfully sent to Anki.',
        'Added version information and changelog section in the settings.'
      ]
    }
  },
  {
    version: '1.0.0',
    date: '2026-06-15',
    changes: {
      es: [
        'Lanzamiento inicial de Yoru Reader.',
        'Lector de novelas ligeras en japonés con paginación automática inteligente.',
        'Integración con diccionarios de Yomitan e IndexedDB.',
        'Soporte completo de AnkiConnect para minar vocabulario.',
        'Lectura en voz alta (TTS) y captura de capturas de pantalla/audio para tarjetas.',
        'Sincronización en la nube con Google Drive y copias de seguridad locales.'
      ],
      en: [
        'Initial release of Yoru Reader.',
        'Japanese light novel reader with smart automatic pagination.',
        'Integration with Yomitan dictionaries and IndexedDB.',
        'Full AnkiConnect support for vocabulary mining.',
        'Text-to-speech (TTS) and screenshot/audio capture for cards.',
        'Cloud synchronization with Google Drive and local backups.'
      ]
    }
  }
];
