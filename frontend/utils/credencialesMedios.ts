/**
 * Las claves de Kavita y de Audiobookshelf, pedidas al servidor de Yoru.
 *
 * Antes venían escritas dentro de la app, en `config/serverDefaults.ts`. Eso tenía una
 * virtud enorme —la app se abría ya configurada, sin pedirle a nadie una dirección ni
 * una clave— y un defecto que acabó pesando más: el repositorio es público, así que
 * una clave escrita ahí es una clave publicada, y encima para siempre, porque queda en
 * el historial de git aunque luego se borre.
 *
 * Mientras Kavita y Audiobookshelf solo escuchaban en `localhost` casi no importaba:
 * tener la clave no servía de nada sin una dirección a la que ir. Al publicarlos con
 * Tailscale Funnel, dirección y clave quedaban las dos publicadas, y eso ya es dejar
 * la puerta abierta.
 *
 * Así que las claves se mudaron al servidor de sincronización, que vive en el PC de
 * zams y ya sabe quién es miembro del Discord de Yoru, porque es lo que comprueba para
 * guardar el progreso. Ahora las reparte por `GET /api/medios`, que exige sesión. La
 * app se sigue abriendo configurada sin que nadie escriba nada —que era lo bueno— pero
 * la puerta pasa de «saber leer GitHub» a «ser miembro».
 *
 * Lo que esto **no** arregla, y conviene no olvidarlo: la clave acaba en el aparato
 * del miembro, porque es su propia app la que habla con Kavita. Quien abra las
 * herramientas del navegador la verá. Para que no saliera nunca del PC habría que
 * hacer pasar el tráfico de los medios por el servidor de Yoru; está anotado en
 * `servidor-sync/README.md` como el siguiente paso.
 *
 * Nada de esto puede estorbar. Sin red, con el PC apagado o sin ser miembro, la app se
 * abre y se lee igual: lo único que pasa es que los servidores de medios aparecen sin
 * configurar, que es exactamente lo que pasaba antes de que existieran.
 */

import { serverRequest } from './serverHttp';
import { urlServidorSync, leerSesionServidor, abrirSesionServidor } from './yoruSyncService';
import { urlSync, sesionServidorValida } from './yoruSyncNucleo';

const CLAVE = 'yoru_medios_fabrica';

/**
 * Cada cuánto se vuelve a preguntar.
 *
 * Doce horas es un equilibrio: si zams rota una clave, el aparato de un miembro se
 * entera dentro del día sin tener que reinstalar nada, y mientras tanto no se molesta
 * al servidor en cada arranque. Una clave rotada deja de valer en el momento, así que
 * lo peor que pasa en esas horas es que el servidor diga que no y la pantalla lo cuente.
 */
const VIGENCIA_MS = 12 * 60 * 60 * 1000;

export interface CredencialKavita {
  serverUrl: string;
  apiKey: string;
}

export interface CredencialAudiobookshelf {
  serverUrl: string;
  token: string;
}

export interface CredencialesMedios {
  kavita: CredencialKavita | null;
  audiobookshelf: CredencialAudiobookshelf | null;
  /** Cuándo se pidieron, en milisegundos, para saber si toca volver a preguntar. */
  pedidasEn: number;
}

const VACIAS: CredencialesMedios = { kavita: null, audiobookshelf: null, pedidasEn: 0 };

/* ------------------------------------------------------------------ lo guardado */

/**
 * Lo último que dijo el servidor.
 *
 * Es síncrono a propósito: lo llaman `getKavitaConfig()` y
 * `getAudiobookshelfConfig()`, que no pueden esperar porque los usa media interfaz.
 * Quien refresca es `asegurarCredencialesMedios()`, al arrancar.
 */
export function leerCredencialesMedios(): CredencialesMedios {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return VACIAS;
    const dato = JSON.parse(raw);
    return {
      kavita: credencial(dato?.kavita, 'apiKey') as CredencialKavita | null,
      audiobookshelf: credencial(dato?.audiobookshelf, 'token') as CredencialAudiobookshelf | null,
      pedidasEn: Number(dato?.pedidasEn) || 0,
    };
  } catch {
    // Sin almacenamiento, o con basura dentro, se actúa como si no hubiera nada: la
    // app pide configurar los servidores a mano y se sigue leyendo igual.
    return VACIAS;
  }
}

/**
 * Una credencial solo cuenta si trae dirección **y** clave.
 *
 * Media credencial es peor que ninguna: dejaría a la app creyéndose configurada para
 * fallar en cada petición, y al usuario mirando una pantalla que dice «no responde»
 * sin nada que tocar.
 */
function credencial(bruto: unknown, campo: 'apiKey' | 'token'): CredencialKavita | CredencialAudiobookshelf | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const dato = bruto as Record<string, unknown>;
  const serverUrl = String(dato.serverUrl || '').trim().replace(/\/+$/, '');
  const secreto = String(dato[campo] || '').trim();
  if (!serverUrl || !secreto) return null;
  return campo === 'apiKey'
    ? { serverUrl, apiKey: secreto }
    : { serverUrl, token: secreto };
}

function guardar(credenciales: CredencialesMedios): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(credenciales));
  } catch {
    /* Sin almacenamiento se vuelve a preguntar en el siguiente arranque. Molesta, no rompe. */
  }
}

/** Al cerrar la sesión del servidor, las claves que dio se van con ella. */
export function olvidarCredencialesMedios(): void {
  try { localStorage.removeItem(CLAVE); } catch { /* da igual */ }
  avisarALaInterfaz();
}

/**
 * El mismo aviso que lanza `saveKavitaConfig()`, para que la pantalla de servidores se
 * vuelva a leer sola cuando las claves llegan un segundo después del arranque.
 */
function avisarALaInterfaz(): void {
  try { window.dispatchEvent(new Event('yoru-media-servers-changed')); } catch { /* fuera del navegador */ }
}

/* ---------------------------------------------------------- hablar al servidor */

/**
 * Pide las claves al servidor y las guarda. Devuelve lo que haya quedado guardado.
 *
 * No lanza nunca: cualquier fallo deja lo de antes tal cual y se vuelve a intentar en
 * el siguiente arranque. Un servidor apagado no puede dejar a nadie sin biblioteca
 * local.
 */
export async function refrescarCredencialesMedios(): Promise<CredencialesMedios> {
  const base = urlServidorSync();
  if (!base) return leerCredencialesMedios();

  const guardada = leerSesionServidor();
  const sesion = sesionServidorValida(guardada, Date.now())
    ? guardada
    : (await abrirSesionServidor()).sesion;
  if (!sesion) return leerCredencialesMedios();

  try {
    const { data } = await serverRequest<{ kavita?: unknown; audiobookshelf?: unknown }>(
      urlSync(base, '/api/medios'),
      { headers: { Authorization: `Bearer ${sesion.token}` }, timeoutMs: 20_000 },
    );
    const credenciales: CredencialesMedios = {
      kavita: credencial(data?.kavita, 'apiKey') as CredencialKavita | null,
      audiobookshelf: credencial(data?.audiobookshelf, 'token') as CredencialAudiobookshelf | null,
      pedidasEn: Date.now(),
    };
    guardar(credenciales);
    avisarALaInterfaz();
    return credenciales;
  } catch (error) {
    console.warn('[yoru-medios] no se pudieron pedir las claves:', error instanceof Error ? error.message : String(error));
    return leerCredencialesMedios();
  }
}

/**
 * Lo que llama la app al arrancar: refresca solo si hace falta.
 *
 * «Hace falta» es no tener nada o tenerlo viejo. Lo primero es el arranque tras
 * instalar; lo segundo, que zams haya rotado una clave desde ayer.
 */
export async function asegurarCredencialesMedios(): Promise<CredencialesMedios> {
  const guardadas = leerCredencialesMedios();
  const tieneAlgo = Boolean(guardadas.kavita || guardadas.audiobookshelf);
  const fresco = guardadas.pedidasEn > 0 && Date.now() - guardadas.pedidasEn < VIGENCIA_MS;
  if (tieneAlgo && fresco) return guardadas;
  return refrescarCredencialesMedios();
}
