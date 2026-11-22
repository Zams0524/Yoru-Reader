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
 * Qué se borra: por dónde vas en cada libro, lo leído (caracteres y tiempo) y lo leído
 * o escuchado directamente de Kavita y Audiobookshelf. Qué no: los libros, sus
 * marcadores y notas, las palabras, las tarjetas y los ajustes.
 *
 * Funciones puras, sin almacenamiento ni pantalla, para que las use el combinador y se
 * puedan probar solas.
 */

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

/** Los datos de un perfil con la marca aplicada. Sin marca, los mismos datos. */
export function perfilTrasBorrado<T extends Record<string, any>>(datos: T, marca: string | null | undefined): T {
  if (!marca || !ms(marca)) return datos;
  const salida: Record<string, any> = { ...datos, progressResetAt: ultimaMarca(datos.progressResetAt, marca) };
  if (datos.books) salida.books = librosTrasBorrado(datos.books, marca);
  if (datos.serverProgress) {
    salida.serverProgress = {
      ...datos.serverProgress,
      kavita: mapaTrasBorrado(datos.serverProgress.kavita, marca),
      audiobooks: mapaTrasBorrado(datos.serverProgress.audiobooks, marca),
    };
  }
  return salida as T;
}
