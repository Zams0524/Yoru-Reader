/**
 * Alineación entre el texto de un libro y el audio de su audiolibro.
 *
 * Una alineación es una lista de *cues*: trozos de texto con el momento del audio en
 * que se leen. Es el mismo formato que un subtítulo (SRT o WebVTT), que es lo que
 * producen los alineadores forzados y lo que se puede traer ya hecho de fuera.
 *
 * Aquí no se genera nada: esto solo lee una alineación y responde a las dos preguntas
 * que hace el lector — «¿qué texto suena ahora?» y «¿por dónde va el audio si estoy
 * leyendo aquí?».
 *
 * **Contrato para quien genere los cues: el texto del cue va en kanji, como el libro.**
 * Un alineador de japonés trabaja en kana, porque un modelo acústico no puede leer kanji
 * (un kanji no tiene un sonido, tiene varios). Pero ese kana es un andamio interno: si
 * acaba dentro del cue, `timeOfText` compara `カタオモイノアイテ` contra `片思いの相手`
 * y no casa nunca, porque `normalizeForMatch` quita puntuación y no convierte lecturas.
 * Fallaría en todos los libros japoneses, que son todos. El generador alinea en kana,
 * y al escribir el cue pone el tramo original del libro.
 *
 * Nota que viene de mirar los servidores de verdad: ni Kavita ni Audiobookshelf dan
 * esto. Un audiolibro con capítulos permite acompañar la lectura a grandes rasgos; para
 * seguirla frase a frase hace falta una alineación como esta.
 *
 * No confundir con `parseSRT` de `fileImport.ts`: aquel devuelve el texto plano de un
 * subtítulo para importarlo como libro y descarta los tiempos. Aquí los tiempos son
 * justamente el dato.
 */

export interface AlignmentCue {
  /** Posición en la lista, empezando en 0. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface Alignment {
  cues: AlignmentCue[];
  /** El hueco más largo sin cues, en ms. Mide si queda texto sin alinear. */
  longestGapMs: number;
  /** Hay un hueco tan grande que falta un trozo del libro. */
  incomplete: boolean;
}

/** Un hueco mayor que esto significa que falta texto, no que haya un silencio. */
const GAP_THRESHOLD_MS = 60_000;

/** `00:01:02,500` y `00:01:02.500` (SRT usa coma; WebVTT, punto). */
function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    (Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
    + Number(fraction.padEnd(3, '0'))
  );
}

/**
 * Lee un SRT o un WebVTT. Tolera las dos formas de separar decimales, la cabecera
 * `WEBVTT`, los números de orden y los saltos de línea de Windows. Lo que no entiende lo
 * salta en vez de fallar: una alineación con un cue roto sigue sirviendo para el resto
 * del libro.
 */
export function parseAlignment(source: string): Alignment {
  const cues: AlignmentCue[] = [];
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0])) lines.shift();

    const arrowAt = lines.findIndex((line) => line.includes('-->'));
    if (arrowAt < 0) continue;

    const [rawStart, rawEnd] = lines[arrowAt].split('-->');
    const startMs = parseTimestamp(rawStart || '');
    // El final puede traer ajustes de posición detrás, en WebVTT.
    const endMs = parseTimestamp((rawEnd || '').trim().split(/\s+/)[0] || '');
    if (startMs === null || endMs === null || endMs < startMs) continue;

    const text = lines.slice(arrowAt + 1).join(' ').trim();
    if (!text) continue;

    cues.push({ index: cues.length, startMs, endMs, text });
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  cues.forEach((cue, index) => { cue.index = index; });

  let longestGapMs = 0;
  for (let i = 1; i < cues.length; i += 1) {
    const gap = cues[i].startMs - cues[i - 1].endMs;
    if (gap > longestGapMs) longestGapMs = gap;
  }

  return { cues, longestGapMs, incomplete: longestGapMs > GAP_THRESHOLD_MS };
}

/**
 * El cue que suena en ese momento. Si el instante cae en un hueco entre dos cues,
 * devuelve el anterior: es lo que acaba de sonar, y es mejor que no decir nada.
 * Devuelve `null` antes del primer cue.
 */
export function cueAt(cues: AlignmentCue[], timeMs: number): AlignmentCue | null {
  if (!cues.length || timeMs < cues[0].startMs) return null;

  let low = 0;
  let high = cues.length - 1;
  let found = cues[0];
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startMs <= timeMs) {
      found = cues[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * El momento del audio en que se lee ese texto, para saltar ahí al ponerse a escuchar
 * desde donde se iba leyendo. Compara por texto normalizado, porque el texto del EPUB y
 * el del cue rara vez coinciden carácter a carácter.
 */
export function timeOfText(cues: AlignmentCue[], text: string): number | null {
  const needle = normalizeForMatch(text);
  if (!needle) return null;
  for (const cue of cues) {
    const hay = normalizeForMatch(cue.text);
    if (!hay) continue;
    if (hay.includes(needle) || needle.includes(hay)) return cue.startMs;
  }
  return null;
}

/**
 * Quita lo que sobra para comparar: espacios, puntuación japonesa y occidental, y las
 * diferencias de ancho (NFKC pasa katakana y signos de ancho medio a su forma normal).
 *
 * `ー` (U+30FC) **no se quita**, aunque al lado de un guion parezca lo mismo: en japonés
 * es un sonido, la vocal larga. `ビール` (cerveza) y `ビル` (edificio) son palabras
 * distintas y solo las separa esa marca. Sí se quita `―` (U+2015), la raya de diálogo.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[、。，．,.「」『』（）()［］[\]…―!?！？"'’”]/g, '')
    .toLowerCase();
}
