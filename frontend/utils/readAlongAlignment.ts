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
  /** Lo que el generador dijo de su propio trabajo. `null` si el fichero no lo trae. */
  verdict: AlignmentVerdict | null;
}

/**
 * El dictamen que el generador escribe antes del primer cue:
 *
 *     YORU-ALINEACION v1 {"verdict":"parcial","coverage":0.41,…}
 *
 * No es un cue, así que `parseAlignment` lo salta sin enterarse y el fichero sigue
 * siendo un SRT corriente para cualquier otro programa.
 *
 * Importa porque **el veredicto manda**: una alineación que su propio generador da por
 * mala no se carga, por bien formado que esté el fichero. Un SRT traído de fuera no lo
 * trae, y entonces esto es `null` y decide quien lo importa.
 */
export interface AlignmentVerdict {
  /** `bueno` | `parcial` | `dudoso` | `no-es-pareja`. Cualquier otra cosa es desconocida. */
  verdict: string;
  /** Parte del libro que recibió tiempo, de 0 a 1. */
  coverage: number;
  /** Parte del audio que recibió texto. Distingue «tomo partido» de «no son pareja». */
  audioCoverage: number;
  /** Lo que hay que enseñarle a quien lo importa, en sus palabras. */
  notice: string;
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

  return {
    cues,
    longestGapMs,
    incomplete: longestGapMs > GAP_THRESHOLD_MS,
    verdict: parseVerdict(source),
  };
}

/** Lee la línea `YORU-ALINEACION v1 {…}`. Devuelve `null` si no está o no se entiende. */
export function parseVerdict(source: string): AlignmentVerdict | null {
  const line = source.split(/\r?\n/, 40).find((l) => l.startsWith('YORU-ALINEACION'));
  if (!line) return null;
  const brace = line.indexOf('{');
  if (brace < 0) return null;
  try {
    const raw = JSON.parse(line.slice(brace));
    return {
      verdict: String(raw.verdict || ''),
      coverage: Number(raw.coverage) || 0,
      audioCoverage: Number(raw.audioCoverage) || 0,
      notice: String(raw.notice || ''),
    };
  } catch {
    return null;
  }
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
 * El momento del audio en que se lee ese texto, barriendo los cues de uno en uno.
 *
 * Sirve para una consulta suelta. Para el lector **no**: un tomo da decenas de miles de
 * cues y esto es un barrido completo por cada salto. Para eso está `buildAlignmentIndex`,
 * que empareja cues con párrafos una vez y luego responde en tiempo constante.
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

// ── El índice: cues ↔ párrafos ──────────────────────────────────────────

/**
 * Empareja cada cue con el párrafo del libro en que cae, una sola vez.
 *
 * Sin esto, cada salto costaría un barrido de los ~40.000 cues de un tomo, y el lector
 * hace un salto por página. Con esto, las dos preguntas del lector —«¿qué párrafo suena
 * ahora?» y «¿por qué segundo va este párrafo?»— se contestan en tiempo constante.
 *
 * El emparejamiento se hace **hacia delante y sin volver atrás**: los cues van en el
 * orden del libro, así que basta ir avanzando por el texto. Eso lo deja en una pasada
 * sobre el libro, y además impide que un cue se enganche a un párrafo anterior porque
 * la frase se repita más adelante.
 */
export interface AlignmentIndex {
  cues: AlignmentCue[];
  /** Para cada cue, el párrafo en que cae, o -1 si no se encontró. */
  paragraphOfCue: Int32Array;
  /** Para cada cue, su sección, o -1. */
  sectionOfCue: Int32Array;
  /** Del id de párrafo al primer cue que cae en él. */
  firstCueOfParagraph: Map<number, number>;
  /** Cuántos cues se pudieron colocar en el libro. */
  placed: number;
  verdict: AlignmentVerdict | null;
}

/** Un párrafo del libro, numerado como los numera el lector. */
export interface ParagraphText {
  sectionIndex: number;
  paragraphId: number;
  text: string;
}

/**
 * Empareja los cues con los párrafos. `paragraphs` tiene que venir en el orden del
 * libro y numerado como el lector (`ReaderEngineApi.goToParagraph`).
 */
export function buildAlignmentIndex(
  alignment: Alignment,
  paragraphs: ParagraphText[],
): AlignmentIndex {
  const { cues } = alignment;
  const paragraphOfCue = new Int32Array(cues.length).fill(-1);
  const sectionOfCue = new Int32Array(cues.length).fill(-1);
  const firstCueOfParagraph = new Map<number, number>();

  // El libro entero como un solo texto normalizado, y de qué párrafo sale cada tramo.
  const normalized: string[] = [];
  const startOf: number[] = [];
  let total = 0;
  for (const p of paragraphs) {
    const text = normalizeForMatch(p.text);
    startOf.push(total);
    normalized.push(text);
    total += text.length;
  }
  const libro = normalized.join('');

  // Busca cada cue a partir de donde acabó el anterior: una pasada, y sin retroceder.
  let desde = 0;
  let placed = 0;
  for (const cue of cues) {
    const needle = normalizeForMatch(cue.text);
    if (!needle) continue;
    let at = libro.indexOf(needle, desde);
    // Si no aparece de aquí en adelante puede ser que el cue no esté en el libro, o que
    // nos hayamos pasado por un emparejamiento anterior flojo. Se mira desde el
    // principio una sola vez; si tampoco está, el cue se queda sin párrafo, que es lo
    // correcto: antes dejarlo fuera que colgarlo de cualquier sitio.
    if (at < 0) at = libro.indexOf(needle);
    if (at < 0) continue;

    const p = paragraphAt(startOf, at);
    if (p < 0) continue;
    paragraphOfCue[cue.index] = paragraphs[p].paragraphId;
    sectionOfCue[cue.index] = paragraphs[p].sectionIndex;
    if (!firstCueOfParagraph.has(paragraphs[p].paragraphId)) {
      firstCueOfParagraph.set(paragraphs[p].paragraphId, cue.index);
    }
    placed++;
    desde = at + needle.length;
  }

  return {
    cues,
    paragraphOfCue,
    sectionOfCue,
    firstCueOfParagraph,
    placed,
    verdict: alignment.verdict,
  };
}

/** El párrafo que contiene esa posición del texto unido. Búsqueda binaria. */
function paragraphAt(startOf: number[], at: number): number {
  let low = 0;
  let high = startOf.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (startOf[mid] <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * El párrafo que suena en ese momento, o `null`.
 *
 * `null` no es un fallo: es que ahí no hay texto alineado. El lector tiene que
 * **quedarse quieto** cuando pasa, no saltar al párrafo más cercano. Un salto a ojo en
 * un libro para aprender japonés enseña mal.
 */
export function paragraphAtTime(
  index: AlignmentIndex,
  timeMs: number,
): { paragraphId: number; sectionIndex: number; cue: AlignmentCue } | null {
  const cue = cueAt(index.cues, timeMs);
  if (!cue) return null;
  // Si el momento cae muy por detrás del final del cue, estamos en un hueco sin alinear.
  if (timeMs > cue.endMs + UNALIGNED_SLACK_MS) return null;
  const paragraphId = index.paragraphOfCue[cue.index];
  if (paragraphId < 0) return null;
  return { paragraphId, sectionIndex: index.sectionOfCue[cue.index], cue };
}

/** El segundo del audio en que empieza ese párrafo, o `null` si no está alineado. */
export function timeOfParagraph(index: AlignmentIndex, paragraphId: number): number | null {
  const cue = index.firstCueOfParagraph.get(paragraphId);
  return cue === undefined ? null : index.cues[cue].startMs;
}

/**
 * Tras un cue, cuánto silencio se tolera antes de dar por hecho que ahí no hay texto.
 * Una pausa normal entre frases no llega a dos segundos; más que eso, en un libro
 * alineado de verdad, es un tramo que el generador dejó fuera a propósito.
 */
const UNALIGNED_SLACK_MS = 4000;
