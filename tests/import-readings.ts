import JSZip from 'jszip';
import { parseHTML, parseEPUB } from '../frontend/utils/fileImport';
import { db, type Book } from '../frontend/utils/db';
import { exportBookForNativeReader } from '../frontend/utils/nativeReader';
import { renderBookWords } from '../frontend/utils/nativeReaderWords';

const equal = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label);
};

(window as any).runImportReadingsTests = async (epubBase64?: string) => {
  const passed: string[] = [];
  const source = '<p><ruby>舞<rt>ぶ</rt>台<rt>たい</rt></ruby>へ。</p>';
  equal(parseHTML(source), '{舞台|ぶたい}へ。', 'All per-kanji readings survive import');
  equal(parseHTML('<p><ruby><rb>東京</rb><rp>（</rp><rt>とうきょう</rt><rp>）</rp></ruby></p>'),
    '{東京|とうきょう}', 'Fallback parentheses stay out of text');
  equal(parseHTML('<p><ruby><rb>東</rb><rb>京</rb><rt>とう</rt><rt>きょう</rt></ruby></p>'),
    '{東京|とうきょう}', 'Explicit ruby bases keep every reading');
  passed.push('Multi-reading ruby, explicit rb and fallback parentheses');

  const original: Book = {
    id: 'reading-regression', title: 'Reading regression', author: 'Test', cover: '',
    chapters: [{ title: 'Chapter', content: '{舞台|ぶ}へ。\n次の行。' }],
    progress: { currentChapter: 0, currentPage: 1, percent: 50, charactersRead: 8, secondsRead: 42 },
    bookmarks: [{ paragraphId: 1 }],
    highlights: [{ id: 'highlight', paragraphId: 0, start: 0, end: 2, text: '舞台',
      color: 'yellow', note: 'Keep this note', createdAt: '2026-10-20' }],
    status: 'reading', createdAt: '2026-10-20', lastRead: '2026-10-20',
  };
  const corrected = { ...original, chapters: [{ title: 'Chapter', content: parseHTML(source) + '\n次の行。' }] };
  const metadata = ({ chapters: _chapters, ...rest }: Book) => rest;
  for (const single of [false, true]) {
    await db.saveBooks([original]);
    const books = single ? await db.addBook(corrected) : await db.addBooks([corrected]);
    equal(books.length, 1, 'Reimport must not duplicate the book');
    equal(books[0].chapters, corrected.chapters, 'Reimport refreshes the readings');
    equal(metadata(books[0]), metadata(original), 'Reimport preserves all saved metadata');
    equal((await db.getBooks())[0], books[0], 'Correction is persisted');
    for (const content of ['{別物|べつもの}へ。\n次の行。', '{舞台|ぶたい}へ。次の行。\n',
      '{h1:{舞台|ぶたい}へ。}\n次の行。']) {
      const changed = { ...corrected, chapters: [{ title: 'Chapter', content }] };
      const result = single ? await db.addBook(changed) : await db.addBooks([changed]);
      equal(result[0].chapters, corrected.chapters, 'Different text/layout must not replace the book');
    }
  }
  passed.push('Single and batch reimport: persisted readings, no duplicates, progress/notes preserved; changed text/layout rejected');

  const exported = exportBookForNativeReader(corrected as any);
  if (!exported.html.includes('<ruby>舞台<rt>ぶたい</rt></ruby>')) throw new Error('Native export loses reading');
  if (exported.key === exportBookForNativeReader(original as any).key) throw new Error('Stale native cache key');
  // Words as analyseBookWords keeps them (Kuromoji does not load in this test page).
  const analysed = new Map<string, any[]>([
    [corrected.chapters[0].content.split('\n')[0], [{ s: '舞台', b: '舞台', r: 'ぶたい', ruby: '<ruby>舞台<rt>ぶたい</rt></ruby>' }, 'へ。']],
    ['次の行。', [{ s: '次', b: '次', r: 'つぎ' }, { s: 'の', b: 'の', r: 'の' }, { s: '行', b: '行', r: 'ぎょう' }, '。']],
  ]);
  const words = renderBookWords(analysed, { 次: 'known' }, true);
  const styled = exportBookForNativeReader(corrected as any, { lineHtml: words });
  if (!styled.html.includes('<span class="w-mature">次</span>')) throw new Error('Word state not marked from statuses');
  if (!/<ruby class="w-new">行<rt/.test(styled.html)) throw new Error('No furigana on a new word');
  const doc = new DOMParser().parseFromString(styled.html, 'text/html');
  equal(doc.querySelector('rt')?.textContent, 'ぶたい',
    'Word-state rendering loses author reading');
  passed.push('Native plain/styled export preserves full reading and invalidates cached book');

  if (epubBase64) {
    const bytes = Uint8Array.from(atob(epubBase64), c => c.charCodeAt(0));
    const zip = await JSZip.loadAsync(bytes);
    let multiReading = 0;
    for (const entry of Object.values(zip.files)) {
      if (!/\.x?html?$/i.test(entry.name)) continue;
      const html = await entry.async('string');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const ruby of Array.from(doc.querySelectorAll('ruby'))) {
        const readings = Array.from(ruby.querySelectorAll('rt'));
        if (readings.length < 2) continue;
        const expected = readings.map(rt => rt.textContent?.trim() || '').join('');
        const imported = parseHTML(`<p>${ruby.outerHTML}</p>`);
        if (!imported.endsWith(`|${expected}}`)) throw new Error('EPUB loses a multi-part reading');
        multiReading++;
      }
    }
    const parsed = await parseEPUB(bytes.buffer);
    if (!parsed.chapters.length) throw new Error('EPUB import produced no chapters');
    const native = exportBookForNativeReader({ ...original, ...parsed } as any);
    if (!native.html.includes('<rt>ぶたい</rt>')) throw new Error('Full EPUB native export loses 舞台 reading');
    passed.push(`Real EPUB: ${multiReading} multi-reading ruby blocks preserved; ${parsed.chapters.length} chapters exported`);
  }
  await db.close();
  return passed;
};
