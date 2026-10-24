import React from 'react';
import { Copy, Bookmark, StickyNote, Volume2 } from 'lucide-react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../utils/highlights';

interface ReaderColors {
  textMain: string;
  textMuted: string;
  headerBg?: string;
  border?: string;
  popoverBg?: string;
  cardBg?: string;
  accent: string;
}

interface SelectionToolbarProps {
  visible: boolean;
  /** x: centre of the selection, y: its top; bottom (optional): its bottom, to go below it when there is no room above. */
  position: { x: number; y: number; bottom?: number } | null;
  selectedText: string;
  onCopy: () => void;
  onBookmark: () => void;
  onHighlight?: (color: HighlightColor) => void;
  onNote?: () => void;
  /** Read aloud from the selection. */
  onReadAloud?: () => void;
  colors: ReaderColors;
  lang: string;
}

const TOOLBAR_HALF_WIDTH = 180;

/**
 * SelectionToolbar — floating toolbar on text selection: highlight colours, note, copy, bookmark,
 * read aloud from here.
 */
export default function SelectionToolbar({
  visible,
  position,
  onCopy,
  onBookmark,
  onHighlight,
  onNote,
  onReadAloud,
  colors,
  lang,
}: SelectionToolbarProps) {
  if (!visible || !position) return null;
  const es = lang === 'es';

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    border: 'none',
    background: 'none',
    color: colors.textMain,
    fontSize: '0.78rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    borderRadius: '6px',
    transition: 'background 0.15s',
  };
  const hover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'none'; },
  };
  const divider = <div style={{ width: '1px', height: '20px', background: colors.border, flexShrink: 0 }} />;

  // Keep the bar on screen, above the selection when there is room, below it otherwise.
  const x = Math.min(Math.max(position.x, TOOLBAR_HALF_WIDTH + 8), window.innerWidth - TOOLBAR_HALF_WIDTH - 8);
  // A tall selection (vertical text, several lines) goes below its bottom, or inside it near its top.
  const below = position.bottom !== undefined ? position.bottom + 12 : position.y + 34;
  const top = position.y - 56 >= 60 ? position.y - 56 : below + 48 < window.innerHeight - 8 ? below : Math.max(8, position.y + 8);

  return (
    <div
      role="toolbar"
      aria-label={es ? 'Acciones de la selección' : 'Selection actions'}
      // Pressing a button must not clear the text selection first.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${x}px`,
        transform: 'translateX(-50%)',
        zIndex: 10010,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        maxWidth: 'calc(100vw - 16px)',
        background: colors.popoverBg || 'rgba(20, 20, 24, 0.95)',
        border: `1px solid ${colors.border}`,
        borderRadius: '12px',
        padding: '4px 6px',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      {onHighlight && (
        <>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              onClick={() => onHighlight(color.id)}
              aria-label={es ? `Subrayar en ${color.es.toLowerCase()}` : `Highlight ${color.en.toLowerCase()}`}
              title={es ? color.es : color.en}
              style={{ ...btnStyle, padding: '8px 6px' }}
              {...hover}
            >
              <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: color.swatch, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.25)' }} />
            </button>
          ))}
          {divider}
        </>
      )}
      {onNote && (
        <>
          <button type="button" style={btnStyle} onClick={onNote} {...hover}>
            <StickyNote size={14} />
            {es ? 'Nota' : 'Note'}
          </button>
          {divider}
        </>
      )}
      <button type="button" style={btnStyle} onClick={onCopy} aria-label={es ? 'Copiar' : 'Copy'} title={es ? 'Copiar' : 'Copy'} {...hover}>
        <Copy size={14} />
      </button>
      <button type="button" style={btnStyle} onClick={onBookmark} aria-label={es ? 'Marcador' : 'Bookmark'} title={es ? 'Marcador' : 'Bookmark'} {...hover}>
        <Bookmark size={14} />
      </button>
      {onReadAloud && (
        <button type="button" style={btnStyle} onClick={onReadAloud} aria-label={es ? 'Leer en voz alta desde aquí' : 'Read aloud from here'} title={es ? 'Leer desde aquí' : 'Read from here'} {...hover}>
          <Volume2 size={14} />
        </button>
      )}
    </div>
  );
}
