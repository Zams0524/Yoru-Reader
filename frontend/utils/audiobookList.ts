/**
 * Tu lista de audiolibros: los que has apartado para luego.
 *
 * Es deliberadamente lo más tonto posible —un puñado de ids— porque el audiolibro
 * entero vive en el servidor y ya lo tenemos cacheado para los carruseles de Inicio.
 * Guardar aquí una copia de los títulos sería tener dos verdades, y la de aquí se
 * quedaría vieja en cuanto alguien renombrara algo en Audiobookshelf.
 *
 * No son los estantes de la biblioteca (`libraryIndex.ts`): aquellos se deducen del
 * progreso de tus libros, y un audiolibro del servidor no tiene progreso tuyo que
 * deducir. Este es un apartado explícito, que se pone y se quita a mano.
 */

const LIST_KEY = 'yoru_audiobook_list';

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Un almacén ilegible no debe tumbar la ficha: la lista sale vacía y se sigue.
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(ids));
  } catch {
    // Sin sitio o sin permiso: no se guarda, pero la pantalla no se rompe.
  }
  window.dispatchEvent(new CustomEvent('yoru-audiobook-list-updated'));
}

/** Los ids apartados, el último añadido primero. */
export function audiobookList(): string[] {
  return read();
}

export function isAudiobookInList(itemId: string): boolean {
  return read().includes(itemId);
}

/** Lo añade si no estaba y lo quita si estaba. Devuelve cómo queda. */
export function toggleAudiobookInList(itemId: string): boolean {
  const ids = read();
  const index = ids.indexOf(itemId);
  if (index >= 0) {
    ids.splice(index, 1);
    write(ids);
    return false;
  }
  ids.unshift(itemId);
  write(ids);
  return true;
}
