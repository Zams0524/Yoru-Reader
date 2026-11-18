/**
 * Los miembros conectados de un servidor de Discord, leídos de su **widget público**.
 *
 * Discord tiene dos formas de enseñar quién está en un servidor. La completa pide un
 * bot con su token secreto y permisos especiales, y Yoru es una app abierta que corre
 * en el aparato de cada uno: un token metido aquí sería de todo el mundo. La otra es
 * el widget, que el dueño del servidor enciende en «Ajustes del servidor → Widget» y
 * que cualquiera puede leer sin clave. Esa es la que se usa.
 *
 * Lo que el widget da, y lo que no, y la pantalla lo dice tal cual:
 *  - Solo los que están conectados (hasta 100). Los desconectados no salen.
 *  - De cada uno: nombre, estado, avatar y el *nombre* de lo que está haciendo
 *    («Yoru Reader», un juego…), sin el detalle de qué libro o qué capítulo.
 */

/**
 * El servidor de Yoru Reader, de fábrica.
 *
 * Miembros no pregunta a quién mirar: Discord aquí no es «un servidor cualquiera que
 * tú conectas», es *el* servidor de Yoru, y por eso el ID vive en el código y no en
 * los ajustes. La pantalla no deja apuntar a otro, así que nadie convierte Miembros en
 * un visor de servidores ajenos ni se queda delante de una pantalla vacía porque no
 * sabía qué ID pegar.
 *
 * Para que haya lista, este servidor tiene que tener el widget encendido en «Ajustes
 * del servidor → Widget»; si se apaga, la pantalla lo dice.
 */
export const YORU_DISCORD_GUILD_ID = '1372928430634565775';

export interface DiscordMember {
  id: string;
  name: string;
  status: 'online' | 'idle' | 'dnd';
  avatar: string;
  /** A qué está jugando o qué app tiene abierta, si Discord lo enseña. */
  activity: string;
}

export interface DiscordWidget {
  name: string;
  invite: string;
  onlineCount: number;
  members: DiscordMember[];
}

export type DiscordWidgetError = 'bad-id' | 'not-found' | 'widget-off' | 'rate-limit' | 'network';

/**
 * Los bots del servidor, por nombre.
 *
 * Esta lista existe porque **el widget no dice quién es un bot**. Comprobado contra la
 * respuesta de verdad: de cada miembro llegan `id`, `username`, `discriminator`,
 * `avatar`, `status`, `avatar_url` y `game`, y nada más. El `id` ni siquiera es el de
 * Discord, es un número de orden (0, 1, 2…), y el `discriminator` es «0000» para
 * todos. Así que no hay ningún dato con el que distinguirlos: solo el nombre.
 *
 * Saber quién es bot de verdad exigiría un bot con su token, y un token dentro de una
 * app que se descarga cualquiera no es un secreto. Queda descartado.
 *
 * Para añadir uno nuevo basta escribir su nombre aquí, en minúsculas.
 */
export const BOTS_CONOCIDOS = [
  'bump buddy',
  'disboard',
  'dyno',
  'jockie music',
  'kotoba',
  'mudae',
  'nekotina',
  'tts bot',
];

function normalizar(nombre: string): string {
  return nombre.trim().toLowerCase();
}

/**
 * Si este miembro es un bot.
 *
 * La regla de oro es **ante la duda, es una persona**: dejar colarse un bot es una
 * molestia, pero esconder a alguien de la lista de miembros de su propia comunidad es
 * mucho peor. Por eso solo se excluye a los de la lista y a quien lleva «bot» como
 * palabra suelta al final del nombre («TTS Bot»); nunca por contenerlo dentro, que se
 * llevaría por delante a cualquiera que se llame Robot, Botella o Abbot.
 */
export function esBot(nombre: string): boolean {
  const limpio = normalizar(nombre);
  if (!limpio) return false;
  if (BOTS_CONOCIDOS.includes(limpio)) return true;
  return / bot$/.test(limpio);
}

/** La lista sin bots. Función pura: la misma entrada da siempre la misma salida. */
export function sinBots(miembros: DiscordMember[]): DiscordMember[] {
  return miembros.filter((miembro) => !esBot(miembro.name));
}

/** Un ID de Discord es un número largo; cualquier otra cosa no merece ni la petición. */
export function isDiscordId(value: string): boolean {
  return /^\d{15,22}$/.test(value.trim());
}

export async function fetchDiscordWidget(guildId: string, signal?: AbortSignal): Promise<DiscordWidget> {
  const id = guildId.trim();
  if (!isDiscordId(id)) throw new Error('bad-id' satisfies DiscordWidgetError);

  let response: Response;
  try {
    response = await fetch(`https://discord.com/api/guilds/${id}/widget.json`, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new Error('network' satisfies DiscordWidgetError);
  }

  if (response.status === 403) throw new Error('widget-off' satisfies DiscordWidgetError);
  if (response.status === 404 || response.status === 400) throw new Error('not-found' satisfies DiscordWidgetError);
  if (response.status === 429) throw new Error('rate-limit' satisfies DiscordWidgetError);
  if (!response.ok) throw new Error('network' satisfies DiscordWidgetError);

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error('network' satisfies DiscordWidgetError);

  const todos: DiscordMember[] = (Array.isArray(data.members) ? data.members : [])
    .map((entry: any): DiscordMember => ({
      id: String(entry?.id ?? ''),
      name: String(entry?.username ?? '').trim(),
      status: entry?.status === 'idle' || entry?.status === 'dnd' ? entry.status : 'online',
      // Solo se acepta la imagen si viene del CDN de Discord: es una URL que acaba en un `<img>`.
      avatar: typeof entry?.avatar_url === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(entry.avatar_url)
        ? entry.avatar_url
        : '',
      activity: String(entry?.game?.name ?? '').trim(),
    }))
    .filter((member: DiscordMember) => member.name);

  const invite = typeof data.instant_invite === 'string' && /^https:\/\/discord\.(gg|com)\//.test(data.instant_invite)
    ? data.instant_invite
    : '';

  const members = sinBots(todos);

  return {
    name: String(data.name ?? '').trim(),
    invite,
    /*
      Se cuenta lo que se enseña, no lo que manda Discord. `presence_count` incluye a
      los bots, así que usarlo dejaría «En línea · 9» encima de una lista de una
      persona, y el que sobra parecería un fallo.
    */
    onlineCount: members.length,
    members,
  };
}
