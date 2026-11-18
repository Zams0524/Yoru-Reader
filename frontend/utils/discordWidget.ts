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

  const members: DiscordMember[] = (Array.isArray(data.members) ? data.members : [])
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

  return {
    name: String(data.name ?? '').trim(),
    invite,
    onlineCount: Number.isFinite(Number(data.presence_count)) ? Number(data.presence_count) : members.length,
    members,
  };
}
