import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, MinusCircle, PanelsTopLeft, Palette, PlusCircle, Settings, Type } from 'lucide-react';
import { BUILT_IN_FONTS, ReaderSettingsState, guardarAntesDeLimpio, recuperarAntesDeLimpio, valoresDeLimpio } from '../../hooks/useReaderSettings';
import { isNativeReaderAvailable } from '../../utils/nativeReader';

interface ReaderSettingsPopoverProps {
  settings: ReaderSettingsState;
  onSettingChange: <K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => void;
  onClose: () => void;
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
  onOpenExtensionSettings,
  lang,
  onSettingChange,
}: ReaderSettingsPopoverProps) {
  const { fontSize, lineHeight, verticalPadding, horizontalPadding, paginated, theme, showProgressLine, disableCss, direction, fontFamily } = settings;
  const fontWeight = settings.fontWeight || 400;
  const textAlign = settings.textAlign || 'original';
  const hyphenation = !!settings.hyphenation;
  const dictPopupPlacement = settings.dictPopupPlacement === 'clasico' ? 'clasico' : 'leido';
  const es = lang === 'es';
  const nativeAvailable = isNativeReaderAvailable();
  const [seccion, setSeccion] = useState<'apariencia' | 'texto' | 'diseno' | 'comportamiento' | null>(null);

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

  /*
    Modo limpio. Encenderlo pone también el color y la fuente que le van, y recuerda los
    que había para devolverlos al apagarlo; entre medias cada uno se cambia por su lado.
  */
  const setModoLimpio = (on: boolean) => {
    const claves = ['theme', 'fontFamily', 'fontSize', 'lineHeight', 'horizontalPadding', 'verticalPadding', 'textAlign', 'fontWeight'] as const;
    const poner = <K extends keyof ReaderSettingsState>(clave: K, valor: ReaderSettingsState[K] | undefined) => {
      if (valor !== undefined) onSettingChange(clave, valor);
    };
    if (on) {
      guardarAntesDeLimpio({ theme, fontFamily, fontSize, lineHeight, horizontalPadding, verticalPadding, textAlign, fontWeight });
      const valores = valoresDeLimpio();
      for (const clave of claves) poner(clave, valores[clave]);
    } else {
      const antes = recuperarAntesDeLimpio();
      poner('theme', antes.theme && antes.theme !== 'grafito' ? antes.theme : 'dark');
      poner('fontFamily', antes.fontFamily || '__default__');
      for (const clave of ['fontSize', 'lineHeight', 'horizontalPadding', 'verticalPadding', 'textAlign', 'fontWeight'] as const) poner(clave, antes[clave]);
    }
    onSettingChange('modoLimpio', on);
  };

  const fonts = BUILT_IN_FONTS.some((font) => font.value === fontFamily)
    ? BUILT_IN_FONTS
    : [...BUILT_IN_FONTS, { label: fontFamily, value: fontFamily }];

  const secciones = [
    { id: 'apariencia', Icono: Palette, titulo: es ? 'Apariencia' : 'Appearance' },
    { id: 'texto', Icono: Type, titulo: es ? 'Texto' : 'Text' },
    { id: 'diseno', Icono: PanelsTopLeft, titulo: es ? 'Diseño' : 'Layout' },
    { id: 'comportamiento', Icono: Settings, titulo: es ? 'Comportamiento' : 'Behaviour' },
  ] as const;
  const abierta = secciones.find((item) => item.id === seccion) || null;

  /*
    La hoja de ajustes: sube desde abajo, primero
    las cuatro categorías y dentro de cada una sus ajustes, con una flecha para
    volver. Los ajustes son los de siempre; lo que cambia es dónde están.
  */
  return (
    <>
      {/* Not a hole of the native reader: the page stays visible around the card (a tap on it closes the card). */}
      <div className="readera-settings-backdrop" data-native-ignore onClick={onClose} />
      <div className="readera-settings is-sheet" role="dialog" aria-label={es ? 'Ajustes del lector' : 'Reader settings'}>
        <button type="button" className="readera-sheet-handle" onClick={onClose} aria-label={es ? 'Cerrar' : 'Close'}><span /></button>
        <div className="readera-sheet-head">
          {abierta && (
            <button type="button" className="readera-sheet-back" onClick={() => setSeccion(null)} aria-label={es ? 'Volver a las categorías' : 'Back to the categories'}>
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="readera-sheet-title">{abierta ? abierta.titulo : (es ? 'Ajustes del lector' : 'Reader settings')}</div>
        </div>
        {abierta && (
          <p className="readera-sheet-note">{es ? 'Los cambios se aplican al momento.' : 'Changes apply right away.'}</p>
        )}

        <div className="readera-settings-body">
          {!abierta && (
            <div className="readera-sheet-cats">
              {secciones.map(({ id, Icono, titulo }) => (
                <button key={id} type="button" className="readera-sheet-cat" onClick={() => setSeccion(id)}>
                  <Icono size={18} aria-hidden="true" />
                  <span>{titulo}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {seccion === 'apariencia' && (
            <>
            <SwitchRow
              label={es ? 'Modo limpio' : 'Clean mode'}
              checked={!!settings.modoLimpio}
              onChange={setModoLimpio}
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
                { value: 'grafito', label: es ? 'Grafito' : 'Graphite' },
              ]}
              onChange={(value) => onSettingChange('theme', value as ReaderSettingsState['theme'])}
            />
            <SwitchRow
              label={es ? 'Barra de progreso' : 'Progress line'}
              checked={!!showProgressLine}
              onChange={(value) => onSettingChange('showProgressLine', value)}
            />
            <SwitchRow
              label={es ? 'Ocultar imágenes (spoilers)' : 'Hide images (spoilers)'}
              checked={!!settings.hideImages}
              onChange={(value) => onSettingChange('hideImages', value)}
            />
            </>
          )}
          {seccion === 'texto' && (
            <>
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
              label={es ? 'Furigana' : 'Furigana'}
              checked={settings.showFurigana !== false}
              onChange={(value) => onSettingChange('showFurigana', value)}
            />
            <SwitchRow
              label={es ? 'Formato del editor' : 'Publisher formatting'}
              checked={!disableCss}
              onChange={(value) => onSettingChange('disableCss', !value)}
            />
            </>
          )}
          {seccion === 'diseno' && (
            <>
            <PickerRow
              label={es ? 'Paso de página' : 'Page flipping'}
              value={paginated ? 'paged' : 'continuous'}
              options={[
                { value: 'paged', label: es ? 'Por páginas' : 'Paged' },
                { value: 'continuous', label: es ? 'Continuo (desplazar)' : 'Continuous (scroll)' },
              ]}
              onChange={setFlow}
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
            </>
          )}
          {seccion === 'comportamiento' && (
            <>
            <PickerRow
              label={es ? 'Posición del diccionario' : 'Dictionary position'}
              value={dictPopupPlacement}
              options={[
                { value: 'leido', label: es ? 'Sobre lo ya leído' : 'Over what you read' },
                { value: 'clasico', label: es ? 'Junto a la palabra (clásico)' : 'Next to the word (classic)' },
              ]}
              onChange={(value) => onSettingChange('dictPopupPlacement', value === 'clasico' ? 'clasico' : 'leido')}
            />
            {nativeAvailable && (
              <SwitchRow
                label={es ? 'Motor nativo (beta)' : 'Native engine (beta)'}
                checked={settings.nativeEngine !== false}
                onChange={(value) => onSettingChange('nativeEngine', value)}
              />
            )}
            {onOpenExtensionSettings && (
              <button type="button" className="readera-settings-row readera-settings-link" onClick={onOpenExtensionSettings}>
                {es ? 'Ajustes de parseo / extensión' : 'Parse / extension settings'}
              </button>
            )}
  
            </>
          )}
        </div>
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
          <div className="readera-dropdown-backdrop" data-native-ignore onClick={() => setOpen(false)} />
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
