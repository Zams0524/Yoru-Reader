import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import ReaderSidePanel from './ReaderSidePanel';
import type { ReaderEngineApi } from './ReaderEngine';
import { searchBook, type SearchHit } from '../../utils/bookSearch';
import { blockText, normalizeForSearch, rangeForOffsets, setNamedHighlight } from '../../utils/readerText';

interface Props {
  chapters: { content?: string }[];
  apiRef: React.MutableRefObject<ReaderEngineApi | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  colors: { textMain: string; textMuted: string; border?: string; popoverBg?: string; cardBg?: string; accent: string };
  lang: string;
}

const SEARCH_HIGHLIGHT = 'yoru-search';

/** Shows a hit: opens its section, then highlights the n-th match in the paragraph. */
export function revealSearchHit(api: ReaderEngineApi, hit: SearchHit, query: string) {
  api.goToParagraph(hit.sectionIndex, hit.paragraphId);
  const needle = normalizeForSearch(query.trim());
  let attempts = 0;
  const tryHighlight = () => {
    const block = api.getContent()?.querySelector(`p.chapter-content[index="${hit.paragraphId}"]`);
    if (!block) {
      if (attempts++ < 20) window.setTimeout(tryHighlight, 50);
      return;
    }
    const text = normalizeForSearch(blockText(block));
    let at = -1;
    for (let n = 0; n <= hit.occurrence; n++) {
      at = text.indexOf(needle, at + (n === 0 ? 0 : needle.length));
      if (at === -1) break;
    }
    const range = at >= 0 ? rangeForOffsets(block, at, at + needle.length) : null;
    setNamedHighlight(SEARCH_HIGHLIGHT, range);
    if (range) api.revealRange(range);
  };
  window.setTimeout(tryHighlight, 80);
}

export function clearSearchHighlight() {
  setNamedHighlight(SEARCH_HIGHLIGHT, null);
}

export default function BookSearchPanel({ chapters, apiRef, query, onQueryChange, onClose, colors, lang }: Props) {
  const es = lang === 'es';
  const [debounced, setDebounced] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const sections = apiRef.current?.getSections() || [];
  const result = useMemo(
    () => (debounced.trim().length > 0 ? searchBook(chapters, sections, debounced) : null),
    // Sections only change when the book or layout does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapters, debounced, sections.length],
  );

  const openHit = (hit: SearchHit) => {
    const api = apiRef.current;
    if (!api) return;
    onClose();
    revealSearchHit(api, hit, debounced);
  };

  return (
    <ReaderSidePanel
      title={es ? 'Buscar en el libro' : 'Search in book'}
      onClose={onClose}
      colors={colors}
      closeLabel={es ? 'Cerrar búsqueda' : 'Close search'}
      headerExtra={(
        <div className="reader-search-field" style={{ borderBottom: `1px solid ${colors.border || 'rgba(255,255,255,0.08)'}` }}>
          <Search size={16} color={colors.textMuted} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={es ? 'Palabra o frase…' : 'Word or phrase…'}
            aria-label={es ? 'Texto a buscar' : 'Text to search'}
            style={{ color: colors.textMain }}
          />
        </div>
      )}
    >
      {!result && (
        <p className="reader-side-panel-empty" style={{ color: colors.textMuted }}>
          {es ? 'Escribe para buscar en todo el libro. Da igual hiragana o katakana.' : 'Type to search the whole book. Hiragana and katakana match each other.'}
        </p>
      )}
      {result && (
        <>
          <p className="reader-side-panel-count" style={{ color: colors.textMuted }}>
            {result.hits.length === 0
              ? (es ? 'Sin resultados.' : 'No results.')
              : `${result.hits.length}${result.truncated ? '+' : ''} ${result.hits.length === 1
                ? (es ? 'resultado' : 'result')
                : (es ? 'resultados' : 'results')}`}
          </p>
          <ul className="reader-search-results">
            {result.hits.map((hit, index) => (
              <li key={`${hit.paragraphId}-${hit.occurrence}-${index}`}>
                <button type="button" onClick={() => openHit(hit)} style={{ color: colors.textMain }}>
                  <span className="reader-search-chapter" style={{ color: colors.textMuted }}>{hit.sectionTitle}</span>
                  <span className="reader-search-snippet">
                    {hit.before}
                    <mark style={{ background: `${colors.accent}40`, color: colors.textMain }}>{hit.match}</mark>
                    {hit.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </ReaderSidePanel>
  );
}
