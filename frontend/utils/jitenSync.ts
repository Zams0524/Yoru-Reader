import { getLocalParserSetting, usesLocalParserSettings } from './parserSettingsStore';
import { furiganaPairsFromAnnotated } from './yoruParserNative';

/**
 * jiten.moe integration for the native reader (Android, or any shell without the reader extension):
 * - parses paragraphs with Jiten's parser and colours words with the user's Jiten card states;
 * - sends every Yoru review and word mark to the user's Jiten account (queued while offline).
 * The user's Jiten API key (jiten.moe → Settings → API) is kept with the parser settings.
 * On desktop the reader extension owns the Jiten connection, so this module stays off there.
 */

const API_BASE = 'https://api.jiten.moe/api';
const REQUEST_TIMEOUT_MS = 15000;
const PARSE_BATCH_PARAGRAPHS = 40;
const PARSE_BATCH_CHARS = 8000;
const PARSE_CACHE_LIMIT = 4000;
const WORD_KEY_STORAGE = 'yoru_jiten_word_keys_v1';
const WORD_KEY_LIMIT = 20000;
const QUEUE_STORAGE = 'yoru_jiten_queue_v1';
const QUEUE_LIMIT = 2000;

// Jiten knownState codes, as used by the reader extension.
const CARD_STATES: Record<number, string> = {
  0: 'new', 1: 'young', 2: 'mature', 3: 'blacklisted', 4: 'due', 5: 'mastered', 6: 'redundant', 7: 'suspended',
};

export type JitenConnectionState = 'off' | 'ok' | 'rejected' | 'offline';

export interface JitenToken {
  start: number;
  end: number;
  key: string; // `${wordId}:${readingIndex}`
}

export interface JitenWordInfo {
  key: string;
  spelling: string;
  reading: string; // kana
  states: string[];
  furigana?: [string, string][]; // kanji run → kana, for furigana on new words
}

class JitenAuthError extends Error {}

// ── Settings / status ──────────────────────────────────────────────────

export function getJitenApiKey(): string {
  const key = getLocalParserSetting('jitenApiKey');
  return typeof key === 'string' ? key.trim() : '';
}

export function isJitenSyncEnabled(): boolean {
  return usesLocalParserSettings() && getJitenApiKey().length > 0 && rejectedKey !== getJitenApiKey();
}

export function isJitenParserEnabled(): boolean {
  const useParser = getLocalParserSetting('jitenUseParser');
  return isJitenSyncEnabled() && useParser !== false && useParser !== 'false';
}

let rejectedKey = '';
let connectionState: JitenConnectionState = 'off';
const listeners = new Set<() => void>();

export function getJitenConnectionState(): JitenConnectionState {
  if (!getJitenApiKey()) return 'off';
  if (rejectedKey === getJitenApiKey()) return 'rejected';
  return connectionState === 'off' ? 'ok' : connectionState;
}

/** Called after parses, state changes or connection changes. Returns an unsubscribe function. */
export function onJitenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => {
    try { listener(); } catch (error) { console.warn('[Jiten] listener failed', error); }
  });
}

// ── HTTP ───────────────────────────────────────────────────────────────

async function jitenRequest<T = any>(action: string, body: unknown, apiKey = getJitenApiKey()): Promise<T> {
  if (!apiKey) throw new JitenAuthError('No Jiten API key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `ApiKey ${apiKey}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    connectionState = 'offline';
    emitChange();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    if (apiKey === getJitenApiKey()) {
      rejectedKey = apiKey;
      emitChange();
    }
    throw new JitenAuthError(`Jiten rejected the API key (${response.status})`);
  }
  if (!response.ok) throw new Error(`Jiten ${action} failed: HTTP ${response.status}`);

  if (connectionState !== 'ok') {
    connectionState = 'ok';
    emitChange();
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Checks a key against Jiten without saving it. */
export async function testJitenApiKey(apiKey: string): Promise<'ok' | 'rejected' | 'offline'> {
  try {
    await jitenRequest('reader/ping', undefined, apiKey.trim());
    if (apiKey.trim() === rejectedKey) rejectedKey = '';
    return 'ok';
  } catch (error) {
    return error instanceof JitenAuthError ? 'rejected' : 'offline';
  }
}

// ── Parsing ────────────────────────────────────────────────────────────

const parseCache = new Map<string, JitenToken[]>();
const words = new Map<string, JitenWordInfo>();
// Local marks made in Yoru, shown immediately (by spelling) until the next parse confirms them.
const stateOverrides = new Map<string, string>();
const inFlight = new Set<string>();

function kanaFromAnnotated(reading: string): string {
  return (reading || '').replace(/([^\[\]]+?)\[([^\]]+)\]/g, (_match, base: string, ruby: string) => {
    // Keep any kana that precedes the annotated kanji in the same chunk.
    const kanaPrefix = base.replace(/[㐀-鿿豈-﫿々〆ヵヶ]+$/, '');
    return kanaPrefix + ruby;
  });
}

export function getCachedJitenTokens(text: string): JitenToken[] | undefined {
  return parseCache.get(text);
}

export function getJitenWord(key: string): JitenWordInfo | undefined {
  const info = words.get(key);
  if (!info) return undefined;
  const override = stateOverrides.get(info.spelling);
  return override ? { ...info, states: [override] } : info;
}

function rememberParse(text: string, tokens: JitenToken[]) {
  parseCache.set(text, tokens);
  if (parseCache.size > PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
}

/** Parses paragraphs with Jiten (skipping cached ones). Resolves with the texts that were parsed. */
export async function parseWithJiten(texts: string[]): Promise<string[]> {
  if (!isJitenParserEnabled()) return [];
  const todo = Array.from(new Set(texts)).filter((text) => text.trim() && !parseCache.has(text) && !inFlight.has(text));
  if (todo.length === 0) return [];
  todo.forEach((text) => inFlight.add(text));

  const parsed: string[] = [];
  try {
    let batch: string[] = [];
    let batchChars = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      const current = batch;
      batch = [];
      batchChars = 0;
      const result = await jitenRequest<{ tokens?: any[][]; vocabulary?: any[] }>('reader/parse', { text: current });
      for (const vocab of result?.vocabulary || []) {
        const key = `${vocab.wordId}:${vocab.readingIndex}`;
        const states = (Array.isArray(vocab.knownState) ? vocab.knownState : [])
          .map((state: number) => CARD_STATES[state])
          .filter(Boolean);
        const info: JitenWordInfo = {
          key,
          spelling: vocab.spelling || '',
          reading: kanaFromAnnotated(vocab.reading || ''),
          states: states.length ? states : ['new'],
          furigana: furiganaPairsFromAnnotated(vocab.reading || ''),
        };
        words.set(key, info);
        rememberWordKey(info.spelling, info.reading, key);
      }
      current.forEach((text, index) => {
        const group = result?.tokens?.[index] || [];
        rememberParse(text, group
          .filter((token: any) => Number.isFinite(token?.start) && Number.isFinite(token?.end) && token.end > token.start)
          .map((token: any) => ({ start: token.start, end: token.end, key: `${token.wordId}:${token.readingIndex}` }))
          .sort((a: JitenToken, b: JitenToken) => a.start - b.start));
        parsed.push(text);
      });
    };

    for (const text of todo) {
      if (batch.length >= PARSE_BATCH_PARAGRAPHS || batchChars + text.length > PARSE_BATCH_CHARS) await flush();
      batch.push(text);
      batchChars += text.length;
    }
    await flush();
  } catch (error) {
    console.warn('[Jiten] Parse failed, keeping the local parser:', error);
  } finally {
    todo.forEach((text) => inFlight.delete(text));
  }
  if (parsed.length) {
    // Once every mark has reached Jiten, the server states are the source of truth again.
    if (loadQueue().length === 0) stateOverrides.clear();
    emitChange();
  }
  return parsed;
}

// ── Word id lookup (for SRS cards that never passed through the parser) ──

let wordKeys: Record<string, string> | null = null;

function loadWordKeys(): Record<string, string> {
  if (wordKeys) return wordKeys;
  try {
    wordKeys = JSON.parse(localStorage.getItem(WORD_KEY_STORAGE) || '{}') || {};
  } catch {
    wordKeys = {};
  }
  return wordKeys!;
}

let saveKeysTimer: ReturnType<typeof setTimeout> | null = null;
function rememberWordKey(spelling: string, reading: string, key: string) {
  if (!spelling) return;
  const map = loadWordKeys();
  map[`${spelling}|${reading}`] = key;
  if (!map[spelling]) map[spelling] = key;
  if (saveKeysTimer) return;
  saveKeysTimer = setTimeout(() => {
    saveKeysTimer = null;
    const entries = Object.entries(map);
    const trimmed = entries.length > WORD_KEY_LIMIT ? Object.fromEntries(entries.slice(-WORD_KEY_LIMIT)) : map;
    wordKeys = trimmed;
    try { localStorage.setItem(WORD_KEY_STORAGE, JSON.stringify(trimmed)); } catch { /* storage full: keep in memory */ }
  }, 2000);
}

async function resolveWordKey(term: string, reading: string): Promise<string | null> {
  const map = loadWordKeys();
  const known = map[`${term}|${reading}`] || map[term];
  if (known) return known;

  // Public endpoint, no key needed: splits the text into Jiten words.
  const response = await fetch(`${API_BASE}/vocabulary/parse?text=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error(`Jiten word lookup failed: HTTP ${response.status}`);
  const parsed: { wordId: number; readingIndex: number; originalText: string }[] = await response.json();
  const match = parsed.find((word) => word.originalText === term) || (parsed.length === 1 ? parsed[0] : null);
  if (!match) return null;
  const key = `${match.wordId}:${match.readingIndex}`;
  rememberWordKey(term, reading, key);
  return key;
}

// ── Sync queue ─────────────────────────────────────────────────────────

type JitenOp =
  | { kind: 'review'; term: string; reading: string; rating: number; at: number }
  | { kind: 'state'; term: string; reading: string; state: string; at: number };

function loadQueue(): JitenOp[] {
  try {
    const queue = JSON.parse(localStorage.getItem(QUEUE_STORAGE) || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: JitenOp[]) {
  try { localStorage.setItem(QUEUE_STORAGE, JSON.stringify(queue.slice(-QUEUE_LIMIT))); } catch { /* ignore */ }
}

function enqueue(op: JitenOp) {
  const queue = loadQueue();
  queue.push(op);
  saveQueue(queue);
  void flushJitenQueue();
}

let flushing: Promise<void> | null = null;

/** Sends queued reviews and marks to Jiten. Safe to call often. */
export function flushJitenQueue(): Promise<void> {
  if (!isJitenSyncEnabled()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (;;) {
        const queue = loadQueue();
        const op = queue[0];
        if (!op) break;
        try {
          const key = await resolveWordKey(op.term, op.reading);
          if (key) {
            const [wordId, readingIndex] = key.split(':').map(Number);
            if (op.kind === 'review') {
              await jitenRequest('srs/review', { wordId, readingIndex, rating: op.rating });
            } else {
              await jitenRequest('srs/set-vocabulary-state', { wordId, readingIndex, state: op.state });
            }
          }
        } catch (error) {
          if (error instanceof JitenAuthError) break;
          // Network problems: keep the op and retry later. A bad request would never pass, so drop it.
          if (!(error instanceof Error) || !/HTTP 4\d\d/.test(error.message)) break;
          console.warn('[Jiten] Dropping a sync item Jiten refused:', op, error);
        }
        const current = loadQueue();
        if (current[0] && current[0].at === op.at && current[0].term === op.term) current.shift();
        saveQueue(current);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function getPendingJitenSyncCount(): number {
  return loadQueue().length;
}

/** Yoru rating 1-4 (Again, Hard, Good, Easy) → Jiten review. */
export function syncJitenReview(term: string, reading: string, rating: number) {
  if (!isJitenSyncEnabled() || !term || rating < 1 || rating > 4) return;
  const spelling = term.split(':')[0];
  if (!stateOverrides.has(spelling)) stateOverrides.set(spelling, 'young');
  enqueue({ kind: 'review', term: spelling, reading: reading || '', rating, at: Date.now() });
  emitChange();
}

/**
 * Yoru word marks → Jiten deck states.
 * known → never forget, ignored → blacklist, learning → mining deck; "new" undoes the previous mark.
 */
export function syncJitenWordStatus(term: string, reading: string, status: string, previousStatus?: string) {
  if (!isJitenSyncEnabled() || !term) return;
  const spelling = term.split(':')[0];
  const states: string[] = [];
  if (previousStatus === 'known' && status !== 'known') states.push('neverForget-remove');
  if (previousStatus === 'ignored' && status !== 'ignored') states.push('blacklist-remove');
  if (status === 'known' && previousStatus !== 'known') states.push('neverForget-add');
  if (status === 'ignored' && previousStatus !== 'ignored') states.push('blacklist-add');
  if (status === 'learning' && previousStatus !== 'learning') states.push('mining-add');
  if (states.length === 0) return;

  const at = Date.now();
  states.forEach((state, index) => enqueue({ kind: 'state', term: spelling, reading: reading || '', state, at: at + index }));
  const shown = status === 'known' ? 'mastered' : status === 'ignored' ? 'blacklisted' : status === 'learning' ? 'young' : 'new';
  stateOverrides.set(spelling, shown);
  emitChange();
}
