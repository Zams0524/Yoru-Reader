import {
  getKavitaLibraries,
  getKavitaSeries,
  getKavitaSeriesMetadata,
  isKavitaConfigured,
  kavitaSeriesCoverUrl,
} from './kavitaService';
import {
  absCoverUrl,
  getAudiobookLibraries,
  getAudiobooks,
  isAudiobookshelfConfigured,
} from './audiobookshelfService';
import type { ServerItem } from './serverCatalog';

/**
 * Series y autores de los servidores de casa (Kavita y Audiobookshelf), para las
 * secciones «Series» y «Autores» de Explorar.
 *
 * Esas secciones salían de la biblioteca local y nada más, así que con todo en el
 * servidor decían «Todavía no hay nada» mientras Kavita tenía doscientas series. El
 * catálogo de Inicio (`serverCatalog`) guarda solo una muestra para las filas; aquí se
 * guarda el listado entero, con el autor de cada título.
 *
 * Mismas reglas que el catálogo: se pinta de la caché al instante, se refresca en
 * segundo plano, y un servidor que no contesta deja lo que ya se sabía.
 */

const CACHE_KEY = 'yoru_server_entities_v1';
export const SERVER_ENTITIES_EVENT = 'yoru-server-entities-updated';
/** Una vez cada pocas horas basta: series y autores cambian poco. */
const STALE_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
/** Tope de páginas por biblioteca, por si un servidor miente con su total. */
const MAX_PAGES = 50;
/** Peticiones de metadatos a la vez: el servidor es de casa, no hay que ahogarlo. */
const METADATA_CONCURRENCY = 6;

export interface ServerEntities {
  at: number;
  /** Las series de Kavita, una por título, con sus autores. */
  kavita: ServerItem[];
  /** Los audiolibros de Audiobookshelf, con su serie y su autor. */
  audiobooks: ServerItem[];
  /** Los autores de cada serie de Kavita, por su id. Vacío = ya se preguntó y no hay. */
  kavitaWriters: Record<string, string[]>;
}

/** Una serie o un autor del servidor, con sus títulos dentro. */
export interface ServerGroup {
  key: string;
  name: string;
  items: ServerItem[];
}

const EMPTY: ServerEntities = { at: 0, kavita: [], audiobooks: [], kavitaWriters: {} };

export function getCachedServerEntities(): ServerEntities {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as ServerEntities;
    return {
      at: Number(parsed?.at) || 0,
      kavita: Array.isArray(parsed?.kavita) ? parsed.kavita : [],
      audiobooks: Array.isArray(parsed?.audiobooks) ? parsed.audiobooks : [],
      kavitaWriters: parsed?.kavitaWriters && typeof parsed.kavitaWriters === 'object' ? parsed.kavitaWriters : {},
    };
  } catch {
    return EMPTY;
  }
}

function save(entities: ServerEntities): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entities));
  } catch {
    /* sin sitio: la caché es un lujo, la vista se queda con lo que tenga */
  }
  window.dispatchEvent(new Event(SERVER_ENTITIES_EVENT));
}

async function fetchAllKavita(): Promise<ServerItem[]> {
  const libraries = await getKavitaLibraries();
  const out: ServerItem[] = [];
  const seen = new Set<number>();
  for (const library of libraries) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await getKavitaSeries(library.id, page, PAGE_SIZE);
      for (const series of result.items) {
        if (seen.has(series.id)) continue;
        seen.add(series.id);
        out.push({
          id: `kavita-${series.id}`,
          serverId: String(series.id),
          title: series.name,
          cover: kavitaSeriesCoverUrl(series.id),
          source: 'kavita',
          hours: series.avgHoursToRead,
        });
      }
      if (result.items.length < PAGE_SIZE || page >= (result.totalPages || page)) break;
    }
  }
  return out;
}

async function fetchAllAudiobooks(): Promise<ServerItem[]> {
  const libraries = (await getAudiobookLibraries()).filter((library) => library.mediaType !== 'podcast');
  const out: ServerItem[] = [];
  const seen = new Set<string>();
  for (const library of libraries) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await getAudiobooks(library.id, page, PAGE_SIZE);
      for (const item of result.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push({
          id: `abs-${item.id}`,
          serverId: item.id,
          title: item.title,
          cover: absCoverUrl(item.id),
          source: 'audiobookshelf',
          series: item.series || undefined,
          author: item.author || undefined,
        });
      }
      if (result.items.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= result.total) break;
    }
  }
  return out;
}

/**
 * Los autores de las series de Kavita. El listado no los trae: están en los metadatos,
 * uno por serie. Solo se pregunta por las que no se conocían ya, así que la primera
 * vez tarda un poco y las siguientes no piden casi nada.
 */
async function fetchKavitaWriters(series: ServerItem[], known: Record<string, string[]>): Promise<Record<string, string[]>> {
  const writers: Record<string, string[]> = {};
  const pending: string[] = [];
  for (const item of series) {
    const id = item.serverId || '';
    if (!id) continue;
    if (known[id]) writers[id] = known[id];
    else pending.push(id);
  }
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const id = pending[next];
      next += 1;
      // `getKavitaSeriesMetadata` no lanza: un fallo vuelve sin autores.
      const meta = await getKavitaSeriesMetadata(Number(id));
      writers[id] = meta.writers || [];
    }
  };
  await Promise.all(Array.from({ length: METADATA_CONCURRENCY }, worker));
  return writers;
}

let running: Promise<void> | null = null;

/**
 * Trae del servidor las series y los autores. No lanza nunca y no se pisa consigo
 * misma: si ya hay una en marcha, devuelve esa. Sin `force`, no hace nada si la caché
 * es reciente.
 */
export function refreshServerEntities(force = false): Promise<void> {
  if (running) return running;
  const wantsKavita = isKavitaConfigured();
  const wantsAudio = isAudiobookshelfConfigured();
  const previous = getCachedServerEntities();
  if (!wantsKavita && !wantsAudio) {
    // Un servidor que ya no está configurado no deja nada en Explorar.
    if (previous.kavita.length || previous.audiobooks.length) save(EMPTY);
    return Promise.resolve();
  }
  if (!force && previous.at && Date.now() - previous.at < STALE_MS) return Promise.resolve();

  running = (async () => {
    try {
      const [kavita, audiobooks] = await Promise.all([
        wantsKavita ? fetchAllKavita().catch(() => null) : Promise.resolve([] as ServerItem[]),
        wantsAudio ? fetchAllAudiobooks().catch(() => null) : Promise.resolve([] as ServerItem[]),
      ]);
      if (kavita === null && audiobooks === null) return;
      const kavitaList = kavita ?? previous.kavita;
      // Lo del listado se guarda ya, sin esperar a los autores: las series salen antes.
      const partial: ServerEntities = {
        at: Date.now(),
        kavita: kavitaList,
        audiobooks: audiobooks ?? previous.audiobooks,
        kavitaWriters: previous.kavitaWriters,
      };
      save(partial);
      if (wantsKavita && kavita !== null) {
        const kavitaWriters = await fetchKavitaWriters(kavitaList, previous.kavitaWriters);
        save({ ...partial, kavitaWriters });
      }
    } catch {
      /* fuera de casa o servidor caído: se queda la caché */
    } finally {
      running = null;
    }
  })();
  return running;
}

function sortGroups(groups: ServerGroup[]): ServerGroup[] {
  return groups.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'ja'));
}

function byTitle(a: ServerItem, b: ServerItem): number {
  return a.title.localeCompare(b.title, 'ja', { numeric: true });
}

/**
 * Las series del servidor. Cada serie de Kavita es ya una serie; los audiolibros se
 * agrupan por el campo `series` que da Audiobookshelf, sin inventar ninguna.
 */
export function serverSeriesGroups(entities: ServerEntities): ServerGroup[] {
  const groups: ServerGroup[] = entities.kavita.map((item) => ({
    key: `kavita:${item.serverId || item.id}`,
    name: item.title,
    items: [{ ...item, author: entities.kavitaWriters[item.serverId || '']?.[0] }],
  }));
  const audio = new Map<string, ServerGroup>();
  for (const item of entities.audiobooks) {
    const name = cleanSeriesName(item.series);
    if (!name) continue;
    let group = audio.get(name);
    if (!group) {
      group = { key: `abs:${name}`, name, items: [] };
      audio.set(name, group);
    }
    group.items.push(item);
  }
  for (const group of audio.values()) group.items.sort(byTitle);
  return sortGroups([...groups, ...audio.values()]);
}

/** Los autores del servidor: los de Kavita (de los metadatos) y los de Audiobookshelf. */
export function serverAuthorGroups(entities: ServerEntities): ServerGroup[] {
  const map = new Map<string, ServerGroup>();
  const add = (name: string, item: ServerItem) => {
    const clean = name.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { key: `author:${key}`, name: clean, items: [] };
      map.set(key, group);
    }
    if (!group.items.some((entry) => entry.id === item.id)) group.items.push(item);
  };
  for (const item of entities.kavita) {
    const writers = entities.kavitaWriters[item.serverId || ''] || [];
    for (const writer of writers) add(writer, { ...item, author: writers[0] });
  }
  for (const item of entities.audiobooks) {
    // Audiobookshelf junta varios autores con comas en un solo texto.
    for (const name of splitAuthors(item.author)) add(name, item);
  }
  for (const group of map.values()) group.items.sort(byTitle);
  return sortGroups([...map.values()]);
}

/** «Serie A #3» es la serie «Serie A»: el número es del tomo, no de la serie. */
export function cleanSeriesName(series?: string): string {
  return (series || '').replace(/\s*#\s*[\d.]+\s*$/, '').trim();
}

export function splitAuthors(author?: string): string[] {
  return (author || '')
    .split(/\s*[,、;]\s*|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Busca una serie o un autor del servidor por su clave, en la caché. */
export function findServerGroup(kind: 'series' | 'author', key: string): ServerGroup | null {
  const entities = getCachedServerEntities();
  const list = kind === 'series' ? serverSeriesGroups(entities) : serverAuthorGroups(entities);
  return list.find((group) => group.key === key) ?? null;
}
