import { sanitizeJapaneseText, type Section } from '../components/reader/ReaderEngine';
import { normalizeForSearch } from './readerText';

/**
 * Full-book search over the chapter source. Paragraph ids follow the reader's numbering
 * (renderSectionContent), so a hit can be opened with ReaderEngineApi.goToParagraph.
 */

export interface SearchHit {
  sectionIndex: number;
  sectionTitle: string;
  paragraphId: number;
  occurrence: number; // n-th match inside the paragraph's visible text
  before: string;
  match: string;
  after: string;
}

const CONTEXT = 28;

/** The paragraph's text as the reader shows it: ruby bases only, no images or markup. */
export function visibleLineText(line: string): string {
  return sanitizeJapaneseText(line)
    .replace(/\{img:[^{}]*\}/gi, '')
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export function searchBook(
  chapters: { content?: string }[],
  sections: Section[],
  query: string,
  limit = 300,
): { hits: SearchHit[]; truncated: boolean } {
  const needle = normalizeForSearch(query.trim());
  const hits: SearchHit[] = [];
  if (!needle) return { hits, truncated: false };

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const raw = (chapters[section.chapterIndex]?.content || '').slice(section.startOffset, section.endOffset);
    let paragraphId = section.startParagraphId;

    for (const line of raw.split(/\r?\n/)) {
      const isHeading = /^\{h[123]:/.test(line) && line.endsWith('}');
      const isImage = line.startsWith('{img:') && line.endsWith('}');
      if (!line.trim() || isImage) {
        paragraphId++;
        continue;
      }
      if (isHeading) continue; // headings have no paragraph id; the chapter list covers them

      const text = visibleLineText(line);
      const haystack = normalizeForSearch(text);
      let occurrence = 0;
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
        hits.push({
          sectionIndex,
          sectionTitle: section.title,
          paragraphId,
          occurrence,
          before: (at > CONTEXT ? '…' : '') + text.slice(Math.max(0, at - CONTEXT), at),
          match: text.slice(at, at + needle.length),
          after: text.slice(at + needle.length, at + needle.length + CONTEXT) + (at + needle.length + CONTEXT < text.length ? '…' : ''),
        });
        occurrence++;
        if (hits.length >= limit) return { hits, truncated: true };
      }
      paragraphId++;
    }
  }
  return { hits, truncated: false };
}
