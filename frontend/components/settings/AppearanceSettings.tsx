import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { getHomeLayout, resetHomeLayout, saveHomeLayout, RAILS, type RailId } from '../../utils/homeRails';

/**
 * Tema, acento, esquinas, idioma y la guía.
 *
 * Los cinco ajustes que tiñen la aplicación entera, juntos porque se tocan
 * juntos: se entra aquí a dejarla a tu gusto de una vez, no a cambiar uno suelto.
 *
 * Movido tal cual desde `Library.tsx`. El acceso a la guía estaba en un cartel
 * dorado en la cabecera de Ajustes y bajó aquí, que es donde la lista decía que
 * estaba: esta entrada se anuncia como «Tema, idioma y guía».
 */
function railBtn(disabled: boolean): React.CSSProperties {
  return {
    width: '26px', height: '26px', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)',
    background: 'none', color: 'var(--text-muted)',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
  };
}

const ACCENTS = [
  { id: 'gold', es: 'Dorado de Yoru', en: 'Yoru gold', swatch: '#f2c866' },
  { id: 'crimson', es: 'Carmesí', en: 'Crimson', swatch: '#f0888f' },
  { id: 'jade', es: 'Jade', en: 'Jade', swatch: '#6fd1a6' },
  { id: 'indigo', es: 'Índigo', en: 'Indigo', swatch: '#8fa8f0' },
  { id: 'violet', es: 'Violeta', en: 'Violet', swatch: '#c197ef' },
];

function HomeRailsEditor({ lang }: { lang: string }) {
  const [layout, setLayout] = useState(() => getHomeLayout());
  const hidden = new Set(layout.hidden);

  const apply = (next: typeof layout) => {
    setLayout(next);
    saveHomeLayout(next);
  };

  const move = (index: number, delta: number) => {
    const order = [...layout.order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    apply({ ...layout, order });
  };

  const toggle = (id: RailId) => {
    const next = hidden.has(id)
      ? layout.hidden.filter((entry) => entry !== id)
      : [...layout.hidden, id];
    apply({ ...layout, hidden: next });
  };

  const byId = new Map(RAILS.map((rail) => [rail.id, rail]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {layout.order.map((id, index) => {
        const rail = byId.get(id);
        if (!rail) return null;
        const off = hidden.has(id);
        return (
          <div
            key={id}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-raised)',
              opacity: off ? 0.5 : 1,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, fontSize: '0.84rem', color: 'var(--text-main)' }}>
              {lang === 'es' ? rail.es : rail.en}
            </span>
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={lang === 'es' ? 'Subir' : 'Move up'}
              style={railBtn(index === 0)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === layout.order.length - 1}
              aria-label={lang === 'es' ? 'Bajar' : 'Move down'}
              style={railBtn(index === layout.order.length - 1)}
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-pressed={off}
              aria-label={off
                ? (lang === 'es' ? 'Mostrar' : 'Show')
                : (lang === 'es' ? 'Esconder' : 'Hide')}
              style={railBtn(false)}
            >
              {off ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => { resetHomeLayout(); setLayout(getHomeLayout()); }}
        style={{
          alignSelf: 'flex-start', marginTop: '6px', padding: '6px 12px',
          border: '1px solid var(--border-light)', borderRadius: 'var(--radius-pill)',
          background: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer',
        }}
      >
        {lang === 'es' ? 'Volver al orden de siempre' : 'Back to the usual order'}
      </button>
    </div>
  );
}

export default function AppearanceSettings({
  lang,
  settings,
  onSaveSettings,
  onOpenTutorial,
  isMobile,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  onOpenTutorial: () => void;
  /** Pantalla estrecha: los dos bloques pasan de dos columnas a una. */
  isMobile: boolean;
}) {
  return (
        <div className="settings-section-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Palette size={18} style={{ color: 'var(--primary)' }} />
            <span>{lang === 'es' ? 'Apariencia e idioma' : 'Appearance & Language'}</span>
          </h3>

          {/*
            La guía, aquí dentro.

            Estaba en un cartel dorado a toda anchura en la cabecera de Ajustes,
            encima de todo lo demás. Un cartel así solo se lee la primera vez;
            a partir de ahí es un trozo de pantalla que se salta. Esta entrada
            de la lista ya se anuncia como «Tema, idioma y guía», así que la
            guía va donde la lista dice que está, y en el tamaño que le toca.
          */}
          <div className="settings-row-control">
            <span className="settings-label-text">
              {lang === 'es' ? 'Guía de Yoru Reader' : 'Yoru Reader guide'}
            </span>
            <button type="button" className="settings-btn" onClick={() => onOpenTutorial()}>
              <Sparkles size={15} />
              {lang === 'es' ? 'Ver de nuevo' : 'See it again'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
              {/*
                Un solo control de esquema. Antes había dos llamados «tema», aquí
                y en «Estilo de texto», con vocabularios distintos — y no eran
                dos ajustes: los dos escribían `settings.theme`. El de allí decía
                además «se aplica únicamente a la página de lectura», que era
                falso. Aquí queda el único, con un vocabulario.
              */}
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                {lang === 'es' ? 'Esquema' : 'Color scheme'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dark)', marginBottom: '10px' }}>
                {lang === 'es'
                  ? 'Los colores de toda la app: catálogo, lector y ajustes.'
                  : 'The colours of the whole app: catalog, reader and settings.'}
              </div>
              <select
                value={settings.theme || 'dark'}
                onChange={(e) => onSaveSettings({ ...settings, theme: e.target.value })}
                className="migaku-select"
                style={{ width: '100%' }}
              >
                <option value="system">{lang === 'es' ? 'Sistema' : 'System'}</option>
                <option value="light">{lang === 'es' ? 'Claro' : 'Light'}</option>
                <option value="dark">{lang === 'es' ? 'Oscuro' : 'Dark'}</option>
                <option value="sepia">{lang === 'es' ? 'Sepia' : 'Sepia'}</option>
              </select>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-dark)', marginTop: '8px' }}>
                {settings.theme === 'system'
                  ? (lang === 'es' ? 'Sigue al escritorio y cambia con él.' : 'Follows your desktop and changes with it.')
                  : settings.theme === 'sepia'
                    ? (lang === 'es' ? 'Papel cálido; el más descansado para leer de noche.' : 'Warm paper; the easiest on the eyes at night.')
                    : ''}
              </div>

              {/*
                Acento. El dorado va primero y es el que viene puesto: es la
                identidad de Yoru, no una opción más de la lista.
              */}
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)', margin: '18px 0 4px' }}>
                {lang === 'es' ? 'Acento' : 'Accent'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dark)', marginBottom: '10px' }}>
                {lang === 'es' ? 'El color de los botones y lo marcado.' : 'The colour of buttons and selected things.'}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {ACCENTS.map((accent) => {
                  const active = (settings.accent || 'gold') === accent.id;
                  return (
                    <button
                      key={accent.id}
                      type="button"
                      onClick={() => onSaveSettings({ ...settings, accent: accent.id })}
                      title={lang === 'es' ? accent.es : accent.en}
                      aria-label={lang === 'es' ? accent.es : accent.en}
                      aria-pressed={active}
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: 'var(--radius-pill)',
                        background: accent.swatch,
                        border: active ? '2px solid var(--text-main)' : '1px solid var(--border-light)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>

              {/*
                Radio de las esquinas. Mueve `--radius-base`, del que cuelgan los
                cuatro peldaños; antes cada pieza traía el suyo, 27 en total.
              */}
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)', margin: '18px 0 4px' }}>
                {lang === 'es' ? 'Esquinas' : 'Corners'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dark)', marginBottom: '10px' }}>
                {lang === 'es' ? 'De esquina viva a muy redondeada.' : 'From sharp to very rounded.'}
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={typeof settings.cornerRadius === 'number' ? settings.cornerRadius : 10}
                onChange={(e) => onSaveSettings({ ...settings, cornerRadius: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
                aria-label={lang === 'es' ? 'Radio de las esquinas' : 'Corner radius'}
              />

              {/*
                El título bajo la portada, para toda la app. No tiene nada que
                ver con «difuminar portada», que es por libro y esconde la
                imagen; este dice si debajo va el nombre o no va nada.
              */}
              <label
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  margin: '18px 0 0', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.showPosterTitles !== false}
                  onChange={(e) => onSaveSettings({ ...settings, showPosterTitles: e.target.checked })}
                  style={{ marginTop: '3px' }}
                />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)' }}>
                    {lang === 'es' ? 'Títulos bajo la portada' : 'Titles under covers'}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-dark)' }}>
                    {lang === 'es'
                      ? 'Quítalos y las cuadrículas se quedan solo en portadas.'
                      : 'Turn them off and the grids are covers only.'}
                  </span>
                </span>
              </label>
            </div>

            {/* Organizar inicio: el orden de los carruseles y los que se esconden. */}
            <div style={{ background: 'var(--surface-soft)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                {lang === 'es' ? 'Organizar inicio' : 'Arrange home'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dark)', marginBottom: '10px' }}>
                {lang === 'es'
                  ? 'Inicio puede llegar a once carruseles. Ponlos en tu orden y esconde los que no uses.'
                  : 'Home can reach eleven rails. Put them in your order and hide the ones you never use.'}
              </div>
              <HomeRailsEditor lang={lang} />
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff', marginBottom: '4px' }}>
                {lang === 'es' ? 'Idioma de la Interfaz' : 'Interface Language'}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#888899', marginBottom: '10px' }}>
                {lang === 'es' ? 'Idioma general de menús y opciones.' : 'Language for menus and app settings.'}
              </div>
              <select 
                value={settings.appLanguage || 'en'}
                onChange={(e) => {
                  const selectedLang = e.target.value;
                  localStorage.setItem('app_language', selectedLang);
                  onSaveSettings({ ...settings, appLanguage: selectedLang });
                }}
                className="migaku-select"
                style={{ width: '100%' }}
              >
                <option value="es">Español 🇪🇸</option>
                <option value="en">English 🇺🇸</option>
              </select>
            </div>
          </div>
        </div>
  );
}
