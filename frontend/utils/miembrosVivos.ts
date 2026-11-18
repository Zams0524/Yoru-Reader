/**
 * Quién está en línea, al día y sin parpadeos.
 *
 * Dos problemas distintos viven aquí, los dos resueltos con funciones puras para poder
 * probarlos sin montar media app:
 *
 *  1. **Cada cuánto preguntar.** Discord no quiere que le machaquen, y lo dice con un
 *     429 y una cabecera `Retry-After`. Así que el ritmo se adapta: rápido cuando todo
 *     va bien, más lento tras un rechazo, y de vuelta al ritmo bueno en cuanto una
 *     respuesta sale bien.
 *  2. **Quién sale en la lista.** El widget no publica a todo el mundo —hoy, de hecho,
 *     solo publica bots—, así que a quien está usando Yoru en este momento lo pone la
 *     propia app: sabe de sobra que está aquí, porque está aquí.
 */

import type { DiscordMember } from './discordWidget';

/** Lo normal entre dos preguntas, con la pantalla abierta y delante. */
export const INTERVALO_BASE_MS = 20_000;

/** El techo cuando Discord pide calma. */
export const INTERVALO_MAXIMO_MS = 120_000;

export interface RitmoSondeo {
  /** Lo que hay que esperar hasta la siguiente pregunta. */
  esperaMs: number;
  /** Cuántos rechazos seguidos llevamos. */
  rechazos: number;
}

export const RITMO_INICIAL: RitmoSondeo = { esperaMs: INTERVALO_BASE_MS, rechazos: 0 };

/**
 * El ritmo después de una respuesta.
 *
 * Una buena devuelve al ritmo de siempre, sin arrastrar el castigo: si Discord ya
 * contesta, no hay motivo para seguir esperando el doble. Un 429 dobla la espera, y si
 * Discord dice cuánto esperar con `Retry-After`, manda él: sabe mejor que nosotros
 * cuándo va a dejar de rechazarnos.
 */
export function siguienteRitmo(
  actual: RitmoSondeo,
  resultado: { ok: boolean; limitado?: boolean; retryAfterSegundos?: number },
): RitmoSondeo {
  if (resultado.ok) return RITMO_INICIAL;

  if (resultado.limitado) {
    const rechazos = actual.rechazos + 1;
    const pedido = Number(resultado.retryAfterSegundos);
    if (Number.isFinite(pedido) && pedido > 0) {
      return { esperaMs: Math.min(pedido * 1000, INTERVALO_MAXIMO_MS), rechazos };
    }
    return { esperaMs: Math.min(actual.esperaMs * 2, INTERVALO_MAXIMO_MS), rechazos };
  }

  // Un fallo de red no es un «no» de Discord: se espera un poco más, sin castigar.
  return { esperaMs: Math.min(actual.esperaMs * 2, INTERVALO_MAXIMO_MS), rechazos: actual.rechazos };
}

/** El nombre, como se compara: sin espacios de sobra y en minúsculas. */
export function claveNombre(nombre: string): string {
  return (nombre || '').trim().toLowerCase();
}

/**
 * El estado de un miembro: su etiqueta y la clase que le da color.
 *
 * Vive aquí, en un solo sitio, porque lo usan dos pantallas —la fila de la lista y la
 * tarjeta— y era cuestión de tiempo que divergieran: basta con que una escriba la
 * clase a mano y se quede sin el color que la otra sí tiene. Los colores los pone el
 * CSS: verde en línea, amarillo ausente, rojo no molestar.
 *
 * Un estado desconocido se trata como «en línea» y no como un hueco gris, porque si
 * Discord publica a alguien es que está conectado; lo que no sabríamos es de qué modo.
 *
 * (Aquí vivió un rato `conmigoDentro`, que añadía a la lista a quien tuviera la app
 * abierta. Se quitó: decía «en línea» de alguien que en Discord estaba apagado, y una
 * pantalla que contradice a Discord sobre tu propio estado confunde más de lo que
 * ayuda.)
 */
export function estadoMiembro(
  status: string | undefined,
  es: boolean,
): { clase: string; etiqueta: string } {
  if (status === 'idle') return { clase: 'is-idle', etiqueta: es ? 'Ausente' : 'Idle' };
  if (status === 'dnd') return { clase: 'is-dnd', etiqueta: es ? 'No molestar' : 'Do not disturb' };
  return { clase: 'is-online', etiqueta: es ? 'En línea' : 'Online' };
}

/**
 * Si dos listas dicen lo mismo.
 *
 * Sirve para no repintar cuando Discord devuelve lo de siempre, que con una respuesta
 * cacheada cinco minutos es casi siempre. Se comparan los campos que se ven; el `id`
 * no, porque el del widget es un número de orden y cambia cuando alguien entra o sale
 * sin que eso signifique nada para quien mira.
 */
export function mismaLista(a: DiscordMember[], b: DiscordMember[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((uno, i) => {
    const otro = b[i];
    return claveNombre(uno.name) === claveNombre(otro.name)
      && uno.status === otro.status
      && (uno.activity || '') === (otro.activity || '')
      && (uno.avatar || '') === (otro.avatar || '');
  });
}
