/**
 * A qué capítulo llevan «siguiente» y «anterior».
 *
 * Parece una suma y no lo es, por dos motivos.
 *
 * El primero: hay capítulos **sin un solo párrafo**. Una página de ilustración, una
 * portadilla, un capítulo que es solo su título. El motor los guarda igual, con
 * `lastIndex = startParagraphId - 1`, o sea un rango vacío. Saltar a uno de esos deja
 * la pantalla sin texto, así que se pasa de largo hasta encontrar uno que tenga.
 *
 * El segundo es el que lo rompía de verdad: el salto se hacía buscando la sección
 * **por el número de párrafo**, y un rango vacío no contiene ningún párrafo, ni
 * siquiera el suyo. La búsqueda no encontraba nada, el salto se quedaba donde estaba y
 * la tecla parecía no hacer nada. Y solo en un sentido, según de qué lado cayera el
 * capítulo vacío, que es lo que lo hacía tan desconcertante de ver.
 */

/** Lo que hace falta saber de un capítulo para decidir. */
export interface TramoDeCapitulo {
  startParagraphId: number;
  lastIndex: number;
}

/** Un capítulo con texto es el que contiene al menos un párrafo. */
export function tieneTexto(tramo: TramoDeCapitulo): boolean {
  return tramo.lastIndex >= tramo.startParagraphId;
}

/**
 * El capítulo con texto más cercano en esa dirección, o `null` si ya no hay más.
 *
 * `null` quiere decir que se acabó el libro por ese lado, y quien llama lo dice. No
 * quiere decir «no se pudo»: eso aquí no existe.
 */
export function capituloVecino(
  capitulos: TramoDeCapitulo[],
  actual: number,
  direccion: 1 | -1,
): number | null {
  for (let i = actual + direccion; i >= 0 && i < capitulos.length; i += direccion) {
    if (tieneTexto(capitulos[i])) return i;
  }
  return null;
}
