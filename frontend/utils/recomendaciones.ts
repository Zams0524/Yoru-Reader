import { db } from './db';

/**
 * «Libros para ti»: por qué se recomienda cada uno, y los que no quieres volver a ver.
 *
 * El carrusel ya existía, pero no decía nada: una fila de portadas sin motivo parece
 * una lista al azar, y cuando acierta tampoco se nota. Nanahoshi enseña la razón en
 * cada tarjeta («Mismo autor que X», «Parecido a X») y deja apartar una con un «no me
 * interesa». Las dos cosas son el mismo arreglo: una recomendación solo se puede
 * juzgar cuando se sabe de dónde viene.
 *
 * Lo apartado se guarda por perfil y son solo identificadores de libros: ni se toca el
 * libro ni se borra nada de él.
 */

/** Por qué este libro está en la fila. */
export interface MotivoRecomendacion {
  kind: 'series' | 'author' | 'new';
  /** La serie o el autor que lo trajo. */
  value?: string;
}

export const RECS_EVENT = 'yoru-recs-updated';

const BASE_KEY = 'yoru_recs_dismissed';

function key(): string {
  return `${BASE_KEY}_${db.getActiveProfileId() || 'profile-default'}`;
}

export function descartados(): string[] {
  try {
    const raw = localStorage.getItem(key());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function estaDescartado(id: string): boolean {
  return descartados().includes(id);
}

/** Aparta un libro de las recomendaciones. */
export function descartar(id: string): void {
  if (!id) return;
  const lista = descartados();
  if (lista.includes(id)) return;
  try {
    localStorage.setItem(key(), JSON.stringify([...lista, id]));
  } catch {
    /* Sin sitio donde guardar, la recomendación vuelve. No se pierde nada del usuario. */
  }
  window.dispatchEvent(new Event(RECS_EVENT));
}

/** Devuelve a la fila todas las recomendaciones apartadas. */
export function olvidarDescartes(): void {
  try {
    localStorage.removeItem(key());
  } catch {
    /* Igual que arriba: es una preferencia, no un dato. */
  }
  window.dispatchEvent(new Event(RECS_EVENT));
}

/** La frase que va debajo de la portada. Corta: tiene que caber en una tarjeta. */
export function motivoTexto(motivo: MotivoRecomendacion, es: boolean): string {
  if (motivo.kind === 'series' && motivo.value) {
    return es ? `Sigue ${motivo.value}` : `Continues ${motivo.value}`;
  }
  if (motivo.kind === 'author' && motivo.value) {
    return es ? `De ${motivo.value}, que ya lees` : `By ${motivo.value}, whom you read`;
  }
  return es ? 'Sin empezar todavía' : 'Not started yet';
}
