/**
 * Servidores que vienen puestos de fábrica.
 *
 * Para que Yoru funcione nada más abrirlo, sin que nadie tenga que escribir una
 * dirección ni pegar una clave. Lo que haya aquí se usa **solo cuando el usuario no
 * tiene nada guardado**: en cuanto configura un servidor en Ajustes, manda el suyo, y
 * puede cambiarlo o borrarlo como siempre.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE ESCRIBE NINGUNA CLAVE. Nunca más.
 *
 * Esto se publica con la app y el repositorio es público, así que una clave escrita
 * aquí es una clave pública desde el momento en que se sube, y sigue estándolo en el
 * historial de git aunque se borre después. Hasta el 18 de noviembre de 2026 la clave
 * de Kavita y el testigo de Audiobookshelf estuvieron justo aquí abajo. Mientras los
 * dos servidores solo escuchaban en `localhost` el daño era limitado, porque no había
 * dirección a la que ir; al publicarlos con Tailscale Funnel pasaron a ser dirección y
 * clave, las dos publicadas, o sea la puerta abierta.
 *
 * Las claves viven ahora en el servidor de sincronización, en `servidor-sync/.env`,
 * que git ignora, y se reparten solo a quien tenga sesión, es decir a los miembros del
 * Discord de Yoru. Lo hace `utils/credencialesMedios.ts`, y ahí está contado entero.
 * Las dos claves de antes quedaron revocadas; las de este fichero, si alguien vuelve a
 * escribir una, no se pueden revocar borrándolas de aquí.
 *
 * Para el equipo de zams, `.env.local` sigue sirviendo: git lo ignora, y lo que ponga
 * ahí manda sobre todo lo demás, que es cómo se prueba contra una instalación local.
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
 * Kavita, en el PC de zams y publicado con Funnel en el puerto 8443.
 *
 * Antes esto era `http://localhost:5000`, que solo valía estando en el propio PC: en
 * el teléfono de cualquier miembro no hay nada escuchando en ese puerto. Con Funnel la
 * misma instalación sale por `https` con un certificado de verdad, así que nadie
 * instala Tailscale y Android no necesita ninguna excepción de tráfico en claro.
 *
 * El puerto va en la dirección porque Funnel solo sirve 443, 8443 y 10000, y el 443 ya
 * lo ocupa el servidor de sincronización (ver `YORU_SYNC_DEFAULTS` más abajo).
 *
 * `apiKey` sale vacío a propósito y solo se llena desde `.env.local`. La clave de los
 * miembros no está aquí: la da el servidor, y la recoge `utils/credencialesMedios.ts`.
 */
export const KAVITA_DEFAULTS: KavitaDefaults = {
  serverUrl: env('VITE_KAVITA_URL') || 'https://desktop-go1ujdd.tail6db786.ts.net:8443',
  apiKey: env('VITE_KAVITA_API_KEY'),
};

/**
 * Audiobookshelf, igual que Kavita: en el PC de zams, por Funnel, puerto 10000.
 *
 * Y como en Kavita, `token` sale vacío y solo lo llena `.env.local`. El de los
 * miembros lo reparte el servidor de sincronización.
 */
export const AUDIOBOOKSHELF_DEFAULTS: AudiobookshelfDefaults = {
  serverUrl: env('VITE_ABS_URL') || 'https://desktop-go1ujdd.tail6db786.ts.net:10000',
  token: env('VITE_ABS_TOKEN'),
};

/**
 * El servidor de sincronización de Yoru, en el PC de zams, publicado con Funnel.
 *
 * Aquí no hay ninguna clave, y por eso esta dirección sí puede ir en el código: lo
 * único que abre la puerta es el token de Discord de cada uno, que lo pone el usuario
 * al entrar y no viaja con la app.
 *
 * Es `https` y sin puerto a propósito. La primera versión apuntaba al nombre del
 * tailnet (`http://…:3747`), y aquello obligaba a cada miembro a instalar Tailscale
 * para que el nombre resolviera siquiera. Con Tailscale Funnel el mismo servidor sale
 * por el 443 con un certificado de verdad: nadie instala nada, y Android no necesita
 * ninguna excepción de tráfico en claro.
 *
 * Con `serverUrl` vacío la sincronización queda apagada y la app funciona como antes.
 * Para probar contra el PC dentro del tailnet, `VITE_YORU_SYNC_URL` sigue mandando.
 */
export interface YoruSyncDefaults {
  serverUrl: string;
}

export const YORU_SYNC_DEFAULTS: YoruSyncDefaults = {
  serverUrl: env('VITE_YORU_SYNC_URL') || 'https://desktop-go1ujdd.tail6db786.ts.net',
};
