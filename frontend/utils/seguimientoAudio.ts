/*
  Seguir con el texto la frase que suena.

  Cada vez que la narración cambia de frase, el lector se pregunta si tiene que mover
  el texto. La respuesta depende de tres cosas: si el usuario apartó la vista a mano
  (entonces no se toca nada hasta que pida volver), de cómo se lee (continuo o por
  páginas) y de dónde cae la frase respecto a lo que de verdad se ve.
*/

/** `siguiendo`: el texto va con el audio. `suspendido`: el usuario lo movió a mano. */
export type ModoSeguimiento = 'siguiendo' | 'suspendido';

/**
 * - `comodidad` (lectura continua): el texto solo se mueve cuando la frase sale de una
 *   zona tranquila en el centro de la pantalla.
 * - `visibilidad` (lectura paginada): basta con que la frase se vea entera.
 */
export type EstrategiaSeguimiento = 'comodidad' | 'visibilidad';

/** Un segmento sobre el eje de desplazamiento, en píxeles. */
export interface TramoEje {
  inicio: number;
  fin: number;
}

export interface DecisionSeguimiento {
  mover: boolean;
  /** Mostrar el aviso de «volver a la narración». */
  ofrecerVolver: boolean;
}

/*
  La zona tranquila, en fracciones de la parte visible.

  Si el texto se recolocara en cada frase, la página no pararía nunca quieta. Con una
  zona amplia la narración avanza varios renglones sin que nada se mueva, y cuando sale
  de ella el salto es uno solo, como pasar de página. Va algo por encima del centro:
  quien escucha suele leer un poco por delante.
*/
const ZONA_DESDE = 0.25;
const ZONA_HASTA = 0.7;

/** Lo que queda de la ventana una vez descontado lo que tapan barras y mandos. */
function parteVisible(ventana: TramoEje, tapaDelante: number, tapaDetras: number): TramoEje {
  const inicio = Math.min(ventana.fin, ventana.inicio + Math.max(0, tapaDelante));
  const fin = Math.max(inicio, ventana.fin - Math.max(0, tapaDetras));
  return { inicio, fin };
}

function contiene(fuera: TramoEje, dentro: TramoEje): boolean {
  return dentro.inicio >= fuera.inicio && dentro.fin <= fuera.fin;
}

/**
 * ¿Hay que mover el texto hasta la frase que suena?
 *
 * `margenInicio` y `margenFin` son los píxeles tapados al principio y al final del eje
 * (la barra del reproductor, por ejemplo): una frase debajo de los mandos no se ve.
 */
export function decidirSeguimiento(opciones: {
  modo: ModoSeguimiento;
  estrategia?: EstrategiaSeguimiento;
  /** El usuario acaba de pedir ir a la frase. */
  forzar?: boolean;
  frase: TramoEje;
  ventana: TramoEje;
  margenInicio?: number;
  margenFin?: number;
}): DecisionSeguimiento {
  const { modo, frase, ventana } = opciones;
  if (modo === 'suspendido') return { mover: false, ofrecerVolver: true };
  if (opciones.forzar) return { mover: true, ofrecerVolver: false };

  const visible = parteVisible(ventana, opciones.margenInicio ?? 0, opciones.margenFin ?? 0);
  if (!contiene(visible, frase)) return { mover: true, ofrecerVolver: false };
  if ((opciones.estrategia ?? 'comodidad') === 'visibilidad') return { mover: false, ofrecerVolver: false };

  const alto = Math.max(1, visible.fin - visible.inicio);
  const zona: TramoEje = {
    inicio: visible.inicio + alto * ZONA_DESDE,
    fin: visible.inicio + alto * ZONA_HASTA,
  };
  const medio = (frase.inicio + frase.fin) / 2;
  return { mover: medio < zona.inicio || medio > zona.fin, ofrecerVolver: false };
}
