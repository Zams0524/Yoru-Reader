import React, { useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, type BookHighlight, type HighlightColor } from '../../utils/highlights';

interface Props {
  highlight: BookHighlight;
  isNew: boolean;
  lang: string;
  colors: { textMain: string; textMuted: string; border?: string; popoverBg?: string; cardBg?: string; accent: string };
  onSave: (changes: { note: string; color: HighlightColor }) => void;
  onDelete: () => void;
  onCancel: () => void;
}

/** Edits the note and colour of a highlight. */
export default function HighlightNoteDialog({ highlight, isNew, lang, colors, onSave, onDelete, onCancel }: Props) {
  const es = lang === 'es';
  const [note, setNote] = useState(highlight.note || '');
  const [color, setColor] = useState<HighlightColor>(highlight.color);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const button = (primary = false): React.CSSProperties => ({
    padding: '9px 14px',
    borderRadius: '8px',
    border: primary ? 'none' : `1px solid ${colors.border || 'rgba(255,255,255,0.12)'}`,
    background: primary ? colors.accent : 'transparent',
    color: primary ? '#111' : colors.textMain,
    fontSize: '0.85rem',
    fontWeight: 700,
    cursor: 'pointer',
  });

  return (
    <div className="highlight-note-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="highlight-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={es ? 'Nota' : 'Note'}
        style={{ background: colors.popoverBg || '#12141a', border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}` }}
      >
        <blockquote style={{ borderLeftColor: HIGHLIGHT_COLORS.find((c) => c.id === color)?.swatch, color: colors.textMain }}>
          {highlight.text}
        </blockquote>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={es ? 'Escribe una nota (opcional)…' : 'Write a note (optional)…'}
          rows={4}
          style={{ color: colors.textMain, borderColor: colors.border || 'rgba(255,255,255,0.12)' }}
        />
        <div className="highlight-note-colors" role="radiogroup" aria-label={es ? 'Color' : 'Colour'}>
          {HIGHLIGHT_COLORS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={color === option.id}
              aria-label={es ? option.es : option.en}
              onClick={() => setColor(option.id)}
              style={{
                background: option.swatch,
                outline: color === option.id ? `2px solid ${colors.textMain}` : 'none',
              }}
            />
          ))}
        </div>
        <div className="highlight-note-actions">
          <button type="button" style={{ ...button(), color: '#f87171', marginRight: 'auto' }} onClick={onDelete}>
            {isNew ? (es ? 'Descartar' : 'Discard') : (es ? 'Quitar subrayado' : 'Remove')}
          </button>
          <button type="button" style={button()} onClick={onCancel}>{es ? 'Cancelar' : 'Cancel'}</button>
          <button type="button" style={button(true)} onClick={() => onSave({ note, color })}>{es ? 'Guardar' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
