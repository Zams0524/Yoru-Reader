/**
 * Guardar y recuperar la alineación de un libro, y dejarla lista para el lector.
 *
 * **Cómo entra**: el usuario elige el `.srt` que dejó el alineador (`tools/alineador`).
 * No hay descarga automática ni carpeta mágica, y es a propósito: el audiolibro no está
 * en este ordenador —se escucha en streaming desde Audiobookshelf—, así que no existe un
 * «al lado del audio» al que mirar. Señalar un fichero una vez por libro es el camino
 * más corto que funciona de verdad hoy.
 *
 * El SRT se guarda tal cual, en IndexedDB y no en localStorage, porque un tomo da del
 * orden de un megabyte de cues. El índice se reconstruye al abrir el libro: cuesta una
 * pasada y así nunca queda desfasado respecto al texto.
 */
import type { Section } from '../components/reader/ReaderEngine';
import { visibleLineText } from './bookSearch';
import {
  buildAlignmentIndex,
  parseAlignment,
  type AlignmentIndex,
  type ParagraphText,
} from './readAlongAlignment';

const PREFIX = 'yoru_alineacion_';

interface Guardada {
  srt: string;
  /** Cómo se llamaba el fichero, para poder decirlo al enseñarlo. */
  name: string;
  /** ISO 8601, como `2026-10-30T08:30:00.000Z`. */
  importedAt: string;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Misma base y mismo almacén que `db`: lo crea quien llegue primero.
    const peticion = indexedDB.open('YoruReaderStore', 1);
    peticion.onupgradeneeded = (e: any) => {
      const base = e.target.result;
      if (!base.objectStoreNames.contains('keyvalue')) base.createObjectStore('keyvalue');
    };
    peticion.onsuccess = (e: any) => resolve(e.target.result);
    peticion.onerror = (e: any) => reject(e.target.error);
  });
}

async function leer(clave: string): Promise<Guardada | null> {
  const base = await abrir();
  return new Promise((resolve) => {
    const p = base.transaction('keyvalue', 'readonly').objectStore('keyvalue').get(clave);
    p.onsuccess = () => resolve(p.result || null);
    p.onerror = () => resolve(null);
  });
}

async function escribir(clave: string, valor: Guardada | null): Promise<void> {
  const base = await abrir();
  return new Promise((resolve, reject) => {
    const almacen = base.transaction('keyvalue', 'readwrite').objectStore('keyvalue');
    const p = valor ? almacen.put(valor, clave) : almacen.delete(clave);
    p.onsuccess = () => resolve();
    p.onerror = () => reject(p.error);
  });
}

export async function saveAlignmentSrt(bookId: string, srt: string, name: string): Promise<void> {
  await escribir(PREFIX + bookId, { srt, name, importedAt: new Date().toISOString() });
}

export async function deleteAlignment(bookId: string): Promise<void> {
  await escribir(PREFIX + bookId, null);
}

export async function loadAlignmentSrt(bookId: string): Promise<Guardada | null> {
  return leer(PREFIX + bookId);
}

/**
 * Los párrafos del libro, numerados **como los numera el lector**, que es lo que permite
 * abrirlos luego con `ReaderEngineApi.goToParagraph`.
 *
 * Recorre el texto igual que `searchBook`: mismas reglas para saltar imágenes, títulos y
 * líneas en blanco. Si esas reglas cambian allí hay que cambiarlas aquí, o los cues
 * caerán en el párrafo de al lado.
 */
export function bookParagraphs(
  chapters: { content?: string }[],
  sections: Section[],
): ParagraphText[] {
  const fuera: ParagraphText[] = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const crudo = (chapters[section.chapterIndex]?.content || '')
      .slice(section.startOffset, section.endOffset);
    let paragraphId = section.startParagraphId;

    for (const linea of crudo.split(/\r?\n/)) {
      const esTitulo = /^\{h[123]:/.test(linea) && linea.endsWith('}');
      const esImagen = linea.startsWith('{img:') && linea.endsWith('}');
      if (!linea.trim() || esImagen) {
        paragraphId++;
        continue;
      }
      if (esTitulo) continue; // los títulos no llevan id de párrafo
      fuera.push({ sectionIndex, paragraphId, text: visibleLineText(linea) });
      paragraphId++;
    }
  }
  return fuera;
}

export interface LoadedAlignment {
  index: AlignmentIndex;
  name: string;
  /** Lo que hay que decirle al usuario antes de que se fíe, o cadena vacía. */
  notice: string;
}

/**
 * Deja lista la alineación guardada de un libro, o explica por qué no.
 *
 * **El veredicto manda.** Si el generador dijo que el audio y el libro no son pareja, no
 * se carga por perfecto que esté el fichero: poner cues de otro libro sobre este texto es
 * peor que no tener audio sincronizado. `parcial` y `dudoso` sí se cargan, pero diciendo
 * lo que son.
 */
export async function prepareAlignment(
  bookId: string,
  chapters: { content?: string }[],
  sections: Section[],
  lang: string,
): Promise<{ ok: LoadedAlignment } | { error: string } | null> {
  const guardada = await loadAlignmentSrt(bookId);
  if (!guardada) return null;
  return buildFromSrt(guardada.srt, guardada.name, chapters, sections, lang);
}

/** Lo mismo a partir del texto del fichero. Lo usa también la importación. */
export function buildFromSrt(
  srt: string,
  name: string,
  chapters: { content?: string }[],
  sections: Section[],
  lang: string,
): { ok: LoadedAlignment } | { error: string } {
  const es = lang === 'es';
  const alignment = parseAlignment(srt);
  if (!alignment.cues.length) {
    return { error: es ? 'Ese fichero no trae ningún cue.' : 'That file has no cues.' };
  }

  const v = alignment.verdict;
  if (v && v.verdict === 'no-es-pareja') {
    return {
      error: v.notice || (es
        ? 'El alineador dice que ese audio no es de este libro.'
        : 'The aligner says that audio is not for this book.'),
    };
  }

  const index = buildAlignmentIndex(alignment, bookParagraphs(chapters, sections));
  if (!index.placed) {
    return {
      error: es
        ? 'Ninguna frase del fichero aparece en este libro. ¿Es la alineación de otro libro?'
        : 'No line in that file appears in this book. Is it another book’s alignment?',
    };
  }

  const colocados = index.placed / index.cues.length;
  let notice = '';
  if (v && v.verdict === 'parcial') {
    notice = v.notice || (es
      ? `El audio solo cubre parte del libro (${Math.round(v.coverage * 100)} %).`
      : `The audio covers only part of the book (${Math.round(v.coverage * 100)} %).`);
  } else if (v && v.verdict === 'dudoso') {
    notice = v.notice || (es
      ? 'El alineador marcó esta alineación como dudosa.'
      : 'The aligner marked this alignment as doubtful.');
  } else if (colocados < 0.9) {
    // Aunque el generador la diera por buena: si la mayoría de los cues no aparece en
    // este texto, el libro no es exactamente el que se alineó.
    notice = es
      ? `Solo el ${Math.round(colocados * 100)} % de las frases del fichero aparecen en este libro.`
      : `Only ${Math.round(colocados * 100)} % of the file’s lines appear in this book.`;
  }

  return { ok: { index, name, notice } };
}
