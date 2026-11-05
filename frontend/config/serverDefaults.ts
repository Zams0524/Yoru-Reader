/**
 * Servidores que vienen puestos de fábrica.
 *
 * Para que Yoru funcione nada más abrirlo, sin que nadie tenga que escribir una
 * dirección ni pegar una clave. Lo que haya aquí se usa **solo cuando el usuario no
 * tiene nada guardado**: en cuanto configura un servidor en Ajustes, manda el suyo, y
 * puede cambiarlo o borrarlo como siempre.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AVISO, y va en serio:
 *
 * Esto se publica con la app y el repositorio es público. **Una clave escrita aquí
 * es una clave pública** desde el momento en que se sube, y seguirá estándolo en el
 * historial de git aunque se borre después. Hay robots que rastrean GitHub buscando
 * credenciales y las encuentran en minutos.
 *
 * Si alguna vez hay que retirar una de estas claves, **no basta con quitarla de este
 * fichero**: hay que revocarla en el propio Kavita y en el propio Audiobookshelf y
 * generar una nueva. Borrarla de aquí no cierra nada.
 *
 * La alternativa, si no se quiere publicar: `.env.local`, que git ignora. Ahí la
 * clave se queda en el equipo y la app arranca igual de configurada.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface KavitaDefaults {
  serverUrl: string;
  apiKey: string;
}

export interface AudiobookshelfDefaults {
  serverUrl: string;
  token: string;
}

/**
 * Kavita. Con `apiKey` vacío no se usa: la app pedirá configurarlo como hasta ahora.
 */
export const KAVITA_DEFAULTS: KavitaDefaults = {
  serverUrl: 'http://localhost:5000',
  apiKey: '',
};

/**
 * Audiobookshelf. Con `token` vacío no se usa.
 */
export const AUDIOBOOKSHELF_DEFAULTS: AudiobookshelfDefaults = {
  serverUrl: 'http://localhost:13378',
  token: '',
};
