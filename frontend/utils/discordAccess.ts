/**
 * Quién puede usar Yoru: la decisión, sin tocar la red ni el almacenamiento.
 *
 * Yoru es para los miembros del servidor de Discord de Yoru, así que al arrancar hay
 * que responder una pregunta con trampa: «¿este que abre la app es miembro?». La
 * respuesta de verdad la tiene Discord, y Discord no siempre está: hay aviones, hay
 * túneles, y hay madrugadas en las que su API devuelve 500. Un lector que pagó su
 * tiempo leyendo no puede quedarse fuera de su propia biblioteca porque el servidor
 * de otro se cayó.
 *
 * De ahí la regla, que es toda la gracia de este fichero: **manda la última
 * comprobación que salió bien**. Si hace menos de una semana que Discord dijo «sí, es
 * miembro», se entra sin preguntar nada. Solo cuando esa respuesta envejece más de la
 * cuenta, y encima no hay forma de renovarla, se cierra la puerta. Y un fallo de
 * Discord nunca expulsa a nadie: no saber no es lo mismo que saber que no.
 *
 * Todo esto vive aparte, en funciones puras, por dos razones. Una, que se pueda
 * probar de verdad: decidir quién entra es exactamente el sitio donde un despiste se
 * convierte en «no puedo abrir mis libros». Dos, que se lea de un tirón, sin `fetch`
 * ni `localStorage` en medio.
 */

/** Cuánto vale una comprobación buena antes de que haya que repetirla. */
export const MARGEN_SIN_COMPROBAR_MS = 7 * 24 * 60 * 60 * 1000;

/** Cada cuánto se vuelve a preguntar a Discord teniendo red: una vez al día basta. */
export const RECOMPROBAR_CADA_MS = 24 * 60 * 60 * 1000;

/** Lo que se guarda en el aparato de la sesión de Discord. Nada de la lista de servidores. */
export interface SesionDiscord {
  accessToken: string;
  refreshToken: string;
  /** Cuándo caduca el token de acceso, en milisegundos desde época. */
  expiraEn: number;
  usuarioId: string;
  usuarioNombre: string;
  /** Última vez que Discord confirmó que sí es miembro. 0 si nunca. */
  ultimaComprobacionOk: number;
  /** Si la última respuesta clara de Discord fue «no está en el servidor». */
  noEsMiembro?: boolean;
}

export type EstadoAcceso =
  /** Adelante. */
  | 'permitido'
  /** No hay Client ID puesto: la app está mal configurada, y hay que decirlo. */
  | 'falta-config'
  /** Nadie ha entrado todavía, o cerró sesión. */
  | 'sin-sesion'
  /** Discord dijo claramente que esta cuenta no está en el servidor. */
  | 'no-es-miembro'
  /** Hay sesión, pero la comprobación caducó y no hay forma de renovarla ahora. */
  | 'sin-conexion';

export interface DatosDecision {
  sesion: SesionDiscord | null;
  /** Client ID configurado (constante o variable de build). Vacío = falta. */
  clientId: string;
  ahora: number;
  /** Lo que el aparato cree de su propia conexión. */
  hayRed: boolean;
}

/**
 * Si se entra o no, y por qué.
 *
 * El orden importa. Primero lo que no depende de nadie (configuración, sesión), luego
 * el «no» explícito de Discord, y solo al final la caducidad: así un miembro de hace
 * tres días no pasa por ninguna comprobación de red.
 */
export function decidirAcceso({ sesion, clientId, ahora, hayRed }: DatosDecision): EstadoAcceso {
  if (!clientId.trim()) return 'falta-config';
  if (!sesion || !sesion.refreshToken) return 'sin-sesion';

  // Un «no» de Discord es un «no» mientras no haya otra sesión: no caduca a favor.
  if (sesion.noEsMiembro) return 'no-es-miembro';

  const frescura = ahora - sesion.ultimaComprobacionOk;
  if (sesion.ultimaComprobacionOk > 0 && frescura < MARGEN_SIN_COMPROBAR_MS) return 'permitido';

  // La comprobación ya no vale. Con red se puede renovar, así que se deja pasar y la
  // app vuelve a preguntar por detrás; sin red no hay manera, y ahí sí se para.
  return hayRed ? 'permitido' : 'sin-conexion';
}

/**
 * Si toca volver a preguntar a Discord al arrancar.
 *
 * Sin red no se intenta, para no gastar una petición condenada. Y si la última
 * comprobación es de hace un rato corto, tampoco: se pregunta como mucho una vez al
 * día, que es lo que pidió zams.
 */
export function tocaRecomprobar({ sesion, hayRed, ahora }: { sesion: SesionDiscord | null; hayRed: boolean; ahora: number }): boolean {
  if (!sesion || !sesion.refreshToken || !hayRed) return false;
  if (sesion.noEsMiembro) return false;
  return ahora - sesion.ultimaComprobacionOk >= RECOMPROBAR_CADA_MS;
}

/** Si el token de acceso ya no sirve (o le queda tan poco que no merece usarse). */
export function tokenCaducado(sesion: SesionDiscord, ahora: number, margenMs = 60_000): boolean {
  return sesion.expiraEn - margenMs <= ahora;
}

/** Qué contesta Discord cuando se le pregunta por los servidores de alguien. */
export type RespuestaMembresia =
  /** Está en el servidor. */
  | { tipo: 'miembro' }
  /** No está. Respuesta clara, no un fallo. */
  | { tipo: 'no-miembro' }
  /** No se pudo saber: sin red, 5xx, límite de peticiones. */
  | { tipo: 'indeterminado' }
  /** El token no vale y no se pudo renovar: hay que volver a entrar. */
  | { tipo: 'sesion-invalida' };

/**
 * Cómo queda la sesión guardada después de preguntar a Discord.
 *
 * Aquí está la parte que de verdad protege al lector: con `indeterminado` **no se
 * toca nada**. No se apunta el fallo, no se mueve la fecha, no se marca a nadie como
 * intruso. La sesión sigue exactamente como estaba, así que el margen de los siete
 * días se gasta igual que antes de preguntar y quien estaba dentro sigue dentro.
 */
export function aplicarRespuesta(
  sesion: SesionDiscord,
  respuesta: RespuestaMembresia,
  ahora: number,
): SesionDiscord | null {
  if (respuesta.tipo === 'miembro') {
    return { ...sesion, ultimaComprobacionOk: ahora, noEsMiembro: false };
  }
  if (respuesta.tipo === 'no-miembro') {
    return { ...sesion, noEsMiembro: true };
  }
  // Se cierra la sesión: el token ya no vale para nada.
  if (respuesta.tipo === 'sesion-invalida') return null;
  return sesion;
}
