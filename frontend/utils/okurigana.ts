/**
 * Juntar el kanji con furigana y el kana que le sigue, que son la misma palabra.
 *
 * En una novela japonesa el furigana cubre **solo el kanji**, y la terminación queda
 * fuera: `<ruby>尊<rt>とうと</rt></ruby>き`. Al partir el párrafo por los `<ruby>` para no
 * estropear el marcado del autor, esa terminación se quedaba en el trozo siguiente y se
 * analizaba por separado. Resultado: el lector creía que 尊 era una palabra —y un
 * nombre, además, porque la categoría iba puesta a mano— y que き era otra.
 *
 * 尊 no es una palabra. 自 tampoco, ni 辿, ni 苛立. No están en ningún diccionario ni lo
 * estarán, así que cada una era una búsqueda perdida que encima salía a internet. Y
 * aquel `ら` suelto que aparecía como nombre era la cola de 自ら.
 *
 * Aquí no se adivina dónde acaba la palabra: se le pregunta al analizador morfológico,
 * que para eso está. Se le da el kanji con el kana que viene detrás y se mira por dónde
 * corta él. Si dice que el kanji va solo —como 町 seguido de に—, no se toca nada.
 */

export interface TokenMinimo {
  surface: string;
  basicForm: string;
  pos: string;
}

export interface PalabraJunta {
  /** El kana de después que resulta ser parte de la palabra. */
  okurigana: string;
  /** La forma de diccionario, que es con la que se busca. */
  palabra: string;
  /** La categoría de verdad, en vez del 名詞 que se ponía a mano. */
  pos: string;
}

/*
  Cuánto kana se le ofrece al analizador.

  El okurigana es corto: casi siempre uno o dos kana, y los largos como 「しい」 de 美しい
  llegan a tres. Pasarle media frase no ayudaría y sí podría hacer que se tragara la
  partícula siguiente. Seis es holgado y acota el riesgo.
*/
const MAXIMO_KANA = 6;

const HIRAGANA_AL_PRINCIPIO = /^[ぁ-ゟ]+/;

/**
 * Si el kana que sigue al kanji es parte de su palabra, lo devuelve junto. Si no, `null`.
 *
 * `tokenizar` se recibe en vez de importarse para poder probar esto sin cargar Kuromoji,
 * que necesita sus diccionarios y un navegador.
 */
export function juntarOkurigana(
  base: string,
  textoSiguiente: string,
  tokenizar: (texto: string) => TokenMinimo[],
): PalabraJunta | null {
  if (!base || !textoSiguiente) return null;

  const kana = (HIRAGANA_AL_PRINCIPIO.exec(textoSiguiente) || [''])[0].slice(0, MAXIMO_KANA);
  if (!kana) return null;

  let tokens: TokenMinimo[];
  try {
    tokens = tokenizar(base + kana);
  } catch {
    return null;
  }
  const primero = tokens && tokens[0];
  if (!primero || !primero.surface) return null;

  // El analizador cortó justo detrás del kanji: lo que sigue es otra cosa, normalmente
  // una partícula. Es el caso de 町 seguido de に, y hay que dejarlo estar.
  if (!primero.surface.startsWith(base) || primero.surface.length <= base.length) return null;

  const okurigana = primero.surface.slice(base.length);
  // Que lo que se traga sea exactamente el kana que le dimos, y por delante.
  if (!kana.startsWith(okurigana)) return null;

  return {
    okurigana,
    palabra: primero.basicForm || primero.surface,
    pos: primero.pos || '',
  };
}
