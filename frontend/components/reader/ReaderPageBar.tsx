import React, { useMemo, useRef, useState } from 'react';
import type { ReaderEngineApi, Section } from './ReaderEngine';

interface Props {
  visible: boolean;
  currChars: number;
  totalChars: number;
  apiRef: React.MutableRefObject<ReaderEngineApi | null>;
  onSeek: (charPosition: number) => void;
  lang: string;
  accent: string;
}

const FALLBACK_CHARS_PER_PAGE = 450;

/**
 * ReadEra-style bottom bar: "page X of N" and a slider over the whole book with chapter ticks.
 * Pages are estimated from how many characters fit on a page of the open section, so the count
 * follows the font size and margins.
 */
export default function ReaderPageBar({ visible, currChars, totalChars, apiRef, onSeek, lang, accent }: Props) {
  const es = lang === 'es';
  const [dragValue, setDragValue] = useState<number | null>(null);
  const charsPerPageRef = useRef(FALLBACK_CHARS_PER_PAGE);

  const api = apiRef.current;
  const sections: Section[] = api?.getSections() || [];

  // Characters per page, measured on the open section (paged mode); keep the last good value.
  if (api?.isPaginated()) {
    const section = sections[api.getCurrentSection()];
    const { pages } = api.getPageInfo();
    if (section?.charCount && pages > 0) {
      const measured = section.charCount / pages;
      if (measured > 20) charsPerPageRef.current = measured;
    }
  }
  const charsPerPage = charsPerPageRef.current;
  const totalPages = Math.max(1, Math.ceil(totalChars / charsPerPage));
  const pageAt = (chars: number) => Math.min(totalPages, Math.floor(chars / charsPerPage) + 1);

  const shownChars = dragValue ?? currChars;
  const ticks = useMemo(() => {
    if (!totalChars) return [];
    const seen = new Set<number>();
    return sections
      .filter((section) => {
        if (seen.has(section.chapterIndex)) return false;
        seen.add(section.chapterIndex);
        return section.startChars > 0;
      })
      .slice(0, 80)
      .map((section) => (section.startChars / totalChars) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length, totalChars]);

  const draggedSection = dragValue !== null
    ? [...sections].reverse().find((section) => section.startChars <= dragValue)
    : null;

  const commit = () => {
    if (dragValue === null) return;
    onSeek(Math.max(0, Math.min(totalChars, Math.round(dragValue))));
    setDragValue(null);
  };

  if (!visible || totalChars <= 0) return null;

  return (
    <div className="reader-pagebar" style={{ '--pagebar-accent': accent } as React.CSSProperties}>
      <div className="reader-pagebar-label" aria-live="polite">
        {es ? `${pageAt(shownChars)} de ${totalPages}` : `${pageAt(shownChars)} of ${totalPages}`}
        {draggedSection && <span className="reader-pagebar-chapter">{draggedSection.title}</span>}
      </div>
      <div className="reader-pagebar-track">
        <div className="reader-pagebar-ticks" aria-hidden="true">
          {ticks.map((left, index) => <span key={index} style={{ left: `${left}%` }} />)}
        </div>
        <input
          type="range"
          min={0}
          max={totalChars}
          step={1}
          value={shownChars}
          aria-label={es ? 'Posición en el libro' : 'Position in the book'}
          aria-valuetext={es ? `Página ${pageAt(shownChars)} de ${totalPages}` : `Page ${pageAt(shownChars)} of ${totalPages}`}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
