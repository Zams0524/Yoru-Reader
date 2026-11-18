/**
 * En qué orden mandan los diccionarios.
 *
 * Importa desde que una palabra la resuelve **el primero que la tenga**: con un
 * diccionario de respaldo debajo —el JMdict inglés por debajo del español—, el orden
 * decide en qué idioma lees cada palabra.
 *
 * Normalmente lo pone el usuario en Ajustes → Diccionarios. El problema era qué pasa
 * cuando no ha puesto ninguno, que es el caso de cualquiera recién instalado: la lista
 * guardada venía vacía, todos empataban, y quién ganaba lo decidía la puntuación de la
 * entrada. O sea, la suerte.
 *
 * Sin nada guardado manda **el que se instaló primero**. Es lo que se espera: el
 * primero que pusiste es el tuyo, y los que añades después quedan debajo, que es justo
 * lo que se quiere de un respaldo. Y es estable: la misma biblioteca da siempre el
 * mismo orden.
 */

export interface DiccionarioOrdenable {
  title: string;
  /** ISO 8601, como `2026-08-29T10:00:00.000Z`. Puede faltar en los más antiguos. */
  importedAt?: string;
}

/**
 * Los títulos en el orden que manda de verdad.
 *
 * `ordenGuardado` es lo que el usuario eligió; lo que no esté ahí va detrás, por fecha
 * de importación. Los que no tienen fecha van al final, sin desordenarse entre ellos.
 */
export function ordenEfectivo(
  diccionarios: DiccionarioOrdenable[],
  ordenGuardado: string[] = [],
): string[] {
  const guardados = ordenGuardado.filter((titulo) => diccionarios.some((d) => d.title === titulo));
  const resto = diccionarios
    .filter((d) => !guardados.includes(d.title))
    .map((d, i) => ({ titulo: d.title, fecha: d.importedAt || '', i }))
    .sort((a, b) => {
      if (a.fecha && b.fecha) return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.i - b.i;
      if (a.fecha) return -1;   // con fecha, antes que sin ella
      if (b.fecha) return 1;
      return a.i - b.i;         // sin fecha: como vinieran, sin removerlos
    })
    .map((d) => d.titulo);
  return [...guardados, ...resto];
}

/** Dónde queda un diccionario en ese orden. Los desconocidos, al final. */
export function rangoDeDiccionario(titulo: string, orden: string[]): number {
  const i = orden.indexOf(titulo);
  return i === -1 ? orden.length : i;
}
