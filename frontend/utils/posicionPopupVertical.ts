/**
 * Dónde se planta la tarjeta del diccionario cuando el libro se lee en vertical.
 *
 * En japonés vertical se lee de arriba abajo y las columnas van de derecha a izquierda, así que
 * lo ya leído queda **a la derecha** de la palabra, y en su propia columna, **encima**. La tarjeta
 * va sobre eso y nunca sobre lo que viene, que es por donde el texto sigue.
 *
 * Esto estaba escrito a mano dentro del lector y decidía con una sola pregunta: «¿cabe a la
 * derecha?», y si no, al borde izquierdo. Con la tarjeta fija en 380 px eso saltaba al rincón
 * opuesto por diferencias de diez píxeles, y de paso dejaba sin probar el hueco de encima, que
 * también es texto leído.
 */

export interface PalabraEnPantalla {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SitioPedido {
  anchoVentana: number;
  altoVentana: number;
  palabra: PalabraEnPantalla;
  /** El ancho que la tarjeta querría tener (380 px en el lector). */
  anchoDeseado: number;
  /** Lo que mide de alto ahora mismo. */
  altoTarjeta: number;
  margen: number;
  hueco: number;
  /**
   * Por debajo de este ancho la tarjeta deja de ser legible, así que no se encoge más y se busca
   * otro sitio. No está medido con usuarios: es un número elegido para que los significados no
   * queden en tiras de dos palabras, y se puede subir o bajar sin tocar la lógica.
   */
  anchoMinimo: number;
}

export interface SitioTarjeta {
  left: number;
  top: number;
  ancho: number;
  /**
   * `derecha`: sobre lo leído, al lado de la palabra. `encima`: sobre lo leído de su propia
   * columna. `izquierda`: no había hueco en lo leído y va pegada a la izquierda de la palabra.
   * `debajo`: pantalla tan estrecha que tampoco cabe a la izquierda.
   * Antes existía `extremo`, que la mandaba al borde izquierdo de la pantalla, lejos de la
   * palabra; zams (26 nov 2026) la quiere junto a la columna de la palabra.
   */
  donde: 'derecha' | 'encima' | 'izquierda' | 'debajo';
}

const entre = (valor: number, minimo: number, maximo: number) =>
  Math.max(minimo, Math.min(valor, Math.max(minimo, maximo)));

export function sitioEnVertical(pedido: SitioPedido): SitioTarjeta {
  const { anchoVentana, altoVentana, palabra, anchoDeseado, altoTarjeta, margen, hueco, anchoMinimo } = pedido;

  // Alineada con la palabra, sin salirse por abajo: es lo que la mantiene cerca de lo consultado.
  const topJuntoALaPalabra = entre(palabra.top, margen, altoVentana - altoTarjeta - margen);
  const anchoCabiendo = Math.min(anchoDeseado, Math.max(anchoMinimo, anchoVentana - margen * 2));

  // 1) A la derecha de la palabra. Si no cabe entera, se encoge: mejor que mudarse de rincón.
  const libreDerecha = anchoVentana - palabra.right - hueco - margen;
  if (libreDerecha >= anchoMinimo) {
    return {
      left: palabra.right + hueco,
      top: topJuntoALaPalabra,
      ancho: Math.min(anchoDeseado, libreDerecha),
      donde: 'derecha',
    };
  }

  /*
    2) Encima de la palabra. En su columna, lo de arriba ya está leído. La tarjeta se alinea por
    su borde derecho con el de la palabra, así que se extiende hacia las columnas de la derecha,
    que también están leídas, y no hacia las de la izquierda, que no.
  */
  const libreEncima = palabra.top - margen - hueco;
  if (libreEncima >= altoTarjeta) {
    return {
      left: entre(palabra.right - anchoCabiendo, margen, anchoVentana - anchoCabiendo - margen),
      top: palabra.top - hueco - altoTarjeta,
      ancho: anchoCabiendo,
      donde: 'encima',
    };
  }

  /*
    3) No hay hueco en lo leído: a la izquierda de la palabra, **pegada a ella**. Antes se iba al
    borde izquierdo de la pantalla, y con la palabra en la primera columna (pegada al borde
    derecho) la tarjeta quedaba en la otra punta. zams (26 nov 2026) la quiere junto a la
    columna de la palabra, aunque tape las columnas que siguen.
  */
  const libreIzquierda = palabra.left - hueco - margen;
  if (libreIzquierda >= anchoMinimo) {
    const ancho = Math.min(anchoDeseado, libreIzquierda);
    return { left: palabra.left - hueco - ancho, top: topJuntoALaPalabra, ancho, donde: 'izquierda' };
  }

  // 4) Pantalla muy estrecha: debajo de la palabra si cabe.
  const libreDebajo = altoVentana - palabra.bottom - hueco - margen;
  const leftAlineada = entre(palabra.right - anchoCabiendo, margen, anchoVentana - anchoCabiendo - margen);
  if (libreDebajo >= altoTarjeta) {
    return { left: leftAlineada, top: palabra.bottom + hueco, ancho: anchoCabiendo, donde: 'debajo' };
  }

  // 5) No cabe en ningún lado: lo más cerca posible sin salirse.
  return { left: leftAlineada, top: topJuntoALaPalabra, ancho: anchoCabiendo, donde: 'izquierda' };
}
