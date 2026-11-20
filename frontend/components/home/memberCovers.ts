import { absCoverUrl } from '../../utils/audiobookshelfService';
import { kavitaSeriesCoverUrl, kavitaVolumeCoverUrl } from '../../utils/kavitaService';
import type { AudiolibroMiembro, LibroMiembro } from '../../utils/yoruSyncService';

/**
 * De dónde sale la portada de lo que lee otro miembro.
 *
 * Kavita y Audiobookshelf son los mismos para todos, así que de una serie o de un
 * audiolibro del servidor basta su identificador: la portada la pide esta app con su
 * propia sesión, y el servidor de sincronización no tiene que cargar con ella. De un
 * libro importado no hay más portada que la que su dueño subió, y esa sí viaja (si es
 * pequeña; si no, sale el hueco).
 */
export function portadaDeLibro(libro: LibroMiembro): string {
  if (libro.origen === 'kavita') {
    return (libro.volumeId ? kavitaVolumeCoverUrl(libro.volumeId) : '')
      || (libro.seriesId ? kavitaSeriesCoverUrl(libro.seriesId) : '');
  }
  return libro.portada || '';
}

export function portadaDeAudiolibro(audio: AudiolibroMiembro): string {
  return audio.itemId ? absCoverUrl(audio.itemId) : '';
}
