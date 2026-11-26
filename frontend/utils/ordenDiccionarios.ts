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

export type IdiomaDefiniciones = 'es' | 'en';

/**
 * En qué idioma explica un diccionario, mirando su título. `null` si no se sabe.
 *
 * Los JMdict que trae la app se llaman `JMdict (Spanish) [...]` y `JMdict (English) [...]`;
 * el inglés más antiguo se llamaba solo `JMdict [...]`. Jiten solo tiene inglés.
 * Un diccionario importado sin pista en el título (un monolingüe japonés, por ejemplo)
 * queda como desconocido: ni se adelanta ni se aparta.
 */
export function idiomaDeDiccionario(titulo: string): IdiomaDefiniciones | null {
  const t = String(titulo || '');
  if (/spanish|espa(ñ|n)ol|\(es\)|\[es\]|日西|西和/i.test(t)) return 'es';
  if (/english|ingl(é|e)s|\(en\)|\[en\]|日英|英和|^jiten$/i.test(t) || /^JMdict \[/i.test(t)) return 'en';
  return null;
}

/**
 * El orden de siempre, pero con el idioma de la app por delante.
 *
 * Con la app en español, un JMdict inglés que se instaló antes —o que alguien dejó arriba
 * en Ajustes— ganaba todas las palabras que también estaban en español, y el popup salía
 * en inglés sin motivo. Ahora primero van los del idioma de la app, luego los que no se
 * sabe, y al final los de otro idioma. Dentro de cada grupo manda el orden de antes.
 */
export function ordenPorIdioma(orden: string[], idioma: IdiomaDefiniciones): string[] {
  const peso = (titulo: string) => {
    const suyo = idiomaDeDiccionario(titulo);
    return suyo === idioma ? 0 : suyo === null ? 1 : 2;
  };
  return orden
    .map((titulo, i) => ({ titulo, i, p: peso(titulo) }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((d) => d.titulo);
}

/** El idioma de la app. `db.ts` deja `app_language` escrito en cada cambio de idioma. */
export function idiomaDeLaApp(): IdiomaDefiniciones {
  try {
    return (localStorage.getItem('app_language') || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}
