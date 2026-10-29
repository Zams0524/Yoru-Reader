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
const MAX_ITEMS = 12;

export interface ServerItem {
  id: string;
  title: string;
  cover: string;
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
