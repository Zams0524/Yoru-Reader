import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, MinusCircle, PlusCircle } from 'lucide-react';
import { BUILT_IN_FONTS, ReaderSettingsState } from '../../hooks/useReaderSettings';
import { isNativeReaderAvailable } from '../../utils/nativeReader';

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
  const fontWeight = settings.fontWeight || 400;
  const textAlign = settings.textAlign || 'original';
  const hyphenation = !!settings.hyphenation;
  const es = lang === 'es';
  const nativeAvailable = isNativeReaderAvailable();

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
              { value: 'dark', label: es ? 'Noche' : 'Night' },
              { value: 'night-contrast', label: es ? 'Noche contraste' : 'Night contrast' },
              { value: 'sepia', label: es ? 'Sepia' : 'Sepia' },
              { value: 'sepia-contrast', label: es ? 'Sepia contraste' : 'Sepia contrast' },
              { value: 'twilight', label: es ? 'Crepúsculo' : 'Twilight' },
              { value: 'console', label: es ? 'Consola' : 'Console' },
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
          <div className="readera-settings-row">
            <span className="readera-settings-label">{es ? 'Grosor de letra' : 'Font thickness'}</span>
            <input
              type="range"
              className="readera-settings-slider"
              min={200}
              max={800}
              step={100}
              value={fontWeight}
              onChange={(e) => onSettingChange('fontWeight', Number(e.target.value))}
              aria-label={es ? 'Grosor de letra' : 'Font thickness'}
              style={{ '--fill': `${((fontWeight - 200) / 600) * 100}%` } as React.CSSProperties}
            />
          </div>
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
            label={es ? 'Alineación del texto' : 'Text align'}
            value={textAlign}
            display={`${{
              original: es ? 'Original' : 'Original',
              justify: es ? 'Justificado' : 'Justify',
              left: es ? 'Izquierda' : 'Left',
              center: es ? 'Centrado' : 'Center',
              right: es ? 'Derecha' : 'Right',
            }[textAlign]}${hyphenation ? (es ? ' + guionado' : ' + hyphenation') : ''}`}
            header={(
              <button type="button" role="switch" aria-checked={hyphenation} className="readera-dropdown-switch" onClick={() => onSettingChange('hyphenation', !hyphenation)}>
                <span>{es ? 'Guionado' : 'Hyphenation'}</span>
                <span className={`readera-switch${hyphenation ? ' on' : ''}`} aria-hidden="true"><span /></span>
              </button>
            )}
            options={[
              { value: 'justify', label: es ? 'Justificado' : 'Justify' },
              { value: 'left', label: es ? 'Izquierda' : 'Left' },
              { value: 'center', label: es ? 'Centrado' : 'Center' },
              { value: 'right', label: es ? 'Derecha' : 'Right' },
              { value: 'original', label: es ? 'Original' : 'Original' },
            ]}
            onChange={(value) => onSettingChange('textAlign', value as ReaderSettingsState['textAlign'])}
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
          {nativeAvailable && (
            <SwitchRow
              label={es ? 'Motor nativo (beta, sin diccionario aún)' : 'Native engine (beta, no dictionary yet)'}
              checked={settings.nativeEngine !== false}
              onChange={(value) => onSettingChange('nativeEngine', value)}
            />
          )}
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

/** Row with a ReadEra-style dropdown list that opens over the card. */
function PickerRow({ label, value, options, onChange, display, header }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  display?: string;
  header?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const current = options.find((option) => option.value === value);

  // Open under the value, shifted up when it would leave the screen.
  useLayoutEffect(() => {
    if (!open || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const listHeight = listRef.current?.offsetHeight || 0;
    const margin = 12;
    const top = Math.max(margin, Math.min(rect.top + 22, window.innerHeight - listHeight - margin));
    setPosition({ top, left: rect.left + 44, width: Math.max(180, rect.width - 50) });
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={rowRef}
        className="readera-settings-row readera-settings-picker-row"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="readera-settings-label">{label}</span>
        <span className="readera-settings-picker">
          <span className="readera-settings-picker-value">{display ?? current?.label ?? value}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <>
          <div className="readera-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div
            ref={listRef}
            className="readera-dropdown"
            role="listbox"
            aria-label={label}
            style={position ? { top: position.top, left: position.left, width: position.width } : { visibility: 'hidden' }}
          >
            {header && <div className="readera-dropdown-header">{header}</div>}
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? 'selected' : ''}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
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
