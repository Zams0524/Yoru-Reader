/**
 * La alineación de un audiolibro, pedida al servidor de Yoru.
 *
 * Hasta ahora la alineación solo entraba a mano: había que generar un `.srt` en un
 * ordenador con el alineador e importarlo libro por libro desde el reproductor. Eso
 * funciona, pero nadie que abre «Leer y escuchar» espera tener que hacerlo: espera que
 * suene el audio y se resalte el texto.
 *
 * Ahora el generador corre en el PC donde viven los EPUB y los audios, deja un `.srt`
 * por audiolibro en el servidor de sincronización, y la app lo pide por el id del
 * audiolibro en cuanto se abre el reproductor. Importar a mano sigue estando, para
 * quien tenga un audiolibro que no venga del servidor.
 *
 * No lanza nunca. Sin red, sin sesión o sin alineación generada todavía, el lector
 * se queda como estaba: con el audio sonando y sin resaltado.
 */

import { serverRequest, ServerHttpError } from './serverHttp';
import { urlServidorSync, leerSesionServidor, abrirSesionServidor } from './yoruSyncService';
import { urlSync, sesionServidorValida } from './yoruSyncNucleo';

export type AlineacionRemota =
  | { tipo: 'ok'; srt: string; nombre: string }
  /** El servidor contestó y no la tiene: ese audiolibro aún no se ha alineado. */
  | { tipo: 'no-hay' }
  /** No se pudo preguntar (sin red, sin sesión, servidor apagado). */
  | { tipo: 'sin-respuesta' };

export async function descargarAlineacion(itemId: string): Promise<AlineacionRemota> {
  const base = urlServidorSync();
  if (!base || !/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return { tipo: 'sin-respuesta' };

  const guardada = leerSesionServidor();
  const sesion = sesionServidorValida(guardada, Date.now())
    ? guardada
    : (await abrirSesionServidor()).sesion;
  if (!sesion) return { tipo: 'sin-respuesta' };

  try {
    const { data } = await serverRequest<{ srt?: unknown }>(
      urlSync(base, `/api/alineacion/${itemId}`),
      { headers: { Authorization: `Bearer ${sesion.token}` }, timeoutMs: 30_000 },
    );
    const srt = typeof data?.srt === 'string' ? data.srt : '';
    if (!srt.trim()) return { tipo: 'no-hay' };
    return { tipo: 'ok', srt, nombre: `${itemId}.srt` };
  } catch (error) {
    if (error instanceof ServerHttpError && error.status === 404) return { tipo: 'no-hay' };
    console.warn('[yoru-alineacion] no se pudo pedir la alineación:', error instanceof Error ? error.message : String(error));
    return { tipo: 'sin-respuesta' };
  }
}
