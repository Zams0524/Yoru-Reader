/**
 * Qué parte de un libro del catálogo viaja con la sincronización y qué parte va aparte.
 *
 * La sincronización (Drive y el servidor de Yoru) sube el bulto entero cada vez que algo
 * cambia: basta pasar una página. Un EPUB con ilustraciones ronda los 10 MB en base64, así
 * que meter el texto de los libros en ese bulto haría que cada página subiera la biblioteca
 * entera, y con unos pocos libros el servidor lo rechazaría por grande y dejaría de
 * sincronizarse todo, progreso incluido.
 *
 * Así que en el bulto va la ficha del libro: título, autor, estado («Por leer», «Leyendo»…),
 * por dónde va, marcadores, notas y una portada pequeña. Con eso el libro aparece en el
 * catálogo de los otros aparatos. El texto se sube una sola vez por libro al servidor de
 * Yoru (`/api/textos`), y el otro aparato lo baja cuando abre el libro
 * (`yoruSyncService.ts`).
 *
 * Este módulo no habla con nadie ni toca la base: lo usan `db.ts` al exportar y
 * `cloudMerge.ts` al combinar.
 */

/** Por encima de esto, la portada viaja reducida. Unos 110 KB de imagen. */
export const LIMITE_PORTADA = 150_000;

/** Ancho de la portada reducida: de sobra para la cuadrícula del catálogo. */
const ANCHO_PORTADA = 360;

/** El fondo que pone la app a un libro sin portada (`db.addBook`). */
const PORTADA_POR_DEFECTO = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

/** Título y autor, como los empareja la combinación (`cloudMerge.ts`). */
export function claveTituloAutor(libro: any): string {
  return `${String(libro?.title || '').trim().toLowerCase()}\u0000${String(libro?.author || '').trim().toLowerCase()}`;
}

/** cyrb53: un hash de 53 bits, sin `crypto.subtle`, que no existe fuera de https. */
function cyrb53(texto: string, semilla: number): string {
  let h1 = 0xdeadbeef ^ semilla;
  let h2 = 0x41c6ce57 ^ semilla;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Con qué nombre se guarda el texto de un libro en el servidor. Sale del título y el
 * autor, no del id: el mismo libro importado en dos aparatos tiene dos ids y un texto.
 */
export function claveTexto(libro: any): string {
  const base = claveTituloAutor(libro);
  return `${cyrb53(base, 1)}${cyrb53(base, 2)}`;
}

/** El libro tiene su texto en este aparato. */
export function tieneTexto(libro: any): boolean {
  return Array.isArray(libro?.chapters) && libro.chapters.length > 0;
}

/**
 * El libro vino de otro aparato y su texto todavía no está aquí: hay que bajarlo para
 * abrirlo. Uno borrado no cuenta, no se va a abrir.
 */
export function faltaTexto(libro: any): boolean {
  return Boolean(libro) && !libro.isDeleted && !tieneTexto(libro) && libro.textoAparte === true;
}

/* -------------------------------------------------------------------- portadas */

const portadasReducidas = new Map<string, string>();

function claveDePortada(portada: string): string {
  return `${portada.length}:${portada.slice(0, 48)}:${portada.slice(-96)}`;
}

/**
 * La portada a lo ancho del catálogo, en JPEG. Necesita un lienzo, así que fuera del
 * navegador (pruebas en Node) devuelve `null` y el libro viaja con el fondo de siempre.
 */
export async function reducirPortada(portada: string): Promise<string | null> {
  const clave = claveDePortada(portada);
  const guardada = portadasReducidas.get(clave);
  if (guardada) return guardada;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const imagen = new Image();
    imagen.src = portada;
    await imagen.decode();
    const ancho = Math.min(ANCHO_PORTADA, imagen.naturalWidth || ANCHO_PORTADA);
    const alto = Math.max(1, Math.round(((imagen.naturalHeight || ancho) * ancho) / (imagen.naturalWidth || ancho)));
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(imagen, 0, 0, ancho, alto);
    const reducida = lienzo.toDataURL('image/jpeg', 0.82);
    if (!reducida.startsWith('data:image/') || reducida.length >= portada.length) return null;
    portadasReducidas.set(clave, reducida);
    return reducida;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- para el bulto */

/**
 * La ficha de un libro tal como viaja: sin texto y con la portada pequeña. Marca
 * `textoAparte` cuando el libro tiene texto en algún aparato, y `portadaReducida`
 * cuando la portada no es la original, para que la combinación no cambie la buena
 * por la pequeña en el aparato que la tiene.
 */
export async function libroParaSincronizar(libro: any): Promise<any> {
  const { chapters, ...ficha } = libro || {};
  const salida: any = { ...ficha, chapters: [] };
  if (!libro?.isDeleted && (tieneTexto(libro) || libro?.textoAparte)) salida.textoAparte = true;

  const portada = typeof libro?.cover === 'string' ? libro.cover : '';
  if (portada.startsWith('data:') && portada.length > LIMITE_PORTADA) {
    salida.cover = (await reducirPortada(portada)) || PORTADA_POR_DEFECTO;
    salida.portadaReducida = true;
  }
  return salida;
}

export async function librosParaSincronizar(libros: any[]): Promise<any[]> {
  const salida: any[] = [];
  for (const libro of libros || []) salida.push(await libroParaSincronizar(libro));
  return salida;
}

/**
 * Tras combinar dos copias de un libro: si se quedó con la portada pequeña y alguna de
 * las dos tiene la original, vuelve la original.
 */
export function conPortadaOriginal(combinado: any, ...copias: any[]): any {
  if (!combinado?.portadaReducida) return combinado;
  const original = copias.find((c) => c && !c.portadaReducida && typeof c.cover === 'string' && c.cover.startsWith('data:'));
  if (!original) return combinado;
  const { portadaReducida, ...resto } = combinado;
  return { ...resto, cover: original.cover };
}
