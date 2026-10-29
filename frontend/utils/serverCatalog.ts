import { getKavitaLibraries, getKavitaSeries, isKavitaConfigured, kavitaSeriesCoverUrl } from './kavitaService';
import {
  absCoverUrl,
  getAudiobookLibraries,
  getAudiobooks,
  isAudiobookshelfConfigured,
} from './audiobookshelfService';

/**
 * Novedades de los servidores de casa, para que al abrir la app ya haya algo que
 * enseñar sin esperar a nadie.
 *
 * Reglas, en este orden:
 *  1. Lo que se pinta sale de la caché, que se lee al instante.
 *  2. La consulta va en segundo plano, con un tope de tiempo corto.
 *  3. Si el servidor no está (portátil fuera de casa, modo avión), no pasa nada:
 *     se queda la caché, no hay error, ni aviso, ni espera.
 *  4. Sin credenciales no se intenta siquiera.
 */

const CACHE_KEY = 'yoru_server_catalog_v1';
const TIMEOUT_MS = 2500;
// Bastantes para poder sortear «aleatorios» sin volver a pedirlos.
const MAX_ITEMS = 36;

export interface ServerItem {
  id: string;
  title: string;
  cover: string;
  source: 'kavita' | 'audiobookshelf';
  /** Serie a la que pertenece, cuando el servidor la da. */
  series?: string;
  author?: string;
}

/** Una serie del servidor, con los tomos que conocemos de ella. */
export interface ServerSeries {
  key: string;
  title: string;
  covers: string[];
  count: number;
  author?: string;
  source: 'kavita' | 'audiobookshelf';
}

export interface ServerCatalog {
  /** Cuándo se consiguió, en epoch ms. */
  at: number;
  kavita: ServerItem[];
  audiobooks: ServerItem[];
}

const EMPTY: ServerCatalog = { at: 0, kavita: [], audiobooks: [] };

/** El último listado conocido. Nunca lanza: si no hay nada, devuelve vacío. */
export function getCachedServerCatalog(): ServerCatalog {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as ServerCatalog;
    return {
      at: Number(parsed?.at) || 0,
      kavita: Array.isArray(parsed?.kavita) ? parsed.kavita : [],
      audiobooks: Array.isArray(parsed?.audiobooks) ? parsed.audiobooks : [],
    };
  } catch {
    return EMPTY;
  }
}

function save(catalog: ServerCatalog): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    window.dispatchEvent(new Event('yoru-server-catalog-updated'));
  } catch {
    /* almacenamiento lleno: la caché es un lujo, no se rompe nada sin ella */
  }
}

/** Corta por lo sano: fuera de casa no se espera a un servidor que no va a contestar. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    }),
  ]);
}

async function fetchKavita(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getKavitaLibraries());
  const first = libraries[0];
  if (!first) return [];
  const page = await withTimeout(getKavitaSeries(first.id, 1, MAX_ITEMS));
  return (page.items || []).slice(0, MAX_ITEMS).map((series) => ({
    id: `kavita-${series.id}`,
    title: series.name,
    cover: kavitaSeriesCoverUrl(series.id),
    source: 'kavita' as const,
  }));
}

async function fetchAudiobooks(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getAudiobookLibraries());
  const first = libraries[0];
  if (!first) return [];
  const page = await withTimeout(getAudiobooks(first.id, 0, MAX_ITEMS));
  return (page.items || []).slice(0, MAX_ITEMS).map((item) => ({
    id: `abs-${item.id}`,
    title: item.title,
    cover: absCoverUrl(item.id),
    source: 'audiobookshelf' as const,
    series: item.series || undefined,
    author: item.author || undefined,
  }));
}

let running = false;

/**
 * Pide las novedades y actualiza la caché. No propaga errores a propósito: quien la
 * llama no tiene nada que hacer con ellos. Se puede llamar al arrancar sin miedo.
 */
export async function refreshServerCatalog(): Promise<void> {
  if (running) return;
  const wantsKavita = isKavitaConfigured();
  const wantsAudiobooks = isAudiobookshelfConfigured();
  if (!wantsKavita && !wantsAudiobooks) return;

  running = true;
  try {
    const [kavita, audiobooks] = await Promise.all([
      wantsKavita ? fetchKavita().catch(() => null) : Promise.resolve(null),
      wantsAudiobooks ? fetchAudiobooks().catch(() => null) : Promise.resolve(null),
    ]);

    // Un servidor caído no borra lo que ya sabíamos del otro.
    if (kavita === null && audiobooks === null) return;
    const previous = getCachedServerCatalog();
    save({
      at: Date.now(),
      kavita: kavita ?? previous.kavita,
      audiobooks: audiobooks ?? previous.audiobooks,
    });
  } finally {
    running = false;
  }
}

/**
 * Series de audiolibros, agrupando por el campo `series` que da Audiobookshelf.
 * Solo sale lo que el servidor dice: si un audiolibro no trae serie, no se inventa.
 */
export function audiobookSeriesOf(items: ServerItem[]): ServerSeries[] {
  const map = new Map<string, ServerSeries>();
  for (const item of items) {
    if (!item.series) continue;
    const entry = map.get(item.series) || {
      key: item.series,
      title: item.series,
      covers: [],
      count: 0,
      author: item.author,
      source: 'audiobookshelf' as const,
    };
    if (entry.covers.length < 4) entry.covers.push(item.cover);
    entry.count += 1;
    map.set(item.series, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Una muestra al azar, para los carruseles de «aleatorios». */
export function sample<T>(items: T[], count: number, seed = 0): T[] {
  const copy = [...items];
  // Baraja determinista por semilla: el botón «Actualizar» cambia la semilla.
  let state = seed || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
