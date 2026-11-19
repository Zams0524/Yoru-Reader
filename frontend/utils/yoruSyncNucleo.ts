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

/* ------------------------------------------------------------------ los perfiles */

/** Lo que hace falta mirar de una exportación para decidir sobre sus perfiles. */
export interface ExportacionConPerfiles {
  activeProfileId?: string | null;
  profiles?: { id: string; name?: string; [clave: string]: any }[];
  profileData?: Record<string, any>;
  [clave: string]: any;
}

/**
 * Si un perfil no guarda nada que se pueda perder: ni un libro (los borrados cuentan,
 * que llevan estadísticas), ni una palabra marcada, ni una tarjeta del SRS.
 */
export function perfilSinNada(datos: any): boolean {
  if (!datos) return true;
  if ((datos.books || []).length > 0) return false;
  if (Object.keys(datos.wordStatuses || {}).length > 0) return false;
  // Las claves `_deck_…` son mazos, no tarjetas: un mazo vacío no es progreso.
  return !Object.keys(datos.srsData || {}).some((clave) => !clave.startsWith('_deck_'));
}

export interface PerfilesReconciliados<T> {
  local: T;
  remoto: T;
  /** Hubo que quitar un perfil o cambiar el activo en este aparato. */
  cambioLocal: boolean;
  /** Lo mismo en la copia del servidor. */
  cambioRemoto: boolean;
}

/**
 * Quita los perfiles vacíos que son la misma persona que otro, antes de combinar.
 *
 * El perfil se crea solo al entrar con Discord, con un identificador nuevo en cada
 * instalación (`profile-<fecha>`), y el combinador junta los perfiles **por
 * identificador**. Así que quien borraba los datos de la app, o la instalaba en otro
 * aparato, recibía su progreso del servidor… en un perfil aparte, mientras el activo
 * seguía siendo el recién creado y vacío: Inicio en blanco con todo guardado al lado
 * (zams, 19 nov 2026).
 *
 * La cuenta de Discord es una, así que un perfil vacío con el mismo nombre que otro
 * es ese otro. Se quita el vacío y, si era el activo, pasa a serlo el que tiene los
 * datos. Solo se quitan perfiles **sin nada dentro**: dos perfiles con datos no se
 * funden aquí, porque eso no tiene vuelta atrás y puede que estén separados aposta.
 *
 * Se limpia en los dos lados a la vez; si no, el combinador volvería a traer del
 * servidor el perfil que se acaba de quitar aquí.
 */
export function reconciliarPerfiles<T extends ExportacionConPerfiles>(local: T, remoto: T): PerfilesReconciliados<T> {
  const perfilesLocal = local.profiles || [];
  const perfilesRemoto = remoto.profiles || [];
  const enLocal = new Set(perfilesLocal.map((p) => p.id));
  const enRemoto = new Set(perfilesRemoto.map((p) => p.id));
  const todos = [...perfilesRemoto, ...perfilesLocal.filter((p) => !enRemoto.has(p.id))];

  const vacio = (id: string) => perfilSinNada(local.profileData?.[id]) && perfilSinNada(remoto.profileData?.[id]);
  const nombre = (perfil: { name?: string }) => String(perfil.name || '').trim().toLowerCase();

  /** De varios candidatos, el que se queda. El mismo en todos los aparatos. */
  const elegir = (candidatos: string[]): string => {
    const activoRemoto = remoto.activeProfileId || '';
    if (candidatos.includes(activoRemoto)) return activoRemoto;
    const delServidor = candidatos.filter((id) => enRemoto.has(id)).sort();
    return delServidor[0] ?? [...candidatos].sort()[0];
  };

  /** Perfil que sobra → perfil que se queda en su lugar. */
  const destino = new Map<string, string>();

  const porNombre = new Map<string, string[]>();
  for (const perfil of todos) {
    const clave = nombre(perfil);
    if (!clave) continue;
    porNombre.set(clave, [...(porNombre.get(clave) || []), perfil.id]);
  }
  for (const ids of porNombre.values()) {
    if (ids.length < 2) continue;
    const llenos = ids.filter((id) => !vacio(id));
    const queda = elegir(llenos.length > 0 ? llenos : ids);
    for (const id of ids) {
      if (id !== queda && vacio(id)) destino.set(id, queda);
    }
  }

  /*
    Aparato recién estrenado cuyo perfil no se llama igual que el del servidor (el
    nombre de Discord cambió entre medias): su único perfil, vacío y desconocido para
    el servidor, sigue siendo el de la misma cuenta.
  */
  if (perfilesLocal.length === 1 && perfilesRemoto.length > 0) {
    const unico = perfilesLocal[0].id;
    if (!enRemoto.has(unico) && !destino.has(unico) && vacio(unico)) {
      destino.set(unico, elegir(perfilesRemoto.map((p) => p.id)));
    }
  }

  if (destino.size === 0) return { local, remoto, cambioLocal: false, cambioRemoto: false };

  const limpiar = (lado: T, presentes: Set<string>): { lado: T; cambio: boolean } => {
    const activo = lado.activeProfileId || '';
    const cambio = [...destino.keys()].some((id) => presentes.has(id)) || destino.has(activo);
    if (!cambio) return { lado, cambio };
    const profileData = { ...(lado.profileData || {}) };
    for (const id of destino.keys()) delete profileData[id];
    return {
      cambio,
      lado: {
        ...lado,
        activeProfileId: destino.get(activo) ?? lado.activeProfileId,
        profiles: (lado.profiles || []).filter((p) => !destino.has(p.id)),
        profileData,
      },
    };
  };

  const l = limpiar(local, enLocal);
  const r = limpiar(remoto, enRemoto);
  return { local: l.lado, remoto: r.lado, cambioLocal: l.cambio, cambioRemoto: r.cambio };
}
