/**
 * Marcadores y subrayados que viajan entre aparatos, uno a uno.
 *
 * Hasta el 26 nov 2026 los marcadores iban dentro de la ficha del libro, y al combinar dos
 * copias de un libro ganaba la ficha entera de la copia leída más tarde (`cloudMerge.ts`).
 * Poner un marcador no cambia esa fecha, así que un marcador puesto en el PC se perdía en
 * cuanto el móvil había leído ese libro después: la copia del móvil, sin el marcador, ganaba
 * en el servidor y luego borraba el marcador del PC también. Y los de un libro leído del
 * servidor sin descargar (`estadoTemporal.ts`) no salían nunca del aparato.
 *
 * Ahora se juntan los de las dos copias. Para que quitar un marcador en un aparato no lo
 * devuelva el otro, cada quitado deja su fecha (`bookmarksRemoved`, `highlightsRemoved`), y
 * un marcador solo sobrevive a esa fecha si se volvió a poner después.
 */

export type Borrados = Record<string, string>;

export const claveMarcador = (marcador: any): string => String(marcador?.paragraphId ?? '');
export const claveSubrayado = (subrayado: any): string => String(subrayado?.id ?? '');

function fecha(valor: unknown): number {
  const ms = typeof valor === 'string' ? Date.parse(valor) : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

/** Cuándo se puso o se cambió por última vez (0 en los de antes de guardar fechas). */
function fechaDe(item: any): number {
  return Math.max(fecha(item?.updatedAt), fecha(item?.createdAt));
}

function lista(valor: unknown): any[] {
  return Array.isArray(valor) ? valor.filter((item) => item && typeof item === 'object') : [];
}

function sinFechas(item: any): any {
  const { createdAt, updatedAt, ...resto } = item || {};
  return Object.fromEntries(Object.keys(resto).sort().map((k) => [k, resto[k]]));
}

function mapa(valor: unknown): Borrados {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Borrados) : {};
}

/**
 * Lo que guarda el lector, comparado con lo que había: los nuevos y los cambiados llevan
 * fecha, y los quitados se apuntan en `borrados`.
 */
export function sellarCambios(
  antes: unknown,
  ahora: unknown,
  borradosAntes: unknown,
  clave: (item: any) => string,
  momento = new Date().toISOString(),
): { items: any[]; borrados: Borrados } {
  const previos = new Map(lista(antes).map((item) => [clave(item), item]));
  const borrados: Borrados = { ...mapa(borradosAntes) };
  const items = lista(ahora).map((item) => {
    const k = clave(item);
    const previo = previos.get(k);
    delete borrados[k];
    if (!previo) return item.createdAt ? { ...item, updatedAt: momento } : { ...item, createdAt: momento };
    // El lector guarda su copia en memoria, que puede no llevar las fechas: sin cambios de
    // verdad se queda la guardada, con las suyas.
    if (JSON.stringify(sinFechas(previo)) === JSON.stringify(sinFechas(item))) return previo;
    return { ...item, createdAt: previo.createdAt || item.createdAt || momento, updatedAt: momento };
  });
  const quedan = new Set(items.map(clave));
  for (const k of previos.keys()) if (!quedan.has(k)) borrados[k] = momento;
  return { items, borrados };
}

/**
 * Las dos copias de una lista, juntas. Si las dos tienen el mismo, gana el cambiado más
 * tarde (en empate, `preferida`). Un quitado gana a todo lo puesto hasta ese momento.
 */
export function combinarMarcas(
  local: unknown,
  remoto: unknown,
  borradosLocal: unknown,
  borradosRemoto: unknown,
  clave: (item: any) => string,
  preferida: 'local' | 'remoto' = 'local',
  selloLocal?: unknown,
  selloRemoto?: unknown,
): { items: any[]; borrados: Borrados } {
  const borrados: Borrados = { ...mapa(borradosRemoto) };
  for (const [k, cuando] of Object.entries(mapa(borradosLocal))) {
    if (fecha(cuando) > fecha(borrados[k])) borrados[k] = cuando;
  }

  const items: any[] = [];
  const posicion = new Map<string, number>();
  // De qué copia viene cada uno: 1 la primera, 2 la segunda, 3 las dos.
  const origen = new Map<string, number>();
  const primero = preferida === 'local' ? lista(local) : lista(remoto);
  const segundo = preferida === 'local' ? lista(remoto) : lista(local);
  const sellos = preferida === 'local' ? [fecha(selloLocal), fecha(selloRemoto)] : [fecha(selloRemoto), fecha(selloLocal)];
  for (const item of primero) {
    const k = clave(item);
    if (posicion.has(k)) continue;
    posicion.set(k, items.length);
    origen.set(k, 1);
    items.push(item);
  }
  for (const item of segundo) {
    const k = clave(item);
    const i = posicion.get(k);
    if (i === undefined) {
      posicion.set(k, items.length);
      origen.set(k, 2);
      items.push(item);
    } else {
      origen.set(k, 3);
      if (fechaDe(item) > fechaDe(items[i])) items[i] = item;
    }
  }

  const quedan = items.filter((item) => {
    const k = clave(item);
    /*
      Uno sin fecha propia (puesto antes de que la llevaran) que solo está en una copia: si
      la otra copia tocó su lista después que esta (`bookmarksAt`, del PR #127),
      es que allí se quitó. Los que llevan fecha propia van por sus quitados, porque que
      falten en una lista tocada más tarde puede ser solo que ese aparato aún no los tenía.
    */
    const de = origen.get(k);
    if (!fechaDe(item) && (de === 1 || de === 2)) {
      const propio = sellos[de - 1];
      const otro = sellos[2 - de];
      if (otro > propio) return false;
    }
    if (!(k in borrados)) return true;
    if (fecha(borrados[k]) >= fechaDe(item)) return false;
    // Se volvió a poner después de quitarlo: el quitado ya no hace falta.
    delete borrados[k];
    return true;
  });
  return { items: quedan, borrados };
}

/**
 * Marcadores y subrayados de dos copias de un mismo libro (o del estado de un libro leído
 * del servidor sin descargar). Devuelve solo esos campos, para ponerlos encima del resto.
 */
export function combinarMarcasDeLibro(local: any, remoto: any, preferida: 'local' | 'remoto' = 'local'): Record<string, any> {
  const marcadores = combinarMarcas(local?.bookmarks, remoto?.bookmarks, local?.bookmarksRemoved, remoto?.bookmarksRemoved, claveMarcador, preferida, local?.bookmarksAt, remoto?.bookmarksAt);
  const subrayados = combinarMarcas(local?.highlights, remoto?.highlights, local?.highlightsRemoved, remoto?.highlightsRemoved, claveSubrayado, preferida, local?.highlightsAt, remoto?.highlightsAt);
  const salida: Record<string, any> = {};
  // El sello de la lista entera (lo que miran las versiones de antes de esta): el más reciente.
  const masReciente = (a: unknown, b: unknown) => (fecha(b) > fecha(a) ? b : a);
  const bookmarksAt = masReciente(local?.bookmarksAt, remoto?.bookmarksAt);
  const highlightsAt = masReciente(local?.highlightsAt, remoto?.highlightsAt);
  if (bookmarksAt) salida.bookmarksAt = bookmarksAt;
  if (highlightsAt) salida.highlightsAt = highlightsAt;
  if (marcadores.items.length || local?.bookmarks || remoto?.bookmarks) salida.bookmarks = marcadores.items;
  if (subrayados.items.length || local?.highlights || remoto?.highlights) salida.highlights = subrayados.items;
  // Si alguna copia los traía, van siempre: si no, al ponerlos encima de la ficha quedarían
  // los quitados viejos de esa copia.
  if (Object.keys(marcadores.borrados).length || local?.bookmarksRemoved || remoto?.bookmarksRemoved) salida.bookmarksRemoved = marcadores.borrados;
  if (Object.keys(subrayados.borrados).length || local?.highlightsRemoved || remoto?.highlightsRemoved) salida.highlightsRemoved = subrayados.borrados;
  return salida;
}

export type MarcasTemporales = Record<string, {
  bookmarks?: any[];
  highlights?: any[];
  bookmarksRemoved?: Borrados;
  highlightsRemoved?: Borrados;
}>;

/** Las marcas de los libros leídos del servidor sin descargar, libro a libro. */
export function combinarMarcasTemporales(local?: MarcasTemporales | null, remoto?: MarcasTemporales | null): MarcasTemporales {
  const salida: MarcasTemporales = {};
  const ids = new Set([...Object.keys(local || {}), ...Object.keys(remoto || {})]);
  for (const id of ids) {
    const combinado = combinarMarcasDeLibro(local?.[id], remoto?.[id]);
    // Igual que `exportarMarcasTemporales`: sin listas ni mapas vacíos.
    const entrada: MarcasTemporales[string] = {};
    if (combinado.bookmarks?.length) entrada.bookmarks = combinado.bookmarks;
    if (combinado.highlights?.length) entrada.highlights = combinado.highlights;
    if (Object.keys(combinado.bookmarksRemoved || {}).length) entrada.bookmarksRemoved = combinado.bookmarksRemoved;
    if (Object.keys(combinado.highlightsRemoved || {}).length) entrada.highlightsRemoved = combinado.highlightsRemoved;
    if (Object.keys(entrada).length) salida[id] = entrada;
  }
  return salida;
}
