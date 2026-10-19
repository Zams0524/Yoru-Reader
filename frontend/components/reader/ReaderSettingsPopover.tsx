import React from 'react';
import { ChevronDown, MinusCircle, PlusCircle } from 'lucide-react';
import { BUILT_IN_FONTS, ReaderSettingsState } from '../../hooks/useReaderSettings';

interface ReaderSettingsPopoverProps {
  settings: ReaderSettingsState;
  onSettingChange: <K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => void;
  onClose: () => void;
  onOpenFullSettings: () => void;
  onOpenExtensionSettings?: () => void;
  lang: string;
}

/**
 * Quick reader settings, laid out like ReadEra's book settings card: a dropdown card under the
 * top bar with one row per setting (pickers, − value + steppers and switches).
 */
export default function ReaderSettingsPopover({
  settings,
  onClose,
  onOpenFullSettings,
  onOpenExtensionSettings,
  lang,
  onSettingChange,
}: ReaderSettingsPopoverProps) {
  const { fontSize, lineHeight, verticalPadding, horizontalPadding, paginated, theme, showProgressLine, disableCss, direction, fontFamily } = settings;
  const es = lang === 'es';

  const clampSet = (key: 'fontSize' | 'lineHeight' | 'verticalPadding' | 'horizontalPadding', value: number, min: number, max: number) => {
    onSettingChange(key, Math.round(Math.max(min, Math.min(max, value)) * 100) / 100);
  };

  // Page flipping: paged, or continuous scrolling (continuous is horizontal text only).
  const setFlow = (value: string) => {
    const isPaged = value === 'paged';
    onSettingChange('paginated', isPaged);
    if (!isPaged) {
      onSettingChange('direction', 'horizontal');
      onSettingChange('vertical', false);
    }
  };

  const setDirection = (mode: 'auto' | 'vertical' | 'horizontal') => {
    onSettingChange('direction', mode);
    onSettingChange('vertical', mode !== 'horizontal');
    if (mode !== 'horizontal') onSettingChange('paginated', true);
  };

  const fonts = BUILT_IN_FONTS.some((font) => font.value === fontFamily)
    ? BUILT_IN_FONTS
    : [...BUILT_IN_FONTS, { label: fontFamily, value: fontFamily }];

  return (
    <>
      <div className="readera-settings-backdrop" onClick={onClose} />
      <div className="readera-settings" role="dialog" aria-label={es ? 'Ajustes del libro' : 'Book settings'}>
        <div className="readera-settings-title">{es ? 'AJUSTES DEL LIBRO · EPUB, TXT, HTML' : 'BOOK SETTINGS · EPUB, TXT, HTML'}</div>

        <div className="readera-settings-body">
          <PickerRow
            label={es ? 'Paso de página' : 'Page flipping'}
            value={paginated ? 'paged' : 'continuous'}
            options={[
              { value: 'paged', label: es ? 'Por páginas' : 'Paged' },
              { value: 'continuous', label: es ? 'Continuo (desplazar)' : 'Continuous (scroll)' },
            ]}
            onChange={setFlow}
          />
          <PickerRow
            label={es ? 'Modo de color' : 'Color mode'}
            value={theme || 'dark'}
            options={[
              { value: 'light', label: es ? 'Día' : 'Day' },
              { value: 'sepia', label: es ? 'Papel' : 'Paper' },
              { value: 'dark', label: es ? 'Noche' : 'Night' },
            ]}
            onChange={(value) => onSettingChange('theme', value as ReaderSettingsState['theme'])}
          />
          <PickerRow
            label={es ? 'Fuente' : 'Font face'}
            value={fontFamily || '__default__'}
            options={fonts.map((font) => ({ value: font.value, label: font.value === '__default__' ? (es ? 'Predeterminada' : 'Default') : font.label }))}
            onChange={(value) => onSettingChange('fontFamily', value)}
          />
          <StepperRow
            label={es ? 'Tamaño de letra' : 'Font size'}
            display={String(fontSize)}
            onMinus={() => clampSet('fontSize', fontSize - 1, 10, 60)}
            onPlus={() => clampSet('fontSize', fontSize + 1, 10, 60)}
            es={es}
          />
          <StepperRow
            label={es ? 'Interlineado' : 'Line spacing'}
            display={`${Math.round(lineHeight * 100)}%`}
            onMinus={() => clampSet('lineHeight', lineHeight - 0.05, 1, 3)}
            onPlus={() => clampSet('lineHeight', lineHeight + 0.05, 1, 3)}
            es={es}
          />
          <StepperRow
            label={es ? 'Márgenes laterales' : 'Side margins'}
            display={`${horizontalPadding}%`}
            onMinus={() => clampSet('horizontalPadding', horizontalPadding - 1, 0, 30)}
            onPlus={() => clampSet('horizontalPadding', horizontalPadding + 1, 0, 30)}
            es={es}
          />
          <StepperRow
            label={es ? 'Márgenes arriba/abajo' : 'Top/bottom margins'}
            display={`${verticalPadding}%`}
            onMinus={() => clampSet('verticalPadding', verticalPadding - 1, 0, 20)}
            onPlus={() => clampSet('verticalPadding', verticalPadding + 1, 0, 20)}
            es={es}
          />
          <PickerRow
            label={es ? 'Dirección del texto' : 'Text direction'}
            value={direction || 'auto'}
            options={[
              { value: 'auto', label: es ? 'Automática' : 'Automatic' },
              { value: 'vertical', label: es ? 'Escritura vertical' : 'Vertical writing' },
              { value: 'horizontal', label: es ? 'Escritura horizontal' : 'Horizontal writing' },
            ]}
            onChange={(value) => setDirection(value as 'auto' | 'vertical' | 'horizontal')}
          />
          <SwitchRow
            label={es ? 'Barra de progreso' : 'Progress line'}
            checked={!!showProgressLine}
            onChange={(value) => onSettingChange('showProgressLine', value)}
          />
          <SwitchRow
            label={es ? 'Formato del editor' : 'Publisher formatting'}
            checked={!disableCss}
            onChange={(value) => onSettingChange('disableCss', !value)}
          />
          {onOpenExtensionSettings && (
            <button type="button" className="readera-settings-row readera-settings-link" onClick={onOpenExtensionSettings}>
              {es ? 'Ajustes de parseo / extensión' : 'Parse / extension settings'}
            </button>
          )}
        </div>

        <button type="button" className="readera-settings-footer" onClick={onOpenFullSettings}>
          {es ? 'AJUSTES GENERALES' : 'GENERAL SETTINGS'}
        </button>
      </div>
    </>
  );
}

function PickerRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="readera-settings-row">
      <span className="readera-settings-label">{label}</span>
      <span className="readera-settings-picker">
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown size={18} aria-hidden="true" />
      </span>
    </label>
  );
}

function StepperRow({ label, display, onMinus, onPlus, es }: { label: string; display: string; onMinus: () => void; onPlus: () => void; es: boolean }) {
  return (
    <div className="readera-settings-row">
      <span className="readera-settings-label">{label}</span>
      <div className="readera-settings-stepper">
        <button type="button" onClick={onMinus} aria-label={es ? `Menos ${label.toLowerCase()}` : `Less ${label.toLowerCase()}`}>
          <MinusCircle size={26} strokeWidth={1.6} />
        </button>
        <span className="readera-settings-value">{display}</span>
        <button type="button" onClick={onPlus} aria-label={es ? `Más ${label.toLowerCase()}` : `More ${label.toLowerCase()}`}>
          <PlusCircle size={26} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="readera-settings-row readera-settings-switch-row" onClick={() => onChange(!checked)}>
      <span className="readera-settings-switch-label">{label}</span>
      <span className={`readera-switch${checked ? ' on' : ''}`} aria-hidden="true"><span /></span>
    </button>
  );
}
