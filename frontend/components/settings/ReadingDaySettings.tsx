import React from 'react';

/**
 * A qué hora empieza tu día de lectura.
 *
 * Existe porque mucha gente lee de madrugada, y a la una de la mañana uno siente
 * que sigue siendo el día anterior. Sin esto, una sesión de las dos partía la racha
 * en dos y las estadísticas contaban lo que marca el reloj, no lo que uno vive.
 *
 * Movido tal cual desde `Library.tsx`: mismo comportamiento y mismo aspecto, solo
 * que fuera de un fichero de ocho mil líneas.
 */
export default function ReadingDaySettings({
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
          ? 'Establece los límites horarios para el cálculo del historial de lectura diario.'
          : 'Sets calendar hour boundaries for daily reading history calculations.'}
      </p>

      <div style={{ marginTop: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span className="settings-label-text">{lang === 'es' ? 'Hora de inicio del día' : 'Start Day Hour'}</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700 }}>
            {String(settings.startDayHour || 0).padStart(2, '0')}:00
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="23"
          step="1"
          value={settings.startDayHour || 0}
          onChange={(e) => onSaveSettings({ ...settings, startDayHour: parseInt(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
        />
        <p style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.3)', marginTop: '8px', lineHeight: 1.3 }}>
          {lang === 'es'
            ? 'Ajusta a qué hora comienza un nuevo día. Útil si lees después de medianoche y deseas que se contabilice en el día anterior.'
            : 'Configure at what hour a new reading day starts. Useful for night readers.'}
        </p>
      </div>
    </>
  );
}
