/**
 * Escribir japonés con un IME, sin que la app se meta por medio.
 *
 * Un IME (Microsoft IME, Google 日本語入力, el teclado de Android…) no manda letras sueltas: abre
 * una «composición», va enseñando candidatos mientras tecleas, y solo al final entrega la
 * palabra. Durante ese rato el navegador dispara teclas que **no son** del usuario para la app:
 * son del IME. Tratarlas como si lo fueran es lo que rompe la escritura japonesa.
 *
 * Lo que pasaba en Yoru:
 *
 * - Enter confirma el candidato elegido. Si un campo trata ese Enter como «aceptar», se queda
 *   con el texto a medio componer: escribías おれ, pulsabas Enter para poner 俺, y la app daba
 *   por buena おれ.
 * - Las flechas y el espacio recorren la lista de candidatos.
 * - Shift cambia a katakana y escribe las mayúsculas del romaji, así que se pulsa a todas horas.
 *
 * Las preguntas de aquí abajo se hacen antes de actuar sobre una tecla.
 */

/** Lo mínimo que hace falta, para aceptar el evento del DOM y el sintético de React por igual. */
interface EventoDeTecla {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/**
 * La tecla es del IME, no del usuario: déjala pasar.
 *
 * Se miran las dos señales a propósito. `isComposing` es la buena, pero en la tecla que **abre**
 * la composición todavía viene en false, y ahí lo único que lo delata es el `keyCode` 229 que
 * los navegadores reservan justo para esto.
 */
export function componiendoConIME(evento: EventoDeTecla): boolean {
  const nativo = evento.nativeEvent ?? evento;
  return nativo.isComposing === true || nativo.keyCode === 229;
}

/** El foco está en algo donde se escribe, así que los atajos del lector no pintan nada. */
export function esCampoDeTexto(destino: EventTarget | null): boolean {
  const elemento = destino as HTMLElement | null;
  if (!elemento || typeof elemento.tagName !== 'string') return false;
  return (
    elemento.tagName === 'INPUT'
    || elemento.tagName === 'SELECT'
    || elemento.tagName === 'TEXTAREA'
    || elemento.isContentEditable === true
  );
}

/**
 * Hay un campo de texto con el foco ahora mismo, mire donde mire el evento.
 *
 * Hace falta para los atajos que escuchan en `window` sin mirar el destino: una tecla del IME
 * puede llegar con el `target` en otro sitio aunque estés escribiendo en un recuadro.
 */
export function escribiendoEnAlgo(): boolean {
  return typeof document !== 'undefined' && esCampoDeTexto(document.activeElement);
}
