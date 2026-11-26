/**
 * Dónde se planta la tarjeta del diccionario cuando el libro se lee en horizontal (escritorio).
 *
 * La tarjeta va **pegada a la palabra**: encima si cabe (ahí está lo ya leído) y, si no, justo
 * debajo. Nunca se manda al borde opuesto de la pantalla.
 *
 * Antes, cuando no cabía encima, se iba abajo del todo («al extremo de la página»). Con una
 * palabra en la parte alta de la pantalla eso dejaba la tarjeta lejísimos, en el borde de
 * abajo, y zams (26 nov 2026) pidió que salga cerca de la palabra, ajustándose solo lo justo
 * para no salirse de la pantalla.
 */

export interface PalabraEnPantalla {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SitioHorizontalPedido {
  anchoVentana: number;
  altoVentana: number;
  palabra: PalabraEnPantalla;
  /** Lo que mide la tarjeta de ancho ahora mismo. */
  anchoTarjeta: number;
  /** Lo que mide (o mediría) de alto con todo su contenido, ya con su tope. */
  altoPrevisto: number;
  margen: number;
  hueco: number;
  /** Por debajo de esto no se encoge la tarjeta aunque no quepa. */
  altoMinimo: number;
}

export interface SitioHorizontal {
  left: number;
  /**
   * Si `encima`, es el borde de **abajo** de la tarjeta (el lector la sube con
   * `translateY(-100%)`); si no, su borde de arriba.
   */
  top: number;
  encima: boolean;
  altoMaximo: number;
}

const entre = (valor: number, minimo: number, maximo: number) =>
  Math.max(minimo, Math.min(valor, Math.max(minimo, maximo)));

export function sitioEnHorizontal(pedido: SitioHorizontalPedido): SitioHorizontal {
  const { anchoVentana, altoVentana, palabra, anchoTarjeta, altoPrevisto, margen, hueco, altoMinimo } = pedido;

  const libreEncima = Math.max(0, palabra.top - margen - hueco);
  const libreDebajo = Math.max(0, altoVentana - palabra.bottom - margen - hueco);

  // Encima si cabe entera; si no cabe en ningún lado, en el lado con más sitio.
  const encima = libreEncima >= altoPrevisto || (libreDebajo < altoPrevisto && libreEncima > libreDebajo);

  // El alto se limita al hueco del lado elegido, para que no se salga por arriba ni por abajo.
  const altoMaximo = Math.max(altoMinimo, Math.min(altoVentana - margen * 2, encima ? libreEncima : libreDebajo));
  const altoReal = Math.min(altoPrevisto, altoMaximo);

  const top = encima
    ? Math.max(palabra.top - hueco, margen + altoReal)
    : Math.min(palabra.bottom + hueco, Math.max(margen, altoVentana - margen - altoReal));

  // En horizontal, la tarjeta empieza donde empieza la palabra y se corre lo justo para caber.
  const left = entre(palabra.left, margen, anchoVentana - anchoTarjeta - margen);

  return { left, top, encima, altoMaximo };
}
