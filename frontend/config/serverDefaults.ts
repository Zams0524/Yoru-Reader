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

/**
 * Un valor de `.env.local`, que git ignora.
 *
 * Así hay dos caminos para lo mismo, y los dos dejan la app configurada sin que
 * nadie escriba nada al abrirla:
 *
 * - **Escribirlo aquí abajo**: viaja con la app y se publica. Léase el aviso.
 * - **Escribirlo en `.env.local`**: se queda en este equipo y no sube a ningún sitio.
 *
 * Lo de `.env.local` manda sobre lo de aquí, para poder probar sin tocar el código.
 */
function env(name: string): string {
  // Fuera de Vite —las pruebas corren en Node a secas— `import.meta.env` no existe.
  const source = (import.meta as { env?: Record<string, string | undefined> }).env;
  const value = source?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

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
  serverUrl: env('VITE_KAVITA_URL') || 'http://localhost:5000',
  apiKey: env('VITE_KAVITA_API_KEY') || 'TpThYNJN3ehxG6Ftfc2mWsprqLUc0kYm',
};

/**
 * Audiobookshelf. Con `token` vacío no se usa.
 */
export const AUDIOBOOKSHELF_DEFAULTS: AudiobookshelfDefaults = {
  serverUrl: env('VITE_ABS_URL') || 'http://localhost:13378',
  token: env('VITE_ABS_TOKEN')
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXlJZCI6ImE4OGI0NTM0LTc2NmQtNGI1YS1iMjdhLTFkZDkwNDNlNWRhMyIsIm5hbWUiOiJ1c3VhcmlvcyIsInR5cGUiOiJhcGkiLCJpYXQiOjE3OTM5MjI0NzJ9.OtBu6XhqdvnvpqIEl30e8iaGYpGW2_vxKidVT59jByE',
};

/**
 * El servidor de sincronización de Yoru, en el PC de zams, por Tailscale.
 *
 * Aquí no hay ninguna clave, y por eso esta dirección sí puede ir en el código: lo
 * único que abre la puerta es el token de Discord de cada uno, que lo pone el usuario
 * al entrar y no viaja con la app. La dirección sola no sirve de nada a quien no esté
 * en el tailnet, porque un nombre `.ts.net` no resuelve fuera de él.
 *
 * Se usa el nombre de Tailscale y no la IP (100.121.94.3) porque el nombre sobrevive a
 * que la IP cambie; la IP queda escrita en la configuración de red de Android, que es
 * donde Android exige direcciones concretas.
 *
 * Con `serverUrl` vacío la sincronización queda apagada y la app funciona como antes.
 */
export interface YoruSyncDefaults {
  serverUrl: string;
}

export const YORU_SYNC_DEFAULTS: YoruSyncDefaults = {
  serverUrl: env('VITE_YORU_SYNC_URL') || 'http://desktop-go1ujdd.tail6db786.ts.net:3747',
};
