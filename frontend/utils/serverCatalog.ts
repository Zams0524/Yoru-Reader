import {
  getKavitaCollections,
  getKavitaLibraries,
  getKavitaOnDeck,
  getKavitaPopularSeries,
  getKavitaRecentlyAdded,
  getKavitaSeries,
  getKavitaSeriesMetadata,
  isKavitaConfigured,
  kavitaSeriesCoverUrl,
  kavitaVolumeCoverUrl,
} from './kavitaService';
import {
  absCoverUrl,
  getAudiobookCollections,
  getAudiobookLibraries,
  getAudiobookPersonalized,
  getAudiobooks,
  getAudiobooksInProgress,
  getPopularAudiobooks,
  getRecentAudiobooks,
  isAudiobookshelfConfigured,
} from './audiobookshelfService';
import type { AudiobookItem, KavitaSeries } from '../types/integrations';
import { localContinueEntries, localKavitaSeriesRead, sharesServerProgress } from './serverProgress';
import { clasificar, esColeccionDeGenero } from './coleccionesInteligentes';

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
  /**
   * Identificador para React, con prefijo de carrusel: la misma serie sale en
   * «Series de libros» y en «Continuar en el servidor», y dos claves iguales en la
   * misma página se pisan. **No vale para pedirle nada al servidor**: para eso está
   * `serverId`, o `serverItemId()` si el dato viene de una caché vieja.
   */
  id: string;
  /** El identificador de verdad, el que entiende Kavita o Audiobookshelf. */
  serverId?: string;
  title: string;
  cover: string;
  source: 'kavita' | 'audiobookshelf';
  /** Serie a la que pertenece, cuando el servidor la da. */
  series?: string;
  author?: string;
  /** Horas estimadas de lectura, cuando Kavita las da. */
  hours?: number;
  /** Por dónde va el usuario, 0-100. Solo lo traen los que están a medias. */
  percent?: number;
  /** Cuándo entró en el servidor (epoch ms). Solo en «Añadidos recientemente». */
  addedAt?: number;
  /** Cuántas personas lo leen o escuchan en el servidor. Solo en «Popular». */
  readers?: number;
  /** Otros nombres del mismo título (Kavita: el original y el traducido). */
  altTitles?: string[];
  /** Géneros y etiquetas del servidor, cuando se conocen. Sirven para clasificar. */
  genres?: string[];
  /**
   * Lo metió la app en la colección, no el servidor (`coleccionesInteligentes.ts`).
   * Solo en los títulos de una colección.
   */
  auto?: boolean;
}

/**
 * Una colección del servidor: las de Kavita y las de Audiobookshelf. Lleva sus
 * títulos dentro para que la vista de la colección salga de la caché, sin red.
 */
export interface ServerCollection {
  key: string;
  title: string;
  source: 'kavita' | 'audiobookshelf';
  items: ServerItem[];
}

/** Una serie del servidor, con los tomos que conocemos de ella. */
export interface ServerSeries {
  key: string;
  title: string;
  covers: string[];
  count: number;
  author?: string;
  source: 'kavita' | 'audiobookshelf';
  /**
   * El primer tomo de la serie. La serie es un montón que hacemos aquí agrupando por
   * nombre, no algo que el servidor tenga con identidad propia, así que no hay ficha
   * de serie a la que ir: pulsar la tarjeta abre este tomo.
   */
  firstId: string;
}

export interface ServerCatalog {
  /** Cuándo se consiguió, en epoch ms. */
  at: number;
  kavita: ServerItem[];
  audiobooks: ServerItem[];
  /** Lo que el servidor de Kavita tiene a medias (su propio «seguir leyendo»). */
  onDeck: ServerItem[];
  /** Estanterías que Audiobookshelf prepara para el usuario. */
  forYouAudio: ServerItem[];
  /** Lo que el usuario tiene a medias en Audiobookshelf, con su avance. */
  continueAudio: ServerItem[];
  /** Lo último que entró en los dos servidores, lo más nuevo primero. */
  recent: ServerItem[];
  /** Lo que más gente lee o escucha en el servidor (solo con cuenta de administrador). */
  popular: ServerItem[];
  /** Las colecciones de Kavita y de Audiobookshelf. */
  collections: ServerCollection[];
}

const EMPTY: ServerCatalog = {
  at: 0, kavita: [], audiobooks: [], onDeck: [], forYouAudio: [], continueAudio: [], recent: [], popular: [], collections: [],
};

/** El último listado conocido. Nunca lanza: si no hay nada, devuelve vacío. */
export function getCachedServerCatalog(): ServerCatalog {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    // Sin caché todavía, lo escuchado por este perfil ya se puede enseñar: no depende
    // de ningún servidor, está apuntado aquí.
    if (!raw) return sharesServerProgress() ? EMPTY : { ...EMPTY, continueAudio: localAudioContinueItems() };
    const parsed = JSON.parse(raw) as ServerCatalog;
    return {
      at: Number(parsed?.at) || 0,
      kavita: Array.isArray(parsed?.kavita) ? parsed.kavita : [],
      audiobooks: Array.isArray(parsed?.audiobooks) ? parsed.audiobooks : [],
      // Una caché de antes puede traer el «seguir leyendo» de la cuenta: sin compartir
      // el progreso no se enseña, que sería lo que lee otra persona.
      onDeck: Array.isArray(parsed?.onDeck) && sharesServerProgress() ? parsed.onDeck : [],
      forYouAudio: Array.isArray(parsed?.forYouAudio) ? parsed.forYouAudio : [],
      // Igual con «Seguir escuchando»: lo de la cuenta solo si este perfil comparte.
      // Si no comparte, lo suyo sale de lo apuntado en el aparato, sin esperar a
      // ningún refresco y sin mirar la caché, que es de la cuenta.
      continueAudio: sharesServerProgress()
        ? (Array.isArray(parsed?.continueAudio) ? parsed.continueAudio : [])
        : localAudioContinueItems(),
      // Una caché de antes de estas filas no las trae: salen vacías hasta el refresco.
      recent: Array.isArray(parsed?.recent) ? parsed.recent : [],
      popular: Array.isArray(parsed?.popular) ? parsed.popular : [],
      collections: Array.isArray(parsed?.collections) ? parsed.collections : [],
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
function withTimeout<T>(promise: Promise<T>, ms: number = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

async function fetchKavita(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getKavitaLibraries());
  const first = libraries[0];
  if (!first) return [];
  const page = await withTimeout(getKavitaSeries(first.id, 1, MAX_ITEMS));
  return (page.items || []).slice(0, MAX_ITEMS).map((series) => kavitaItem('kavita', series));
}

async function fetchAudiobooks(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getAudiobookLibraries());
  const first = libraries[0];
  if (!first) return [];
  const page = await withTimeout(getAudiobooks(first.id, 0, MAX_ITEMS));
  return (page.items || []).slice(0, MAX_ITEMS).map((item) => audiobookItem('abs', item));
}

async function fetchOnDeck(): Promise<ServerItem[]> {
  const series = await withTimeout(getKavitaOnDeck(MAX_ITEMS));
  /*
    El autor, que el listado de series no trae: está en los metadatos, uno por serie.
    Solo para las que se ven en la fila, y sin que un servidor lento tumbe el
    carrusel: `getKavitaSeriesMetadata` nunca lanza, y lo que no llegue a tiempo
    sencillamente sale sin autor, que es mejor que decir «Sin autor» por costumbre.
  */
  const visibles = series.slice(0, 12);
  const autores = new Map<number, string>();
  await withTimeout(
    Promise.all(
      visibles.map(async (item) => {
        const meta = await getKavitaSeriesMetadata(item.id);
        const escritor = (meta.writers || [])[0];
        if (escritor) autores.set(item.id, escritor);
      })
    ),
    TIMEOUT_MS * 4
  ).catch(() => undefined);

  return series.map((item) => {
    // Kavita cuenta páginas; la tarjeta enseña por dónde vas, igual que las de audio.
    const leidas = Number(item.pagesRead);
    const total = Number(item.pages);
    const percent = total > 0 && Number.isFinite(leidas)
      ? Math.min(100, Math.max(0, Math.round((leidas / total) * 100)))
      : undefined;
    return {
      id: 'ondeck-' + item.id,
      serverId: String(item.id),
      title: item.name,
      cover: kavitaSeriesCoverUrl(item.id),
      source: 'kavita' as const,
      author: autores.get(item.id),
      percent,
    };
  });
}

async function fetchForYouAudio(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getAudiobookLibraries());
  const first = libraries[0];
  if (!first) return [];
  const items = await withTimeout(getAudiobookPersonalized(first.id, 12));
  return items.map((item) => ({
    id: 'foryou-' + item.id,
    serverId: item.id,
    title: item.title,
    cover: absCoverUrl(item.id),
    source: 'audiobookshelf' as const,
    author: item.author || undefined,
  }));
}

/**
 * Lo que este perfil tiene a medias de oír, apuntado en el aparato.
 *
 * Es lo que llena «Seguir escuchando» cuando el perfil no comparte el progreso con la
 * cuenta. Sale de aquí y no de la caché a propósito: la caché es de la cuenta y la
 * comparten todos los perfiles, así que un perfil no puede fiarse de ella.
 */
export function localAudioContinueItems(): ServerItem[] {
  return localContinueEntries()
    .map((entry) => (entry.kind === 'audiobook'
      ? {
        id: 'enescucha-' + entry.itemId,
        serverId: entry.itemId,
        title: entry.title,
        cover: absCoverUrl(entry.itemId),
        source: 'audiobookshelf' as const,
        author: entry.author || undefined,
        percent: entry.percent,
      }
      : null))
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Las series de Kavita que este perfil ha abierto, con su avance: sus libros del servidor.
 *
 * Es la misma lista en la Biblioteca («Leyendo») y en el perfil («Libros»). Antes solo
 * la armaba la Biblioteca, y el perfil, que miraba nada más que lo importado, decía
 * «Este estante está vacío» a quien lee de Kavita sin descargar nada.
 *
 * Lo leído sale de lo apuntado en el aparato; el título y el autor, de la caché del
 * catálogo cuando la serie está en ella. No se le pide nada al servidor.
 */
export function localKavitaReadingItems(catalog: ServerCatalog = getCachedServerCatalog()): ServerItem[] {
  const delServidor = new Map(catalog.kavita.map((item) => [serverItemId(item), item]));
  return localKavitaSeriesRead().map((serie) => {
    const conocida = delServidor.get(String(serie.seriesId));
    return {
      id: `kavita-${serie.seriesId}`,
      serverId: String(serie.seriesId),
      title: conocida?.title || serie.title,
      // La portada es la del tomo por el que vas, no la de la serie.
      cover: kavitaVolumeCoverUrl(serie.volumeId) || conocida?.cover || '',
      source: 'kavita' as const,
      author: conocida?.author,
      percent: serie.percent,
    };
  });
}

/** «Continuar escuchando»: lo que Audiobookshelf tiene a medias, con su avance. */
async function fetchContinueAudio(): Promise<ServerItem[]> {
  /*
    Sin compartir el progreso, lo «a medias» de la cuenta es lo que escucha otra
    persona. En ese caso sale lo escuchado en este perfil, apuntado en el aparato.
  */
  if (!sharesServerProgress()) return localAudioContinueItems();

  /*
    Más tiempo que los demás, y por eso lleva su propio plazo.

    Esto son dos peticiones encadenadas —la lista y el avance—, y a veces alguna
    suelta más. Con los 2,5 s de todos se pasaba de largo, el intento se daba por
    fallido y se quedaba lo de la caché: las tarjetas de siempre, con la barra a cero.
  */
  const enCurso = await withTimeout(getAudiobooksInProgress(12), TIMEOUT_MS * 4);
  return enCurso.map(({ item, percent }) => ({
    id: 'enescucha-' + item.id,
    serverId: item.id,
    title: item.title,
    cover: absCoverUrl(item.id),
    source: 'audiobookshelf' as const,
    series: item.series || undefined,
    author: item.author || undefined,
    percent,
  }));
}

/** Una serie de Kavita como tarjeta del servidor, con un prefijo de carrusel. */
function kavitaItem(prefix: string, series: KavitaSeries): ServerItem {
  const otros = [series.originalName, series.localizedName]
    .filter((nombre): nombre is string => !!nombre && nombre.trim() !== '' && nombre !== series.name);
  return {
    id: `${prefix}-${series.id}`,
    serverId: String(series.id),
    title: series.name,
    cover: kavitaSeriesCoverUrl(series.id),
    source: 'kavita',
    hours: series.avgHoursToRead,
    ...(otros.length > 0 ? { altTitles: [...new Set(otros)] } : {}),
  };
}

/** Un audiolibro como tarjeta del servidor, con un prefijo de carrusel. */
function audiobookItem(prefix: string, item: AudiobookItem): ServerItem {
  return {
    id: `${prefix}-${item.id}`,
    serverId: item.id,
    title: item.title,
    cover: absCoverUrl(item.id),
    source: 'audiobookshelf',
    series: item.series || undefined,
    author: item.author || undefined,
    ...(item.genres?.length ? { genres: item.genres } : {}),
  };
}

/**
 * Junta dos listas ya ordenadas en una, por un número que va de mayor a menor. Así
 * «Añadidos recientemente» mezcla Kavita y Audiobookshelf por fecha, y «Popular»
 * por lectores, en vez de poner todo lo de un servidor delante del otro.
 */
function mergeBy(a: ServerItem[], b: ServerItem[], key: (item: ServerItem) => number, limit: number): ServerItem[] {
  return [...a, ...b].sort((x, y) => key(y) - key(x)).slice(0, limit);
}

/*
  Lo de Kavita y lo de Audiobookshelf se piden por separado: un servidor caído no
  deja sin fila al otro. Lo que se guarda es la lista ya mezclada.
*/
async function fetchRecentKavita(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getKavitaLibraries());
  const first = libraries[0];
  if (!first) return [];
  const recientes = await withTimeout(getKavitaRecentlyAdded(first.id, 20));
  return recientes.map(({ series, addedAt }) => ({ ...kavitaItem('reciente', series), addedAt }));
}

async function fetchRecentAudio(): Promise<ServerItem[]> {
  const libraries = await withTimeout(getAudiobookLibraries());
  const first = libraries[0];
  if (!first) return [];
  const recientes = await withTimeout(getRecentAudiobooks(first.id, 20));
  return recientes.map(({ item, addedAt }) => ({ ...audiobookItem('reciente', item), addedAt }));
}

async function fetchPopularKavita(): Promise<ServerItem[]> {
  const populares = await withTimeout(getKavitaPopularSeries(20), TIMEOUT_MS * 2);
  return populares.map(({ series, count }) => ({ ...kavitaItem('popular', series), readers: count }));
}

async function fetchPopularAudio(): Promise<ServerItem[]> {
  const populares = await withTimeout(getPopularAudiobooks(20), TIMEOUT_MS * 2);
  return populares.map((entry) => ({
    id: `popular-${entry.id}`,
    serverId: entry.id,
    title: entry.title,
    cover: absCoverUrl(entry.id),
    source: 'audiobookshelf' as const,
    author: entry.author || undefined,
    readers: entry.count,
  }));
}

async function fetchCollectionsKavita(): Promise<ServerCollection[]> {
  // Una petición por colección: lleva su propio plazo, más largo que el de las demás.
  const colecciones = await withTimeout(getKavitaCollections(12, 24), TIMEOUT_MS * 4);
  return colecciones.map((entry) => ({
    key: `kavita-${entry.id}`,
    title: entry.title,
    source: 'kavita' as const,
    items: entry.series.map((series) => kavitaItem('coleccion', series)),
  }));
}

async function fetchCollectionsAudio(): Promise<ServerCollection[]> {
  const libraries = await withTimeout(getAudiobookLibraries());
  const first = libraries[0];
  if (!first) return [];
  const colecciones = await withTimeout(getAudiobookCollections(first.id, 12), TIMEOUT_MS * 2);
  return colecciones.map((entry) => ({
    key: `abs-${entry.id}`,
    title: entry.name,
    source: 'audiobookshelf' as const,
    items: entry.items.map((item) => audiobookItem('coleccion', item)),
  }));
}

/* ------------------------------------------------------------------ */
/*  Colecciones que se llenan solas                                     */
/* ------------------------------------------------------------------ */

/**
 * Los géneros de las series de Kavita que ya se preguntaron.
 *
 * El listado de series no los trae: hay que pedir los metadatos serie a serie. Como
 * no cambian, se guardan, y cada refresco pregunta solo por las que no se conocían
 * (lo recién llegado, que es justo lo que hay que clasificar).
 */
const GENEROS_KEY = 'yoru_server_generos_v1';
/** Cuántas series nuevas se preguntan como mucho por refresco. */
const GENEROS_POR_VEZ = 24;
/** Cuántas se recuerdan: de sobra para un servidor de casa, y la caché no crece sin fin. */
const GENEROS_MAX = 2000;

function leerGeneros(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(GENEROS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function guardarGeneros(generos: Record<string, string[]>): void {
  try {
    const claves = Object.keys(generos);
    const recortado = claves.length > GENEROS_MAX
      ? Object.fromEntries(claves.slice(claves.length - GENEROS_MAX).map((clave) => [clave, generos[clave]]))
      : generos;
    localStorage.setItem(GENEROS_KEY, JSON.stringify(recortado));
  } catch {
    /* sin sitio: se volverán a preguntar la próxima vez */
  }
}

/** Una colección tal como la dio el servidor, sin lo que añadió la app. */
function soloDelServidor(collection: ServerCollection): ServerCollection {
  return { ...collection, items: collection.items.filter((item) => !item.auto) };
}

function claveDe(item: ServerItem): string {
  return `${item.source}:${serverItemId(item)}`;
}

/**
 * Cada colección del servidor, con lo que le falta.
 *
 * Kavita y Audiobookshelf no meten solos una serie nueva en «Re:Zero» ni en
 * «Isekai & Reencarnación»: alguien tiene que ir a hacerlo. Aquí se hace en la app,
 * con `coleccionesInteligentes.ts`, y **no se le escribe nada al servidor**: lo que
 * se añade lleva `auto` y vive solo en esta caché. Así no hace falta una cuenta de
 * administrador, y si la regla se equivoca, se arregla con una actualización y no
 * hay que deshacer nada en el servidor.
 *
 * Los candidatos son todo lo que el catálogo conoce de los dos servidores; lo recién
 * llegado está siempre entre ellos, en «Añadidos recientemente». Lo de un servidor
 * puede entrar en una colección del otro: el audiolibro de Re:Zero va con sus novelas.
 */
async function completarColecciones(catalog: ServerCatalog): Promise<ServerCollection[]> {
  const colecciones = catalog.collections.map(soloDelServidor);
  if (colecciones.length === 0) return colecciones;

  const candidatos = new Map<string, ServerItem>();
  for (const item of [
    ...catalog.recent, ...catalog.kavita, ...catalog.audiobooks, ...catalog.popular,
    ...catalog.onDeck, ...catalog.forYouAudio, ...catalog.continueAudio,
  ]) {
    const clave = claveDe(item);
    const visto = candidatos.get(clave);
    // La misma serie sale en varias filas: se junta lo que sepa cada una.
    candidatos.set(clave, visto ? {
      ...visto,
      series: visto.series || item.series,
      author: visto.author || item.author,
      altTitles: visto.altTitles || item.altTitles,
      genres: visto.genres || item.genres,
    } : item);
  }

  // Los géneros de Kavita, solo si alguna colección es de género: si no, sobran.
  if (colecciones.some((coleccion) => esColeccionDeGenero(coleccion.title))) {
    const generos = leerGeneros();
    const faltan = [...candidatos.values()]
      .filter((item) => item.source === 'kavita' && !(claveDe(item) in generos))
      .slice(0, GENEROS_POR_VEZ);
    if (faltan.length > 0) {
      await withTimeout(
        Promise.all(faltan.map(async (item) => {
          const id = Number(serverItemId(item));
          if (!Number.isFinite(id)) return;
          // `getKavitaSeriesMetadata` no lanza; sin respuesta da listas vacías.
          const meta = await getKavitaSeriesMetadata(id);
          generos[claveDe(item)] = [...meta.genres, ...meta.tags];
        })),
        TIMEOUT_MS * 4
      ).catch(() => undefined);
      guardarGeneros(generos);
    }
    for (const [clave, item] of candidatos) {
      const sabidos = generos[clave];
      if (sabidos?.length && !item.genres?.length) candidatos.set(clave, { ...item, genres: sabidos });
    }
  }

  const nuevos = clasificar(
    colecciones.map((coleccion) => ({
      nombre: coleccion.title,
      // Los miembros con lo que se sepa de ellos: sus otros títulos dan la pista de la serie.
      miembros: coleccion.items.map((item) => candidatos.get(claveDe(item)) || item),
    })),
    [...candidatos.values()],
    claveDe
  );

  let total = 0;
  const resultado = colecciones.map((coleccion, indice) => {
    const extra = nuevos[indice];
    if (extra.length === 0) return coleccion;
    total += extra.length;
    return {
      ...coleccion,
      items: [
        ...coleccion.items,
        ...extra.map(({ libro }) => ({
          id: `auto-${libro.source}-${serverItemId(libro)}`,
          serverId: serverItemId(libro),
          title: libro.title,
          cover: libro.cover,
          source: libro.source,
          series: libro.series,
          author: libro.author,
          hours: libro.hours,
          auto: true,
        })),
      ],
    };
  });
  if (total > 0) console.log(`[catálogo] colecciones: ${total} título(s) añadido(s) solos`);
  return resultado;
}

/** Una colección del servidor, de la caché. La usa la vista de la colección. */
export function cachedServerCollection(key: string): ServerCollection | null {
  return getCachedServerCatalog().collections.find((entry) => entry.key === key) || null;
}

let running = false;

/** Una petición al servidor con el motivo a mano cuando falla, en vez de tragárselo. */
interface Attempt<T = ServerItem> {
  items: T[] | null;
  error: string | null;
}

async function attempt<T = ServerItem>(run: () => Promise<T[]>): Promise<Attempt<T>> {
  try {
    return { items: await run(), error: null };
  } catch (error) {
    return { items: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const SKIPPED: Attempt<never> = { items: null, error: null };

/**
 * Una línea por servidor en el registro, y **nada en pantalla**.
 *
 * El silencio de cara al usuario se queda tal cual: estar fuera de casa o sin red no
 * es un problema que haya que anunciarle, y por eso esto no lanza avisos ni pinta
 * errores. Lo que no podía seguir igual es que nosotros tampoco lo viéramos: un
 * diagnóstico que no distingue «no había nada» de «la petición se cayó» no sirve, y
 * era imposible saber por qué un carrusel salía vacío sin preguntárselo al usuario.
 */
function report(server: string, parts: { label: string; attempt: Attempt<unknown> }[]): void {
  const failed = parts.find((part) => part.attempt.error);
  if (failed) {
    console.warn(`[catálogo] ${server}: falló ${failed.label} — ${failed.attempt.error}`);
    return;
  }
  const counts = parts.map((part) => `${part.attempt.items?.length ?? 0} ${part.label}`).join(', ');
  console.log(`[catálogo] ${server}: ${counts}`);
}

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
    const [
      kavita, audiobooks, onDeck, forYouAudio, continueAudio,
      recentKavita, recentAudio, popularKavita, popularAudio,
    ] = await Promise.all([
      wantsKavita ? attempt(fetchKavita) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt(fetchAudiobooks) : Promise.resolve(SKIPPED),
      wantsKavita ? attempt(fetchOnDeck) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt(fetchForYouAudio) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt(fetchContinueAudio) : Promise.resolve(SKIPPED),
      wantsKavita ? attempt(fetchRecentKavita) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt(fetchRecentAudio) : Promise.resolve(SKIPPED),
      wantsKavita ? attempt(fetchPopularKavita) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt(fetchPopularAudio) : Promise.resolve(SKIPPED),
    ]);
    const [collectionsKavita, collectionsAudio] = await Promise.all([
      wantsKavita ? attempt<ServerCollection>(fetchCollectionsKavita) : Promise.resolve(SKIPPED),
      wantsAudiobooks ? attempt<ServerCollection>(fetchCollectionsAudio) : Promise.resolve(SKIPPED),
    ]);

    if (wantsKavita) {
      report('Kavita', [
        { label: 'series', attempt: kavita },
        { label: 'a medias', attempt: onDeck },
        { label: 'recientes', attempt: recentKavita },
        { label: 'populares', attempt: popularKavita },
        { label: 'colecciones', attempt: collectionsKavita },
      ]);
    }
    if (wantsAudiobooks) {
      report('Audiobookshelf', [
        { label: 'audiolibros', attempt: audiobooks },
        { label: 'para ti', attempt: forYouAudio },
        { label: 'a medias', attempt: continueAudio },
        { label: 'recientes', attempt: recentAudio },
        { label: 'populares', attempt: popularAudio },
        { label: 'colecciones', attempt: collectionsAudio },
      ]);
    }

    // Un servidor caído no borra lo que ya sabíamos del otro.
    if (kavita.items === null && audiobooks.items === null) return;
    const previous = getCachedServerCatalog();
    /*
      Las filas que mezclan los dos servidores: lo del que contestó, y lo que ya se
      sabía del que no. Un servidor que ya no está configurado no deja nada.
    */
    const keep = <T extends { source: 'kavita' | 'audiobookshelf' }>(
      fresh: T[] | null, old: T[], source: 'kavita' | 'audiobookshelf', wanted: boolean
    ): T[] => (!wanted ? [] : fresh ?? old.filter((entry) => entry.source === source));
    const next: ServerCatalog = {
      at: Date.now(),
      kavita: kavita.items ?? previous.kavita,
      audiobooks: audiobooks.items ?? previous.audiobooks,
      onDeck: onDeck.items ?? previous.onDeck,
      forYouAudio: forYouAudio.items ?? previous.forYouAudio,
      continueAudio: continueAudio.items ?? previous.continueAudio,
      recent: mergeBy(
        keep(recentKavita.items, previous.recent, 'kavita', wantsKavita),
        keep(recentAudio.items, previous.recent, 'audiobookshelf', wantsAudiobooks),
        (item) => item.addedAt || 0,
        24
      ),
      popular: mergeBy(
        keep(popularKavita.items, previous.popular, 'kavita', wantsKavita),
        keep(popularAudio.items, previous.popular, 'audiobookshelf', wantsAudiobooks),
        (item) => item.readers || 0,
        24
      ),
      collections: [
        ...keep(collectionsKavita.items, previous.collections, 'kavita', wantsKavita),
        ...keep(collectionsAudio.items, previous.collections, 'audiobookshelf', wantsAudiobooks),
      ],
    };
    /*
      Lo nuevo de los servidores, a sus colecciones. Si algo falla aquí, las
      colecciones se guardan como las dio el servidor: completarlas es un extra.
    */
    try {
      next.collections = await completarColecciones(next);
    } catch (error) {
      console.warn('[catálogo] no se pudieron completar las colecciones:', error);
      next.collections = next.collections.map(soloDelServidor);
    }
    save(next);
  } finally {
    running = false;
  }
}

/**
 * El identificador que entiende el servidor.
 *
 * Lo normal es `serverId`. El respaldo es para las cachés escritas antes de que ese
 * campo existiera: ahí solo estaba el id con prefijo de carrusel, y una caché vieja
 * sigue siendo válida durante días. Quitarle el prefijo deja el id de verdad, que es
 * justo de donde salió.
 */
export function serverItemId(item: ServerItem): string {
  return item.serverId || item.id.replace(/^(kavita|abs|ondeck|foryou|reciente|popular|coleccion)-/, '');
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
      firstId: serverItemId(item),
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
