/**
 * Dos cosas pequeñas que las estadísticas no tenían y que no caben en el parte diario:
 * la **meta diaria** y **a qué hora** se lee o se escucha.
 *
 * El parte diario (`statistic` en IndexedDB, un registro por libro y día) viaja a la
 * nube y lo mezcla `cloudMerge`. Meterle veinticuatro casillas por hora a cada registro
 * obligaba a tocar esa mezcla, y un error ahí se paga con las rachas de todo el mundo.
 * Por eso las horas van aparte, en `localStorage` y por perfil: son un dato de este
 * aparato («aquí sueles leer de noche»), no una cifra que haya que reconciliar.
 *
 * Consecuencia que la pantalla tiene que decir: las horas empiezan a contar desde que
 * existe este fichero. Lo leído antes tiene día, pero no hora.
 */

import { db } from './db';

const GOAL_KEY = 'yoru_stats_daily_goal';
const HOURS_KEY = 'yoru_stats_hours';
/** Los días que se guardan. Un año largo: lo mismo que enseña el mapa de calor. */
const KEEP_DAYS = 400;

export const HABITS_EVENT = 'yoru-stats-habits-updated';

/** Segundos por hora del día (0–23), lectura y escucha por separado. */
export interface HourBuckets {
  reading: number[];
  listening: number[];
}

type HoursLog = Record<string, { r?: number[]; l?: number[] }>;

function profileKey(base: string): string {
  return `${base}_${db.getActiveProfileId() || 'profile-default'}`;
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(HABITS_EVENT));
  } catch {
    // Sin ventana (pruebas) no hay a quién avisar.
  }
}

/** La meta diaria en minutos; 0 es «sin meta». */
export function getDailyGoalMinutes(): number {
  try {
    const value = Number(localStorage.getItem(profileKey(GOAL_KEY)));
    return Number.isFinite(value) && value > 0 ? Math.min(24 * 60, Math.round(value)) : 0;
  } catch {
    return 0;
  }
}

export function setDailyGoalMinutes(minutes: number): void {
  try {
    const value = Math.max(0, Math.min(24 * 60, Math.round(minutes || 0)));
    if (value > 0) localStorage.setItem(profileKey(GOAL_KEY), String(value));
    else localStorage.removeItem(profileKey(GOAL_KEY));
    notify();
  } catch {
    // Sin sitio donde guardar, la meta no se queda. No se pierde ningún dato.
  }
}

function readLog(): HoursLog {
  try {
    const raw = localStorage.getItem(profileKey(HOURS_KEY));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as HoursLog) : {};
  } catch {
    return {};
  }
}

function ymd(date: Date): string {
  return date.toLocaleDateString('sv').slice(0, 10);
}

function emptyDay(): number[] {
  return new Array(24).fill(0);
}

/**
 * Apunta tiempo en la hora en la que estamos.
 *
 * Se llama desde el mismo sitio que suma al parte diario, así que cuenta exactamente
 * lo mismo. El tiempo llega en trozos pequeños (cada pocos segundos mientras se lee),
 * de modo que cargarlo entero a la hora actual se equivoca, como mucho, en el trozo
 * que cruza el cambio de hora.
 */
export function recordHourActivity(readingSeconds: number, listeningSeconds: number, when: Date = new Date()): void {
  const reading = Math.max(0, Number(readingSeconds) || 0);
  const listening = Math.max(0, Number(listeningSeconds) || 0);
  if (reading <= 0 && listening <= 0) return;
  try {
    const log = readLog();
    const key = ymd(when);
    const hour = when.getHours();
    const day = log[key] || {};
    if (reading > 0) {
      const list = Array.isArray(day.r) && day.r.length === 24 ? day.r : emptyDay();
      list[hour] = Math.round((list[hour] || 0) + reading);
      day.r = list;
    }
    if (listening > 0) {
      const list = Array.isArray(day.l) && day.l.length === 24 ? day.l : emptyDay();
      list[hour] = Math.round((list[hour] || 0) + listening);
      day.l = list;
    }
    log[key] = day;

    const keys = Object.keys(log);
    if (keys.length > KEEP_DAYS) {
      const limit = new Date(when);
      limit.setDate(limit.getDate() - KEEP_DAYS);
      const from = ymd(limit);
      for (const old of keys) if (old < from) delete log[old];
    }
    localStorage.setItem(profileKey(HOURS_KEY), JSON.stringify(log));
  } catch {
    // Las horas son un adorno de las estadísticas: si no se pueden guardar, el parte
    // diario —que es el dato de verdad— no se entera.
  }
}

/** El reparto por horas de cada día guardado, con las casillas siempre completas. */
export function getHourLog(): Map<string, HourBuckets> {
  const out = new Map<string, HourBuckets>();
  const log = readLog();
  for (const [key, day] of Object.entries(log)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day) continue;
    const fill = (list?: number[]) =>
      Array.isArray(list) && list.length === 24 ? list.map((value) => Math.max(0, Number(value) || 0)) : emptyDay();
    out.set(key, { reading: fill(day.r), listening: fill(day.l) });
  }
  return out;
}
