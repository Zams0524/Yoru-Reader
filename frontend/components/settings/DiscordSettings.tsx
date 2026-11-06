import React from 'react';

/**
 * Lo que Discord enseña de ti mientras lees.
 *
 * La lista negra es la pieza que importa: lo que aparece en Discord lo ve tu gente,
 * y no todo lo que uno lee quiere enseñarlo. Por eso hay una forma de decir «esta
 * novela no», y por eso el temporizador de inactividad existe — para que no se
 * quede el título colgado ahí cuando te has ido.
 *
 * Movido tal cual desde `Library.tsx`.
 */

/** El mismo aspecto para los tres campos, que antes estaba copiado tres veces. */
const CAMPO: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '6px',
  padding: '8px 12px',
  color: 'var(--text-main)',
  fontSize: '0.88rem',
  width: '100%',
};

const ETIQUETA: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

export default function DiscordSettings({
  lang,
  settings,
  onSaveSettings,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
}) {
  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Configura la integración de presencia en Discord.'
          : 'Configure the Discord presence integration.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
        {/* Enabled */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
          <span>{lang === 'es' ? 'Habilitar Discord Rich Presence:' : 'Enable Discord Rich Presence:'}</span>
          <input
            type="checkbox"
            checked={settings.discordEnabled || false}
            onChange={(e) => onSaveSettings({ ...settings, discordEnabled: e.target.checked })}
            style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
          />
        </div>

        {/* Inactivity Timer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={ETIQUETA}>
            {lang === 'es' ? 'Temporizador de inactividad (segundos):' : 'Inactivity Timer (seconds):'}
          </label>
          <input
            type="number"
            value={settings.discordInactivityTimer !== undefined ? settings.discordInactivityTimer : 300}
            onChange={(e) => onSaveSettings({ ...settings, discordInactivityTimer: parseInt(e.target.value) || 0 })}
            style={CAMPO}
          />
        </div>

        {/* Icon */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={ETIQUETA}>{lang === 'es' ? 'Icono:' : 'Icon:'}</label>
          <select
            value={settings.discordIcon || 'Yoru'}
            onChange={(e) => onSaveSettings({ ...settings, discordIcon: e.target.value })}
            style={{ ...CAMPO, cursor: 'pointer' }}
          >
            <option value="Yoru">Yoru</option>
            <option value="Cute">Cute</option>
            <option value="Jacked">Jacked</option>
            <option value="Cursed">Cursed</option>
          </select>
        </div>

        {/* Show Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={ETIQUETA}>{lang === 'es' ? 'Mostrar Estadísticas:' : 'Show Stats:'}</label>
          <select
            value={settings.discordShowStats || 'None'}
            onChange={(e) => onSaveSettings({ ...settings, discordShowStats: e.target.value })}
            style={{ ...CAMPO, cursor: 'pointer' }}
          >
            <option value="None">{lang === 'es' ? 'Ninguna' : 'None'}</option>
            <option value="Characters per Hour">{lang === 'es' ? 'Caracteres por hora' : 'Characters per Hour'}</option>
            <option value="Total Characters">{lang === 'es' ? 'Caracteres totales' : 'Total Characters'}</option>
            <option value="Cards Mined">{lang === 'es' ? 'Tarjetas creadas' : 'Cards Mined'}</option>
            <option value="Active Reading Time">{lang === 'es' ? 'Tiempo activo de lectura' : 'Active Reading Time'}</option>
          </select>
        </div>

        {/* Blacklisted Scenes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={ETIQUETA}>
            {lang === 'es' ? 'Novelas/Escenas en lista negra:' : 'Blacklisted Novels/Scenes:'}
          </label>
          <textarea
            value={settings.discordBlacklist || ''}
            onChange={(e) => onSaveSettings({ ...settings, discordBlacklist: e.target.value })}
            placeholder={lang === 'es' ? 'Escribe nombres de libros a ignorar, uno por línea...' : 'Enter book names to ignore, one per line...'}
            style={{ ...CAMPO, height: '120px', resize: 'vertical' }}
          />
        </div>
      </div>
    </>
  );
}
