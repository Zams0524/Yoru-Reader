/**
 * «Borrar mi progreso de lectura»: qué se le quita a un perfil y cómo se entera el
 * resto de aparatos.
 *
 * Borrar solo aquí no basta. La sincronización nunca sustituye una copia por otra, las
 * combina (`cloudMerge.ts`), y lo leído solo crece: el otro aparato, o el servidor,
 * devolverían en la siguiente vuelta lo que se acaba de borrar. Por eso el borrado deja
 * una marca con fecha en el perfil (`progressResetAt`) que viaja con todo lo demás, igual
 * que `borrado` en lo leído de Kavita o `srsRemovals` en las tarjetas. El combinador la
 * aplica a las dos copias antes de juntarlas: todo lo que se leyó **antes** de la marca
 * se queda a cero, y lo que se lea **después**, en cualquier aparato, cuenta de nuevo.
 *
 * Qué se borra: por dónde vas en cada libro, lo leído (caracteres y tiempo), lo leído
 * o escuchado directamente de Kavita y Audiobookshelf, y Yoru SRS entero: sus mazos y
 * sus tarjetas, y su historial y sus estadísticas (que se vacían en
 * `db._borrarRestosDeProgreso`). Qué no: los libros, sus marcadores y notas, las
 * palabras y los ajustes.
 *
 * Funciones puras, sin almacenamiento ni pantalla, para que las use el combinador y se
 * puedan probar solas.
 */

import { diasSrsDespuesDe, historialDespuesDe, partesSinLoAnteriorA } from './estadisticasSync';

function ms(valor: unknown): number {
  const t = typeof valor === 'string' ? Date.parse(valor) : 0;
  return Number.isNaN(t) ? 0 : t;
}

/** De dos marcas de borrado, la más reciente; `null` si no hay ninguna. */
export function ultimaMarca(a?: string | null, b?: string | null): string | null {
  const ta = ms(a);
  const tb = ms(b);
  if (!ta && !tb) return null;
  return (tb > ta ? b : a) as string;
}

function tieneProgreso(libro: any): boolean {
  const p = libro?.progress || {};
  return Boolean(
    libro?.lastRead || p.currentChapter || p.currentPage || p.percent || p.charactersRead || p.secondsRead
    || (libro?.status && libro.status !== 'unread'),
  );
}

/** El mismo libro como recién importado: sin posición, sin lo leído y sin fecha de lectura. */
export function libroSinProgreso<T extends Record<string, any>>(libro: T): T {
  return {
    ...libro,
    progress: {
      ...(libro.progress || {}),
      currentChapter: 0,
      currentPage: 0,
      percent: 0,
      charactersRead: 0,
      secondsRead: 0,
    },
    status: 'unread',
    lastRead: null,
  };
}

/**
 * Los libros con la marca aplicada: se vacían los que se leyeron por última vez antes
 * de ella (o nunca). Devuelve la misma lista si no había nada que tocar.
 */
export function librosTrasBorrado<T extends Record<string, any>>(libros: T[] | undefined | null, marca: string): T[] {
  const lista = libros || [];
  const limite = ms(marca);
  if (!limite) return lista;
  let cambiado = false;
  const salida = lista.map((libro) => {
    if (!libro || ms(libro.lastRead) > limite || !tieneProgreso(libro)) return libro;
    cambiado = true;
    return libroSinProgreso(libro);
  });
  return cambiado ? salida : lista;
}

/**
 * Un mapa de progreso del servidor (Kavita o audiolibros) con la marca aplicada: las
 * entradas tocadas antes de ella quedan como olvidadas (`borrado`), con la fecha de la
 * marca, que es como ya se olvida una serie (`forgetKavitaSeries`).
 */
export function mapaTrasBorrado(
  mapa: Record<string, any> | undefined | null,
  marca: string,
): Record<string, any> | undefined | null {
  const limite = ms(marca);
  if (!mapa || !limite) return mapa;
  let cambiado = false;
  const salida: Record<string, any> = {};
  for (const [clave, entrada] of Object.entries(mapa)) {
    if (!entrada || typeof entrada !== 'object' || ms(entrada.at) > limite || (entrada.borrado && ms(entrada.at) === limite)) {
      salida[clave] = entrada;
      continue;
    }
    cambiado = true;
    const olvidada: Record<string, any> = { ...entrada, borrado: true, at: marca };
    if ('percent' in olvidada) olvidada.percent = 0;
    if ('currentTime' in olvidada) olvidada.currentTime = 0;
    salida[clave] = olvidada;
  }
  return cambiado ? salida : mapa;
}

/**
 * Cuándo se puso por última vez una entrada de Yoru SRS, con el mismo criterio que
 * `cloudMerge.cardSavedTime`: para un mazo (`_deck_…`), cuándo se creó; para una
 * tarjeta, su último repaso, su importación de Anki o, si nunca se repasó, su
 * creación (que es cuando vence una tarjeta nueva). 0 si no hay fecha.
 */
export function ultimaVezEntradaSrs(clave: string, tarjeta: any): number {
  if (!tarjeta || typeof tarjeta !== 'object') return 0;
  if (clave.startsWith('_deck_')) return ms(tarjeta.createdAt);
  const repaso = Math.max(ms(tarjeta.lastReview), ms(tarjeta.last_review));
  const creada = !repaso && !tarjeta.state ? Math.max(ms(tarjeta.due), ms(tarjeta.dueDate)) : 0;
  return Math.max(repaso, ms(tarjeta.importedAt), creada);
}

/**
 * Las tarjetas de Yoru SRS con la marca aplicada: los mazos y las tarjetas que ya
 * estaban antes de ella se borran. Lo creado, importado o repasado después, en
 * cualquier aparato, se conserva. Como el combinador lo aplica a las dos copias, el
 * otro aparato o la cuenta no pueden devolverlos. Devuelve el mismo objeto si no
 * había nada que quitar.
 */
export function tarjetasTrasBorrado(
  tarjetas: Record<string, any> | undefined | null,
  marca: string,
): Record<string, any> | undefined | null {
  const limite = ms(marca);
  if (!tarjetas || !limite) return tarjetas;
  let cambiado = false;
  const salida: Record<string, any> = {};
  for (const [clave, tarjeta] of Object.entries(tarjetas)) {
    if (ultimaVezEntradaSrs(clave, tarjeta) > limite) {
      salida[clave] = tarjeta;
      continue;
    }
    cambiado = true;
  }
  return cambiado ? salida : tarjetas;
}

/** Día local (AAAA-MM-DD) de una marca, como los guardan los contadores de Yoru SRS. */
export function diaDeMarca(marca: string): string {
  const d = new Date(ms(marca));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Los datos de un perfil con la marca aplicada. Sin marca, los mismos datos. */
export function perfilTrasBorrado<T extends Record<string, any>>(datos: T, marca: string | null | undefined): T {
  if (!marca || !ms(marca)) return datos;
  const salida: Record<string, any> = { ...datos, progressResetAt: ultimaMarca(datos.progressResetAt, marca) };
  if (datos.books) salida.books = librosTrasBorrado(datos.books, marca);
  if (datos.srsData) salida.srsData = tarjetasTrasBorrado(datos.srsData, marca);
  // Las estadísticas que viajan (estadisticasSync.ts): lo de antes de la marca se va.
  if (datos.readingStats) salida.readingStats = partesSinLoAnteriorA(datos.readingStats, ms(marca), 'local');
  if (datos.srsHistory) salida.srsHistory = historialDespuesDe(datos.srsHistory, ms(marca));
  if (datos.srsDays) salida.srsDays = diasSrsDespuesDe(datos.srsDays, diaDeMarca(marca));
  if (datos.serverProgress) {
    salida.serverProgress = {
      ...datos.serverProgress,
      kavita: mapaTrasBorrado(datos.serverProgress.kavita, marca),
      audiobooks: mapaTrasBorrado(datos.serverProgress.audiobooks, marca),
    };
  }
  return salida as T;
}
