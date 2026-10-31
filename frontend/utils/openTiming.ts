/**
 * Cuánto tarda en abrirse un libro o un audiolibro, y en qué se va el tiempo.
 *
 * El lector nativo de Android ya escribía una línea así (`NativeReaderHost.tsx`, por
 * `NativeReader.log`, porque la consola del WebView no llega al registro del
 * teléfono). En Electron no había nada, así que «abre lento» no se podía discutir con
 * números. Esto es la misma idea para la web: una sola línea por apertura, con los
 * tramos medidos, en vez de un cronómetro a ojo.
 *
 * Se mide desde que se pulsa, no desde que monta el lector: lo que sufre quien lee es
 * la espera entera.
 */

interface OpenRun {
  label: string;
  startedAt: number;
  lastAt: number;
  marks: string[];
  done: boolean;
}

let run: OpenRun | null = null;

/** Arranca el cronómetro de una apertura. Una nueva cancela la anterior sin escribir. */
export function startOpenTiming(label: string): void {
  const now = performance.now();
  run = { label, startedAt: now, lastAt: now, marks: [], done: false };
  // El lector nativo de Android lee esta marca para su propia línea.
  (window as { __yoruOpenRequestedAt?: number }).__yoruOpenRequestedAt = now;
}

/** Cierra un tramo: lo que ha pasado desde la marca anterior. */
export function markOpenTiming(name: string): void {
  if (!run || run.done) return;
  const now = performance.now();
  run.marks.push(`${name} ${Math.round(now - run.lastAt)}`);
  run.lastAt = now;
}

/**
 * Da la apertura por terminada y escribe la línea. Se llama cuando el lector ya enseña
 * algo, que es el momento que le importa a quien abre el libro.
 */
export function finishOpenTiming(): void {
  if (!run || run.done) return;
  run.done = true;
  const total = Math.round(performance.now() - run.startedAt);
  const detail = run.marks.length ? `${run.marks.join(' ms, ')} ms, ` : '';
  console.info(`[yoru] abrir ${run.label}: ${detail}total ${total} ms`);
}

/** Lo que se lleva medido, por si hace falta mirarlo sin esperar al final. */
export function openTimingSoFar(): number | null {
  return run && !run.done ? Math.round(performance.now() - run.startedAt) : null;
}
