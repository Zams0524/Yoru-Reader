// Reads an Anki .apkg (or .colpkg) file directly in the browser, without AnkiConnect: unzip with
// JSZip, open the embedded SQLite collection with sql.js, decompressing it with fzstd first when
// Anki wrote it in the newer zstd-compressed format. Handles the legacy schema (col.models /
// col.decks as JSON blobs) that every .apkg deck-share export uses regardless of the exporting
// Anki version, since that is what keeps a shared deck importable into any Anki install.
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
// @ts-ignore - resolved to a static asset URL by Vite; no type declarations for this specifier.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { decompress as zstdDecompress } from 'fzstd';

export interface ApkgRawCard {
  /** Field name (from the note's model) -> field value. */
  fields: Record<string, string>;
  deckName: string;
  interval: number;
  reps: number;
  lapses: number;
  /** Anki's ease factor * 1000 (e.g. 2500 = 250%). */
  factor: number;
  /** Anki card type: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  type: number;
  /** New: queue position. Learning/Relearning: next-review time, epoch seconds. Review: days since the collection was created. */
  due: number;
  /** Last-modified time, epoch seconds (used as an approximate last-review time). */
  mod: number;
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
function loadSql() {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  return sqlPromise;
}

async function extractCollectionBytes(zip: JSZip): Promise<Uint8Array> {
  const compressed = zip.file('collection.anki21b');
  if (compressed) {
    const bytes = await compressed.async('uint8array');
    return zstdDecompress(bytes);
  }
  const anki21 = zip.file('collection.anki21');
  if (anki21) return anki21.async('uint8array');
  const anki2 = zip.file('collection.anki2');
  if (anki2) return anki2.async('uint8array');
  throw new Error('No se encontró una base de datos de Anki reconocible dentro del archivo (collection.anki2/anki21/anki21b).');
}

/** Reads every note+card pair from an Anki .apkg/.colpkg file, with each note's fields by name. */
export async function parseApkgFile(file: File): Promise<ApkgRawCard[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const bytes = await extractCollectionBytes(zip);
  const SQL = await loadSql();
  const db = new SQL.Database(bytes);
  try {
    const colRows = db.exec('SELECT models, decks FROM col LIMIT 1');
    if (!colRows.length || !colRows[0].values.length) {
      throw new Error('El archivo no tiene una tabla "col" reconocible. Exporta el mazo desde Anki (File > Export) como .apkg.');
    }
    const [modelsJson, decksJson] = colRows[0].values[0] as [string, string];
    const models = JSON.parse(String(modelsJson)) as Record<string, { flds?: { name: string; ord: number }[] }>;
    const decks = JSON.parse(String(decksJson)) as Record<string, { name?: string }>;

    const fieldNamesByModel: Record<string, string[]> = {};
    for (const [mid, model] of Object.entries(models)) {
      const sorted = [...(model.flds || [])].sort((a, b) => a.ord - b.ord);
      fieldNamesByModel[mid] = sorted.map((f) => f.name);
    }

    const rows = db.exec(`
      SELECT n.mid, n.flds, c.did, c.ivl, c.reps, c.lapses, c.factor, c.type, c.due, c.mod
      FROM cards c JOIN notes n ON n.id = c.nid
    `);
    if (!rows.length) return [];

    const out: ApkgRawCard[] = [];
    for (const row of rows[0].values) {
      const [mid, flds, did, ivl, reps, lapses, factor, type, due, mod] = row as [
        number, string, number, number, number, number, number, number, number, number
      ];
      const names = fieldNamesByModel[String(mid)] || [];
      const values = String(flds).split('\x1f');
      const fields: Record<string, string> = {};
      names.forEach((name, i) => { fields[name] = values[i] || ''; });
      out.push({
        fields,
        deckName: decks[String(did)]?.name || 'Imported',
        interval: ivl || 0,
        reps: reps || 0,
        lapses: lapses || 0,
        factor: factor || 2500,
        type: typeof type === 'number' ? type : 0,
        due: due || 0,
        mod: mod || 0,
      });
    }
    return out;
  } finally {
    db.close();
  }
}
