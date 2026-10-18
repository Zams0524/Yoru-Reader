import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { ReaderSettingsState } from '../../hooks/useReaderSettings';

interface ReaderColors {
  textMain: string;
  textMuted: string;
  headerBg?: string;
  border?: string;
  popoverBg?: string;
  cardBg?: string;
  accent: string;
}

interface ReaderSettingsProps {
  settings: ReaderSettingsState;
  onSettingChange: <K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => void;
  onOpenExtensionSettings?: () => void;
  colors: ReaderColors;
  lang: string;
}

export default function ReaderSettings({
  settings,
  onSettingChange,
  onOpenExtensionSettings,
  colors,
  lang,
}: ReaderSettingsProps) {
  const {
    fontSize,
    lineHeight,
    verticalPadding,
    horizontalPadding,
    vertical,
    paginated,
    theme,
    showProgressLine,
    disableCss,
    direction,
  } = settings;

  // State for custom theme creator
  const [customThemeName, setCustomThemeName] = useState('Custom');
  const [customBg, setCustomBg] = useState(() => localStorage.getItem('reader:customBg') || '#08080a');
  const [customText, setCustomText] = useState(() => localStorage.getItem('reader:customText') || '#ffffff');

  // Helper to adjust numerical settings with bounds
  const adjustValue = (
    key: 'fontSize' | 'lineHeight' | 'verticalPadding' | 'horizontalPadding',
    step: number,
    min: number,
    max: number
  ) => {
    const newVal = Math.max(min, Math.min(max, settings[key] + step));
    onSettingChange(key, Math.round(newVal * 100) / 100);
  };

  // Sync flow segment changes to vertical state
  const handleFlowChange = (isPaged: boolean) => {
    onSettingChange('paginated', isPaged);
    if (!isPaged) {
      // Continuous mode is only for horizontal mode.
      onSettingChange('direction', 'horizontal');
      onSettingChange('vertical', false);
    }
  };

  // Sync direction segment changes to vertical state
  const handleDirectionChange = (mode: 'auto' | 'vertical' | 'horizontal') => {
    onSettingChange('direction', mode);
    if (mode === 'vertical') {
      onSettingChange('vertical', true);
    } else if (mode === 'horizontal') {
      onSettingChange('vertical', false);
    } else {
      // Auto: defaults to vertical LN standard
      onSettingChange('vertical', true);
    }

    // Auto and Vertical can only be Paged. Switch flow to Paged if active.
    if (mode === 'auto' || mode === 'vertical') {
      onSettingChange('paginated', true);
    }
  };

  const handleSaveCustomTheme = () => {
    localStorage.setItem('reader:customBg', customBg);
    localStorage.setItem('reader:customText', customText);
    onSettingChange('theme', 'custom' as any);
  };

  const activeTheme = theme || 'dark';
  const activeDirection = direction || 'auto';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', color: 'inherit', fontSize: '0.85rem' }}>
      
      {/* READER Section */}
      <div className="flow-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="settings-popover-section-label" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1px' }}>
          READER
        </div>

        {/* FLOW: Paged / Continuous */}
        <div>
          <div className="settings-popover-section-label">FLOW</div>
          <div className="settings-segmented-container">
            <button
              className={`settings-segmented-btn ${paginated ? 'active' : ''}`}
              onClick={() => handleFlowChange(true)}
            >
              Paged
            </button>
            <button
              className={`settings-segmented-btn ${!paginated ? 'active' : ''}`}
              onClick={() => handleFlowChange(false)}
            >
              Continuous
            </button>
          </div>
        </div>

        {/* DIRECTION: Auto / Vertical / Horizontal */}
        <div className="direction-container">
          <div className="settings-popover-section-label">DIRECTION</div>
          <div className="settings-segmented-container">
            <button
              className={`settings-segmented-btn ${activeDirection === 'auto' ? 'active' : ''}`}
              onClick={() => handleDirectionChange('auto')}
              disabled={!paginated}
              style={!paginated ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
            >
              Auto
            </button>
            <button
              className={`settings-segmented-btn ${activeDirection === 'vertical' ? 'active' : ''}`}
              onClick={() => handleDirectionChange('vertical')}
              disabled={!paginated}
              style={!paginated ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
            >
              Vertical
            </button>
            <button
              className={`settings-segmented-btn ${activeDirection === 'horizontal' ? 'active' : ''}`}
              onClick={() => handleDirectionChange('horizontal')}
            >
              Horizontal
            </button>
          </div>
        </div>

        {/* TYPE options */}
        <div>
          <div className="settings-popover-section-label" style={{ marginBottom: '10px' }}>
            TYPE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            
            {/* Font size */}
            <div className="settings-slider-card">
              <div className="settings-slider-header">
                <span>Font size</span>
                <span className="settings-slider-value">{fontSize} px</span>
              </div>
              <div className="settings-slider-controls">
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('fontSize', -1, 10, 60)}
                >
                  −
                </button>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="1"
                  value={fontSize}
                  onChange={(e) => onSettingChange('fontSize', Number(e.target.value))}
                  className="settings-slider-input"
                />
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('fontSize', 1, 10, 60)}
                >
                  +
                </button>
              </div>
            </div>

            {/* Line height */}
            <div className="settings-slider-card">
              <div className="settings-slider-header">
                <span>Line height</span>
                <span className="settings-slider-value">{lineHeight.toFixed(2)}</span>
              </div>
              <div className="settings-slider-controls">
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('lineHeight', -0.05, 1.0, 3.0)}
                >
                  −
                </button>
                <input
                  type="range"
                  min="1.0"
                  max="3.0"
                  step="0.05"
                  value={lineHeight}
                  onChange={(e) => onSettingChange('lineHeight', Number(e.target.value))}
                  className="settings-slider-input"
                />
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('lineHeight', 0.05, 1.0, 3.0)}
                >
                  +
                </button>
              </div>
            </div>

            {/* Side margin */}
            <div className="settings-slider-card">
              <div className="settings-slider-header">
                <span>Side margin</span>
                <span className="settings-slider-value">{horizontalPadding}%</span>
              </div>
              <div className="settings-slider-controls">
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('horizontalPadding', -1, 0, 30)}
                >
                  −
                </button>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={horizontalPadding}
                  onChange={(e) => onSettingChange('horizontalPadding', Number(e.target.value))}
                  className="settings-slider-input"
                />
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('horizontalPadding', 1, 0, 30)}
                >
                  +
                </button>
              </div>
            </div>

            {/* Top/bottom margin */}
            <div className="settings-slider-card">
              <div className="settings-slider-header">
                <span>Top/bottom margin</span>
                <span className="settings-slider-value">{verticalPadding}%</span>
              </div>
              <div className="settings-slider-controls">
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('verticalPadding', -1, 0, 20)}
                >
                  −
                </button>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={verticalPadding}
                  onChange={(e) => onSettingChange('verticalPadding', Number(e.target.value))}
                  className="settings-slider-input"
                />
                <button
                  className="settings-slider-btn"
                  onClick={() => adjustValue('verticalPadding', 1, 0, 20)}
                >
                  +
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* STYLE Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
        <div className="settings-popover-section-label" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1px' }}>
          STYLE
        </div>

        {/* Book theme */}
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.9, textAlign: 'left', marginBottom: '2px' }}>Book theme</div>
          <div style={{ fontSize: '0.7rem', opacity: 0.6, textAlign: 'left', marginBottom: '10px' }}>Applies only to the book page</div>
          <div className="theme-cards-container">
            {/* White theme */}
            <div
              className={`theme-card ${activeTheme === 'light' ? 'active' : ''}`}
              onClick={() => onSettingChange('theme', 'light')}
            >
              <div style={{ background: '#ffffff', color: '#121214', width: '60px', height: '36px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.95rem', border: '1px solid rgba(0,0,0,0.1)' }}>
                Aa
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.75rem', fontWeight: 700 }}>White</div>
            </div>

            {/* Paper theme */}
            <div
              className={`theme-card ${activeTheme === 'sepia' ? 'active' : ''}`}
              onClick={() => onSettingChange('theme', 'sepia')}
            >
              <div style={{ background: '#fcfaf2', color: '#5c4b37', width: '60px', height: '36px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.95rem', border: '1px solid rgba(92, 75, 55, 0.2)' }}>
                Aa
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.75rem', fontWeight: 700 }}>Paper</div>
            </div>

            {/* Dark theme */}
            <div
              className={`theme-card ${activeTheme === 'dark' ? 'active' : ''}`}
              onClick={() => onSettingChange('theme', 'dark')}
            >
              <div style={{ background: '#1c1c1e', color: '#ffffff', width: '60px', height: '36px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.95rem', border: '1px solid rgba(255,255,255,0.15)' }}>
                Aa
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.75rem', fontWeight: 700 }}>Dark</div>
            </div>
          </div>
        </div>

        {/* Create custom theme option */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '12px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.9, textAlign: 'left', marginBottom: '8px' }}>
            Create custom theme
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              value={customThemeName}
              onChange={(e) => setCustomThemeName(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--border-light)',
                background: 'var(--bg-app)',
                color: 'inherit',
                fontSize: '0.8rem',
                outline: 'none',
              }}
            />
            {/* Color pickers */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '0.65rem', cursor: 'pointer' }}>
                <span>Page</span>
                <input
                  type="color"
                  value={customBg}
                  onChange={(e) => setCustomBg(e.target.value)}
                  style={{ width: '22px', height: '22px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '0.65rem', cursor: 'pointer' }}>
                <span>Text</span>
                <input
                  type="color"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  style={{ width: '22px', height: '22px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                />
              </label>
            </div>
          </div>
          <button
            onClick={handleSaveCustomTheme}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '8px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary)',
              color: activeTheme === 'dark' ? '#050506' : '#ffffff',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Save custom theme
          </button>
        </div>

        {/* Checkbox options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          {/* Footer progress */}
          <div
            className="style-option-card"
            onClick={() => onSettingChange('showProgressLine', !showProgressLine)}
          >
            <div className="style-option-info">
              <span className="style-option-title">Footer progress</span>
              <span className="style-option-desc">Show the thin chapter progress line</span>
            </div>
            <div className={`style-option-checkbox ${showProgressLine ? 'checked' : ''}`}>
              {showProgressLine && <Check size={12} color="#fff" strokeWidth={3} />}
            </div>
          </div>

          {/* Publisher formatting */}
          <div
            className="style-option-card"
            onClick={() => onSettingChange('disableCss', !disableCss)}
          >
            <div className="style-option-info">
              <span className="style-option-title">Publisher formatting</span>
              <span className="style-option-desc">Keep book layout and typography where possible</span>
            </div>
            <div className={`style-option-checkbox ${!disableCss ? 'checked' : ''}`}>
              {!disableCss && <Check size={12} color="#fff" strokeWidth={3} />}
            </div>
          </div>

          {/* Extension Settings button */}
          {onOpenExtensionSettings && (
            <button
              onClick={onOpenExtensionSettings}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: `1px solid rgba(245, 158, 11, 0.3)`,
                background: 'rgba(245, 158, 11, 0.08)',
                color: '#f59e0b',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                marginTop: '4px',
              }}
            >
              ⚙️ {lang === 'es' ? 'Ajustes de parseo / extensión' : 'Parse / Extension settings'}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}
