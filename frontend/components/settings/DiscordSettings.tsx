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

      {/*
        Los mismos controles que el resto de Ajustes.

        Aquí había una casilla de verificación del navegador, con su tic, y dos
        listas desplegables nativas, mientras que la sección de al lado usa el
        interruptor dorado de Yoru. Dos formas distintas de decir «encendido» en la
        misma pantalla hacen dudar de si significan lo mismo.
      */}
      <div className="settings-row-control">
        <span className="settings-label-text">
          {lang === 'es' ? 'Mostrar lo que lees en Discord' : 'Show what you are reading on Discord'}
        </span>
        <label className="migaku-switch">
          <input
            type="checkbox"
            checked={settings.discordEnabled || false}
            onChange={(e) => onSaveSettings({ ...settings, discordEnabled: e.target.checked })}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      <div className="settings-row-control">
        <span className="settings-label-text" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{lang === 'es' ? 'Dejar de mostrarlo tras' : 'Stop showing it after'}</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-dark)', fontWeight: 400 }}>
            {lang === 'es' ? 'Segundos sin pasar de página' : 'Seconds without turning a page'}
          </span>
        </span>
        <input
          type="number"
          className="migaku-select"
          style={{ width: '120px' }}
          value={settings.discordInactivityTimer !== undefined ? settings.discordInactivityTimer : 300}
          onChange={(e) => onSaveSettings({ ...settings, discordInactivityTimer: parseInt(e.target.value) || 0 })}
        />
      </div>

      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Icono' : 'Icon'}</span>
        <select
          className="migaku-select"
          value={settings.discordIcon || 'Yoru'}
          onChange={(e) => onSaveSettings({ ...settings, discordIcon: e.target.value })}
        >
          <option value="Yoru">Yoru</option>
          <option value="Cute">Cute</option>
          <option value="Jacked">Jacked</option>
          <option value="Cursed">Cursed</option>
        </select>
      </div>

      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Mostrar estadísticas' : 'Show stats'}</span>
        <select
          className="migaku-select"
          value={settings.discordShowStats || 'None'}
          onChange={(e) => onSaveSettings({ ...settings, discordShowStats: e.target.value })}
        >
          <option value="None">{lang === 'es' ? 'Ninguna' : 'None'}</option>
          <option value="Characters per Hour">{lang === 'es' ? 'Caracteres por hora' : 'Characters per Hour'}</option>
          <option value="Total Characters">{lang === 'es' ? 'Caracteres totales' : 'Total Characters'}</option>
          <option value="Cards Mined">{lang === 'es' ? 'Tarjetas creadas' : 'Cards Mined'}</option>
          <option value="Active Reading Time">{lang === 'es' ? 'Tiempo activo de lectura' : 'Active Reading Time'}</option>
        </select>
      </div>

      {/*
        La lista negra, con su explicación fuera del campo. Antes lo único que lo
        explicaba era el texto de dentro, que desaparece en cuanto escribes una
        línea: justo cuando ya no sabes si hacía falta el título exacto.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '14px' }}>
        <span className="settings-label-text">
          {lang === 'es' ? 'Libros que no quieres enseñar' : 'Books you would rather not show'}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dark)', lineHeight: 1.4 }}>
          {lang === 'es'
            ? 'Uno por línea. Mientras leas uno de estos, Discord no enseñará nada.'
            : 'One per line. While you read one of these, Discord shows nothing.'}
        </span>
        <textarea
          value={settings.discordBlacklist || ''}
          onChange={(e) => onSaveSettings({ ...settings, discordBlacklist: e.target.value })}
          placeholder={lang === 'es' ? 'El título tal y como aparece en tu biblioteca' : 'The title as it appears in your library'}
          style={{ ...CAMPO, height: '110px', resize: 'vertical' }}
        />
      </div>
    </>
  );
}
