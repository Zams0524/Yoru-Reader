// Builds public/dictionaries/JMdict_english.zip: the full JMdict (English) from yomidevs/jmdict-yomitan
// cut down to the words a reader of novels meets.
//
// The full dictionary is ~15.6 MB and ~530 000 rows (about a minute to import); the old bundled file
// kept the first 100 000 rows in JMdict order, which left out words like 名前, 猫 or 天気. This keeps
// every row of the entries JMdict marks as common plus the 60 000 most frequent words of
// frequency-novels.zip that JMdict has (~149 000 rows, ~4.7 MB, imports as fast as the old file).
//
// Usage:
//   curl -L -o JMdict_english_full.zip https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMdict_english.zip
//   node build/make-jmdict-english.mjs JMdict_english_full.zip [public/dictionaries/JMdict_english.zip]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const NOVEL_WORDS = 60000;
const BANK_SIZE = 10000;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [input, output = path.join(root, 'public/dictionaries/JMdict_english.zip')] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node build/make-jmdict-english.mjs <JMdict_english full zip> [output zip]');
  process.exit(1);
}

const bankNumber = (name) => Number(name.match(/_(\d+)\.json$/)?.[1] || 0);
async function readBanks(zip, prefix) {
  const names = Object.keys(zip.files).filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
  names.sort((a, b) => bankNumber(a) - bankNumber(b));
  const rows = [];
  for (const name of names) {
    for (const row of JSON.parse(await zip.file(name).async('string'))) rows.push(row);
  }
  return rows;
}

const full = await JSZip.loadAsync(fs.readFileSync(input));
const rows = await readBanks(full, 'term_bank_');

// Rank of each word in the novels frequency list (lower is more frequent).
const frequency = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'public/dictionaries/frequency-novels.zip')));
const rank = new Map();
for (const [term, , value] of await readBanks(frequency, 'term_meta_bank_')) {
  if (typeof value === 'number' && !(rank.get(term) <= value)) rank.set(term, value);
}
const inDictionary = new Set(rows.map((row) => row[0]));
const keep = new Set(rows.filter((row) => row[4] > 0).map((row) => row[0])); // JMdict common entries
[...rank.keys()]
  .filter((term) => inDictionary.has(term))
  .sort((a, b) => rank.get(a) - rank.get(b))
  .slice(0, NOVEL_WORDS)
  .forEach((term) => keep.add(term));

const kept = rows.filter((row) => keep.has(row[0]));
const out = new JSZip();
for (const name of Object.keys(full.files)) {
  if (!name.startsWith('term_bank_') && !full.files[name].dir) out.file(name, await full.file(name).async('uint8array'));
}
for (let i = 0; i < kept.length; i += BANK_SIZE) {
  out.file(`term_bank_${i / BANK_SIZE + 1}.json`, JSON.stringify(kept.slice(i, i + BANK_SIZE)));
}
const data = await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
fs.writeFileSync(output, data);
console.log(`${keep.size} words, ${kept.length} of ${rows.length} rows, ${(data.length / 1e6).toFixed(1)} MB -> ${output}`);
