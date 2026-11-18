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
 * Añade a la lista a quien está usando Yoru ahora mismo.
 *
 * Esto es lo que arregla el «En línea · 0» estando uno delante de la pantalla. El
 * widget de Discord publica a muy poca gente, pero de una persona tenemos certeza
 * absoluta: la que tiene la app abierta. Así que se la pone, y punto.
 *
 * Si el widget sí la trae, **manda el widget**: su estado y su actividad son los de
 * Discord de verdad, y aquí solo sabríamos decir «en línea». Lo único que se conserva
 * de lo nuestro es la foto, porque la del perfil ya está descargada y la del widget
 * puede tardar.
 */
export function conmigoDentro(
  delWidget: DiscordMember[],
  yo: { nombre: string; avatar?: string; actividad?: string } | null,
): DiscordMember[] {
  if (!yo || !claveNombre(yo.nombre)) return delWidget;

  const miClave = claveNombre(yo.nombre);
  const indice = delWidget.findIndex((m) => claveNombre(m.name) === miClave);

  if (indice >= 0) {
    const copia = [...delWidget];
    copia[indice] = { ...delWidget[indice], avatar: yo.avatar || delWidget[indice].avatar };
    return copia;
  }

  const mio: DiscordMember = {
    id: `yo:${miClave}`,
    name: yo.nombre,
    status: 'online',
    avatar: yo.avatar || '',
    activity: yo.actividad || '',
  };

  return [mio, ...delWidget];
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
