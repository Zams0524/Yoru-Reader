import { getLocalParserSetting, modoAnalizador } from './parserSettingsStore';
import { kanaDeAnotado, rubiesDeAnotado, type RubyJiten } from './furiganaJiten';

/**
 * jiten.moe integration:
 * - parses paragraphs with Jiten's parser and colours words with the user's Jiten card states,
 *   en todas las plataformas, escritorio incluido (ver `isJitenParserEnabled`);
 * - sends every Yoru review and word mark to the user's Jiten account (queued while offline),
 *   solo leyendo en modo Jiten: en el modo Yoru las marcas son del SRS de la app y no salen.
 * The user's Jiten API key (jiten.moe → Settings → API) is kept with the parser settings.
 */

const API_BASE = 'https://api.jiten.moe/api';
const REQUEST_TIMEOUT_MS = 15000;
const PARSE_BATCH_PARAGRAPHS = 40;
const PARSE_BATCH_CHARS = 8000;
/**
 * Cuántos lotes se le piden a Jiten a la vez.
 *
 * Cuatro, no «todos»: un capítulo largo son bastantes lotes y soltarlos de golpe es lo que se
 * gana un 429 de la cuenta. Con cuatro, las primeras líneas (que son las que el lector está
 * mirando) llegan en una sola ida y vuelta y el resto va detrás sin atragantar al servidor.
 */
const PARSE_CONCURRENCIA = 4;
const PARSE_CACHE_LIMIT = 4000;
const WORD_KEY_STORAGE = 'yoru_jiten_word_keys_v1';
const WORD_KEY_LIMIT = 20000;
const QUEUE_STORAGE = 'yoru_jiten_queue_v1';
const QUEUE_LIMIT = 2000;
const THROTTLE_WAIT_MS = 1500;
const MAX_THROTTLE_RETRIES = 4;

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
  furigana?: RubyJiten[]; // readings of the dictionary form, for furigana on new words
}

class JitenAuthError extends Error {}

class JitenHttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

// On Android, CapacitorHttp's fetch ignores AbortSignal, so a request that never answers would hang
// the sync queue for the whole session. Race every call against a timer instead.
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Settings / status ──────────────────────────────────────────────────

export function getJitenApiKey(): string {
  const key = getLocalParserSetting('jitenApiKey');
  return typeof key === 'string' ? key.trim() : '';
}

/** Hay clave guardada y Jiten no la ha rechazado. */
function claveUsable(): boolean {
  const key = getJitenApiKey();
  return key.length > 0 && rejectedKey !== key;
}

/**
 * Mandar a Jiten los repasos y las marcas: solo leyendo en modo Jiten, en cualquier aparato.
 *
 * Lo manda el modo, no la clave, por decisión de zams (18 nov 2026): «aunque esté la clave de
 * Jiten, estoy en el modo Yoru: esos botones funcionan con mi SRS nativo y no se mandan a
 * Jiten». Tiene sentido: el modo es lo que se ve mientras lees, y tener cuenta de Jiten no
 * quiere decir que todo lo que marques leyendo con el analizador de Yoru sea suyo.
 *
 * Antes dependía del aparato: en Android mandaba siempre que hubiera clave, y en escritorio no
 * mandaba nunca —se daba por hecho que eso lo hacía la extensión de lectura, que en realidad ni
 * se entera de que pulsas los botones de la tarjeta, porque son de la app—.
 */
export function isJitenSyncEnabled(): boolean {
  return claveUsable() && modoAnalizador() === 'jiten';
}

/**
 * True cuando las palabras las parte Jiten y no el analizador de la app.
 *
 * Antes salía del interruptor `jitenUseParser`, que solo aparecía si había clave; ahora el modo
 * se elige por su nombre en los ajustes del analizador, y el interruptor de antes solo sirve
 * para decidir en qué modo arranca quien ya lo tenía puesto (`modoAnalizadorPorDefecto`).
 *
 * Esto vale también en escritorio desde el 18 nov 2026, y ese es el arreglo. Antes pedía además
 * `usesLocalParserSettings()`, que en Electron es falso, así que en el ordenador el parser de
 * Jiten **nunca** se encendía, con clave o sin ella: el lector tokenizaba cada párrafo con
 * Kuromoji y se quedaba así. La idea era que en escritorio parte las palabras la extensión, pero
 * la extensión ya no llega a hacerlo: encuentra el texto metido en spans por la app, y su
 * endpoint apunta al servidor local de Yoru (127.0.0.1:23280), que devuelve ese mismo Kuromoji.
 * Resultado: poner la clave de Jiten en el ordenador no cambiaba absolutamente nada.
 *
 * Ahora el parseo lo pide la app, igual que en Android. La ventana se crea con `webSecurity:
 * false`, así que la llamada a api.jiten.moe sale sin tropezar con CORS.
 */
export function isJitenParserEnabled(): boolean {
  return claveUsable() && modoAnalizador() === 'jiten';
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
  let text: string;
  try {
    response = await withTimeout(fetch(`${API_BASE}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `ApiKey ${apiKey}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    }), `Jiten ${action}`);
    text = await withTimeout(response.text(), `Jiten ${action}`);
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
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new JitenHttpError(
      response.status,
      `Jiten ${action} failed: HTTP ${response.status} ${text.slice(0, 200)}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }

  if (connectionState !== 'ok') {
    connectionState = 'ok';
    emitChange();
  }
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

export function getCachedJitenTokens(text: string): JitenToken[] | undefined {
  return parseCache.get(text);
}

export function getJitenWord(key: string): JitenWordInfo | undefined {
  const info = words.get(key);
  if (!info) return undefined;
  const override = stateOverrides.get(info.spelling);
  return override ? { ...info, states: [override] } : info;
}

/** The state Yoru marked by hand on a spelling and Jiten has not confirmed yet, if any. */
export function getJitenOverride(spelling: string): string | undefined {
  return stateOverrides.get(spelling);
}

function rememberParse(text: string, tokens: JitenToken[]) {
  parseCache.set(text, tokens);
  if (parseCache.size > PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
}

/**
 * Un lote de párrafos, repitiéndolo si Jiten frena por exceso de peticiones.
 *
 * Los lotes salen ahora de varios en varios, así que el 429 es más fácil de encontrar que
 * cuando iban en fila de uno. Antes un 429 tiraba el lote y esos párrafos se quedaban con el
 * analizador de la app hasta volver a entrar en el capítulo.
 */
async function pedirParseo(textos: string[]): Promise<{ tokens?: any[][]; vocabulary?: any[] }> {
  for (let intento = 0; ; intento++) {
    try {
      return await jitenRequest<{ tokens?: any[][]; vocabulary?: any[] }>('reader/parse', { text: textos });
    } catch (error) {
      if (error instanceof JitenHttpError && error.status === 429 && intento < MAX_THROTTLE_RETRIES) {
        await wait(error.retryAfterMs ?? THROTTLE_WAIT_MS * (intento + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Parses paragraphs with Jiten (skipping cached ones). Resolves with the texts that were parsed.
 *
 * `alLlegarLote` se llama con los textos de cada lote en cuanto ese lote contesta, para poder
 * pintarlos sin esperar a los demás.
 *
 * Los lotes van en paralelo, hasta `PARSE_CONCURRENCIA` a la vez. Antes se pedían en fila: cada
 * uno esperaba a que contestara el anterior, y como además no se pintaba nada hasta que estaban
 * todos, un capítulo largo tardaba la suma de todas las idas y venidas en empezar a colorearse.
 * Ahora tarda la más lenta de las primeras, y el texto se va tiñendo por partes.
 */
export async function parseWithJiten(texts: string[], alLlegarLote?: (textos: string[]) => void): Promise<string[]> {
  if (!isJitenParserEnabled()) return [];
  const todo = Array.from(new Set(texts)).filter((text) => text.trim() && !parseCache.has(text) && !inFlight.has(text));
  if (todo.length === 0) return [];
  todo.forEach((text) => inFlight.add(text));

  // Se agrupa todo primero y se pide después: es lo que permite que los lotes salgan a la vez.
  const lotes: string[][] = [];
  let batch: string[] = [];
  let batchChars = 0;
  for (const text of todo) {
    if (batch.length > 0 && (batch.length >= PARSE_BATCH_PARAGRAPHS || batchChars + text.length > PARSE_BATCH_CHARS)) {
      lotes.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push(text);
    batchChars += text.length;
  }
  if (batch.length > 0) lotes.push(batch);

  const parsed: string[] = [];

  const resolverLote = async (current: string[]) => {
    const result = await pedirParseo(current);
    for (const vocab of result?.vocabulary || []) {
      const key = `${vocab.wordId}:${vocab.readingIndex}`;
      const states = (Array.isArray(vocab.knownState) ? vocab.knownState : [])
        .map((state: number) => CARD_STATES[state])
        .filter(Boolean);
      const info: JitenWordInfo = {
        key,
        spelling: vocab.spelling || '',
        reading: kanaDeAnotado(vocab.reading || ''),
        states: states.length ? states : ['new'],
        furigana: rubiesDeAnotado(vocab.reading || ''),
      };
      words.set(key, info);
      rememberWordKey(info.spelling, info.reading, key);
    }
    const delLote: string[] = [];
    current.forEach((text, index) => {
      const group = result?.tokens?.[index] || [];
      rememberParse(text, group
        .filter((token: any) => Number.isFinite(token?.start) && Number.isFinite(token?.end) && token.end > token.start)
        .map((token: any) => ({ start: token.start, end: token.end, key: `${token.wordId}:${token.readingIndex}` }))
        .sort((a: JitenToken, b: JitenToken) => a.start - b.start));
      parsed.push(text);
      delLote.push(text);
    });
    // Pintado inmediato: lo que ya está no espera a lo que falta.
    if (delLote.length) alLlegarLote?.(delLote);
  };

  /*
    El fallo se recoge por lote y no por tanda entera: antes un solo lote que fallara abortaba
    el resto del capítulo, y ahora los demás siguen y solo se queda sin Jiten el que falló.
  */
  let siguiente = 0;
  const trabajador = async () => {
    for (;;) {
      const indice = siguiente++;
      if (indice >= lotes.length) return;
      try {
        await resolverLote(lotes[indice]);
      } catch (error) {
        console.warn('[Jiten] Parse failed, keeping the local parser:', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCIA, lotes.length) }, trabajador));

  todo.forEach((text) => inFlight.delete(text));
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
  const response = await withTimeout(fetch(`${API_BASE}/vocabulary/parse?text=${encodeURIComponent(term)}`), 'Jiten word lookup');
  if (!response.ok) throw new JitenHttpError(response.status, `Jiten word lookup failed: HTTP ${response.status}`);
  const parsed: { wordId: number; readingIndex: number; originalText: string }[] = await withTimeout(response.json(), 'Jiten word lookup');
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

/*
  Acuse del último envío.

  Desde que los botones de la tarjeta salen hacia Jiten (18 nov 2026), hacía falta poder
  contestar a «¿le llegó?» sin abrir la web de Jiten ni mirar la consola. Se guarda solo el
  último, que es el que se pregunta.
*/
const LAST_SYNC_STORAGE = 'yoru_jiten_last_sync_v1';

export type JitenSyncReport = { at: number; term: string; que: string; ok: boolean; detalle?: string };

function describirOp(op: JitenOp): string {
  if (op.kind === 'review') return ['again', 'hard', 'good', 'easy'][op.rating - 1] || `nota ${op.rating}`;
  return op.state;
}

function apuntarEnvio(report: JitenSyncReport) {
  try { localStorage.setItem(LAST_SYNC_STORAGE, JSON.stringify(report)); } catch { /* ignore */ }
  emitChange();
}

/** El último apunte que salió hacia Jiten y qué contestó. */
export function getLastJitenSync(): JitenSyncReport | null {
  try {
    const guardado = JSON.parse(localStorage.getItem(LAST_SYNC_STORAGE) || 'null');
    return guardado && typeof guardado.at === 'number' ? guardado : null;
  } catch {
    return null;
  }
}

let flushing: Promise<void> | null = null;

/** Sends queued reviews and marks to Jiten. Safe to call often. */
export function flushJitenQueue(): Promise<void> {
  if (!isJitenSyncEnabled()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      let throttled = 0;
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
            apuntarEnvio({ at: Date.now(), term: op.term, que: describirOp(op), ok: true });
          } else {
            apuntarEnvio({ at: Date.now(), term: op.term, que: describirOp(op), ok: false, detalle: 'Jiten no conoce esa palabra' });
          }
        } catch (error) {
          if (error instanceof JitenAuthError) break;
          // Jiten debounces quick changes to the same account (429): wait and send the same item again.
          if (error instanceof JitenHttpError && error.status === 429 && throttled < MAX_THROTTLE_RETRIES) {
            throttled += 1;
            await wait(error.retryAfterMs ?? THROTTLE_WAIT_MS * throttled);
            continue;
          }
          // Network problems, timeouts, server errors or a long throttle: keep the item and retry later.
          if (!(error instanceof JitenHttpError) || error.status >= 500 || error.status === 429) break;
          // Any other 4xx would never pass (409 means Jiten already has it), so drop it.
          console.warn('[Jiten] Dropping a sync item Jiten refused:', op, error.message);
          apuntarEnvio({
            at: Date.now(),
            term: op.term,
            que: describirOp(op),
            ok: false,
            detalle: error instanceof JitenHttpError ? `Jiten contestó HTTP ${error.status}` : 'Jiten lo rechazó'
          });
        }
        throttled = 0;
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

// Queued even while the key is rejected or Jiten is unreachable, so nothing is lost: the queue is
// sent once the key checks out again (Settings → "Save and check") or the app restarts.
function canQueueJitenSync(): boolean {
  return getJitenApiKey().length > 0 && modoAnalizador() === 'jiten';
}

/** Yoru rating 1-4 (Again, Hard, Good, Easy) → Jiten review. */
export function syncJitenReview(term: string, reading: string, rating: number) {
  if (!canQueueJitenSync() || !term || rating < 1 || rating > 4) return;
  const spelling = term.split(':')[0];
  if (!stateOverrides.has(spelling)) stateOverrides.set(spelling, 'young');
  enqueue({ kind: 'review', term: spelling, reading: reading || '', rating, at: Date.now() });
  emitChange();
}

/**
 * Yoru word marks → Jiten vocabulary states.
 * known → never forget, ignored → blacklist, learning → mazo de minado; "new" deshace la marca.
 */
export function syncJitenWordStatus(term: string, reading: string, status: string, previousStatus?: string) {
  if (!canQueueJitenSync() || !term) return;
  const spelling = term.split(':')[0];
  const states: string[] = [];
  if (previousStatus === 'known' && status !== 'known') states.push('neverForget-remove');
  if (previousStatus === 'ignored' && status !== 'ignored') states.push('blacklist-remove');
  if (status === 'known' && previousStatus !== 'known') states.push('neverForget-add');
  if (status === 'ignored' && previousStatus !== 'ignored') states.push('blacklist-add');
  /*
    Mazo. En Jiten el mazo de minado se llama `mining`, igual que en su extensión
    (`${deck}-add`), y es lo que hay detrás de su botón «Deck +».

    Si Jiten lo rechaza —puede pedir que la tarjeta exista ya—, la cola tira ese apunte sola
    con un aviso en la consola y no se entera nadie: el mazo de Yoru es local y no depende de
    esto.
  */
  if (previousStatus === 'learning' && status !== 'learning') states.push('mining-remove');
  if (status === 'learning' && previousStatus !== 'learning') states.push('mining-add');
  if (states.length === 0 && status !== 'learning') return;

  const at = Date.now();
  states.forEach((state, index) => enqueue({ kind: 'state', term: spelling, reading: reading || '', state, at: at + index }));
  const shown = status === 'known' ? 'mastered' : status === 'ignored' ? 'blacklisted' : status === 'learning' ? 'young' : 'new';
  stateOverrides.set(spelling, shown);
  emitChange();
}

/**
 * «Forget»: Jiten olvida la tarjeta y la palabra vuelve a estar sin ver.
 * Es el mismo `forget-add` que manda su extensión desde el botón del mismo nombre.
 */
export function syncJitenForget(term: string, reading: string) {
  if (!canQueueJitenSync() || !term) return;
  const spelling = term.split(':')[0];
  enqueue({ kind: 'state', term: spelling, reading: reading || '', state: 'forget-add', at: Date.now() });
  stateOverrides.set(spelling, 'new');
  emitChange();
}
