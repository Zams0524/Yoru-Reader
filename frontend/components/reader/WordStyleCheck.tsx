import React, { useState } from 'react';
import { applyLocalWordStyles, usesLocalParserSettings, type WordEffect, type WordStyleThemeConfig } from '../../utils/parserSettingsStore';

/**
 * "Test in the reader": the sample uses the reader's real markup (`.jiten-word.<state>` spans) and
 * the stylesheet built from the SAVED configuration, then checks each word's computed style
 * against what was saved. It proves the colours really reach the reader, not just the preview.
 */

const SAMPLE: { state: string; text: string; es: string; en: string }[] = [
  { state: 'new', text: '事典', es: 'Nueva', en: 'New' },
  { state: 'young', text: '時', es: 'Joven', en: 'Young' },
  { state: 'mature', text: '新しい', es: 'Madura', en: 'Mature' },
  { state: 'due', text: '言葉', es: 'Pendiente', en: 'Due' },
  { state: 'blacklisted', text: '物', es: 'Lista negra', en: 'Blacklisted' },
];

interface CheckResult {
  state: string;
  ok: boolean;
  detail: string;
}

function hexToRgb(colour: string): [number, number, number] | null {
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return rgb.some(Number.isNaN) ? null : (rgb as [number, number, number]);
}

function rgbOf(computed: string): [number, number, number] | null {
  const match = computed.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b] = match[1].split(',').map((part) => parseFloat(part));
  return [r, g, b];
}

const sameColour = (expected: string, computed: string) => {
  const a = hexToRgb(expected);
  const b = rgbOf(computed);
  return !!a && !!b && a.every((value, i) => Math.abs(value - b[i]) <= 2);
};

function checkElement(element: HTMLElement, effects: WordEffect[], t: (es: string, en: string) => string): { ok: boolean; detail: string } {
  const style = getComputedStyle(element);
  const problems: string[] = [];
  const checked: string[] = [];
  for (const effect of effects) {
    if (effect.type === 'text-colour' && effect.colour) {
      checked.push(t('color', 'colour'));
      if (!sameColour(effect.colour, style.color)) problems.push(t(`color ${style.color} ≠ ${effect.colour}`, `colour ${style.color} ≠ ${effect.colour}`));
    } else if (effect.type === 'underline') {
      checked.push(t('subrayado', 'underline'));
      if (!style.textDecorationLine.includes('underline')) problems.push(t('sin subrayado', 'no underline'));
    } else if (effect.type === 'background' && effect.colour) {
      checked.push(t('fondo', 'background'));
      if (!sameColour(effect.colour, style.backgroundColor)) problems.push(t('fondo distinto', 'different background'));
    } else if (effect.type === 'opacity' && effect.value !== undefined && !effect.hoverOnly) {
      checked.push(t('opacidad', 'opacity'));
      if (Math.abs(parseFloat(style.opacity) - effect.value) > 0.02) problems.push(t(`opacidad ${style.opacity}`, `opacity ${style.opacity}`));
    } else if (effect.type === 'shadow') {
      checked.push(t('sombra', 'shadow'));
      if (!style.textShadow || style.textShadow === 'none') problems.push(t('sin sombra', 'no shadow'));
    }
  }
  if (problems.length) return { ok: false, detail: problems.join(', ') };
  return { ok: true, detail: checked.length ? checked.join(' · ') : t('sin efectos', 'no effects') };
}

interface Props {
  savedConfig: WordStyleThemeConfig;
  hasUnsavedChanges: boolean;
  t: (es: string, en: string) => string;
  colors: { border: string; textMain: string; textMuted: string; cardBg: string; accent: string };
  cardStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const WordStyleCheck: React.FC<Props> = ({ savedConfig, hasUnsavedChanges, t, colors, cardStyle, descStyle }) => {
  const sampleRef = React.useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const local = usesLocalParserSettings();

  const runCheck = () => {
    applyLocalWordStyles();
    const root = sampleRef.current;
    if (!root) return;
    setResults(SAMPLE.map(({ state }) => {
      const element = root.querySelector<HTMLElement>(`[data-check-state="${state}"]`);
      const effects = savedConfig?.states?.[state]?.effects || [];
      if (!element) return { state, ok: false, detail: t('no encontrado', 'not found') };
      return { state, ...checkElement(element, effects, t) };
    }));
  };

  const passed = results?.filter((result) => result.ok).length ?? 0;

  return (
    <div style={cardStyle}>
      <div style={descStyle}>
        {local
          ? t('Este texto usa las mismas clases que el lector y solo los estilos GUARDADOS. Pulsa «Probar» para comprobar que cada estado se ve como lo configuraste.',
            'This text uses the reader\'s own classes and only the SAVED styles. Press "Test" to check that every state looks as configured.')
          : t('En escritorio la extensión aplica estos estilos en el lector; aquí solo se puede ver la vista previa.',
            'On desktop the extension applies these styles in the reader; only the preview is available here.')}
      </div>
      {hasUnsavedChanges && (
        <div style={{ ...descStyle, color: '#fbbf24', marginTop: '6px' }}>
          {t('Tienes cambios sin guardar: la prueba usa la última configuración guardada.', 'You have unsaved changes: the test uses the last saved configuration.')}
        </div>
      )}
      <div
        ref={sampleRef}
        style={{ marginTop: '12px', padding: '14px', borderRadius: '8px', border: `1px solid ${colors.border}`, fontSize: '1.2rem', lineHeight: 2, fontFamily: 'var(--font-japanese), serif', color: colors.textMain, display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}
      >
        {SAMPLE.map((item) => (
          <span key={item.state} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className={`jiten-word ${item.state}`} data-check-state={item.state}>{item.text}</span>
            <span style={{ fontSize: '0.62rem', color: colors.textMuted, fontFamily: 'var(--font-ui), sans-serif', lineHeight: 1.2 }}>{t(item.es, item.en)}</span>
          </span>
        ))}
      </div>
      {local && (
        <button
          type="button"
          onClick={runCheck}
          style={{ marginTop: '12px', padding: '8px 14px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.textMain, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
        >
          {t('Probar estilos guardados', 'Test saved styles')}
        </button>
      )}
      {results && (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ ...descStyle, color: passed === results.length ? '#4ade80' : '#f87171', fontWeight: 700 }}>
            {passed === results.length
              ? t(`✓ Funciona: los ${results.length} estados se ven como los guardaste.`, `✓ Working: all ${results.length} states look as saved.`)
              : t(`✗ ${results.length - passed} de ${results.length} estados no coinciden.`, `✗ ${results.length - passed} of ${results.length} states do not match.`)}
          </div>
          {results.map((result) => {
            const label = SAMPLE.find((item) => item.state === result.state);
            return (
              <div key={result.state} style={{ ...descStyle, marginTop: 0, color: result.ok ? colors.textMuted : '#f87171' }}>
                {result.ok ? '✓' : '✗'} {label ? t(label.es, label.en) : result.state}: {result.detail}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WordStyleCheck;
