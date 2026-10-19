/** Highlights and notes saved with each book (ReadEra-style quotes). */

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface BookHighlight {
  id: string;
  paragraphId: number;
  /** Offsets in the paragraph's visible text (no furigana). */
  start: number;
  end: number;
  text: string;
  color: HighlightColor;
  note?: string;
  createdAt: string;
}

export const HIGHLIGHT_COLORS: { id: HighlightColor; swatch: string; es: string; en: string }[] = [
  { id: 'yellow', swatch: '#facc15', es: 'Amarillo', en: 'Yellow' },
  { id: 'green', swatch: '#4ade80', es: 'Verde', en: 'Green' },
  { id: 'blue', swatch: '#60a5fa', es: 'Azul', en: 'Blue' },
  { id: 'pink', swatch: '#f472b6', es: 'Rosa', en: 'Pink' },
];

export const highlightCssName = (color: HighlightColor) => `yoru-hl-${color}`;

export function newHighlightId(): string {
  return `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Plain-text export of a book's quotes and notes, in reading order. */
export function exportHighlights(bookTitle: string, highlights: BookHighlight[], lang: string): string {
  const es = lang === 'es';
  const ordered = [...highlights].sort((a, b) => a.paragraphId - b.paragraphId || a.start - b.start);
  const lines = [`${bookTitle} — ${es ? 'Subrayados y notas' : 'Highlights and notes'}`, ''];
  for (const item of ordered) {
    lines.push(`「${item.text}」`);
    if (item.note?.trim()) lines.push(`  ${es ? 'Nota' : 'Note'}: ${item.note.trim()}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
