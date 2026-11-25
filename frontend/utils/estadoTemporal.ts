/**
 * Lo que se guarda de un libro que se lee del servidor sin descargar.
 *
 * Un libro temporal (id `tmp:...`) no tiene fila en la base de libros, así que lo que
 * el lector guardaba con `db` se perdía al salir: la página exacta y los marcadores.
 * Del progreso solo quedaba el porcentaje que sube a Kavita, que al volver dejaba al
 * lector al principio de un capítulo, no en la página que se estaba leyendo.
 *
 * Aquí se apunta, por perfil y por libro temporal, la posición exacta del lector
 * (sección y párrafo), sus marcadores y sus subrayados. Es poco texto: va en
 * localStorage y se guardan solo los libros abiertos más recientes.
 */

export interface PosicionTemporal {
  currentChapter: number;
  currentPage: number;
  percent: number;
  at: string;
}

export interface EstadoTemporal {
  progress?: PosicionTemporal;
  bookmarks?: any[];
  highlights?: any[];
  at: string;
}

const PREFIJO_CLAVE = 'yoru_estado_temporal_';
/** Cuántos libros temporales se recuerdan por perfil. */
const MAXIMO = 60;

export const esIdTemporal = (id: unknown): id is string => typeof id === 'string' && id.startsWith('tmp:');

function clave(profileId: string | null | undefined): string {
  return PREFIJO_CLAVE + (profileId || 'profile-default');
}

function leerTodo(profileId: string | null | undefined): Record<string, EstadoTemporal> {
  try {
    const datos = JSON.parse(localStorage.getItem(clave(profileId)) || '{}');
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
  } catch {
    return {};
  }
}

function escribirTodo(profileId: string | null | undefined, todo: Record<string, EstadoTemporal>): void {
  const ids = Object.keys(todo);
  if (ids.length > MAXIMO) {
    // Se sueltan los que llevan más tiempo sin abrirse.
    ids.sort((a, b) => String(todo[b]?.at || '').localeCompare(String(todo[a]?.at || '')));
    for (const id of ids.slice(MAXIMO)) delete todo[id];
  }
  try {
    localStorage.setItem(clave(profileId), JSON.stringify(todo));
  } catch (error) {
    console.warn('[yoru] no se pudo guardar el estado del libro temporal:', error instanceof Error ? error.message : String(error));
  }
}

function actualizar(profileId: string | null | undefined, bookId: string, cambio: Partial<EstadoTemporal>): void {
  if (!esIdTemporal(bookId)) return;
  const todo = leerTodo(profileId);
  todo[bookId] = { ...(todo[bookId] || {}), ...cambio, at: new Date().toISOString() };
  escribirTodo(profileId, todo);
}

/** Lo apuntado de ese libro temporal, o `null`. */
export function leerEstadoTemporal(profileId: string | null | undefined, bookId: string): EstadoTemporal | null {
  if (!esIdTemporal(bookId)) return null;
  return leerTodo(profileId)[bookId] || null;
}

export function guardarPosicionTemporal(
  profileId: string | null | undefined,
  bookId: string,
  posicion: { currentChapter: number; currentPage: number; percent: number },
): void {
  actualizar(profileId, bookId, {
    progress: {
      currentChapter: posicion.currentChapter,
      currentPage: posicion.currentPage,
      percent: posicion.percent,
      at: new Date().toISOString(),
    },
  });
}

export function guardarMarcadoresTemporales(profileId: string | null | undefined, bookId: string, bookmarks: any[]): void {
  actualizar(profileId, bookId, { bookmarks: Array.isArray(bookmarks) ? bookmarks : [] });
}

export function guardarSubrayadosTemporales(profileId: string | null | undefined, bookId: string, highlights: any[]): void {
  actualizar(profileId, bookId, { highlights: Array.isArray(highlights) ? highlights : [] });
}

/** Al guardar el libro en la biblioteca, lo temporal ya no hace falta. */
export function olvidarEstadoTemporal(profileId: string | null | undefined, bookId: string): void {
  const todo = leerTodo(profileId);
  if (!(bookId in todo)) return;
  delete todo[bookId];
  escribirTodo(profileId, todo);
}

/**
 * Dónde se retoma un libro temporal. La posición exacta apuntada aquí manda, salvo que
 * el servidor diga que se ha leído más (otro aparato): entonces se va a lo del servidor.
 *
 * El servidor guarda páginas de Kavita, no porcentajes: al subir se redondea a la
 * página más cercana, que puede ir hasta media página por delante. Por eso hay una
 * página de margen (y al menos un punto), para no tomar ese redondeo por lectura en
 * otro aparato.
 */
export function retomarAqui(local: PosicionTemporal | undefined | null, porcentajeServidor: number, paginasServidor = 0): boolean {
  if (!local || !Number.isFinite(local.currentChapter) || !Number.isFinite(local.currentPage)) return false;
  const servidor = Number.isFinite(porcentajeServidor) ? porcentajeServidor : 0;
  const margen = Math.max(1, paginasServidor > 0 ? 100 / paginasServidor : 1);
  return servidor <= (Number(local.percent) || 0) + margen;
}
