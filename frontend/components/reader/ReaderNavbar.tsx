import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  List,
  Settings,
  Image,
  Activity,
  Timer,
  Headphones,
  Search,
  MoreVertical,
  StickyNote,
  Bookmark,
  BookAudio,
  Cloud,
} from 'lucide-react';

interface ReaderColors {
  textMain: string;
  textMuted: string;
  headerBg?: string;
  border?: string;
  popoverBg?: string;
  cardBg?: string;
  accent: string;
}

interface ReaderNavbarProps {
  visible: boolean;
  onClose?: () => void;
  onBack: () => void;
  onToggleToc: () => void;
  onToggleBookmarks?: () => void;
  onToggleSession?: () => void;
  isReadingSpeedActive?: boolean;
  isReadingSpeedPaused?: boolean;
  readingSpeed?: number;
  onToggleReadingSpeed?: () => void;
  onToggleSettings: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  bookTitle: string;
  bookAuthor?: string;
  sectionTitle?: string;
  colors: ReaderColors;
  lang?: string;
  isBookCompleted?: boolean;
  onToggleFlagCompleted?: () => void;
  onOpenGallery?: () => void;
  onOpenJumpModal?: () => void;
  onMouseLeave?: () => void;
  isReadingAloud?: boolean;
  onToggleReadAloud?: () => void;
  /** Audiobook from Audiobookshelf; only when a server is connected. */
  isAudiobookOpen?: boolean;
  /** El libro se esta leyendo del servidor, sin guardarlo. */
  isTemporary?: boolean;
  /** Guardarlo en la biblioteca sin volver a bajarlo. */
  onKeep?: () => void;
  onToggleAudiobook?: () => void;
  onOpenSearch?: () => void;
  onOpenNotes?: () => void;
  /** The page on screen has a bookmark (ribbon), and the button that sets or removes it. */
  isPageBookmarked?: boolean;
  onTogglePageBookmark?: () => void;
}

/**
 * Reader top bar, ReadEra-style: back on the left, read aloud / search / contents / settings /
 * more on the right, and the book title, author and current section underneath.
 */
export default function ReaderNavbar({
  visible,
  onBack,
  onToggleToc,
  onToggleSettings,
  bookTitle,
  bookAuthor,
  sectionTitle,
  colors,
  lang = 'es',
  onOpenGallery,
  onToggleSession,
  isReadingSpeedActive = false,
  isReadingSpeedPaused = false,
  readingSpeed = 0,
  onToggleReadingSpeed,
  onMouseLeave,
  isReadingAloud = false,
  onToggleReadAloud,
  isAudiobookOpen = false,
  isTemporary = false,
  onKeep,
  onToggleAudiobook,
  onOpenSearch,
  onOpenNotes,
  isPageBookmarked = false,
  onTogglePageBookmark,
}: ReaderNavbarProps) {
  const es = lang === 'es';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const runAndClose = (action?: () => void) => () => {
    setMenuOpen(false);
    action?.();
  };

  const speedLabel = `${isReadingSpeedPaused ? (es ? 'Pausada · ' : 'Paused · ') : ''}${readingSpeed.toLocaleString()} ${es ? 'car/h' : 'ch/h'}`;

  return (
    <div
      className="reader-topbar"
      onMouseLeave={onMouseLeave}
      style={{
        transform: visible ? 'translateY(0)' : 'translateY(-110%)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div className="reader-topbar-row">
        <button type="button" className="reader-topbar-btn" onClick={onBack} title={es ? 'Volver' : 'Back'} aria-label={es ? 'Volver' : 'Back'}>
          <ArrowLeft size={22} />
        </button>

        <div className="reader-topbar-actions">
          {onToggleReadAloud && (
            <button
              type="button"
              className={`reader-topbar-btn${isReadingAloud ? ' is-active' : ''}`}
              onClick={onToggleReadAloud}
              title={es ? 'Leer en voz alta' : 'Read aloud'}
              aria-label={es ? 'Leer en voz alta' : 'Read aloud'}
              aria-pressed={isReadingAloud}
              style={isReadingAloud ? { color: colors.accent } : undefined}
            >
              <Headphones size={21} />
            </button>
          )}
          {onOpenSearch && (
            <button type="button" className="reader-topbar-btn" onClick={onOpenSearch} title={es ? 'Buscar en el libro' : 'Search in book'} aria-label={es ? 'Buscar en el libro' : 'Search in book'}>
              <Search size={21} />
            </button>
          )}
          {onTogglePageBookmark && (
            <button
              type="button"
              className={`reader-topbar-btn${isPageBookmarked ? ' is-active' : ''}`}
              onClick={onTogglePageBookmark}
              title={isPageBookmarked ? (es ? 'Quitar marcador de esta página' : 'Remove page bookmark') : (es ? 'Marcar esta página' : 'Bookmark this page')}
              aria-label={isPageBookmarked ? (es ? 'Quitar marcador de esta página' : 'Remove page bookmark') : (es ? 'Marcar esta página' : 'Bookmark this page')}
              aria-pressed={isPageBookmarked}
              style={isPageBookmarked ? { color: colors.accent } : undefined}
            >
              <Bookmark size={21} fill={isPageBookmarked ? 'currentColor' : 'none'} />
            </button>
          )}
          <button type="button" className="reader-topbar-btn" onClick={onToggleToc} title={es ? 'Capítulos' : 'Chapters'} aria-label={es ? 'Capítulos' : 'Chapters'}>
            <List size={22} />
          </button>
          <button type="button" className="reader-topbar-btn" onClick={onToggleSettings} title={es ? 'Ajustes' : 'Settings'} aria-label={es ? 'Ajustes' : 'Settings'}>
            <Settings size={21} />
          </button>
          <div className="reader-topbar-more" ref={menuRef}>
            <button
              type="button"
              className="reader-topbar-btn"
              onClick={() => setMenuOpen((open) => !open)}
              title={es ? 'Más opciones' : 'More options'}
              aria-label={es ? 'Más opciones' : 'More options'}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical size={21} />
            </button>
            {menuOpen && (
              <div className="reader-topbar-menu" role="menu" style={{ background: colors.popoverBg || '#16181f' }}>
                {onToggleReadingSpeed && (
                  <button type="button" role="menuitem" onClick={runAndClose(onToggleReadingSpeed)}>
                    <Activity size={18} />
                    <span>
                      {isReadingSpeedActive ? (es ? 'Terminar medición' : 'Finish measuring') : (es ? 'Medir velocidad' : 'Measure speed')}
                      {isReadingSpeedActive && <small>{speedLabel}</small>}
                    </span>
                  </button>
                )}
                {onToggleSession && (
                  <button type="button" role="menuitem" onClick={runAndClose(onToggleSession)}>
                    <Timer size={18} />
                    <span>{es ? 'Sesión de lectura' : 'Reading session'}</span>
                  </button>
                )}
                {onToggleAudiobook && (
                  <button type="button" role="menuitem" onClick={runAndClose(onToggleAudiobook)}>
                    <BookAudio size={18} />
                    <span>{isAudiobookOpen ? (es ? 'Cerrar audiolibro' : 'Close audiobook') : (es ? 'Escuchar audiolibro' : 'Listen to audiobook')}</span>
                  </button>
                )}
                {onOpenNotes && (
                  <button type="button" role="menuitem" onClick={runAndClose(onOpenNotes)}>
                    <StickyNote size={18} />
                    <span>{es ? 'Subrayados y notas' : 'Highlights & notes'}</span>
                  </button>
                )}
                {onOpenGallery && (
                  <button type="button" role="menuitem" onClick={runAndClose(onOpenGallery)}>
                    <Image size={18} />
                    <span>{es ? 'Imágenes del libro' : 'Book images'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="reader-topbar-info">
        <div className="reader-topbar-title">{bookTitle}</div>
        {isTemporary && (
          <span className="reader-temporary">
            <Cloud size={13} aria-hidden="true" />
            {es ? 'Del servidor' : 'From the server'}
            {onKeep && (
              <button type="button" className="reader-temporary-keep" onClick={onKeep}>
                {es ? 'Descargar' : 'Download'}
              </button>
            )}
          </span>
        )}
        {bookAuthor && <div className="reader-topbar-sub">{bookAuthor}</div>}
        <div className="reader-topbar-sub">
          {sectionTitle && <span>{es ? 'Sección: ' : 'Section: '}{sectionTitle}</span>}
          {isReadingSpeedActive && (
            <button type="button" className="reader-topbar-speed" onClick={onToggleReadingSpeed} style={{ color: colors.accent, borderColor: `${colors.accent}66` }}>
              <Activity size={13} /> {speedLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
