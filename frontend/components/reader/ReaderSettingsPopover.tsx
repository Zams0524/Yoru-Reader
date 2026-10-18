import React from 'react';
import { ChevronRight, Check } from 'lucide-react';
import { ReaderSettingsState } from '../../hooks/useReaderSettings';

interface ReaderSettingsPopoverProps {
  settings: ReaderSettingsState;
  onSettingChange: <K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => void;
  onClose: () => void;
  onOpenFullSettings: () => void;
  onOpenExtensionSettings?: () => void;
  lang: string;
}

export default function ReaderSettingsPopover({
  settings,
  onClose,
  onOpenFullSettings,
  onOpenExtensionSettings,
  lang,
  onSettingChange,
}: ReaderSettingsPopoverProps) {
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

  const isEs = lang === 'es';

  // Helper to adjust numerical settings with bounds
  const adjustValue = (
    key: 'fontSize' | 'lineHeight' | 'verticalPadding' | 'horizontalPadding',
    step: number,
    min: number,
    max: number
  ) => {
    const newVal = Math.max(min, Math.min(max, settings[key] + step));
    // Round to 2 decimals to prevent JS floating point precision issues (like 1.35000000002)
    onSettingChange(key, Math.round(newVal * 100) / 100);
  };

  // Sync flow segment changes to vertical state
  const handleFlowChange = (isPaged: boolean) => {
    onSettingChange('paginated', isPaged);
    if (!isPaged) {
      // Continuous mode is only for horizontal mode.
      // Force horizontal direction
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

  const activeTheme = theme || 'dark';
  const activeDirection = direction || 'auto';

  return (
    <>
      {/* Click outside backdrop for popover closing */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10001,
          background: 'transparent',
        }}
        onClick={onClose}
      />

      <div className="settings-popover-card">
        {/* Top arrow */}
        <div className="settings-popover-arrow" />

        {/* Header (Fixed) */}
        <div className="settings-popover-header">
          <span className="settings-popover-title">
            READER SETTINGS
          </span>
          <button className="settings-popover-done" onClick={onClose}>
            Done
          </button>
        </div>

        {/* Scrollable body */}
        <div className="settings-popover-body">
          {/* FLOW: Paged / Continuous */}
          <div className="flow-container">
            <div className="settings-popover-section-label">
              FLOW
            </div>
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
            <div className="settings-popover-section-label">
              DIRECTION
            </div>
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

          {/* TYPE */}
          <div>
            <div className="settings-popover-section-label" style={{ marginBottom: '10px' }}>
              TYPE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Font size slider */}
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

              {/* Line height slider */}
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

              {/* Side margin slider (Horizontal padding) */}
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

              {/* Top/bottom margin slider (Vertical padding) */}
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

          {/* STYLE */}
          <div>
            <div className="settings-popover-section-label" style={{ marginBottom: '10px' }}>
              STYLE
            </div>
            
            {/* Book theme */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.9, textAlign: 'left', marginBottom: '2px' }}>Book theme</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', textAlign: 'left', marginBottom: '10px' }} className="style-option-desc">Applies only to the book page</div>
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

            {/* Checkboxes Options */}
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

              {/* Parse / Extension Settings button */}
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
                  ⚙️ {isEs ? 'Ajustes de parseo / extensión' : 'Parse / Extension settings'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer (Fixed) */}
        <div className="settings-popover-footer" onClick={onOpenFullSettings}>
          <span>All settings</span>
          <ChevronRight size={16} />
        </div>
      </div>
    </>
  );
}
