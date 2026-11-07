/*
  Portado de Nanahoshi (https://github.com/Natsume-197/Nanahoshi), de Natsume:
  `packages/reader/src/read-listen/active-cue-following.ts`.
  Usado con su permiso expreso bajo GPL; ver THIRD-PARTY-GRANTS.md.

  Traducido y adaptado a nuestros nombres; la idea y los dos umbrales son suyos.
*/

/** Si el texto va detrás del audio, o si el usuario lo apartó a mano. */
export type ModoSeguimiento = 'siguiendo' | 'suspendido';

/**
 * Cuándo se considera que hay que mover el texto.
 *
 * - `comodidad`: en lectura continua. La frase vive en una banda central; mientras no
 *   se salga de ella, el texto no se mueve, aunque la frase haya bajado un poco.
 * - `visibilidad`: en lectura paginada. Ahí no hay banda que valga: o la frase está en
 *   la página o no está, y media frase asomando no sirve de nada.
 */
export type EstrategiaSeguimiento = 'comodidad' | 'visibilidad';

/** Un tramo sobre el eje por el que se desplaza el texto (vertical u horizontal). */
export interface TramoEje {
  inicio: number;
  fin: number;
}

export interface DecisionSeguimiento {
  /** Mover el texto hasta la frase. */
  mover: boolean;
  /** Ofrecerle al usuario volver a la narración, porque el seguimiento está suspendido. */
  ofrecerVolver: boolean;
}

/*
  Por qué una banda y no el centro.

  Centrar la frase en cada cambio convierte la lectura en una cinta transportadora: el
  texto se mueve constantemente y la vista nunca descansa en un sitio. Con una banda, el
  texto se queda quieto mientras la narración avanza dentro de ella y solo salta cuando
  se sale, que es más o menos cómo pasarías tú la página.

  22% y 72%: la banda queda algo por encima del centro, porque al leer vas un poco por
  delante de lo que escuchas, y así queda más sitio por debajo para lo que viene.
*/
const BANDA_INICIO = 0.22;
const BANDA_FIN = 0.72;

/**
 * Decide si hay que mover el texto para que se vea la frase que suena.
 *
 * `margenInicio` y `margenFin` son lo que la pantalla tiene tapado por delante y por
 * detrás (la barra del reproductor, por ejemplo): sin descontarlos, la cuenta daría por
 * visible una frase que está debajo de los mandos.
 */
export function decidirSeguimiento({
  modo,
  estrategia = 'comodidad',
  forzar = false,
  frase,
  ventana,
  margenInicio = 0,
  margenFin = 0,
}: {
  modo: ModoSeguimiento;
  estrategia?: EstrategiaSeguimiento;
  /** Llevar el texto allí sí o sí: el usuario acaba de pedirlo. */
  forzar?: boolean;
  frase: TramoEje;
  ventana: TramoEje;
  margenInicio?: number;
  margenFin?: number;
}): DecisionSeguimiento {
  if (modo === 'suspendido') return { mover: false, ofrecerVolver: true };
  if (forzar) return { mover: true, ofrecerVolver: false };

  const utilInicio = Math.min(ventana.fin, ventana.inicio + margenInicio);
  const utilFin = Math.max(utilInicio, ventana.fin - margenFin);
  const utilTamano = Math.max(1, utilFin - utilInicio);
  const bandaInicio = utilInicio + utilTamano * BANDA_INICIO;
  const bandaFin = utilInicio + utilTamano * BANDA_FIN;
  const centroFrase = (frase.inicio + frase.fin) / 2;
  const seVeEntera = frase.inicio >= utilInicio && frase.fin <= utilFin;

  return {
    mover: !seVeEntera
      || (estrategia === 'comodidad' && (centroFrase < bandaInicio || centroFrase > bandaFin)),
    ofrecerVolver: false,
  };
}
