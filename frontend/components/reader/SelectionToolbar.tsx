import React from 'react';
import { Copy, Bookmark } from 'lucide-react';

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
  position: { x: number; y: number } | null;
  selectedText: string;
  onCopy: () => void;
  onBookmark: () => void;
  colors: ReaderColors;
  lang: string;
}

/**
 * SelectionToolbar — Floating toolbar that appears on text selection.
 * Shows Copy and Bookmark buttons.
 */
export default function SelectionToolbar({
  visible,
  position,
  selectedText,
  onCopy,
  onBookmark,
  colors,
  lang,
}: SelectionToolbarProps) {
  if (!visible || !position) return null;

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    border: 'none',
    background: 'none',
    color: colors.textMain,
    fontSize: '0.78rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    borderRadius: '4px',
    transition: 'background 0.15s',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: `${position.y - 50}px`,
        left: `${position.x}px`,
        transform: 'translateX(-50%)',
        zIndex: 10010,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        background: colors.popoverBg || 'rgba(20, 20, 24, 0.95)',
        border: `1px solid ${colors.border}`,
        borderRadius: '10px',
        padding: '4px 6px',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <button
        style={btnStyle}
        onClick={onCopy}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <Copy size={14} />
        {lang === 'es' ? 'Copiar' : 'Copy'}
      </button>
      <div style={{ width: '1px', height: '20px', background: colors.border }} />
      <button
        style={btnStyle}
        onClick={onBookmark}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <Bookmark size={14} />
        {lang === 'es' ? 'Marcar' : 'Bookmark'}
      </button>
    </div>
  );
}
