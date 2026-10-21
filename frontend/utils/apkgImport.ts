// Reads an Anki .apkg (or .colpkg) file directly in the browser, without AnkiConnect: unzip with
// JSZip, open the embedded SQLite collection with sql.js, decompressing it with fzstd first when
// Anki wrote it in the newer zstd-compressed format. Handles the legacy schema (col.models /
// col.decks as JSON blobs) that every .apkg deck-share export uses regardless of the exporting
// Anki version, since that is what keeps a shared deck importable into any Anki install.
import JSZip from 'jszip';
// The inline build has its .wasm embedded as base64 right in the JS, so sql.js never needs to
// fetch() a separate asset at runtime - the plain 'sql.js' build does, and that fetch fails under
// Electron's file:// protocol ("both async and sync fetching of the wasm failed").
// @ts-ignore - no type declarations published for this specific build path.
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
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

let sqlPromise: Promise<any> | null = null;
function loadSql(): Promise<any> {
  if (!sqlPromise) sqlPromise = initSqlJs();
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

/**
 * Field names per notetype ID, in field order. Anki moved this out of the col.models JSON blob
 * into its own relational "fields" table in schema v18 (Anki 2.1.28+); modern Anki leaves
 * col.models as an empty string, so that legacy path is tried first and this is the fallback.
 */
function fieldNamesByModelFromTable(db: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const fieldRows = db.exec('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
  if (!fieldRows.length) return out;
  for (const row of fieldRows[0].values) {
    const [ntid, , name] = row as [number, number, string];
    const key = String(ntid);
    if (!out[key]) out[key] = [];
    out[key].push(String(name));
  }
  return out;
}

/** Deck names by ID, from the same schema-v18 relational "decks" table as the fallback above. */
function deckNamesFromTable(db: any): Record<string, string> {
  const out: Record<string, string> = {};
  const deckRows = db.exec('SELECT id, name FROM decks');
  if (!deckRows.length) return out;
  for (const row of deckRows[0].values) {
    const [id, name] = row as [number, string];
    out[String(id)] = String(name);
  }
  return out;
}

/** Reads every note+card pair from an Anki .apkg/.colpkg file, with each note's fields by name. */
export async function parseApkgFile(file: File): Promise<ApkgRawCard[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const bytes = await extractCollectionBytes(zip);
  const SQL = await loadSql();
  let db = new SQL.Database(bytes);
  try {
    // Modern Anki declares several columns (e.g. fields.name) with a custom "unicase" collation,
    // registered by Anki's own Rust backend but unknown to sql.js's plain SQLite build. Even a
    // plain SELECT against such a table then fails ("no query solution"), since the query planner
    // can't validate every index built on that table. Patch the schema text in sqlite_master to
    // drop the unregistered collation, then re-open from the patched bytes so SQLite reparses it -
    // a no-op when the file doesn't use it, since the REPLACE then matches nothing.
    db.run('PRAGMA writable_schema = ON');
    db.run("UPDATE sqlite_master SET sql = REPLACE(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'");
    db.run('PRAGMA writable_schema = RESET');
    const patched = db.export();
    db.close();
    db = new SQL.Database(patched);
    let modelsJson = '';
    let decksJson = '';
    try {
      const colRows = db.exec('SELECT models, decks FROM col LIMIT 1');
      if (colRows.length && colRows[0].values.length) {
        [modelsJson, decksJson] = colRows[0].values[0] as [string, string];
      }
    } catch {
      // Schema without a models/decks column on "col" at all - fall through to the relational
      // schema below for both field and deck names.
    }

    let fieldNamesByModel: Record<string, string[]> = {};
    try {
      if (modelsJson) {
        const models = JSON.parse(String(modelsJson)) as Record<string, { flds?: { name: string; ord: number }[] }>;
        for (const [mid, model] of Object.entries(models)) {
          const sorted = [...(model.flds || [])].sort((a, b) => a.ord - b.ord);
          fieldNamesByModel[mid] = sorted.map((f) => f.name);
        }
      }
    } catch {
      // col.models wasn't valid JSON - fall through to the relational schema below.
    }
    if (Object.keys(fieldNamesByModel).length === 0) {
      fieldNamesByModel = fieldNamesByModelFromTable(db);
    }

    let decks: Record<string, { name?: string }> = {};
    try {
      if (decksJson) decks = JSON.parse(String(decksJson)) as Record<string, { name?: string }>;
    } catch {
      // col.decks wasn't valid JSON - fall through to the relational schema below.
    }
    let deckNames = Object.fromEntries(Object.entries(decks).map(([id, d]) => [id, d.name || '']));
    if (Object.values(deckNames).every((name) => !name)) {
      deckNames = deckNamesFromTable(db);
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
        deckName: deckNames[String(did)] || 'Imported',
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
