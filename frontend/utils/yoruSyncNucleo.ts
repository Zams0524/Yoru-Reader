/**
 * Las decisiones de la sincronización con el servidor de Yoru, sin red ni almacenamiento.
 *
 * Aparte, igual que `discordAccess.ts`, y por el mismo motivo: aquí es donde un
 * despiste se convierte en «he perdido por dónde iba». Que estas funciones sean puras
 * permite probarlas de verdad y leerlas de un tirón, sin un `fetch` en medio.
 *
 * La regla que gobierna el fichero entero: **la sincronización nunca estorba**. Si no
 * hay red, si el PC de zams está apagado, si el token caducó, la app sigue abriéndose
 * y leyéndose igual. Esto guarda el progreso; no es la puerta de entrada, que esa ya
 * la lleva `discordAccess.ts`.
 */

/** Cada cuánto se sube el progreso estando la app abierta. */
export const INTERVALO_SUBIDA_MS = 5 * 60 * 1000;

/** Margen con el que se da por caducado el token del servidor, para no apurar. */
export const MARGEN_TOKEN_MS = 60 * 1000;

/** Lo que se guarda del servidor en el aparato. Nada del token de Discord. */
export interface SesionServidor {
  token: string;
  usuarioId: string;
  nombre: string;
  /** Cuándo caduca el token del servidor, en milisegundos desde época. */
  expiraEn: number;
}

export type EstadoSync =
  /** Se puede sincronizar ahora. */
  | 'adelante'
  /** No hay dirección de servidor puesta: la función está apagada. */
  | 'apagado'
  /** No se ha entrado con Discord, así que no hay con qué identificarse. */
  | 'sin-discord'
  /** El aparato dice que no hay red. */
  | 'sin-red'
  /** Se sincronizó hace nada; no hace falta volver. */
  | 'muy-pronto';

export interface DatosDecision {
  urlServidor: string;
  haySesionDiscord: boolean;
  hayRed: boolean;
  ahora: number;
  ultimaSubida: number;
  /** Una sincronización que el usuario pidió, o la de abrir la app: no espera turno. */
  forzada: boolean;
}

/**
 * Si toca sincronizar y, si no, por qué no.
 *
 * El orden importa: primero lo que no depende de nada (configuración, sesión), luego
 * la red, y el ritmo al final, para que una sincronización pedida a mano no se quede
 * esperando un turno que no le hace falta.
 */
export function decidirSincronizacion({
  urlServidor,
  haySesionDiscord,
  hayRed,
  ahora,
  ultimaSubida,
  forzada,
}: DatosDecision): EstadoSync {
  if (!urlServidor.trim()) return 'apagado';
  if (!haySesionDiscord) return 'sin-discord';
  if (!hayRed) return 'sin-red';
  if (forzada) return 'adelante';
  if (ultimaSubida > 0 && ahora - ultimaSubida < INTERVALO_SUBIDA_MS) return 'muy-pronto';
  return 'adelante';
}

/** Si el token del servidor sigue valiendo. */
export function sesionServidorValida(sesion: SesionServidor | null, ahora: number): boolean {
  if (!sesion?.token) return false;
  return sesion.expiraEn - MARGEN_TOKEN_MS > ahora;
}

export type Fallo =
  /** Esta cuenta no está en el servidor de Discord de Yoru. */
  | 'no-miembro'
  /** El token del servidor ya no vale: hay que pedir otro. */
  | 'sesion-caducada'
  /** Otro aparato escribió entremedias: hay que volver a combinar. */
  | 'desfase'
  /** El servidor no contesta, o contestó mal. No es culpa del lector. */
  | 'servidor-no-responde'
  | 'otro';

/**
 * Qué significa un código de respuesta del servidor.
 *
 * Importa distinguir «caducó el token» de «no eres miembro»: lo primero se arregla
 * solo pidiendo otro token, y lo segundo no se arregla reintentando, así que
 * confundirlos deja a la app dando vueltas contra un servidor que ya dijo que no.
 */
export function clasificarFallo(status: number): Fallo {
  if (status === 401) return 'sesion-caducada';
  if (status === 403) return 'no-miembro';
  if (status === 409) return 'desfase';
  if (status === 0 || status === 502 || status === 503 || status === 504) return 'servidor-no-responde';
  return 'otro';
}

/** La dirección completa de una ruta del servidor, sin barras de más ni de menos. */
export function urlSync(base: string, ruta: string): string {
  const raiz = base.trim().replace(/\/+$/, '');
  return `${raiz}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}

/** Texto corto en español para enseñar en Ajustes. Nunca culpa al lector. */
export function describirEstado(estado: EstadoSync | 'sincronizando' | 'al-dia' | Fallo): string {
  switch (estado) {
    case 'adelante':
    case 'sincronizando': return 'Sincronizando…';
    case 'al-dia': return 'Al día';
    case 'apagado': return 'Desactivada';
    case 'sin-discord': return 'Entra con Discord para sincronizar';
    case 'sin-red': return 'Sin conexión; se sincronizará al volver';
    case 'muy-pronto': return 'Al día';
    case 'no-miembro': return 'Esta cuenta no está en el servidor de Yoru';
    case 'sesion-caducada': return 'Volviendo a identificarse…';
    case 'desfase': return 'Combinando con lo que hay en el servidor…';
    case 'servidor-no-responde': return 'El servidor de Yoru no responde ahora mismo';
    default: return 'No se pudo sincronizar';
  }
}
