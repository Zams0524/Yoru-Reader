import React from 'react';

/**
 * Cómo se ve y cómo suena el texto: tamaño, dirección, furigana y voz.
 *
 * Es la tarjeta que más se toca de todas, porque leer japonés vertical con el
 * tamaño equivocado cansa a los diez minutos. Todo lo de aquí se aplica al momento
 * sobre lo que ya está abierto: no hay botón de guardar ni hace falta recargar.
 *
 * Movido tal cual desde `Library.tsx`, con su ayudante `renderCheckboxCard`, que
 * no usa nadie más.
 */
export default function TextStyleSettings({
  lang,
  settings,
  onSaveSettings,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
}) {
  const handleSliderChange = (val: number) => {
    onSaveSettings({ ...settings, fontSize: val });
  };

  return (
    <>
      <p className="settings-card-desc">{lang === 'es' ? 'Modifica el tamaño de la tipografía, dirección de lectura, velocidad de audio y comportamiento del lector.' : 'Modify typography size, reading direction, audio speed and reader behavior.'}</p>
      

      {/* Zoom de texto */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Zoom de texto del lector' : 'Reader text zoom'}</span>
        <select
          value={settings.fontSize || 36}
          onChange={(e) => handleSliderChange(parseInt(e.target.value))}
          className="migaku-select"
        >
          <option value="18">75%</option>
          <option value="22">85%</option>
          <option value="26">90%</option>
          <option value="30">95%</option>
          <option value="36">100% ({lang === 'es' ? 'Por defecto' : 'Default'})</option>
          <option value="40">110%</option>
          <option value="44">120%</option>
          <option value="48">130%</option>
        </select>
      </div>

      {/* Modo de visualización (View Mode) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Modo de visualización' : 'View Mode'}</span>
        <select
          value={settings.viewMode || 'paginated'}
          onChange={(e) => onSaveSettings({ ...settings, viewMode: e.target.value })}
          className="migaku-select"
        >
          <option value="paginated">{lang === 'es' ? 'Paginado' : 'Paginated'}</option>
          <option value="continuous">{lang === 'es' ? 'Continuo' : 'Continuous'}</option>
        </select>
      </div>

      {/* Dirección de escritura (Writing Mode) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Dirección de escritura' : 'Writing Mode'}</span>
        <select
          value={settings.writingMode || 'vertical-rl'}
          onChange={(e) => onSaveSettings({ ...settings, writingMode: e.target.value })}
          className="migaku-select"
        >
          <option value="vertical-rl">{lang === 'es' ? 'Vertical (japonés)' : 'Vertical (Japanese)'}</option>
          <option value="horizontal-tb">Horizontal</option>
        </select>
      </div>

      {/* Interlineado (Line Height) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Interlineado' : 'Line Height'}</span>
        <select
          value={settings.lineHeight || '1.65'}
          onChange={(e) => onSaveSettings({ ...settings, lineHeight: e.target.value })}
          className="migaku-select"
        >
          <option value="1.3">1.3x</option>
          <option value="1.5">1.5x</option>
          <option value="1.65">1.65x ({lang === 'es' ? 'Por defecto' : 'Default'})</option>
          <option value="1.8">1.8x</option>
          <option value="2.0">2.0x</option>
        </select>
      </div>

      {/* Sangría de párrafo (Paragraph Indentation) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Sangría de párrafo' : 'Paragraph Indentation'}</span>
        <select
          value={settings.textIndentation || '0'}
          onChange={(e) => onSaveSettings({ ...settings, textIndentation: e.target.value })}
          className="migaku-select"
        >
          <option value="0">{lang === 'es' ? 'Sin sangría' : 'No indent'}</option>
          <option value="1">1em</option>
          <option value="2">2em</option>
        </select>
      </div>

      {/* Margen lateral (Margins) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Margen del lector (px)' : 'Reader margin (px)'}</span>
        <select
          value={settings.firstDimensionMargin || '0'}
          onChange={(e) => onSaveSettings({ ...settings, firstDimensionMargin: e.target.value })}
          className="migaku-select"
        >
          <option value="0">{lang === 'es' ? 'Por defecto' : 'Default'}</option>
          <option value="10">10px</option>
          <option value="20">20px</option>
          <option value="30">30px</option>
          <option value="40">40px</option>
          <option value="50">50px</option>
        </select>
      </div>

      {/* Formato del editor (Publisher formatting) */}
      <div className="settings-row-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <span className="settings-label-text">{lang === 'es' ? 'Formato del editor' : 'Publisher formatting'}</span>
          <label className="migaku-switch">
            <input 
              type="checkbox" 
              checked={settings.prioritizeReaderStyles === false}
              onChange={(e) => onSaveSettings({ ...settings, prioritizeReaderStyles: !e.target.checked })}
            />
            <span className="migaku-switch-slider"></span>
          </label>
        </div>
        <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', marginTop: '-2px' }}>
          {lang === 'es' ? 'Conservar el diseño y la tipografía del libro original siempre que sea posible.' : 'Keep book layout and typography where possible.'}
        </span>
      </div>

      {/* Progreso del pie de página (Footer progress) */}
      <div className="settings-row-control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <span className="settings-label-text">{lang === 'es' ? 'Progreso en pie de página' : 'Footer progress'}</span>
          <label className="migaku-switch">
            <input 
              type="checkbox" 
              checked={settings.showFooterProgress === true}
              onChange={(e) => onSaveSettings({ ...settings, showFooterProgress: e.target.checked })}
            />
            <span className="migaku-switch-slider"></span>
          </label>
        </div>
        <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', marginTop: '-2px' }}>
          {lang === 'es' ? 'Mostrar la delgada línea de progreso del capítulo al final de la pantalla.' : 'Show the thin chapter progress line.'}
        </span>
      </div>

      {/* Justificación de texto (enableTextJustification) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Justificar texto' : 'Justify text'}</span>
        <label className="migaku-switch">
          <input 
            type="checkbox" 
            checked={settings.enableTextJustification === true}
            onChange={(e) => onSaveSettings({ ...settings, enableTextJustification: e.target.checked })}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      {/* Habilitar VPAL (enableFontVPAL) */}
      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Habilitar VPAL (Métrica de fuente proporcional)' : 'Enable Font VPAL (Proportional metrics)'}</span>
        <label className="migaku-switch">
          <input 
            type="checkbox" 
            checked={settings.enableFontVPAL === true}
            onChange={(e) => onSaveSettings({ ...settings, enableFontVPAL: e.target.checked })}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      
      <h4 style={{ margin: '0 0 12px 0', fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {lang === 'es' ? 'Sesión de Lectura' : 'Reading Session'}
      </h4>

      {/* Pause when hidden checkbox card */}
      {(() => {
        const renderCheckboxCard = (title, desc, isChecked, onToggle) => (
          <div 
            onClick={onToggle}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '12px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              cursor: 'pointer',
              boxSizing: 'border-box',
              marginBottom: '10px'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '0.86rem', fontWeight: 500, color: '#ffffff' }}>{title}</span>
              {desc && <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '2px' }}>{desc}</span>}
            </div>
            <div style={{
              width: '18px',
              height: '18px',
              border: isChecked ? 'none' : '1.5px solid rgba(255, 255, 255, 0.45)',
              borderRadius: '4px',
              background: isChecked ? '#5b6abf' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              flexShrink: 0
            }}>
              {isChecked && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Pause when hidden */}
            {renderCheckboxCard(
              lang === 'es' ? 'Pausar al ocultar' : 'Pause when hidden',
              lang === 'es' ? 'Pausar las sesiones de lectura activas cuando la pestaña o aplicación pasa a segundo plano.' : 'Pause active sessions when the tab or app goes to the background.',
              settings.trackerAutoPause !== 'off',
              () => onSaveSettings({ ...settings, trackerAutoPause: settings.trackerAutoPause !== 'off' ? 'off' : 'moderate' })
            )}

            {/* Pause after inactivity */}
            <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.86rem', fontWeight: 500, color: '#ffffff' }}>
                {lang === 'es' ? 'Pausar tras inactividad' : 'Pause after inactivity'}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '-4px' }}>
                {lang === 'es' ? 'La falta de cambios en el contador de caracteres durante el intervalo pausará la sesión.' : 'No position changes for the selected duration pauses the session.'}
              </span>
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '3px', width: '100%', border: '1px solid rgba(255,255,255,0.08)', marginTop: '4px' }}>
                {[
                  { label: lang === 'es' ? 'Desactivado' : 'Off', value: 0 },
                  { label: '30s', value: 0.5 },
                  { label: '60s', value: 1 },
                  { label: '120s', value: 2 }
                ].map((opt) => {
                  const isActive = settings.trackerIdleTime === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onSaveSettings({ ...settings, trackerIdleTime: opt.value })}
                      style={{
                        flex: 1,
                        background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                        color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 0',
                        fontSize: '0.82rem',
                        fontWeight: isActive ? '600' : '400',
                        cursor: 'pointer',
                        boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recover on launch */}
            {renderCheckboxCard(
              lang === 'es' ? 'Recuperar al iniciar' : 'Recover on launch',
              lang === 'es' ? 'Restaurar la sesión inacabada más reciente en estado pausado al siguiente inicio.' : 'Restore the most recent unfinished session in a paused state on next launch.',
              settings.recoverOnLaunch === true,
              () => onSaveSettings({ ...settings, recoverOnLaunch: !settings.recoverOnLaunch })
            )}
          </div>
        );
      })()}
    </>
  );
}
