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
  /** Vertical Japanese reads right to left: the book starts at the right end of the slider. */
  rtl?: boolean;
}

const FALLBACK_CHARS_PER_PAGE = 450;
const TAP_SLOP_PX = 12;

/**
 * ReadEra-style bottom bar: "page X of N" and a slider over the whole book with chapter ticks.
 * Pages are estimated from how many characters fit on a page of the open section, so the count
 * follows the font size and margins.
 */
export default function ReaderPageBar({ visible, currChars, totalChars, apiRef, onSeek, lang, accent, rtl = false }: Props) {
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

  // A tap on the track moves a range input's thumb there: only a drag seeks. The tap that shows
  // the bars lands on the slider (bottom centre) and jumped to the middle of the book.
  const pressXRef = useRef<number | null>(null);
  const tapRef = useRef(false);
  const press = (x: number) => { pressXRef.current = x; tapRef.current = false; };
  const commit = () => {
    if (dragValue === null) return;
    setDragValue(null);
    if (!tapRef.current) onSeek(Math.max(0, Math.min(totalChars, Math.round(dragValue))));
  };
  // pointerup and touchend both end a touch: the first one decides whether it was a tap.
  const release = (x: number | undefined) => {
    const pressX = pressXRef.current;
    pressXRef.current = null;
    if (pressX !== null && x !== undefined) tapRef.current = Math.abs(x - pressX) < TAP_SLOP_PX;
    commit();
  };

  if (!visible || totalChars <= 0) return null;

  return (
    <div className="reader-pagebar" style={{ '--pagebar-accent': accent } as React.CSSProperties}>
      <div className="reader-pagebar-label" aria-live="polite">
        {es ? `${pageAt(shownChars)} de ${totalPages}` : `${pageAt(shownChars)} of ${totalPages}`}
        {draggedSection && <span className="reader-pagebar-chapter">{draggedSection.title}</span>}
      </div>
      <div className="reader-pagebar-track" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="reader-pagebar-ticks" aria-hidden="true">
          {ticks.map((left, index) => <span key={index} style={{ left: `${rtl ? 100 - left : left}%` }} />)}
        </div>
        <input
          type="range"
          min={0}
          max={totalChars}
          step={1}
          value={shownChars}
          aria-label={es ? 'Posición en el libro' : 'Position in the book'}
          aria-valuetext={es ? `Página ${pageAt(shownChars)} de ${totalPages}` : `Page ${pageAt(shownChars)} of ${totalPages}`}
          onChange={(e) => {
            // A tap's value can arrive after it ended.
            if (pressXRef.current === null && tapRef.current) return;
            setDragValue(Number(e.target.value));
          }}
          onPointerDown={(e) => press(e.clientX)}
          onTouchStart={(e) => { if (pressXRef.current === null) press(e.touches[0]?.clientX ?? 0); }}
          onPointerUp={(e) => release(e.clientX)}
          onTouchEnd={(e) => release(e.changedTouches[0]?.clientX)}
          onKeyDown={() => { tapRef.current = false; }}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
