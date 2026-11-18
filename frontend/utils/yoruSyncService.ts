/**
 * Sincronizar el progreso con el servidor de Yoru, el del PC de zams por Tailscale.
 *
 * Es el mismo trato que con Google Drive, con una diferencia que lo cambia todo para
 * quien lo usa: **no hay nada que configurar**. Entras con Discord —que ya es la
 * puerta de la app— y a partir de ahí tu biblioteca te sigue del PC al teléfono sola.
 * Ni direcciones, ni claves, ni una pantalla más de ajustes.
 *
 * Lo que se sube es lo mismo que se sube a Drive, `db.exportFullDatabase()`, y se
 * combina con el mismo `mergeDatabaseExports`. Reusar el combinador no es ahorro de
 * líneas: es que haya **un solo sitio** donde se decide qué copia de un libro gana.
 * Dos combinadores distintos para los mismos datos serían dos sitios donde perder
 * horas de lectura, y el segundo se descubriría tarde.
 *
 * El servidor no combina nada: guarda el bulto y lleva un contador de versiones. Si
 * entre que leemos y escribimos ha escrito otro aparato, contesta 409, y aquí se
 * vuelve a empezar con lo que haya. Por eso el bucle de abajo tiene reintentos: no es
 * desconfianza del servidor, es que dos teléfonos pueden leer a la vez.
 *
 * Nada de esto puede estorbar. Sin red, con el PC apagado o con el token caducado, la
 * app se abre y se lee igual; lo único que pasa es que el progreso espera.
 */

import { Capacitor } from '@capacitor/core';
import { db } from './db';
import { mergeDatabaseExports, countLiveBooks } from './cloudMerge';
import { leerSesion, tokenAccesoFresco } from './discordAuth';
import { serverRequest, ServerHttpError } from './serverHttp';
import { YORU_SYNC_DEFAULTS } from '../config/serverDefaults';
import {
  clasificarFallo,
  decidirSincronizacion,
  sesionServidorValida,
  urlSync,
  type EstadoSync,
  type Fallo,
  type SesionServidor,
} from './yoruSyncNucleo';

const CLAVE_SESION = 'yoru_sync_sesion';
const CLAVE_ULTIMA = 'yoru_sync_ultima';
const CLAVE_RECARGA = 'yoru_sync_recarga_at';

/** Cuántas veces se vuelve a intentar cuando otro aparato escribió entremedias. */
const REINTENTOS_DESFASE = 3;

export function urlServidorSync(): string {
  return (YORU_SYNC_DEFAULTS.serverUrl || '').trim();
}

/* ---------------------------------------------------------------- sesión guardada */

export function leerSesionServidor(): SesionServidor | null {
  try {
    const raw = localStorage.getItem(CLAVE_SESION);
    if (!raw) return null;
    const dato = JSON.parse(raw);
    if (!dato?.token) return null;
    return {
      token: String(dato.token),
      usuarioId: String(dato.usuarioId || ''),
      nombre: String(dato.nombre || ''),
      expiraEn: Number(dato.expiraEn) || 0,
    };
  } catch {
    return null;
  }
}

function guardarSesionServidor(sesion: SesionServidor | null): void {
  try {
    if (!sesion) localStorage.removeItem(CLAVE_SESION);
    else localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  } catch {
    /* Sin almacenamiento se pedirá un token nuevo en cada arranque. Molesta, no rompe. */
  }
}

export function ultimaSincronizacion(): number {
  return Number(localStorage.getItem(CLAVE_ULTIMA)) || 0;
}

function apuntarSincronizacion(ahora = Date.now()): void {
  try { localStorage.setItem(CLAVE_ULTIMA, String(ahora)); } catch { /* da igual */ }
}

/** Se cierra la sesión del servidor; la de Discord no se toca. */
export function olvidarSesionServidor(): void {
  guardarSesionServidor(null);
}

/* ------------------------------------------------------------- hablar al servidor */

function statusDe(error: unknown): number {
  return error instanceof ServerHttpError ? error.status : -1;
}

/**
 * Consigue un token del servidor, con el de Discord, y lo guarda.
 *
 * Devuelve `null` cuando no hay forma: sin sesión de Discord, con el servidor
 * apagado, o si Discord dice que esta cuenta no está en el servidor de Yoru. Quien
 * llama se encarga de que eso no estorbe.
 */
export async function abrirSesionServidor(): Promise<{ sesion: SesionServidor | null; fallo?: Fallo }> {
  const base = urlServidorSync();
  if (!base) return { sesion: null, fallo: 'otro' };

  const accessToken = await tokenAccesoFresco();
  if (!accessToken) return { sesion: null, fallo: 'otro' };

  try {
    const { data } = await serverRequest<{ token: string; expiraEn: number; usuarioId: string; nombre: string }>(
      urlSync(base, '/api/sesion'),
      { method: 'POST', body: { accessToken }, timeoutMs: 20_000 },
    );
    const sesion: SesionServidor = {
      token: String(data?.token || ''),
      usuarioId: String(data?.usuarioId || ''),
      nombre: String(data?.nombre || ''),
      expiraEn: Number(data?.expiraEn) || 0,
    };
    if (!sesion.token) return { sesion: null, fallo: 'otro' };
    guardarSesionServidor(sesion);
    return { sesion };
  } catch (error) {
    const fallo = clasificarFallo(statusDe(error));
    // Un «no eres miembro» no se arregla reintentando: se borra lo guardado y se deja
    // de molestar al servidor hasta que haya otra sesión de Discord.
    if (fallo === 'no-miembro') guardarSesionServidor(null);
    console.warn('[yoru-sync] no se pudo abrir sesión:', error instanceof Error ? error.message : String(error));
    return { sesion: null, fallo };
  }
}

/** La sesión guardada si vale, y si no una nueva. */
async function sesionUsable(): Promise<SesionServidor | null> {
  const guardada = leerSesionServidor();
  if (sesionServidorValida(guardada, Date.now())) return guardada;
  return (await abrirSesionServidor()).sesion;
}

interface ProgresoRemoto {
  version: number;
  actualizadoEn: number;
  datos: any | null;
}

async function bajarProgreso(base: string, sesion: SesionServidor): Promise<ProgresoRemoto> {
  const { data } = await serverRequest<ProgresoRemoto>(urlSync(base, '/api/progreso'), {
    headers: { Authorization: `Bearer ${sesion.token}` },
    timeoutMs: 30_000,
  });
  return {
    version: Number(data?.version) || 0,
    actualizadoEn: Number(data?.actualizadoEn) || 0,
    datos: data?.datos ?? null,
  };
}

async function subirProgreso(base: string, sesion: SesionServidor, datos: any, baseVersion: number): Promise<number> {
  const { data } = await serverRequest<{ version: number }>(urlSync(base, '/api/progreso'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${sesion.token}` },
    body: { baseVersion, datos },
    timeoutMs: 60_000,
  });
  return Number(data?.version) || 0;
}

/* ------------------------------------------------------------ la sincronización */

export type ModoSync =
  /** Combinar y aplicar aquí lo que venga del servidor, y subir el resultado. */
  | 'bidireccional'
  /** Subir lo que falte en el servidor sin tocar nada de este aparato. */
  | 'solo-subir';

export interface ResultadoSync {
  /** `adelante` cuando se llegó a hablar con el servidor; si no, por qué no. */
  estado: EstadoSync;
  /** Si lo que hay en el aparato cambió y conviene recargar la pantalla. */
  cambioLocal: boolean;
  /** Si se escribió algo nuevo en el servidor. */
  subido: boolean;
  fallo?: Fallo;
}

let enMarcha = false;

/**
 * Combina el progreso de este aparato con el del servidor.
 *
 * `solo-subir` existe para el momento en que la app se va al fondo: ahí interesa dejar
 * a salvo lo recién leído, pero **no** tocar los datos de una app que el usuario puede
 * volver a traer al frente en dos segundos. Cambiarle la biblioteca por debajo
 * mientras no mira es la clase de cosa que parece un fallo aunque sea correcta.
 */
export async function sincronizarConServidorYoru(
  modo: ModoSync = 'bidireccional',
  opciones: { forzada?: boolean } = {},
): Promise<ResultadoSync> {
  const base = urlServidorSync();
  const estado = decidirSincronizacion({
    urlServidor: base,
    haySesionDiscord: Boolean(leerSesion()?.refreshToken),
    hayRed: typeof navigator === 'undefined' || navigator.onLine !== false,
    ahora: Date.now(),
    ultimaSubida: ultimaSincronizacion(),
    forzada: opciones.forzada ?? modo === 'bidireccional',
  });
  if (estado !== 'adelante') return { estado, cambioLocal: false, subido: false };

  // Dos sincronizaciones a la vez se pisarían al escribir; la segunda espera su turno
  // en el siguiente intervalo, que llega enseguida.
  if (enMarcha) return { estado: 'muy-pronto', cambioLocal: false, subido: false };
  enMarcha = true;

  try {
    let sesion = await sesionUsable();
    if (!sesion) return { estado: 'adelante', cambioLocal: false, subido: false, fallo: 'servidor-no-responde' };

    let cambioLocal = false;
    let subido = false;

    for (let intento = 0; intento < REINTENTOS_DESFASE; intento++) {
      const remoto = await bajarProgreso(base, sesion);
      const local = await db.exportFullDatabase();

      // Primera vez de esta cuenta: no hay nada que combinar, solo que subir.
      if (!remoto.datos) {
        await subirProgreso(base, sesion, local, remoto.version);
        apuntarSincronizacion();
        return { estado: 'adelante', cambioLocal: false, subido: true };
      }

      const { merged, localChanged, cloudChanged } = mergeDatabaseExports(
        local,
        remoto.datos,
        remoto.actualizadoEn > ultimaSincronizacion(),
      );

      if (localChanged && modo === 'bidireccional') {
        // La copia de antes de tocar nada, igual que con Drive: si la combinación
        // saliera mal, lo de este aparato sigue estando entero en alguna parte.
        await db.saveSyncBackup(local);
        await db.importFullDatabase(merged);
        cambioLocal = true;
      }

      if (cloudChanged) {
        if (countLiveBooks(merged) < countLiveBooks(remoto.datos)) {
          throw new Error('No se sube una biblioteca con menos libros que la del servidor');
        }
        try {
          await subirProgreso(base, sesion, merged, remoto.version);
          subido = true;
        } catch (error) {
          const fallo = clasificarFallo(statusDe(error));
          // Otro aparato escribió mientras combinábamos: se vuelve a empezar con lo
          // que haya ahora. Es lo normal cuando se lee en el PC y en el móvil a la vez.
          if (fallo === 'desfase' && intento < REINTENTOS_DESFASE - 1) continue;
          // El token caducó entre medias: se pide otro y se repite.
          if (fallo === 'sesion-caducada' && intento < REINTENTOS_DESFASE - 1) {
            const nueva = await abrirSesionServidor();
            if (!nueva.sesion) return { estado: 'adelante', cambioLocal, subido, fallo: nueva.fallo };
            sesion = nueva.sesion;
            continue;
          }
          throw error;
        }
      }

      if (modo === 'bidireccional' || !localChanged) apuntarSincronizacion();
      return { estado: 'adelante', cambioLocal, subido };
    }

    return { estado: 'adelante', cambioLocal, subido, fallo: 'desfase' };
  } catch (error) {
    const fallo = clasificarFallo(statusDe(error));
    if (fallo === 'no-miembro') olvidarSesionServidor();
    console.warn('[yoru-sync]', error instanceof Error ? error.message : String(error));
    return { estado: 'adelante', cambioLocal: false, subido: false, fallo };
  } finally {
    enMarcha = false;
  }
}

/**
 * Recarga la pantalla cuando la combinación trajo cosas de otro aparato.
 *
 * Como mucho una vez por minuto: si una combinación saliera mal y marcara cambios en
 * cada vuelta, sin este tope la app se quedaría recargándose sola para siempre y no
 * habría forma de llegar a Ajustes a apagarla.
 */
export function recargarSiHizoFalta(resultado: ResultadoSync): void {
  if (!resultado.cambioLocal) return;
  const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA)) || 0;
  if (Date.now() - ultima <= 60_000) return;
  try { sessionStorage.setItem(CLAVE_RECARGA, String(Date.now())); } catch { /* da igual */ }
  console.log('[yoru-sync] progreso combinado con el servidor de Yoru');
  window.location.reload();
}

/** Si esta plataforma puede sincronizar. Hoy todas; queda explícito por si cambia. */
export function sincronizacionDisponible(): boolean {
  return Boolean(urlServidorSync()) && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'web' || Capacitor.getPlatform() === 'electron');
}

/* --------------------------------------------- qué están leyendo los demás */

/** Lo que el servidor cuenta de otro miembro. Un libro y un porcentaje, nada más. */
export interface FichaMiembro {
  usuarioId: string;
  nombre: string;
  /** Cuándo subió su progreso por última vez, en milisegundos desde época. */
  actualizadoEn: number;
  /** Si comparte lo que lee. Falso también cuando el libro está en su lista negra. */
  comparte: boolean;
  leyendo: {
    titulo: string;
    autor: string;
    portada: string;
    capitulo: string;
    porcentaje: number;
    ultimaLectura: number;
  } | null;
}

/**
 * Qué está leyendo cada miembro, para la tarjeta de Miembros.
 *
 * Devuelve la lista vacía en vez de lanzar: esto adorna una pantalla, no la sostiene,
 * y que el PC de zams esté apagado no puede dejar a nadie sin ver a su gente.
 */
export async function fichasDeMiembros(): Promise<FichaMiembro[]> {
  const base = urlServidorSync();
  if (!base) return [];
  const sesion = await sesionUsable();
  if (!sesion) return [];
  try {
    const { data } = await serverRequest<{ miembros: FichaMiembro[] }>(urlSync(base, '/api/miembros'), {
      headers: { Authorization: `Bearer ${sesion.token}` },
    });
    return Array.isArray(data?.miembros) ? data.miembros : [];
  } catch (error) {
    console.warn('[yoru-sync] miembros:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

/** Lo mismo para uno solo. `null` si no ha sincronizado nunca o no se pudo preguntar. */
export async function fichaDeMiembro(usuarioId: string): Promise<FichaMiembro | null> {
  const base = urlServidorSync();
  if (!base || !usuarioId) return null;
  const sesion = await sesionUsable();
  if (!sesion) return null;
  try {
    const { data } = await serverRequest<FichaMiembro>(urlSync(base, `/api/progreso/${encodeURIComponent(usuarioId)}`), {
      headers: { Authorization: `Bearer ${sesion.token}` },
    });
    return data?.usuarioId ? data : null;
  } catch {
    return null;
  }
}
