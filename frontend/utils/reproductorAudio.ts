import { db } from './db';

/**
 * Lo que el reproductor de audiolibros guarda del usuario: sus marcadores y cuánto
 * salta cada botón.
 *
 * Los dos eran constantes en el código. Los saltos («atrás 10, adelante 30») con un
 * comentario que decía «no es configurable todavía; cuando lo sea, este es el sitio
 * del que tirar», y los marcadores no existían: el botón del marcapáginas solo volvía
 * a apuntar la posición en la que ya estabas. En un audiolibro de seis horas eso no
 * basta — una frase que quieres volver a oír, el sitio donde se te durmió el niño, el
 * capítulo que hay que repasar son varios sitios, y cada uno quiere su nombre.
 *
 * Todo va por perfil y en `localStorage`: son preferencias y marcas del aparato, no
 * datos que haya que sincronizar con el servidor. Audiobookshelf tiene sus propios
 * marcadores, pero escribirlos pediría permiso de escritura en la cuenta y los
 * compartiría con los demás perfiles de la casa, que es justo lo que no se quiere.
 */

export interface MarcadorAudio {
  /** El segundo del audiolibro. */
  at: number;
  /** El nombre que le puso el usuario. Puede estar vacío: entonces manda la hora. */
  label: string;
}

export interface SaltosAudio {
  back: number;
  forward: number;
}

/** Los saltos que se ofrecen, en segundos. */
export const SALTOS = [5, 10, 15, 30, 45, 60];

const SALTOS_DEFECTO: SaltosAudio = { back: 10, forward: 30 };

export const AUDIO_PREFS_EVENT = 'yoru-audio-prefs-updated';

function perfil(): string {
  return db.getActiveProfileId() || 'profile-default';
}

function clave(base: string): string {
  return `${base}_${perfil()}`;
}

/* ---------------------------------- Saltos --------------------------------- */

export function getSaltos(): SaltosAudio {
  try {
    const raw = localStorage.getItem(clave('yoru_audio_saltos'));
    const parsed = raw ? JSON.parse(raw) : null;
    const back = Number(parsed?.back);
    const forward = Number(parsed?.forward);
    return {
      back: SALTOS.includes(back) ? back : SALTOS_DEFECTO.back,
      forward: SALTOS.includes(forward) ? forward : SALTOS_DEFECTO.forward,
    };
  } catch {
    return SALTOS_DEFECTO;
  }
}

export function setSaltos(saltos: SaltosAudio): void {
  try {
    localStorage.setItem(clave('yoru_audio_saltos'), JSON.stringify(saltos));
  } catch {
    /* Sin sitio donde guardar, se queda con 10 y 30, que es lo de siempre. */
  }
  window.dispatchEvent(new Event(AUDIO_PREFS_EVENT));
}

/* -------------------------------- Marcadores ------------------------------- */

/**
 * Los marcadores de un audiolibro, siempre en orden de tiempo.
 *
 * Se guardan todos juntos en una clave y no uno por audiolibro: son unos pocos por
 * libro, caben de sobra, y así la lista entera se lee de una vez cuando haga falta
 * enseñarla en otro sitio.
 */
function leerTodos(): Record<string, MarcadorAudio[]> {
  try {
    const raw = localStorage.getItem(clave('yoru_audio_marcadores'));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function escribirTodos(data: Record<string, MarcadorAudio[]>): void {
  try {
    localStorage.setItem(clave('yoru_audio_marcadores'), JSON.stringify(data));
  } catch {
    /* Igual que arriba: lo que ya estuviera guardado sigue donde estaba. */
  }
  window.dispatchEvent(new Event(AUDIO_PREFS_EVENT));
}

export function getMarcadores(itemId: string): MarcadorAudio[] {
  const lista = leerTodos()[itemId];
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((entry) => entry && Number.isFinite(entry.at))
    .map((entry) => ({ at: Math.max(0, Math.round(entry.at)), label: typeof entry.label === 'string' ? entry.label : '' }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Marca un momento. Si ya había uno a menos de dos segundos, le cambia el nombre en
 * vez de poner otro: dos marcadores en el mismo sitio son uno mal puesto.
 */
export function marcar(itemId: string, at: number, label = ''): void {
  if (!itemId) return;
  const data = leerTodos();
  const lista = getMarcadores(itemId);
  const segundo = Math.max(0, Math.round(at));
  const cerca = lista.findIndex((entry) => Math.abs(entry.at - segundo) <= 2);
  if (cerca >= 0) lista[cerca] = { at: lista[cerca].at, label };
  else lista.push({ at: segundo, label });
  escribirTodos({ ...data, [itemId]: lista.sort((a, b) => a.at - b.at) });
}

export function renombrarMarcador(itemId: string, at: number, label: string): void {
  const data = leerTodos();
  const lista = getMarcadores(itemId).map((entry) => (entry.at === at ? { at, label } : entry));
  escribirTodos({ ...data, [itemId]: lista });
}

export function quitarMarcador(itemId: string, at: number): void {
  const data = leerTodos();
  const lista = getMarcadores(itemId).filter((entry) => entry.at !== at);
  if (lista.length === 0) {
    const resto = { ...data };
    delete resto[itemId];
    escribirTodos(resto);
    return;
  }
  escribirTodos({ ...data, [itemId]: lista });
}
