/**
 * Los avisos de dentro de la app: lo que ha terminado mientras hacías otra cosa.
 *
 * No son las notificaciones del sistema (eso es `yoruNotifications.ts`, en Android).
 * Es la lista que se abre con la campana: «se instaló tal diccionario», y poco más por
 * ahora. Se guardan por perfil, los últimos cincuenta, para que sigan ahí al volver.
 */

import { db } from './db';

export interface AppNotice {
  id: string;
  /** Cuándo pasó, en epoch ms. */
  at: number;
  title: string;
  body?: string;
}

const BASE_KEY = 'yoru_notices';
const SEEN_KEY = 'yoru_notices_seen';
const MAX = 50;
export const NOTICES_EVENT = 'yoru-notices-updated';

function key(base: string): string {
  return `${base}_${db.getActiveProfileId() || 'profile-default'}`;
}

export function getNotices(): AppNotice[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(BASE_KEY)) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.title === 'string' && Number.isFinite(entry.at))
      : [];
  } catch {
    return [];
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(NOTICES_EVENT));
  } catch {
    // Sin ventana no hay a quién avisar.
  }
}

/**
 * Apunta un aviso. Dos iguales seguidos en menos de un minuto cuentan como uno: hay
 * tareas que avisan varias veces de lo mismo al terminar.
 */
export function pushNotice(title: string, body = ''): void {
  try {
    const list = getNotices();
    const now = Date.now();
    const last = list[0];
    if (last && last.title === title && (last.body || '') === body && now - last.at < 60_000) return;
    list.unshift({ id: `${now}-${Math.random().toString(36).slice(2, 8)}`, at: now, title, body: body || undefined });
    localStorage.setItem(key(BASE_KEY), JSON.stringify(list.slice(0, MAX)));
    notify();
  } catch {
    // Un aviso que no se puede guardar no rompe la tarea que lo daba.
  }
}

export function clearNotices(): void {
  try {
    localStorage.removeItem(key(BASE_KEY));
    notify();
  } catch {
    // Nada que hacer.
  }
}

/** Cuántos avisos hay desde la última vez que se abrió la campana. */
export function unseenNoticeCount(): number {
  try {
    const seen = Number(localStorage.getItem(key(SEEN_KEY))) || 0;
    return getNotices().filter((entry) => entry.at > seen).length;
  } catch {
    return 0;
  }
}

export function markNoticesSeen(): void {
  try {
    localStorage.setItem(key(SEEN_KEY), String(Date.now()));
    notify();
  } catch {
    // Nada que hacer.
  }
}
