import React, { useEffect, useState } from 'react';
import { X, Search, Palette, Clock, Type, Target, Layers, FolderOpen, BookOpen, AlertTriangle, Info } from 'lucide-react';
import { t } from '../utils/i18n';
import AppAbout from './AppAbout';
import { useConfirm } from './ConfirmModal';
import { clearYomitanCache, getInstalledDictionaries } from '../utils/yomitanDB';
const VocabularyModal = React.lazy(() => import('./VocabularyModal'));
const FONT_SIZE_STEPS = [16, 20, 24, 28, 32];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: any;
  onSaveSettings: (settings: any) => void;
  mode?: 'settings' | 'info';
  book?: any;
  onUpdateBookDetails?: (bookId: string, data: any) => void;
  libraryViewProps?: any;
  gDriveProps?: any;
  onExportLibrary?: () => void;
  onTriggerImportBackup?: () => void;
  onOpenTutorial?: () => void;
}

export default function SettingsModal({ 
  isOpen, 
  onClose, 
  settings = {}, 
  onSaveSettings, 
  mode = 'settings', 
  book, 
  onUpdateBookDetails,
  libraryViewProps, // Opcional, para controlar las tarjetas de la biblioteca
  onExportLibrary,
  onTriggerImportBackup,
  onOpenTutorial
}: SettingsModalProps) {
  const [isVocabModalOpen, setIsVocabModalOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('theme');
  const [searchQuery, setSearchQuery] = useState('');
  const [installedDictionaries, setInstalledDictionaries] = useState<any[]>([]);
  const [dictionariesLoading, setDictionariesLoading] = useState(false);
  const [dictionariesError, setDictionariesError] = useState(false);
  const { showConfirm, confirmModal } = useConfirm();
  const [mobileSubView, setMobileSubView] = useState<'menu' | 'content'>('menu');

  useEffect(() => {
    if (!isOpen || activeSection !== 'dictionaries') return;
    let isCurrent = true;
    setDictionariesLoading(true);
    setDictionariesError(false);
    const refreshDictionaries = () => {
      getInstalledDictionaries()
        .then(dictionaries => {
          if (isCurrent) setInstalledDictionaries(dictionaries);
        })
        .catch(error => {
          console.warn('[Settings] Failed to load installed dictionaries:', error);
          if (isCurrent) setDictionariesError(true);
        })
        .finally(() => {
          if (isCurrent) setDictionariesLoading(false);
        });
    };
    refreshDictionaries();
    window.addEventListener('yoru-dictionaries-changed', refreshDictionaries);
    return () => {
      isCurrent = false;
      window.removeEventListener('yoru-dictionaries-changed', refreshDictionaries);
    };
  }, [isOpen, activeSection]);

  if (!isOpen) return null;
  
  const lang = settings.appLanguage || 'en';

  // Modal de información del libro (mode === 'info')
  if (mode === 'info') {
    if (!book) return null;
    const charsCount = (book.chapters || []).reduce((acc: number, c: any) => acc + (c.content || '').length, 0);
    const formatDate = (dateStr: string) => {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="settings-modal migaku-style" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
          <div className="modal-header" style={{ paddingBottom: '0.2rem', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)' }}>
              {t('editInfo', lang).toUpperCase()}
            </h3>
            <button className="close-modal-btn" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <X size={20} />
            </button>
          </div>

          <div className="migaku-settings-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('title', lang)}</span>
              <span 
                style={{ fontWeight: 600, color: '#fff', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.3)' }}
                onClick={() => {
                  const title = prompt(lang === 'es' ? "Título del libro:" : "Book title:", book.title || '');
                  if (title !== null && title.trim() && onUpdateBookDetails) {
                    onUpdateBookDetails(book.id, { title: title.trim() });
                  }
                }}
                title={lang === 'es' ? "Haz clic para editar" : "Click to edit"}
              >
                {book.title}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('author', lang)}</span>
              <span 
                style={{ fontWeight: 500, color: '#fff', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.3)' }}
                onClick={() => {
                  const author = prompt(lang === 'es' ? "Autor del libro:" : "Book author:", book.author || '');
                  if (author !== null && onUpdateBookDetails) {
                    onUpdateBookDetails(book.id, { author: author.trim() });
                  }
                }}
                title={lang === 'es' ? "Haz clic para editar" : "Click to edit"}
              >
                {book.author || '-'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('series', lang)}</span>
              <span 
                style={{ fontWeight: 500, color: '#fff', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.3)' }} 
                onClick={() => {
                  const s = prompt(lang === 'es' ? "Nombre de la serie:" : "Series name:", book.series || '');
                  if (s !== null && onUpdateBookDetails) {
                    onUpdateBookDetails(book.id, { series: s });
                  }
                }}
                title={lang === 'es' ? "Haz clic para editar" : "Click to edit"}
              >
                {book.series || '-'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('volumeNumber', lang)}</span>
              <span 
                style={{ fontWeight: 500, color: '#fff', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.3)' }} 
                onClick={() => {
                  const sn = prompt(lang === 'es' ? "Número de volumen/serie:" : "Volume/Series number:", book.seriesNumber || '');
                  if (sn !== null && onUpdateBookDetails) {
                    onUpdateBookDetails(book.id, { seriesNumber: sn });
                  }
                }}
                title={lang === 'es' ? "Haz clic para editar" : "Click to edit"}
              >
                {book.seriesNumber || '-'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Caracteres' : 'Characters'}</span>
              <span style={{ fontWeight: 500, color: '#fff' }}>{charsCount.toLocaleString()}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('lastRead', lang)}</span>
              <span style={{ fontWeight: 500, color: '#fff' }}>{formatDate(book.lastRead)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Añadido' : 'Added'}</span>
              <span style={{ fontWeight: 500, color: '#fff' }}>{formatDate(book.createdAt)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '4px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Última actualización' : 'Last update'}</span>
              <span style={{ fontWeight: 500, color: '#fff' }}>{formatDate(book.updatedAt || book.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const updateSetting = (key: string, value: any) => {
    onSaveSettings({
      ...settings,
      [key]: value
    });
  };

  const getSliderVal = () => {
    return settings.fontSize || 36;
  };

  const sidebarGroups = [
    {
      id: 'general',
      label: lang === 'es' ? 'General' : 'General',
      icon: <Palette size={16} />,
      tabs: [
        { id: 'theme', label: lang === 'es' ? 'Tema' : 'Theme' },
        { id: 'display', label: lang === 'es' ? 'Pantalla' : 'Display' },
        { id: 'discord', label: 'Discord' },
        { id: 'about', label: lang === 'es' ? 'Acerca de / Versión' : 'About / Version' }
      ]
    },
    {
      id: 'lector',
      label: lang === 'es' ? 'Lector' : 'Reader',
      icon: <BookOpen size={16} />,
      tabs: [
        { id: 'text-style', label: lang === 'es' ? 'Estilo de texto' : 'Text Style' },
        { id: 'rendering', label: lang === 'es' ? 'Resaltado' : 'Highlighting' }
      ]
    },
    {
      id: 'anki',
      label: 'Anki',
      icon: <Layers size={16} />,
      tabs: [
        { id: 'sources', label: lang === 'es' ? 'Integración con Anki' : 'Anki Integration' }
      ]
    },
    {
      id: 'datos',
      label: lang === 'es' ? 'Datos' : 'Data',
      icon: <FolderOpen size={16} />,
      tabs: [
        { id: 'backups', label: lang === 'es' ? 'Copias de seguridad' : 'Backups' },
        { id: 'dictionaries', label: lang === 'es' ? 'Diccionarios' : 'Dictionaries' },
        { id: 'danger-zone', label: lang === 'es' ? 'Zona de peligro' : 'Danger Zone' }
      ]
    }
  ];

  const currentGroup = sidebarGroups.find(g => g.tabs.some(t => t.id === activeSection)) || sidebarGroups[0];

  // 1. GENERAL / Tema
  const renderThemeContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Tema' : 'Theme'}</h4>
      <div className="migaku-row">
        <span className="migaku-label">{lang === 'es' ? 'Tema del lector' : 'Reader Theme'}</span>
        <select 
          value={settings.readerTheme || 'dark'}
          onChange={(e) => updateSetting('readerTheme', e.target.value)}
          className="migaku-select"
        >
          <option value="dark">{lang === 'es' ? 'Oscuro Yoru (por defecto)' : 'Dark Yoru (default)'}</option>
          <option value="sepia">{lang === 'es' ? 'Sepia Relajante' : 'Warm Sepia'}</option>
          <option value="light">{lang === 'es' ? 'Claro clásico' : 'Classic Light'}</option>
        </select>
      </div>

      <div style={{ marginTop: '16px' }}>
        <button 
          type="button"
          onClick={() => {
            onClose();
            onOpenTutorial?.();
          }}
          style={{
            width: '100%',
            padding: '11px 16px',
            background: 'rgba(255, 224, 0, 0.08)',
            border: '1px solid rgba(255, 224, 0, 0.25)',
            borderRadius: '8px',
            color: '#FFE000',
            fontWeight: 600,
            fontSize: '0.86rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 224, 0, 0.16)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 224, 0, 0.08)'; }}
        >
          💡 {lang === 'es' ? 'Ver Guía Rápida y Atajos de Teclado' : 'View Quick Guide & Shortcuts'}
        </button>
      </div>
    </div>
  );

  // 2. GENERAL / Pantalla
  const renderDisplayContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Pantalla' : 'Display'}</h4>
      <div className="migaku-row">
        <span className="migaku-label">{t('interfaceLanguage', lang)}</span>
        <select 
          value={settings.appLanguage || 'en'}
          onChange={(e) => updateSetting('appLanguage', e.target.value)}
          className="migaku-select"
        >
          <option value="es">Español 🇪🇸</option>
          <option value="en">English 🇺🇸</option>
        </select>
      </div>
    </div>
  );

  // 3. LECTOR / Estilo de texto
  const renderTextStyleContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Estilo de texto' : 'Text Style'}</h4>
      
      <div className="migaku-row" style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}>
        <span className="migaku-label" style={{ fontSize: '0.72rem', fontWeight: 800, color: '#ff6b4a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {lang === 'es' ? 'AJUSTES DE PANTALLA' : 'DISPLAY SETTINGS'}
        </span>
        <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px' }}>
          {lang === 'es' ? 'Tamaño del texto' : 'Text size'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 4px', width: '100%' }}>
          <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 700, opacity: 0.6 }}>A</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <input 
              type="range" 
              min="0" 
              max="4" 
              step="1"
              value={FONT_SIZE_STEPS.includes(getSliderVal()) ? FONT_SIZE_STEPS.indexOf(getSliderVal()) : 2}
              onChange={(e) => {
                const newSize = FONT_SIZE_STEPS[parseInt(e.target.value)];
                updateSetting('fontSize', newSize);
              }}
              className="migaku-range-slider"
            />
          </div>
          <span style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>A</span>
        </div>
      </div>

      <div className="migaku-row" style={{ marginBottom: '14px' }}>
        <span className="migaku-label">Furigana</span>
        <select 
          value={settings.showFurigana || 'unknown-only'}
          onChange={(e) => updateSetting('showFurigana', e.target.value)}
          className="migaku-select"
        >
          <option value="unknown-only">{lang === 'es' ? 'Palabras desconocidas' : 'Unknown words only'}</option>
          <option value="all">{lang === 'es' ? 'Todo' : 'All'}</option>
          <option value="none">{t('pitchNone', lang)}</option>
        </select>
      </div>

      <div className="migaku-row" style={{ marginBottom: '14px' }}>
        <span className="migaku-label">{lang === 'es' ? 'Dirección de lectura' : 'Reading direction'}</span>
        <select 
          value={settings.readingOrientation || 'horizontal'}
          onChange={(e) => updateSetting('readingOrientation', e.target.value)}
          className="migaku-select"
        >
          <option value="horizontal">Horizontal (Yokogaki)</option>
          <option value="vertical">Vertical (Tategaki)</option>
        </select>
      </div>

      {libraryViewProps && (
        <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {lang === 'es' ? 'Ajustes de Biblioteca' : 'Library Card Settings'}
          </div>

          <div className="drawer-section">
            <span className="migaku-label" style={{ fontSize: '0.85rem' }}>{lang === 'es' ? 'Ancho de tarjetas' : 'Card Width'} ({libraryViewProps.cardWidth}px)</span>
            <input 
              type="range" 
              min="120" 
              max="240" 
              step="8"
              value={libraryViewProps.cardWidth} 
              onChange={(e) => libraryViewProps.setCardWidth(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer', marginTop: '6px' }}
            />
          </div>

          <div className="migaku-row">
            <span className="migaku-label">{lang === 'es' ? 'Imagen de portada' : 'Cover Image'}</span>
            <select 
              value={libraryViewProps.coverFit}
              onChange={(e) => libraryViewProps.setCoverFit(e.target.value)}
              className="migaku-select"
            >
              <option value="cover">{lang === 'es' ? 'Rellenar' : 'Fill'}</option>
              <option value="contain">{lang === 'es' ? 'Ajustar' : 'Fit'}</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
            <span className="migaku-label" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
              {lang === 'es' ? 'Detalles a mostrar:' : 'Details to display:'}
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { key: 'title', label: lang === 'es' ? 'Título' : 'Title', value: libraryViewProps.showCardTitle, setter: libraryViewProps.setShowCardTitle },
                { key: 'series', label: lang === 'es' ? 'Serie' : 'Series', value: libraryViewProps.showCardSeries, setter: libraryViewProps.setShowCardSeries },
                { key: 'author', label: lang === 'es' ? 'Autor' : 'Author', value: libraryViewProps.showCardAuthor, setter: libraryViewProps.setShowCardAuthor },
                { key: 'tags', label: lang === 'es' ? 'Etiquetas' : 'Tags', value: libraryViewProps.showCardTags, setter: libraryViewProps.setShowCardTags },
                { key: 'progress', label: lang === 'es' ? 'Progreso' : 'Progress', value: libraryViewProps.showCardProgress, setter: libraryViewProps.setShowCardProgress },
                { key: 'status', label: lang === 'es' ? 'Estado' : 'Status', value: libraryViewProps.showCardStatus, setter: libraryViewProps.setShowCardStatus }
              ].map(opt => (
                <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={opt.value} 
                    onChange={(e) => opt.setter(e.target.checked)}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );

  // 4. LECTOR / Resaltado
  const renderRenderingContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Resaltado' : 'Highlighting'}</h4>
      
      <div className="migaku-row">
        <span className="migaku-label">{lang === 'es' ? 'Acento por color' : 'Pitch accent by color'}</span>
        <select 
          value={settings.pitchAccent || 'none'}
          onChange={(e) => updateSetting('pitchAccent', e.target.value)}
          className="migaku-select"
        >
          <option value="none">{t('pitchNone', lang)}</option>
          <option value="pitch-color">{t('pitchColor', lang)}</option>
        </select>
      </div>

      <div className="migaku-row">
        <span className="migaku-label">{lang === 'es' ? 'Estado de aprendizaje' : 'Learning Status'}</span>
        <label className="migaku-switch">
          <input 
            type="checkbox" 
            checked={settings.showLearningStatus !== false}
            onChange={(e) => updateSetting('showLearningStatus', e.target.checked)}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      <div className="migaku-row">
        <span className="migaku-label">{lang === 'es' ? 'Oración al pasar el cursor' : 'Sentence hover info'}</span>
        <label className="migaku-switch">
          <input 
            type="checkbox" 
            checked={settings.sentenceHover === true}
            onChange={(e) => updateSetting('sentenceHover', e.target.checked)}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>
    </div>
  );

  // 5. INTEGRACIÓN / Integración con Anki
  const renderSourcesContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Gestión de Vocabulario y Anki' : 'Vocabulary & Anki Management'}</h4>
      <div className="migaku-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Configura la conexión con tu cliente de AnkiConnect para minar vocabulario e importar tus palabras desde Anki, JPDB, archivos locales o listas de frecuencia.' : 'Configure connection to AnkiConnect client for vocabulary mining, and import your words from Anki, JPDB, local files, or frequency lists.'}
        </span>
        <button
          className="anki-open-settings-btn"
          onClick={() => setIsVocabModalOpen(true)}
          type="button"
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}
        >
          <span>📊 {lang === 'es' ? 'Abrir Panel de Vocabulario y Anki' : 'Open Vocabulary & Anki Panel'}</span>
          <span style={{ fontSize: '0.9rem' }}>→</span>
        </button>
      </div>
    </div>
  );

  // 6. DATOS / Copias de seguridad
  const renderBackupsContent = () => {
    const gDriveActive = localStorage.getItem('yoru_gdrive_tokens') !== null;
    return (
      <div className="settings-panel-section">
        <h4 className="settings-panel-title">{lang === 'es' ? 'Copias de seguridad' : 'Backups'}</h4>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>GOOGLE DRIVE</span>
              <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '8px', background: gDriveActive ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.05)', color: gDriveActive ? '#34d399' : 'rgba(255,255,255,0.4)' }}>
                {gDriveActive ? (lang === 'es' ? 'VINCULADO' : 'LINKED') : (lang === 'es' ? 'DESCONECTADO' : 'DISCONNECTED')}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 10px 0' }}>
              {lang === 'es' ? 'Sincroniza tus libros y progreso en la nube.' : 'Sync your books and progress in the cloud.'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <span className="migaku-label" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
              {lang === 'es' ? 'Copias Locales (Archivo ZIP)' : 'Local Backups (ZIP File)'}
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  if (onExportLibrary) {
                    onExportLibrary();
                  } else if (window.electronAPI && window.electronAPI.exportLibrary) {
                    window.electronAPI.exportLibrary().then((res: any) => {
                      if (res) alert(lang === 'es' ? 'Copia de seguridad guardada con éxito.' : 'Backup saved successfully.');
                    }).catch((e: any) => alert(e.message));
                  } else {
                    alert(lang === 'es' ? 'La copia local no está disponible.' : 'Local backup is not available.');
                  }
                }}
                style={{ flex: 1, padding: '8px 10px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                💾 {lang === 'es' ? 'Exportar copia' : 'Export backup'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onTriggerImportBackup) {
                    onTriggerImportBackup();
                  } else {
                    alert(lang === 'es' ? 'La importación local no está disponible.' : 'Local import is not available.');
                  }
                }}
                style={{ flex: 1, padding: '8px 10px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                📂 {lang === 'es' ? 'Importar copia' : 'Import backup'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 7. DATOS / Diccionarios
  const renderDictionariesContent = () => {
    const disabledDictionaries: string[] = settings.disabledDictionaries || [];
    const handleDictionaryToggle = (title: string) => {
      const nextDisabled = disabledDictionaries.includes(title)
        ? disabledDictionaries.filter(item => item !== title)
        : [...disabledDictionaries, title];
      clearYomitanCache();
      onSaveSettings({ ...settings, disabledDictionaries: nextDisabled });
    };

    return (
      <div className="settings-panel-section">
        <h4 className="settings-panel-title">{lang === 'es' ? 'Diccionarios' : 'Dictionaries'}</h4>
        <p className="settings-panel-desc">
          {lang === 'es'
            ? 'Las instalaciones nuevas activan el diccionario del idioma elegido. Puedes desactivar o volver a activar cada paquete cuando quieras.'
            : 'New installations enable the dictionary for the selected language. You can enable or disable each package at any time.'}
        </p>
        {dictionariesLoading ? (
          <div className="settings-dictionary-empty">{lang === 'es' ? 'Cargando diccionarios…' : 'Loading dictionaries…'}</div>
        ) : dictionariesError ? (
          <div className="settings-dictionary-empty" role="alert">
            {lang === 'es' ? 'No se pudieron cargar los diccionarios. Cierra y vuelve a abrir estos ajustes.' : 'Could not load dictionaries. Close and reopen these settings.'}
          </div>
        ) : installedDictionaries.length === 0 ? (
          <div className="settings-dictionary-empty">
            {lang === 'es' ? 'No hay diccionarios instalados. Instala uno desde la biblioteca de recursos.' : 'No dictionaries are installed. Install one from the resource library.'}
          </div>
        ) : (
          <div className="settings-dictionary-list">
            {installedDictionaries.map(dictionary => {
              const isEnabled = !disabledDictionaries.includes(dictionary.title);
              const isInstalling = dictionary.importState === 'installing';
              const detail = dictionary.hasTerms && dictionary.hasFreqs
                ? (lang === 'es' ? 'Términos y datos de acento/frecuencia' : 'Terms and pitch/frequency data')
                : dictionary.hasTerms
                  ? (lang === 'es' ? 'Diccionario de términos' : 'Term dictionary')
                  : (lang === 'es' ? 'Frecuencia y acento tonal' : 'Frequency and pitch accent');
              return (
                <label className="settings-dictionary-row" key={dictionary.title}>
                  <span className="settings-dictionary-copy">
                    <strong>{dictionary.title}</strong>
                    <small>{dictionary.description || detail}</small>
                  </span>
                  <span className="settings-dictionary-state">
                    <span className={!isInstalling && isEnabled ? 'settings-dictionary-status is-enabled' : 'settings-dictionary-status'}>
                      {isInstalling
                        ? (lang === 'es' ? 'Instalando' : 'Installing')
                        : isEnabled ? (lang === 'es' ? 'Activo' : 'Active') : (lang === 'es' ? 'Pausado' : 'Paused')}
                    </span>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={isInstalling}
                      onChange={() => handleDictionaryToggle(dictionary.title)}
                      aria-label={`${isEnabled ? (lang === 'es' ? 'Desactivar' : 'Disable') : (lang === 'es' ? 'Activar' : 'Enable')} ${dictionary.title}`}
                    />
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // 8. DATOS / Zona de peligro
  const renderDangerZoneContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title" style={{ color: '#f87171', borderLeftColor: '#f87171' }}>{lang === 'es' ? 'Zona de peligro' : 'Danger Zone'}</h4>
      <div style={{ background: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255, 255, 255, 0.6)', margin: 0, lineHeight: 1.4 }}>
          {lang === 'es' ? 'Estas acciones son destructivas y no se pueden deshacer. Se borrarán tus estadísticas, libros importados y configuraciones.' : 'These actions are destructive and cannot be undone. Your stats, imported books, and settings will be permanently deleted.'}
        </p>
        <button
          type="button"
          onClick={async () => {
            const ok = await showConfirm({
              title: lang === 'es' ? '¿Restablecer datos?' : 'Reset data?',
              message: lang === 'es' ? '¿Estás absolutamente seguro de que deseas restablecer TODOS los datos? Esta acción es irreversible.' : 'Are you absolutely sure you want to reset ALL data? This is irreversible.',
              type: 'danger',
              confirmText: lang === 'es' ? 'Restablecer' : 'Reset'
            });
            if (ok) {
              localStorage.clear();
              const req = indexedDB.deleteDatabase('yoru-reader-db');
              req.onsuccess = async () => {
                await showConfirm({
                  title: lang === 'es' ? 'Éxito' : 'Success',
                  message: lang === 'es' ? 'Aplicación restablecida con éxito. Se reiniciará ahora.' : 'App reset successfully. Restarting now.',
                  type: 'info',
                  confirmText: lang === 'es' ? 'Reiniciar' : 'Restart',
                  cancelText: ''
                });
                window.location.reload();
              };
              req.onerror = () => {
                window.location.reload();
              };
            }
          }}
          style={{ width: '100%', padding: '10px', fontSize: '0.8rem', background: '#ef4444', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
        >
          🔧 {lang === 'es' ? 'Restablecer base de datos y ajustes' : 'Reset Database & Settings'}
        </button>
      </div>
    </div>
  );

  // 9. GENERAL / Acerca de / Versión
  const renderAboutContent = () => (
    <div className="settings-panel-section">
      <h4 className="settings-panel-title">{lang === 'es' ? 'Acerca de / Versión' : 'About / Version'}</h4>
      <AppAbout lang={lang} />
    </div>
  );

  const renderDiscordContent = () => {
    return (
      <div className="settings-panel-section">
        <h4 className="settings-panel-title">Discord Rich Presence</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
              <input
                type="checkbox"
                checked={settings.discordEnabled || false}
                onChange={(e) => updateSetting('discordEnabled', e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
              />
              {lang === 'es' ? 'Habilitar Discord Rich Presence' : 'Enable Discord Rich Presence'}
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {lang === 'es' ? 'Temporizador de inactividad (segundos)' : 'Inactivity Timer (seconds)'}
            </label>
            <input
              type="number"
              value={settings.discordInactivityTimer !== undefined ? settings.discordInactivityTimer : 300}
              onChange={(e) => updateSetting('discordInactivityTimer', parseInt(e.target.value) || 0)}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.88rem',
                width: '100%'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {lang === 'es' ? 'Icono' : 'Icon'}
            </label>
            <select
              value={settings.discordIcon || 'Yoru'}
              onChange={(e) => updateSetting('discordIcon', e.target.value)}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#fff',
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {lang === 'es' ? 'Mostrar Estadísticas' : 'Show Stats'}
            </label>
            <select
              value={settings.discordShowStats || 'None'}
              onChange={(e) => updateSetting('discordShowStats', e.target.value)}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#fff',
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {lang === 'es' ? 'Novelas/Escenas en lista negra' : 'Blacklisted Novels/Scenes'}
            </label>
            <textarea
              value={settings.discordBlacklist || ''}
              onChange={(e) => updateSetting('discordBlacklist', e.target.value)}
              placeholder={lang === 'es' ? 'Escribe nombres de libros a ignorar, uno por línea...' : 'Enter book names to ignore, one per line...'}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.88rem',
                width: '100%',
                minHeight: '100px',
                resize: 'vertical'
              }}
            />
          </div>

        </div>
      </div>
    );
  };

  const renderActiveContent = () => {
    switch (activeSection) {
      case 'theme':
        return renderThemeContent();
      case 'display':
        return renderDisplayContent();
      case 'discord':
        return renderDiscordContent();
      case 'about':
        return renderAboutContent();
      case 'text-style':
        return renderTextStyleContent();
      case 'rendering':
        return renderRenderingContent();
      case 'sources':
        return renderSourcesContent();
      case 'backups':
        return renderBackupsContent();
      case 'dictionaries':
        return renderDictionariesContent();
      case 'danger-zone':
        return renderDangerZoneContent();
      default:
        return renderTextStyleContent();
    }
  };

  const allSettingsItems = [
    { id: 'theme', keywords: 'theme tema dark light sepia fondo background', render: renderThemeContent },
    { id: 'display', keywords: 'display visualizacion interfaz idioma language interfaces spanish english pantalla', render: renderDisplayContent },
    { id: 'discord', keywords: 'discord rich presence rpc estado actividad juego', render: renderDiscordContent },
    { id: 'about', keywords: 'about version changelog acerca de info info-version cambios novedades', render: renderAboutContent },
    { id: 'text-style', keywords: 'text style estilo texto fuente font size tamaño slider furigana tarjetas library covers', render: renderTextStyleContent },
    { id: 'rendering', keywords: 'rendering renderizado acento pitch learning status cursor hover resaltado', render: renderRenderingContent },
    { id: 'sources', keywords: 'sources fuentes anki anki-connect deck cards note integracion', render: renderSourcesContent },
    { id: 'backups', keywords: 'backups copias seguridad google drive cloud zip export backup local', render: renderBackupsContent },
    { id: 'dictionaries', keywords: 'dictionaries diccionarios yomitan deinflector words', render: renderDictionariesContent },
    { id: 'danger-zone', keywords: 'danger zone peligro reset clear delete database restablecer borrar', render: renderDangerZoneContent }
  ];

  const filteredItems = searchQuery.trim() 
    ? allSettingsItems.filter(item => item.keywords.includes(searchQuery.toLowerCase()))
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`settings-sidebar-modal mobile-subview-${mobileSubView}`} onClick={(e) => e.stopPropagation()}>
        
        {/* Panel Izquierdo: Sidebar Navigation */}
        <div className="settings-sidebar-left">
          <div className="settings-sidebar-title">
            <span>{lang === 'es' ? 'Configuración' : 'Settings'}</span>
            <button className="settings-close-btn-mobile" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="settings-search-box">
            <Search size={14} className="search-icon-prefix" />
            <input 
              type="text" 
              placeholder={lang === 'es' ? 'Buscar...' : 'Find...'} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="settings-search-input"
            />
            <span className="search-shortcut-badge">CTRL F</span>
          </div>

          {!searchQuery.trim() && (
            <div className="settings-sidebar-menu-list">
              <div className="settings-menu-group">
                <div className="settings-group-header">
                  <span>{lang === 'es' ? 'Configuración Clave' : 'Key Settings'}</span>
                </div>
                <div className="settings-group-items">
                  {sidebarGroups.map((group) => {
                    const isActive = currentGroup.id === group.id;
                    return (
                      <button
                        key={group.id}
                        onClick={() => {
                          setActiveSection(group.tabs[0].id);
                          setMobileSubView('content');
                        }}
                        className={`settings-menu-item-btn ${isActive ? 'active' : ''}`}
                        style={{ color: isActive ? 'var(--primary)' : 'rgba(255, 255, 255, 0.65)' }}
                      >
                        {group.icon}
                        <span>{group.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {searchQuery.trim() && (
            <div className="settings-sidebar-menu-list">
              <div className="settings-menu-group">
                <div className="settings-group-header">
                  <span>{lang === 'es' ? 'Resultados' : 'Results'}</span>
                </div>
                <div className="settings-group-items">
                  {filteredItems.map(item => {
                    const labelObj = sidebarGroups.flatMap(g => g.tabs).find(t => t.id === item.id) || { label: item.id };
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveSection(item.id); setSearchQuery(''); setMobileSubView('content'); }}
                        className="settings-menu-item-btn"
                      >
                        <span>🔍</span>
                        <span>{labelObj.label}</span>
                      </button>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)', padding: '10px 14px', fontStyle: 'italic' }}>
                      {lang === 'es' ? 'Sin resultados' : 'No results found'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel Derecho: Contenido de Ajustes */}
        <div className="settings-sidebar-right">
          <div className="settings-right-header">
            <button 
              className="settings-back-btn-mobile" 
              onClick={() => setMobileSubView('menu')}
              type="button"
            >
              ← {lang === 'es' ? 'Atrás' : 'Back'}
            </button>
            <span className="settings-header-label">
              {currentGroup.label}
            </span>
            <button className="settings-close-x-btn" onClick={onClose} title={lang === 'es' ? 'Cerrar' : 'Close'}>
              <X size={18} />
            </button>
          </div>

          <div className="settings-right-content-viewport">
            {/* Tabs at the top */}
            {!searchQuery.trim() && (
              <div style={{ 
                display: 'flex', 
                gap: '8px', 
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)', 
                paddingBottom: '12px', 
                marginBottom: '20px' 
              }}>
                {currentGroup.tabs.map(tab => {
                  const isActive = activeSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveSection(tab.id)}
                      style={{
                        padding: '6px 16px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        background: isActive ? 'var(--primary)' : 'rgba(255, 255, 255, 0.02)',
                        border: isActive ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                        color: isActive ? '#000' : 'rgba(255, 255, 255, 0.65)'
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}

            {searchQuery.trim() && filteredItems.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {filteredItems.map((item, idx) => (
                  <div key={item.id}>
                    {item.render()}
                    {idx < filteredItems.length - 1 && <hr style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', marginTop: '24px' }} />}
                  </div>
                ))}
              </div>
            ) : (
              renderActiveContent()
            )}
          </div>
        </div>

      </div>

      <React.Suspense fallback={null}>
        {isVocabModalOpen && (
          <VocabularyModal isOpen={isVocabModalOpen} onClose={() => setIsVocabModalOpen(false)} />
        )}
      </React.Suspense>
      {confirmModal}
    </div>
  );
}
