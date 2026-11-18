import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Users } from 'lucide-react';
import { EmptyState } from './primitives';
import {
  fetchDiscordWidget,
  YORU_DISCORD_GUILD_ID,
  type DiscordMember,
  type DiscordWidget,
  type DiscordWidgetError,
} from '../../utils/discordWidget';
import { leerSesion } from '../../utils/discordAuth';
import { continueReading, type ShelfBook } from './libraryIndex';
import MemberCard, { type LecturaActual } from './MemberCard';

/**
 * Miembros: quién del servidor de Yoru está conectado ahora, y con qué.
 *
 * El servidor viene puesto (`YORU_DISCORD_GUILD_ID`): no hay nada que conectar ni
 * ningún ID que pegar, igual que Kavita y Audiobookshelf vienen puestos. Sale del
 * widget público (ver `discordWidget.ts`), así que no hace falta bot ni clave, y por
 * eso mismo solo salen los conectados: Discord no publica a los desconectados por esa
 * vía.
 */

/** Cada cuánto se vuelve a preguntar. Discord refresca el widget más o menos al minuto. */
const REFRESH_MS = 60_000;

const STATUS_ORDER = { online: 0, idle: 1, dnd: 2 } as const;

/**
 * Si un nombre del widget es el de la cuenta con la que se entró.
 *
 * Se compara por nombre porque el widget **no da el id real**: el suyo es un número de
 * orden (0, 1, 2…). No es infalible —dos personas podrían llamarse igual— y por eso lo
 * único que hay en juego es enseñarte de más sobre ti mismo, nunca datos de otro: el
 * bloque de lectura sale de lo que hay guardado en este aparato, que es tuyo.
 */
export function esLaMismaPersona(nombreWidget: string, nombreSesion: string): boolean {
  const a = (nombreWidget || '').trim().toLowerCase();
  const b = (nombreSesion || '').trim().toLowerCase();
  return a.length > 0 && a === b;
}

/** Lo que estás leyendo ahora, de «Continuar». Sin libro a medias, no hay bloque. */
export function lecturaActual(libros: ShelfBook[]): LecturaActual | null {
  const primero = continueReading(libros)[0];
  if (!primero) return null;
  return {
    titulo: primero.title,
    portada: primero.hideCover ? undefined : primero.cover,
    progreso: Number(primero.progress?.percent ?? 0),
  };
}

export default function MembersView({
  es,
  libros = [],
  onVerPerfil,
}: {
  es: boolean;
  /** La estantería, para contar qué estás leyendo tú. De los demás no se sabe nada. */
  libros?: ShelfBook[];
  onVerPerfil?: () => void;
}) {
  const [elegido, setElegido] = useState<DiscordMember | null>(null);
  /** El nombre de la cuenta con la que se entró, para reconocerte en la lista. */
  const [miNombre] = useState(() => leerSesion()?.usuarioNombre || '');
  const esMiCuenta = (nombre: string) => esLaMismaPersona(nombre, miNombre);
  const miLectura = lecturaActual(libros);
  const [widget, setWidget] = useState<DiscordWidget | null>(null);
  const [error, setError] = useState<DiscordWidgetError | ''>('');
  const [loading, setLoading] = useState(false);
  /** Sube para volver a pedir a mano. */
  const [tick, setTick] = useState(0);
  const firstLoad = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const load = () => {
      setLoading(true);
      fetchDiscordWidget(YORU_DISCORD_GUILD_ID, controller.signal)
        .then((data) => { if (alive) { setWidget(data); setError(''); } })
        .catch((reason: Error) => {
          if (!alive || reason?.name === 'AbortError') return;
          // Si ya había lista y falla un refresco, se queda la que había: un corte de
          // red de un minuto no tiene por qué vaciar la pantalla.
          setError((reason?.message as DiscordWidgetError) || 'network');
          if (firstLoad.current) setWidget(null);
        })
        .finally(() => { if (alive) { setLoading(false); firstLoad.current = false; } });
    };
    firstLoad.current = true;
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { alive = false; controller.abort(); window.clearInterval(timer); };
  }, [tick]);

  const errorText = (code: DiscordWidgetError | ''): string => {
    if (code === 'bad-id') return es ? 'El servidor de Yoru está mal puesto en la app. No es cosa tuya; habría que corregirlo.' : 'Yoru\'s server is misconfigured in the app. Not your fault; it needs fixing.';
    if (code === 'widget-off') return es ? 'El servidor de Yoru tiene el widget apagado, así que Discord no publica quién está conectado.' : 'Yoru\'s server has its widget turned off, so Discord does not publish who is online.';
    if (code === 'not-found') return es ? 'Discord no encuentra el servidor de Yoru.' : 'Discord cannot find Yoru\'s server.';
    if (code === 'rate-limit') return es ? 'Discord pide esperar un momento antes de volver a preguntar.' : 'Discord asks to wait a moment before asking again.';
    if (code === 'network') return es ? 'No se pudo hablar con Discord. Revisa la conexión.' : 'Could not reach Discord. Check your connection.';
    return '';
  };

  const members = widget
    ? [...widget.members].sort((a, b) =>
        Number(Boolean(b.activity)) - Number(Boolean(a.activity))
        || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || a.name.localeCompare(b.name))
    : [];

  const statusLabel = (status: keyof typeof STATUS_ORDER) =>
    status === 'idle' ? (es ? 'Ausente' : 'Idle') : status === 'dnd' ? (es ? 'No molestar' : 'Do not disturb') : (es ? 'En línea' : 'Online');

  return (
    <div className="yoru-members">
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Miembros' : 'Members'}</h1>
          <div className="yoru-view-sub">
            {widget?.name
              ? `${widget.name} · Discord`
              : (es ? 'La comunidad de Yoru, desde la app.' : 'The Yoru community, from the app.')}
          </div>
        </div>
        <div className="yoru-detail-actions" style={{ marginBottom: 0 }}>
          {widget?.invite && (
            <a className="yoru-btn" href={widget.invite} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} />
              {es ? 'Abrir en Discord' : 'Open in Discord'}
            </a>
          )}
          <button
            type="button"
            className="yoru-btn"
            onClick={() => setTick((value) => value + 1)}
            disabled={loading}
            title={es ? 'Actualizar' : 'Refresh'}
            aria-label={es ? 'Actualizar' : 'Refresh'}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="yoru-members-connect">
          <p className="yoru-profile-error" role="alert" style={{ margin: 0 }}>{errorText(error)}</p>
        </div>
      )}

      {!widget && loading && (
        <div className="app-section-loading" role="status" aria-live="polite">
          <span className="app-section-loading-indicator" />
          {es ? 'Preguntando a Discord…' : 'Asking Discord…'}
        </div>
      )}

      {widget && (
        <>
          <div className="yoru-members-group-title">
            {es ? 'En línea' : 'Online'} · {widget.onlineCount}
          </div>
          {members.length === 0 ? (
            <EmptyState
              title={es ? 'Nadie conectado ahora mismo' : 'Nobody online right now'}
              sub={es
                ? 'Cuando alguien del servidor se conecte, saldrá aquí. Los bots no cuentan.'
                : 'When someone from the server comes online, they will show up here. Bots do not count.'}
            />
          ) : (
            <ul className="yoru-members-list">
              {members.map((member) => (
                <li key={member.id || member.name}>
                  {/* Un botón y no un div con onClick: así el teclado y los lectores
                      de pantalla lo encuentran solos, sin tener que apañarlo. */}
                  <button
                    type="button"
                    className="yoru-member is-pulsable"
                    onClick={() => setElegido(member)}
                    aria-haspopup="dialog"
                  >
                    <span className="yoru-member-avatar">
                      {member.avatar
                        ? <img src={member.avatar} alt="" loading="lazy" />
                        : <span><Users size={18} /></span>}
                      <i className={`yoru-member-dot is-${member.status}`} title={statusLabel(member.status)} />
                    </span>
                    <span className="yoru-member-text">
                      <span className="yoru-member-name">{member.name}</span>
                      <span className="yoru-member-activity">
                        {member.activity || statusLabel(member.status)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="yoru-members-note">
            {es
              ? 'Discord solo publica aquí a quien está conectado, y de cada uno el nombre de lo que tiene abierto, no el detalle. Los bots del servidor no salen. Se actualiza cada minuto.'
              : 'Discord only publishes who is online here, and for each the name of what they have open, not the detail. The server\'s bots are left out. It refreshes every minute.'}
          </p>
        </>
      )}

      {elegido && (
        <MemberCard
          miembro={elegido}
          es={es}
          esTuyo={esMiCuenta(elegido.name)}
          lectura={esMiCuenta(elegido.name) ? miLectura : null}
          onCerrar={() => setElegido(null)}
          onVerPerfil={onVerPerfil ? () => { setElegido(null); onVerPerfil(); } : undefined}
        />
      )}
    </div>
  );
}
