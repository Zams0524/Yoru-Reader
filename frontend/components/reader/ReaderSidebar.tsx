import React, { useState, useEffect } from 'react';
import { X, Bookmark as BookmarkIcon, StickyNote, Copy } from 'lucide-react';
import { HIGHLIGHT_COLORS, type BookHighlight } from '../../utils/highlights';
import { isPhoneUI } from '../../utils/platform';

interface ReaderColors {
  textMain: string;
  textMuted: string;
  headerBg?: string;
  border?: string;
  popoverBg?: string;
  cardBg?: string;
  accent: string;
}

interface SectionItem {
  id: string;
  title: string;
  isFromToc?: boolean;
}

interface BookmarkItem {
  paragraphId: number;
  sectionName?: string;
  content?: string;
  text?: string;
  /** Set with the page button (a ribbon on the page), not from a text selection. */
  page?: boolean;
}

interface ReadingSessionState {
  isActive: boolean;
  isPaused: boolean;
  readingTime: number;
  charsRead: number;
  speed: string | number;
}

export type ReaderSidebarMode = 'toc' | 'bookmarks' | 'notes' | 'session';

interface ReaderSidebarProps {
  mode: ReaderSidebarMode | null;
  onModeChange?: (mode: ReaderSidebarMode) => void;
  highlights?: BookHighlight[];
  onGoToHighlight?: (highlight: BookHighlight) => void;
  onEditHighlight?: (highlight: BookHighlight) => void;
  onExportHighlights?: () => void;
  onClose: () => void;
  sections: SectionItem[];
  currSection: number;
  onGoToSection: (idx: number) => void;
  bookmarks: BookmarkItem[];
  onToggleBookmark?: (bm: BookmarkItem) => void;
  onGoToBookmark?: (bm: BookmarkItem) => void;
  /** Where a bookmark is, e.g. "Capítulo 3 · pág. 120". */
  describeBookmark?: (bm: BookmarkItem) => string;
  readingSession: ReadingSessionState;
  onToggleSession: () => void;
  colors: ReaderColors;
  lang: string;
}

/**
 * ReaderSidebar — Slide-in panel for TOC, Bookmarks, and Reading Session.
 */
export default function ReaderSidebar({
  mode,
  onModeChange,
  highlights = [],
  onGoToHighlight,
  onEditHighlight,
  onExportHighlights,
  onClose,
  sections,
  currSection,
  onGoToSection,
  bookmarks,
  onGoToBookmark,
  onToggleBookmark,
  describeBookmark,
  readingSession,
  onToggleSession,
  colors,
  lang,
}: ReaderSidebarProps) {
  if (!mode) return null;

  const isEs = !lang || lang === 'es';
  const titles = {
    toc: isEs ? 'Tabla de Contenidos' : 'Table of Contents',
    bookmarks: isEs ? 'Marcadores' : 'Bookmarks',
    notes: isEs ? 'Subrayados y notas' : 'Highlights & notes',
    session: isEs ? 'Sesión de Lectura' : 'Reading Session',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 10000,
        }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          [mode === 'session' ? 'right' : 'left']: 0,
          width: '340px',
          maxWidth: '85vw',
          height: '100vh',
          background: colors.popoverBg || '#0c0c0e',
          borderRight: mode !== 'session' ? `1px solid ${colors.border}` : 'none',
          borderLeft: mode === 'session' ? `1px solid ${colors.border}` : 'none',
          zIndex: 10001,
          display: 'flex',
          flexDirection: 'column',
          animation: mode === 'session' ? 'slideInRight 0.25s ease-out' : 'slideInLeft 0.25s ease-out',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'calc(16px + var(--yoru-safe-top, 0px)) 16px 16px',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: colors.textMain }}>
            {titles[mode]}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs (ReadEra-style contents / bookmarks / quotes) */}
        {mode !== 'session' && onModeChange && (
          <div className="reader-sidebar-tabs" role="tablist" style={{ borderBottom: `1px solid ${colors.border}` }}>
            {(['toc', 'bookmarks', 'notes'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode === tab}
                onClick={() => onModeChange(tab)}
                style={{
                  color: mode === tab ? colors.accent : colors.textMuted,
                  borderBottomColor: mode === tab ? colors.accent : 'transparent',
                }}
              >
                {tab === 'toc' ? (isEs ? 'Capítulos' : 'Chapters')
                  : tab === 'bookmarks' ? `${isEs ? 'Marcadores' : 'Bookmarks'}${bookmarks.length ? ` · ${bookmarks.length}` : ''}`
                    : `${isEs ? 'Notas' : 'Notes'}${highlights.length ? ` · ${highlights.length}` : ''}`}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {mode === 'toc' && (
            <TocContent
              sections={sections}
              currSection={currSection}
              onGoToSection={onGoToSection}
              onClose={onClose}
              colors={colors}
              lang={lang}
            />
          )}
          {mode === 'bookmarks' && (
            <BookmarksContent
              bookmarks={bookmarks}
              onGoToBookmark={onGoToBookmark}
              onRemove={onToggleBookmark}
              describe={describeBookmark}
              onClose={onClose}
              colors={colors}
              lang={lang}
            />
          )}
          {mode === 'notes' && (
            <NotesContent
              highlights={highlights}
              onGo={(item) => { onGoToHighlight?.(item); onClose(); }}
              onEdit={onEditHighlight}
              onExport={onExportHighlights}
              colors={colors}
              lang={lang}
            />
          )}
          {mode === 'session' && (
            <SessionContent
              session={readingSession}
              onToggle={onToggleSession}
              colors={colors}
              lang={lang}
            />
          )}
        </div>
      </div>
    </>
  );
}

// --- TOC ---
interface TocContentProps {
  sections: SectionItem[];
  currSection: number;
  onGoToSection: (idx: number) => void;
  onClose: () => void;
  colors: ReaderColors;
  lang?: string;
}

function TocContent({ sections, currSection, onGoToSection, onClose, colors, lang }: TocContentProps) {
  const isEs = !lang || lang === 'es';
  return (
    <div>
      {sections.map((section, idx) => (
        <div
          key={section.id}
          onClick={() => {
            onGoToSection(idx);
            onClose();
          }}
          style={{
            padding: '10px 12px',
            cursor: 'pointer',
            borderRadius: '6px',
            background: idx === currSection ? `${colors.accent}18` : 'transparent',
            borderLeft: idx === currSection ? `3px solid ${colors.accent}` : '3px solid transparent',
            marginBottom: '2px',
            fontSize: '0.85rem',
            color: idx === currSection ? colors.accent : colors.textMain,
            fontWeight: idx === currSection ? 600 : 400,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (idx !== currSection) e.currentTarget.style.background = `${colors.accent}0a`; }}
          onMouseLeave={e => { if (idx !== currSection) e.currentTarget.style.background = 'transparent'; }}
        >
          {section.title || (isEs ? `Sección ${idx + 1}` : `Chapter ${idx + 1}`)}
        </div>
      ))}
    </div>
  );
}

// --- Bookmarks ---
interface BookmarksContentProps {
  bookmarks: BookmarkItem[];
  onGoToBookmark?: (bm: BookmarkItem) => void;
  onRemove?: (bm: BookmarkItem) => void;
  describe?: (bm: BookmarkItem) => string;
  onClose: () => void;
  colors: ReaderColors;
  lang: string;
}

function BookmarksContent({ bookmarks, onGoToBookmark, onRemove, describe, onClose, colors, lang }: BookmarksContentProps) {
  if (!bookmarks || bookmarks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: colors.textMuted, fontSize: '0.85rem' }}>
        <BookmarkIcon size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
        <p>{lang === 'es' ? 'No hay marcadores guardados' : 'No bookmarks saved'}</p>
        <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '8px' }}>
          {lang === 'es'
            ? 'Toca el marcador de la barra superior para marcar la página, o mantén pulsado el texto y elige el marcador.'
            : 'Tap the bookmark in the top bar to mark the page, or long-press text and pick the bookmark.'}
        </p>
      </div>
    );
  }

  // In reading order, like the page bar shows them.
  const ordered = [...bookmarks].sort((a, b) => a.paragraphId - b.paragraphId);
  return (
    <div>
      {ordered.map((bm, idx) => (
        <div
          key={`${bm.paragraphId}-${idx}`}
          onClick={() => {
            if (onGoToBookmark) onGoToBookmark(bm);
            onClose();
          }}
          style={{
            padding: '10px 12px',
            cursor: 'pointer',
            borderRadius: '6px',
            marginBottom: '4px',
            fontSize: '0.82rem',
            color: colors.textMain,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.04)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginBottom: '4px' }}>
            <span style={{ opacity: 0.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {describe?.(bm) || (lang === 'es' ? `Marcador ${idx + 1}` : `Bookmark ${idx + 1}`)}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(bm); }}
                aria-label={lang === 'es' ? 'Quitar marcador' : 'Remove bookmark'}
                title={lang === 'es' ? 'Quitar marcador' : 'Remove bookmark'}
                style={{ border: 'none', background: 'none', color: colors.textMuted, cursor: 'pointer', padding: '2px', display: 'flex' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {bm.text || bm.content || '...'}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Highlights & notes ---
interface NotesContentProps {
  highlights: BookHighlight[];
  onGo: (item: BookHighlight) => void;
  onEdit?: (item: BookHighlight) => void;
  onExport?: () => void;
  colors: ReaderColors;
  lang: string;
}

function NotesContent({ highlights, onGo, onEdit, onExport, colors, lang }: NotesContentProps) {
  const isEs = lang === 'es';
  if (highlights.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: colors.textMuted, fontSize: '0.85rem' }}>
        <StickyNote size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
        <p>{isEs ? 'Aún no hay subrayados' : 'No highlights yet'}</p>
        <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '8px' }}>
          {isPhoneUI()
            ? (isEs ? 'Mantén pulsado el texto, elige un color o «Nota».' : 'Long-press text, then pick a colour or "Note".')
            : (isEs ? 'Selecciona texto con el ratón y elige un color o «Nota».' : 'Select text with the mouse, then pick a colour or "Note".')}
        </p>
      </div>
    );
  }
  const ordered = [...highlights].sort((a, b) => a.paragraphId - b.paragraphId || a.start - b.start);
  return (
    <div>
      {onExport && (
        <button type="button" className="reader-notes-export" onClick={onExport} style={{ color: colors.textMain, borderColor: colors.border }}>
          <Copy size={14} />
          {isEs ? 'Copiar todo como texto' : 'Copy all as text'}
        </button>
      )}
      {ordered.map((item) => (
        <div key={item.id} className="reader-note-item" style={{ borderLeftColor: HIGHLIGHT_COLORS.find((c) => c.id === item.color)?.swatch }}>
          <button type="button" className="reader-note-text" onClick={() => onGo(item)} style={{ color: colors.textMain }}>
            {item.text}
          </button>
          {item.note?.trim() && <div className="reader-note-note" style={{ color: colors.textMuted }}>{item.note}</div>}
          {onEdit && (
            <button type="button" className="reader-note-edit" onClick={() => onEdit(item)} style={{ color: colors.accent }}>
              {item.note?.trim() ? (isEs ? 'Editar nota' : 'Edit note') : (isEs ? 'Añadir nota' : 'Add note')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Reading Session ---
interface SessionContentProps {
  session: ReadingSessionState;
  onToggle: () => void;
  colors: ReaderColors;
  lang: string;
}

function SessionContent({ session, onToggle, colors, lang }: SessionContentProps) {
  const { isActive, isPaused, readingTime, charsRead, speed } = session || {};
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isActive && !isPaused) {
      const interval = setInterval(() => setTick(t => t + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [isActive, isPaused]);

  const formatTime = (secs: number) => {
    if (!secs) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const statBoxStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    padding: '14px',
    marginBottom: '8px',
  };

  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '10px',
          borderRadius: '8px',
          border: `1px solid ${colors.accent}40`,
          background: `${colors.accent}14`,
          color: colors.accent,
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: '16px',
        }}
      >
        {!isActive
          ? (lang === 'es' ? 'Iniciar sesión' : 'Start session')
          : isPaused
            ? (lang === 'es' ? 'Reanudar' : 'Resume')
            : (lang === 'es' ? 'Pausar' : 'Pause')
        }
      </button>

      {isActive && (
        <>
          <div style={statBoxStyle}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, marginBottom: '4px' }}>
              {lang === 'es' ? 'Tiempo de lectura' : 'Reading Time'}
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.textMain }}>
              {formatTime(readingTime || 0)}
            </div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, marginBottom: '4px' }}>
              {lang === 'es' ? 'Caracteres leídos' : 'Characters Read'}
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.textMain }}>
              {(charsRead || 0).toLocaleString()}
            </div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, marginBottom: '4px' }}>
              {lang === 'es' ? 'Velocidad' : 'Speed'}
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.textMain }}>
              {(speed || 0).toLocaleString()} {lang === 'es' ? 'caracteres/h' : 'chars/h'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
