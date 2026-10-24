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
import type { AnkiReview } from './ankiCardImport';

export interface ApkgRawCard {
  /** Field name (from the note's model) -> field value. */
  fields: Record<string, string>;
  deckName: string;
  cardId: number;
  noteId: number;
  interval: number;
  reps: number;
  lapses: number;
  /** Anki's ease factor * 1000 (e.g. 2500 = 250%). */
  factor: number;
  /** Anki card type: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  type: number;
  /** Anki queue: -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review, 3 day-learning. */
  queue: number;
  /** New: queue position. Learning: next-review time, epoch seconds. Review/day-learning: days since the collection was created. */
  due: number;
  /** Last-modified time, epoch seconds. */
  mod: number;
  /** FSRS memory state Anki stored for the card (cards.data), when the deck uses FSRS. */
  memory: { stability: number; difficulty: number } | null;
  /** Last review time stored with that memory state, epoch seconds. */
  lastReviewSeconds?: number;
  /** The card's review history (revlog), oldest first. */
  reviews: AnkiReview[];
}

export interface ApkgCollection {
  cards: ApkgRawCard[];
  /** Collection creation time, epoch seconds: review due dates are day numbers counted from it. */
  crtSeconds: number | null;
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

/** Parses Anki's per-card `data` JSON for the FSRS memory state (s, d) and last review time (lrt). */
function parseCardData(raw: unknown): { memory: ApkgRawCard['memory']; lastReviewSeconds?: number } {
  if (!raw) return { memory: null };
  try {
    const data = JSON.parse(String(raw));
    const stability = Number(data?.s);
    const difficulty = Number(data?.d);
    const memory = stability > 0 && difficulty >= 1 ? { stability, difficulty } : null;
    const lastReviewSeconds = Number(data?.lrt) > 0 ? Number(data.lrt) : undefined;
    return { memory, lastReviewSeconds };
  } catch {
    return { memory: null };
  }
}

/** Every revlog entry, grouped by card id. */
function reviewsByCard(db: any): Map<number, AnkiReview[]> {
  const out = new Map<number, AnkiReview[]>();
  let rows: any[] = [];
  try {
    rows = db.exec('SELECT id, cid, ease, type, ivl FROM revlog ORDER BY id');
  } catch {
    return out;
  }
  if (!rows.length) return out;
  for (const row of rows[0].values) {
    const [id, cid, ease, type, ivl] = row as [number, number, number, number, number];
    const list = out.get(cid) || [];
    list.push({ at: Number(id), rating: Number(ease) || 0, type: Number(type) || 0, ivl: Number(ivl) || 0 });
    out.set(cid, list);
  }
  return out;
}

/** Reads every note+card pair from an Anki .apkg/.colpkg file, with each note's fields by name. */
export async function parseApkgFile(file: File): Promise<ApkgRawCard[]> {
  return (await parseApkgCollection(file)).cards;
}

/** Like parseApkgFile, plus each card's review history and the collection's creation time. */
export async function parseApkgCollection(file: File): Promise<ApkgCollection> {
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
    let crtSeconds: number | null = null;
    try {
      const crtRows = db.exec('SELECT crt FROM col LIMIT 1');
      const crt = Number(crtRows[0]?.values?.[0]?.[0]);
      if (crt > 0) crtSeconds = crt;
    } catch {
      // No col.crt: review due dates fall back to last review + interval.
    }
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

    // cards.data (FSRS memory state) only exists in newer collections.
    let rows: any[];
    try {
      rows = db.exec(`
        SELECT n.mid, n.flds, c.did, c.ivl, c.reps, c.lapses, c.factor, c.type, c.due, c.mod, c.id, c.nid, c.queue, c.data
        FROM cards c JOIN notes n ON n.id = c.nid
      `);
    } catch {
      rows = db.exec(`
        SELECT n.mid, n.flds, c.did, c.ivl, c.reps, c.lapses, c.factor, c.type, c.due, c.mod, c.id, c.nid, c.queue, NULL
        FROM cards c JOIN notes n ON n.id = c.nid
      `);
    }
    if (!rows.length) return { cards: [], crtSeconds };
    const reviews = reviewsByCard(db);

    const out: ApkgRawCard[] = [];
    for (const row of rows[0].values) {
      const [mid, flds, did, ivl, reps, lapses, factor, type, due, mod, id, nid, queue, data] = row as [
        number, string, number, number, number, number, number, number, number, number, number, number, number, string | null
      ];
      const names = fieldNamesByModel[String(mid)] || [];
      const values = String(flds).split('\x1f');
      const fields: Record<string, string> = {};
      names.forEach((name, i) => { fields[name] = values[i] || ''; });
      const { memory, lastReviewSeconds } = parseCardData(data);
      out.push({
        fields,
        deckName: deckNames[String(did)] || 'Imported',
        cardId: Number(id),
        noteId: Number(nid),
        interval: ivl || 0,
        reps: reps || 0,
        lapses: lapses || 0,
        factor: factor || 2500,
        type: typeof type === 'number' ? type : 0,
        queue: typeof queue === 'number' ? queue : 0,
        due: due || 0,
        mod: mod || 0,
        memory,
        lastReviewSeconds,
        reviews: reviews.get(Number(id)) || [],
      });
    }
    return { cards: out, crtSeconds };
  } finally {
    db.close();
  }
}
