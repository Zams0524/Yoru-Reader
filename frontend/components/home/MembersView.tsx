import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Users } from 'lucide-react';
import { EmptyState } from './primitives';
import {
  fetchDiscordWidget,
  isDiscordId,
  type DiscordWidget,
  type DiscordWidgetError,
} from '../../utils/discordWidget';

/**
 * Miembros: quién de tu servidor de Discord está conectado ahora, y con qué.
 *
 * Sale del widget público del servidor (ver `discordWidget.ts`): no hace falta bot ni
 * clave, solo el ID del servidor y tener el widget encendido. Por eso mismo solo salen
 * los conectados; Discord no publica a los desconectados por esa vía.
 */

/** Cada cuánto se vuelve a preguntar. Discord refresca el widget más o menos al minuto. */
const REFRESH_MS = 60_000;

const STATUS_ORDER = { online: 0, idle: 1, dnd: 2 } as const;

export default function MembersView({
  es,
  guildId,
  onSaveGuildId,
}: {
  es: boolean;
  guildId: string;
  onSaveGuildId: (guildId: string) => void;
}) {
  const [draft, setDraft] = useState(guildId);
  const [widget, setWidget] = useState<DiscordWidget | null>(null);
  const [error, setError] = useState<DiscordWidgetError | ''>('');
  const [loading, setLoading] = useState(false);
  /** Sube para volver a pedir a mano. */
  const [tick, setTick] = useState(0);
  const firstLoad = useRef(true);

  useEffect(() => { setDraft(guildId); }, [guildId]);

  useEffect(() => {
    if (!isDiscordId(guildId)) {
      setWidget(null);
      setError('');
      return undefined;
    }
    const controller = new AbortController();
    let alive = true;
    const load = () => {
      setLoading(true);
      fetchDiscordWidget(guildId, controller.signal)
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
  }, [guildId, tick]);

  const save = useCallback(() => {
    const value = draft.trim();
    if (value === guildId) return;
    if (value && !isDiscordId(value)) { setError('bad-id'); return; }
    setError('');
    onSaveGuildId(value);
  }, [draft, guildId, onSaveGuildId]);

  const errorText = (code: DiscordWidgetError | ''): string => {
    if (code === 'bad-id') return es ? 'Eso no parece un ID de servidor: es un número largo, de unas 18 cifras.' : 'That does not look like a server ID: it is a long number, about 18 digits.';
    if (code === 'widget-off') return es ? 'El servidor tiene el widget apagado. Enciéndelo en Ajustes del servidor → Widget.' : 'The server has its widget turned off. Turn it on in Server Settings → Widget.';
    if (code === 'not-found') return es ? 'Discord no conoce ningún servidor con ese ID.' : 'Discord does not know any server with that ID.';
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

  const connected = isDiscordId(guildId);

  return (
    <div className="yoru-members">
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Miembros' : 'Members'}</h1>
          <div className="yoru-view-sub">
            {widget?.name
              ? `${widget.name} · Discord`
              : (es ? 'Tu servidor de Discord, desde Yoru.' : 'Your Discord server, from Yoru.')}
          </div>
        </div>
        {connected && (
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
        )}
      </div>

      {/* Conectar el servidor: un campo y lo que hay que hacer en Discord, en dos pasos. */}
      <div className="yoru-members-connect">
        <label className="yoru-control-label" htmlFor="yoru-discord-guild">
          {es ? 'ID de tu servidor de Discord' : 'Your Discord server ID'}
        </label>
        <div className="yoru-members-connect-row">
          <div className="yoru-control-field">
            <input
              id="yoru-discord-guild"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder="123456789012345678"
              onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
            />
          </div>
          <button type="button" className="yoru-btn yoru-btn-primary" onClick={save} disabled={draft.trim() === guildId}>
            {connected ? (es ? 'Cambiar' : 'Change') : (es ? 'Conectar' : 'Connect')}
          </button>
          {connected && (
            <button type="button" className="yoru-btn" onClick={() => { setDraft(''); onSaveGuildId(''); }}>
              {es ? 'Desconectar' : 'Disconnect'}
            </button>
          )}
        </div>
        {!connected && (
          <ol className="yoru-members-steps">
            <li>{es
              ? 'En Discord, abre Ajustes del servidor → Widget y enciende «Habilitar widget del servidor».'
              : 'In Discord, open Server Settings → Widget and turn on “Enable Server Widget”.'}</li>
            <li>{es
              ? 'En esa misma pantalla, copia el «ID del servidor» y pégalo aquí.'
              : 'On that same screen, copy the “Server ID” and paste it here.'}</li>
          </ol>
        )}
        {error && <p className="yoru-profile-error" role="alert" style={{ margin: '10px 0 0' }}>{errorText(error)}</p>}
      </div>

      {connected && !widget && loading && (
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
              title={es ? 'Nadie conectado ahora' : 'Nobody online right now'}
              sub={es ? 'Cuando alguien del servidor se conecte, saldrá aquí.' : 'When someone from the server comes online, they will show up here.'}
            />
          ) : (
            <ul className="yoru-members-list">
              {members.map((member) => (
                <li key={member.id || member.name} className="yoru-member">
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
                </li>
              ))}
            </ul>
          )}
          <p className="yoru-members-note">
            {es
              ? 'Discord solo publica aquí a quien está conectado, y de cada uno el nombre de lo que tiene abierto, no el detalle. Se actualiza cada minuto.'
              : 'Discord only publishes who is online here, and for each the name of what they have open, not the detail. It refreshes every minute.'}
          </p>
        </>
      )}
    </div>
  );
}
