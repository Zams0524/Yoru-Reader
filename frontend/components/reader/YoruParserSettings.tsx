import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────
interface YoruParserSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  colors: {
    bg: string;
    headerBg: string;
    border: string;
    textMain: string;
    textMuted: string;
    cardBg: string;
    accent: string;
    popoverBg: string;
  };
  lang: string;
}

interface WordEffect {
  type: 'text-colour' | 'underline' | 'background' | 'opacity' | 'shadow';
  colour?: string;
  style?: 'solid' | 'dotted' | 'dashed' | 'wavy';
  thickness?: number;
  opacity?: number;
  value?: number;
  hoverOnly?: boolean;
  blur?: number;
  offsetX?: number;
  offsetY?: number;
}

interface WordStyleThemeConfig {
  v: number;
  theme: string;
  states: Record<string, { effects: WordEffect[] }>;
}

interface SettingsValues {
  // Appearance
  themeBgColour: string;
  themeAccentColour: string;
  // Furigana & Analysis
  skipFurigana: boolean;
  generatePitch: boolean;
  // Popup
  showPopupOnHover: boolean;
  hidePopupAutomatically: boolean;
  hidePopupDelay: number;
  popupWidth: number;
  popupHeight: number;
  showConjugations: boolean;
  showPitchDiagrams: boolean;
  touchscreenSupport: boolean;
  renderCloseButton: boolean;
  disableFadeAnimation: boolean;
  ttsVoice: string;
  ttsAutoPlay: boolean;
  // Mass Review
  massReviewNew: boolean;
  massReviewDue: boolean;
  massReviewYoung: boolean;
  massReviewMature: boolean;
  massReviewCooldownHours: number;
  massReviewRequireConfirm: boolean;
  // Mining
  jitenAddToForq: boolean;
  setSentences: boolean;
  jitenDisableReviews: boolean;
  jitenUseTwoGrades: boolean;
  jitenAutoMineOnReview: boolean;
  // Keybinds
  parseKey: string;
  showPopupKey: string;
  lookupSelectionKey: string;
  // FSRS 6
  fsrsRetentionRate: number;
  fsrsMaxInterval: number;
  fsrsEnableFuzz: boolean;
  // Word Styling Config
  wordStyleConfig: WordStyleThemeConfig;
}

// ── Preset Themes Configurations ───────────────────────────────────────
const PRESET_THEMES: Record<string, { label: string; config: WordStyleThemeConfig }> = {
  default: {
    label: 'Default',
    config: {
      v: 1,
      theme: 'default',
      states: {
        new: { effects: [{ type: 'text-colour', colour: '#a566ef' }] },
        young: { effects: [{ type: 'underline', colour: '#d08700', style: 'solid', thickness: 2 }] },
        mature: { effects: [] },
        mastered: { effects: [] },
        due: { effects: [{ type: 'text-colour', colour: '#ff4500' }] },
        blacklisted: { effects: [{ type: 'opacity', value: 0.5, hoverOnly: false }] },
        suspended: { effects: [{ type: 'opacity', value: 0.5, hoverOnly: false }] },
        redundant: { effects: [{ type: 'background', colour: '#4b9fff', opacity: 0.14 }] },
        frequent: { effects: [{ type: 'underline', colour: '#4b8d7f', style: 'dotted', thickness: 2 }] },
        'i-plus-one': {
          effects: [
            { type: 'shadow', colour: '#359eff', blur: 6, offsetX: 0, offsetY: 2 },
            { type: 'shadow', colour: '#359eff', blur: 12, offsetX: 0, offsetY: 4 },
          ],
        },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  },
  toyBox: {
    label: 'Toy Box',
    config: {
      v: 1,
      theme: 'toyBox',
      states: {
        new: { effects: [{ type: 'text-colour', colour: '#4b8dff' }] },
        young: { effects: [{ type: 'text-colour', colour: '#4ac34a' }] },
        mature: { effects: [] },
        mastered: { effects: [] },
        due: { effects: [{ type: 'text-colour', colour: '#e8a735' }] },
        blacklisted: { effects: [{ type: 'text-colour', colour: '#777777' }] },
        suspended: { effects: [{ type: 'text-colour', colour: '#777777' }] },
        redundant: { effects: [{ type: 'background', colour: '#4b8dff', opacity: 0.16 }] },
        frequent: { effects: [{ type: 'underline', colour: '#4b8dff', style: 'solid', thickness: 2 }] },
        'i-plus-one': { effects: [{ type: 'shadow', colour: '#4b8dff', blur: 6, offsetX: 0, offsetY: 2 }] },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  },
  monochrome: {
    label: 'Monochrome',
    config: {
      v: 1,
      theme: 'monochrome',
      states: {
        new: { effects: [{ type: 'text-colour', colour: '#cccccc' }] },
        young: { effects: [{ type: 'text-colour', colour: '#999999' }] },
        mature: { effects: [{ type: 'text-colour', colour: '#666666' }] },
        mastered: { effects: [] },
        due: {
          effects: [
            { type: 'text-colour', colour: '#ffffff' },
            { type: 'underline', colour: '#ffffff', style: 'solid', thickness: 1 },
          ],
        },
        blacklisted: { effects: [{ type: 'opacity', value: 0.4, hoverOnly: false }] },
        suspended: { effects: [{ type: 'opacity', value: 0.4, hoverOnly: false }] },
        redundant: { effects: [{ type: 'background', colour: '#aaaaaa', opacity: 0.18 }] },
        frequent: { effects: [{ type: 'underline', colour: '#999999', style: 'dotted', thickness: 1 }] },
        'i-plus-one': { effects: [{ type: 'background', colour: '#cccccc', opacity: 0.1 }] },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  },
  'high-contrast': {
    label: 'High Contrast',
    config: {
      v: 1,
      theme: 'high-contrast',
      states: {
        new: {
          effects: [
            { type: 'text-colour', colour: '#ff00ff' },
            { type: 'background', colour: '#ff00ff', opacity: 0.1 },
          ],
        },
        young: {
          effects: [
            { type: 'text-colour', colour: '#ffaa00' },
            { type: 'background', colour: '#ffaa00', opacity: 0.1 },
          ],
        },
        mature: { effects: [{ type: 'text-colour', colour: '#00ff00' }] },
        mastered: { effects: [] },
        due: {
          effects: [
            { type: 'text-colour', colour: '#ff0000' },
            { type: 'underline', colour: '#ff0000', style: 'wavy', thickness: 2 },
          ],
        },
        blacklisted: { effects: [{ type: 'text-colour', colour: '#555555' }] },
        suspended: { effects: [] },
        redundant: { effects: [{ type: 'background', colour: '#00aaff', opacity: 0.45 }] },
        frequent: { effects: [{ type: 'underline', colour: '#00ffff', style: 'solid', thickness: 2 }] },
        'i-plus-one': { effects: [{ type: 'background', colour: '#4444ff', opacity: 0.5 }] },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  },
  subtle: {
    label: 'Subtle',
    config: {
      v: 1,
      theme: 'subtle',
      states: {
        new: { effects: [{ type: 'background', colour: '#a566ef', opacity: 0.15 }] },
        young: { effects: [{ type: 'background', colour: '#d08700', opacity: 0.12 }] },
        mature: { effects: [] },
        mastered: { effects: [] },
        due: { effects: [{ type: 'background', colour: '#ff4500', opacity: 0.15 }] },
        blacklisted: { effects: [{ type: 'opacity', value: 0.5, hoverOnly: false }] },
        suspended: { effects: [] },
        redundant: { effects: [{ type: 'background', colour: '#4b9fff', opacity: 0.12 }] },
        frequent: { effects: [{ type: 'background', colour: '#4b8d7f', opacity: 0.1 }] },
        'i-plus-one': { effects: [{ type: 'background', colour: '#359eff', opacity: 0.1 }] },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  },
  underline: {
    label: 'Underline',
    config: {
      v: 1,
      theme: 'underline',
      states: {
        new: { effects: [{ type: 'underline', colour: '#a566ef', style: 'solid', thickness: 3 }] },
        young: { effects: [{ type: 'underline', colour: '#e8a020', style: 'solid', thickness: 3 }] },
        mature: { effects: [] },
        mastered: { effects: [] },
        due: { effects: [{ type: 'underline', colour: '#e03030', style: 'solid', thickness: 3 }] },
        blacklisted: { effects: [] },
        suspended: { effects: [] },
        redundant: { effects: [{ type: 'underline', colour: '#4b9fff', style: 'dotted', thickness: 3 }] },
        frequent: { effects: [{ type: 'underline', colour: '#40a840', style: 'dashed', thickness: 3 }] },
        'i-plus-one': { effects: [{ type: 'underline', colour: '#40a840', style: 'solid', thickness: 3 }] },
        unparsed: { effects: [] },
        heiban: { effects: [] },
        atamadaka: { effects: [] },
        nakadaka: { effects: [] },
        odaka: { effects: [] },
        kifuku: { effects: [] },
      }
    }
  }
};

const DEFAULTS: SettingsValues = {
  themeBgColour: '#181818',
  themeAccentColour: '#D8B9FA',
  skipFurigana: false,
  generatePitch: true,
  showPopupOnHover: false,
  hidePopupAutomatically: true,
  hidePopupDelay: 500,
  popupWidth: 350,
  popupHeight: 250,
  showConjugations: true,
  showPitchDiagrams: true,
  touchscreenSupport: false,
  renderCloseButton: true,
  disableFadeAnimation: false,
  ttsVoice: 'female',
  ttsAutoPlay: false,
  massReviewNew: true,
  massReviewDue: true,
  massReviewYoung: false,
  massReviewMature: false,
  massReviewCooldownHours: 20,
  massReviewRequireConfirm: true,
  jitenAddToForq: false,
  setSentences: true,
  jitenDisableReviews: false,
  jitenUseTwoGrades: false,
  jitenAutoMineOnReview: false,
  parseKey: 'Alt+P',
  showPopupKey: 'Shift',
  lookupSelectionKey: 'Alt+L',
  fsrsRetentionRate: 0.90,
  fsrsMaxInterval: 36500,
  fsrsEnableFuzz: true,
  wordStyleConfig: structuredClone(PRESET_THEMES.default.config),
};

const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof SettingsValues)[];

// ── Tabs ───────────────────────────────────────────────────────────────
type TabId = 'general' | 'popup' | 'styling' | 'review' | 'mining' | 'keybinds';

interface TabDef {
  id: TabId;
  icon: string;
  labelEs: string;
  labelEn: string;
}

const TABS: TabDef[] = [
  { id: 'general', icon: '🎨', labelEs: 'General', labelEn: 'General' },
  { id: 'popup', icon: '💬', labelEs: 'Popup', labelEn: 'Popup' },
  { id: 'styling', icon: '✨', labelEs: 'Estilos', labelEn: 'Styling' },
  { id: 'review', icon: '📋', labelEs: 'Repaso', labelEn: 'Review' },
  { id: 'mining', icon: '⛏️', labelEs: 'Minado', labelEn: 'Mining' },
  { id: 'keybinds', icon: '⌨️', labelEs: 'Atajos', labelEn: 'Keybinds' },
];

const STATES_LIST: { id: string; labelEs: string; labelEn: string }[] = [
  { id: 'new', labelEs: 'Nuevo (New)', labelEn: 'New' },
  { id: 'young', labelEs: 'Joven (Young)', labelEn: 'Young' },
  { id: 'mature', labelEs: 'Maduro (Mature)', labelEn: 'Mature' },
  { id: 'mastered', labelEs: 'Dominado (Mastered)', labelEn: 'Mastered' },
  { id: 'due', labelEs: 'Pendiente (Due)', labelEn: 'Due' },
  { id: 'blacklisted', labelEs: 'Lista Negra (Blacklisted)', labelEn: 'Blacklisted' },
  { id: 'suspended', labelEs: 'Suspendido (Suspended)', labelEn: 'Suspended' },
  { id: 'redundant', labelEs: 'Redundante (Redundant)', labelEn: 'Redundant' },
  { id: 'frequent', labelEs: 'Frecuente (Frequent)', labelEn: 'Frequent' },
  { id: 'i-plus-one', labelEs: 'I+1', labelEn: 'I+1' },
  { id: 'unparsed', labelEs: 'Sin Parsear (Unparsed)', labelEn: 'Unparsed' },
  { id: 'heiban', labelEs: 'Heiban (Pitch)', labelEn: 'Heiban (Pitch)' },
  { id: 'atamadaka', labelEs: 'Atamadaka (Pitch)', labelEn: 'Atamadaka (Pitch)' },
  { id: 'nakadaka', labelEs: 'Nakadaka (Pitch)', labelEn: 'Nakadaka (Pitch)' },
  { id: 'odaka', labelEs: 'Odaka (Pitch)', labelEn: 'Odaka (Pitch)' },
  { id: 'kifuku', labelEs: 'Kifuku (Pitch)', labelEn: 'Kifuku (Pitch)' },
];

// ── Bridge helpers ─────────────────────────────────────────────────────
let bridgeIdCounter = 0;

function readSettings(keys: string[]): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const id = `yoru-read-${++bridgeIdCounter}`;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id === id) {
        document.removeEventListener('yoru-settings-data', handler);
        resolve(detail.values);
      }
    };
    document.addEventListener('yoru-settings-data', handler);
    document.dispatchEvent(new CustomEvent('yoru-settings-read', { detail: { id, keys } }));
    setTimeout(() => {
      document.removeEventListener('yoru-settings-data', handler);
      resolve({});
    }, 3000);
  });
}

function writeSettings(entries: Record<string, any>): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `yoru-write-${++bridgeIdCounter}`;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id === id) {
        document.removeEventListener('yoru-settings-written', handler);
        resolve(detail.ok);
      }
    };
    document.addEventListener('yoru-settings-written', handler);
    document.dispatchEvent(new CustomEvent('yoru-settings-write', { detail: { id, entries } }));
    setTimeout(() => {
      document.removeEventListener('yoru-settings-written', handler);
      resolve(false);
    }, 3000);
  });
}

function parseBool(val: any, fallback: boolean): boolean {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback;
}

function parseNum(val: any, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
  return Number.isNaN(n) ? fallback : n;
}

function parseKeybindDisplay(val: any, fallback: string): string {
  if (val === null || val === undefined) return fallback;
  try {
    const arr = typeof val === 'string' ? JSON.parse(val) : val;
    if (!Array.isArray(arr) || arr.length === 0) return '—';
    const kb = arr[0];
    const mods = (kb.modifiers || []).join('+');
    return mods ? `${mods}+${kb.key}` : kb.key;
  } catch {
    return fallback;
  }
}

// Helper to convert wordStyleConfig state effects into inline CSS styles
function getStyleForState(stateKey: string, wordStyleConfig: WordStyleThemeConfig): React.CSSProperties {
  const stateConfig = wordStyleConfig?.states?.[stateKey];
  if (!stateConfig || !stateConfig.effects) return {};

  const style: React.CSSProperties = {};
  for (const effect of stateConfig.effects) {
    switch (effect.type) {
      case 'text-colour':
        if (effect.colour) style.color = effect.colour;
        break;
      case 'underline':
        style.textDecoration = 'underline';
        if (effect.colour) style.textDecorationColor = effect.colour;
        style.textDecorationStyle = (effect.style as any) || 'solid';
        if (effect.thickness) style.textDecorationThickness = `${effect.thickness}px`;
        break;
      case 'background':
        if (effect.colour) {
          const opacity = effect.opacity !== undefined ? effect.opacity : 1.0;
          style.backgroundColor = effect.colour + Math.round(opacity * 255).toString(16).padStart(2, '0');
        }
        break;
      case 'opacity':
        if (effect.value !== undefined) style.opacity = effect.value;
        break;
      case 'shadow':
        if (effect.colour) {
          const blur = effect.blur !== undefined ? effect.blur : 6;
          const ox = effect.offsetX !== undefined ? effect.offsetX : 0;
          const oy = effect.offsetY !== undefined ? effect.offsetY : 2;
          const shadowStr = `${ox}px ${oy}px ${blur}px ${effect.colour}`;
          style.textShadow = style.textShadow ? `${style.textShadow}, ${shadowStr}` : shadowStr;
        }
        break;
    }
  }
  return style;
}

// ── Component ──────────────────────────────────────────────────────────
const YoruParserSettings: React.FC<YoruParserSettingsProps> = ({
  isOpen,
  onClose,
  colors,
  lang,
}) => {
  const [settings, setSettings] = useState<SettingsValues>({ ...DEFAULTS });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [expandedState, setExpandedState] = useState<string | null>(null);
  const [previewVertical, setPreviewVertical] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load settings on open
  useEffect(() => {
    if (!isOpen) return;
    setLoaded(false);
    readSettings(SETTING_KEYS).then((vals) => {
      const safeVals = vals || {};
      let loadedConfig = DEFAULTS.wordStyleConfig;
      if (safeVals.wordStyleConfig) {
        try {
          loadedConfig = typeof safeVals.wordStyleConfig === 'string'
            ? JSON.parse(safeVals.wordStyleConfig)
            : safeVals.wordStyleConfig;
        } catch (_) {}
      }

      setSettings({
        themeBgColour: (safeVals.themeBgColour as string) || DEFAULTS.themeBgColour,
        themeAccentColour: (safeVals.themeAccentColour as string) || DEFAULTS.themeAccentColour,
        skipFurigana: parseBool(safeVals.skipFurigana, DEFAULTS.skipFurigana),
        generatePitch: parseBool(safeVals.generatePitch, DEFAULTS.generatePitch),
        showPopupOnHover: parseBool(safeVals.showPopupOnHover, DEFAULTS.showPopupOnHover),
        hidePopupAutomatically: parseBool(safeVals.hidePopupAutomatically, DEFAULTS.hidePopupAutomatically),
        hidePopupDelay: parseNum(safeVals.hidePopupDelay, DEFAULTS.hidePopupDelay),
        popupWidth: parseNum(safeVals.popupWidth, DEFAULTS.popupWidth),
        popupHeight: parseNum(safeVals.popupHeight, DEFAULTS.popupHeight),
        showConjugations: parseBool(safeVals.showConjugations, DEFAULTS.showConjugations),
        showPitchDiagrams: parseBool(safeVals.showPitchDiagrams, DEFAULTS.showPitchDiagrams),
        touchscreenSupport: parseBool(safeVals.touchscreenSupport, DEFAULTS.touchscreenSupport),
        renderCloseButton: parseBool(safeVals.renderCloseButton, DEFAULTS.renderCloseButton),
        disableFadeAnimation: parseBool(safeVals.disableFadeAnimation, DEFAULTS.disableFadeAnimation),
        ttsVoice: (safeVals.ttsVoice as string) || DEFAULTS.ttsVoice,
        ttsAutoPlay: parseBool(safeVals.ttsAutoPlay, DEFAULTS.ttsAutoPlay),
        massReviewNew: parseBool(safeVals.massReviewNew, DEFAULTS.massReviewNew),
        massReviewDue: parseBool(safeVals.massReviewDue, DEFAULTS.massReviewDue),
        massReviewYoung: parseBool(safeVals.massReviewYoung, DEFAULTS.massReviewYoung),
        massReviewMature: parseBool(safeVals.massReviewMature, DEFAULTS.massReviewMature),
        massReviewCooldownHours: parseNum(safeVals.massReviewCooldownHours, DEFAULTS.massReviewCooldownHours),
        massReviewRequireConfirm: parseBool(safeVals.massReviewRequireConfirm, DEFAULTS.massReviewRequireConfirm),
        jitenAddToForq: parseBool(safeVals.jitenAddToForq, DEFAULTS.jitenAddToForq),
        setSentences: parseBool(safeVals.setSentences, DEFAULTS.setSentences),
        jitenDisableReviews: parseBool(safeVals.jitenDisableReviews, DEFAULTS.jitenDisableReviews),
        jitenUseTwoGrades: parseBool(safeVals.jitenUseTwoGrades, DEFAULTS.jitenUseTwoGrades),
        jitenAutoMineOnReview: parseBool(safeVals.jitenAutoMineOnReview, DEFAULTS.jitenAutoMineOnReview),
        parseKey: parseKeybindDisplay(safeVals.parseKey, DEFAULTS.parseKey),
        showPopupKey: parseKeybindDisplay(safeVals.showPopupKey, DEFAULTS.showPopupKey),
        lookupSelectionKey: parseKeybindDisplay(safeVals.lookupSelectionKey, DEFAULTS.lookupSelectionKey),
        fsrsRetentionRate: parseNum(safeVals.fsrsRetentionRate, DEFAULTS.fsrsRetentionRate),
        fsrsMaxInterval: parseNum(safeVals.fsrsMaxInterval, DEFAULTS.fsrsMaxInterval),
        fsrsEnableFuzz: parseBool(safeVals.fsrsEnableFuzz, DEFAULTS.fsrsEnableFuzz),
        wordStyleConfig: loadedConfig,
      });
      setLoaded(true);
    });
  }, [isOpen]);

  const updateSetting = useCallback(
    async <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaving(true);
      await writeSettings({ [key]: value });
      setSaving(false);
    },
    [],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const handlePresetSelect = useCallback(async (presetKey: string) => {
    if (presetKey === 'custom') return;
    const preset = PRESET_THEMES[presetKey];
    if (preset) {
      const newConfig = structuredClone(preset.config);
      setSettings((prev) => ({ ...prev, wordStyleConfig: newConfig }));
      setSaving(true);
      await writeSettings({ wordStyleConfig: newConfig });
      setSaving(false);
    }
  }, []);

  const handleAddEffect = useCallback(async (stateKey: string, effectType: WordEffect['type']) => {
    const config = structuredClone(settings.wordStyleConfig);
    if (!config.states[stateKey]) {
      config.states[stateKey] = { effects: [] };
    }

    let newEffect: WordEffect;
    switch (effectType) {
      case 'text-colour':
        newEffect = { type: 'text-colour', colour: '#a566ef' };
        break;
      case 'underline':
        newEffect = { type: 'underline', colour: '#a566ef', style: 'solid', thickness: 2 };
        break;
      case 'background':
        newEffect = { type: 'background', colour: '#a566ef', opacity: 0.15 };
        break;
      case 'opacity':
        newEffect = { type: 'opacity', value: 0.5, hoverOnly: false };
        break;
      case 'shadow':
        newEffect = { type: 'shadow', colour: '#359eff', blur: 6, offsetX: 0, offsetY: 2 };
        break;
    }

    config.states[stateKey].effects.push(newEffect);
    config.theme = 'custom';
    setSettings((prev) => ({ ...prev, wordStyleConfig: config }));
    setSaving(true);
    await writeSettings({ wordStyleConfig: config });
    setSaving(false);
  }, [settings.wordStyleConfig]);

  const handleUpdateEffect = useCallback(async (stateKey: string, effectIndex: number, updatedFields: Partial<WordEffect>) => {
    const config = structuredClone(settings.wordStyleConfig);
    const effect = config.states[stateKey]?.effects[effectIndex];
    if (effect) {
      Object.assign(effect, updatedFields);
      config.theme = 'custom';
      setSettings((prev) => ({ ...prev, wordStyleConfig: config }));
      setSaving(true);
      await writeSettings({ wordStyleConfig: config });
      setSaving(false);
    }
  }, [settings.wordStyleConfig]);

  const handleDeleteEffect = useCallback(async (stateKey: string, effectIndex: number) => {
    const config = structuredClone(settings.wordStyleConfig);
    config.states[stateKey]?.effects.splice(effectIndex, 1);
    config.theme = 'custom';
    setSettings((prev) => ({ ...prev, wordStyleConfig: config }));
    setSaving(true);
    await writeSettings({ wordStyleConfig: config });
    setSaving(false);
  }, [settings.wordStyleConfig]);

  if (!isOpen) return null;

  const t = (es: string, en: string) => (lang === 'es' ? es : en);

  // ── Styles ─────────────────────────────────────────────────────────
  const isDark = colors.bg === '#08080a' || colors.bg === '#050507' || colors.bg.startsWith('#0');

  const cardStyle: React.CSSProperties = {
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${colors.border}`,
    borderRadius: '12px',
    padding: '16px 20px',
    marginBottom: '12px',
  };

  const labelStyle: React.CSSProperties = {
    color: colors.textMain,
    fontSize: '0.92rem',
    fontWeight: 500,
    fontFamily: 'var(--font-ui), sans-serif',
  };

  const descStyle: React.CSSProperties = {
    color: colors.textMuted,
    fontSize: '0.78rem',
    marginTop: '2px',
    fontFamily: 'var(--font-ui), sans-serif',
  };

  const sectionTitleStyle: React.CSSProperties = {
    color: colors.accent,
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    margin: '20px 0 10px 0',
    fontFamily: 'var(--font-ui), sans-serif',
  };

  // ── Tab Content Renderers ──────────────────────────────────────────
  const renderGeneral = () => (
    <>
      {/* Appearance */}
      <div style={sectionTitleStyle}>{t('Apariencia del Parser', 'Parser Appearance')}</div>
      <div style={cardStyle}>
        <ColorRow
          label={t('Color de Fondo', 'Background Color')}
          desc={t('Color de fondo del parser. Por defecto: #181818', 'Parser background color. Default: #181818')}
          value={settings.themeBgColour}
          onChange={(v) => updateSetting('themeBgColour', v)}
          colors={colors}
          labelStyle={labelStyle}
          descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ColorRow
          label={t('Color de Acento', 'Accent Color')}
          desc={t('Color de acento del parser. Por defecto: #D8B9FA', 'Parser accent color. Default: #D8B9FA')}
          value={settings.themeAccentColour}
          onChange={(v) => updateSetting('themeAccentColour', v)}
          colors={colors}
          labelStyle={labelStyle}
          descStyle={descStyle}
        />
      </div>

      {/* Furigana & Analysis */}
      <div style={sectionTitleStyle}>{t('Furigana y Análisis', 'Furigana & Analysis')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Mostrar Furigana', 'Show Furigana')}
          desc={t('Muestra la lectura hiragana sobre los kanji parseados.', 'Shows hiragana readings above parsed kanji.')}
          value={!settings.skipFurigana}
          onChange={(v) => updateSetting('skipFurigana', !v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Acento Tonal', 'Pitch Accent')}
          desc={t('Genera diagramas de acento tonal en el popup.', 'Generates pitch accent diagrams in the popup.')}
          value={settings.generatePitch}
          onChange={(v) => updateSetting('generatePitch', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
    </>
  );

  const renderPopup = () => (
    <>
      <div style={sectionTitleStyle}>{t('Activación', 'Activation')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Activar con Hover', 'Activate on Hover')}
          desc={t('Muestra el popup al pasar el cursor. Si no, al hacer clic.', 'Shows popup on hover. If off, shows on click.')}
          value={settings.showPopupOnHover}
          onChange={(v) => updateSetting('showPopupOnHover', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Soporte Táctil', 'Touchscreen Support')}
          desc={t('Habilita interacción táctil para móviles/tablets.', 'Enables touch interaction for mobile/tablet.')}
          value={settings.touchscreenSupport}
          onChange={(v) => updateSetting('touchscreenSupport', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>

      <div style={sectionTitleStyle}>{t('Comportamiento', 'Behavior')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Auto-ocultar Popup', 'Auto-hide Popup')}
          desc={t('Oculta el popup automáticamente tras un tiempo.', 'Automatically hides the popup after a delay.')}
          value={settings.hidePopupAutomatically}
          onChange={(v) => updateSetting('hidePopupAutomatically', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
        {settings.hidePopupAutomatically && (
          <div style={{ marginTop: '12px' }}>
            <SliderRow
              label={t('Tiempo de ocultamiento', 'Hide delay')}
              value={settings.hidePopupDelay} min={200} max={3000} step={100} unit="ms"
              onChange={(v) => updateSetting('hidePopupDelay', v)}
              colors={colors} labelStyle={labelStyle}
            />
          </div>
        )}
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Botón de Cerrar', 'Close Button')}
          desc={t('Muestra botón de cerrar en el popup.', 'Shows close button on popup.')}
          value={settings.renderCloseButton}
          onChange={(v) => updateSetting('renderCloseButton', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Desactivar Animación', 'Disable Fade Animation')}
          desc={t('Desactiva la animación de aparición/desaparición.', 'Disables the fade in/out animation.')}
          value={settings.disableFadeAnimation}
          onChange={(v) => updateSetting('disableFadeAnimation', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>

      <div style={sectionTitleStyle}>{t('Contenido', 'Content')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Mostrar Conjugaciones', 'Show Conjugations')}
          desc={t('Muestra info de conjugación en el popup.', 'Shows conjugation info in popup.')}
          value={settings.showConjugations}
          onChange={(v) => updateSetting('showConjugations', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Diagramas de Tono', 'Pitch Diagrams')}
          desc={t('Muestra acento tonal en el popup.', 'Shows pitch accent in popup.')}
          value={settings.showPitchDiagrams}
          onChange={(v) => updateSetting('showPitchDiagrams', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>

      <div style={sectionTitleStyle}>{t('Audio TTS', 'TTS Audio')}</div>
      <div style={cardStyle}>
        <SelectRow
          label={t('Voz TTS', 'TTS Voice')}
          desc={t('Voz de síntesis de texto a audio.', 'Text-to-speech voice.')}
          value={settings.ttsVoice}
          options={[
            { value: 'female', label: t('Femenina', 'Female') },
            { value: 'male', label: t('Masculina', 'Male') },
          ]}
          onChange={(v) => updateSetting('ttsVoice', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Reproducción Automática', 'Auto Play')}
          desc={t('Reproduce audio automáticamente al abrir el popup.', 'Automatically plays audio when popup opens.')}
          value={settings.ttsAutoPlay}
          onChange={(v) => updateSetting('ttsAutoPlay', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>

      <div style={sectionTitleStyle}>{t('Tamaño del Popup', 'Popup Size')}</div>
      <div style={cardStyle}>
        <SliderRow
          label={t('Ancho', 'Width')}
          value={settings.popupWidth} min={250} max={600} step={10} unit="px"
          onChange={(v) => updateSetting('popupWidth', v)}
          colors={colors} labelStyle={labelStyle}
        />
        <div style={{ height: '12px' }} />
        <SliderRow
          label={t('Alto', 'Height')}
          value={settings.popupHeight} min={150} max={500} step={10} unit="px"
          onChange={(v) => updateSetting('popupHeight', v)}
          colors={colors} labelStyle={labelStyle}
        />
      </div>
    </>
  );

  const renderStyling = () => {
    const config = settings.wordStyleConfig;
    return (
      <>
        {/* Preset Theme Selector */}
        <div style={sectionTitleStyle}>{t('Estilo de Palabras', 'Word Styling')}</div>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>{t('Tema de Estilos', 'Styling Theme')}</div>
              <div style={descStyle}>{t('Elige una paleta de colores predefinida.', 'Choose a preset color palette.')}</div>
            </div>
            <select
              value={config.theme}
              onChange={(e) => handlePresetSelect(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: `1px solid ${colors.border}`,
                background: colors.cardBg,
                color: colors.textMain,
                fontSize: '0.85rem',
                fontFamily: 'var(--font-ui), sans-serif',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {Object.keys(PRESET_THEMES).map((k) => (
                <option key={k} value={k} style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>
                  {PRESET_THEMES[k].label}
                </option>
              ))}
              <option value="custom" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Personalizado', 'Custom')}</option>
            </select>
          </div>
        </div>

        {/* Live Preview Panel */}
        <div style={sectionTitleStyle}>{t('Vista Previa', 'Live Preview')}</div>
        <div
          style={{
            ...cardStyle,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: isDark ? '#08080a' : '#f9f9f9',
            border: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setPreviewVertical((v) => !v)}
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.border}`,
                color: colors.textMain,
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                cursor: 'pointer',
                fontWeight: 600,
                fontFamily: 'var(--font-ui)',
              }}
            >
              {previewVertical ? 'Horizontal' : 'Vertical'}
            </button>
          </div>

          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`,
              background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100px',
            }}
          >
            {previewVertical ? (
              <div
                style={{
                  fontSize: '1.25rem',
                  lineHeight: '2em',
                  writingMode: 'vertical-rl',
                  height: '180px',
                  fontFamily: 'var(--font-japanese), serif',
                }}
              >
                <span style={getStyleForState('new', config)}>事典</span>
                <span style={getStyleForState('unparsed', config)}>を</span>
                <span style={getStyleForState('unparsed', config)}>読む</span>
                <span style={getStyleForState('young', config)}>時</span>
                <span style={getStyleForState('unparsed', config)}>、</span>
                <span style={getStyleForState('unparsed', config)}>新しい</span>
                <span style={getStyleForState('due', config)}>言葉</span>
                <span style={getStyleForState('unparsed', config)}>ga</span>
                <span style={getStyleForState('i-plus-one', config)}>物出て</span>
                <span style={getStyleForState('unparsed', config)}>くる</span>
                <span style={getStyleForState('unparsed', config)}>。</span>
              </div>
            ) : (
              <div
                style={{
                  fontSize: '1.2rem',
                  lineHeight: '2em',
                  fontFamily: 'var(--font-japanese), serif',
                  textAlign: 'center',
                }}
              >
                <span style={getStyleForState('new', config)}>事典</span>
                <span style={getStyleForState('unparsed', config)}>を</span>
                <span style={getStyleForState('unparsed', config)}>読む</span>
                <span style={getStyleForState('young', config)}>時</span>
                <span style={getStyleForState('unparsed', config)}>、</span>
                <span style={getStyleForState('unparsed', config)}>新しい</span>
                <span style={getStyleForState('due', config)}>言葉</span>
                <span style={getStyleForState('unparsed', config)}>が</span>
                <span style={getStyleForState('i-plus-one', config)}>物出て</span>
                <span style={getStyleForState('unparsed', config)}>くる</span>
                <span style={getStyleForState('unparsed', config)}>。</span>
              </div>
            )}
          </div>
        </div>

        {/* Word States List Accordion */}
        <div style={sectionTitleStyle}>{t('Estados de Palabras', 'Word States')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {STATES_LIST.map((state) => {
            const stateConfig = config.states[state.id] || { effects: [] };
            const isExpanded = expandedState === state.id;

            return (
              <div
                key={state.id}
                style={{
                  background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${colors.border}`,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  transition: 'all 0.15s',
                }}
              >
                {/* Accordion Header */}
                <div
                  onClick={() => setExpandedState(isExpanded ? null : state.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.8rem', color: colors.textMuted }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span style={{ ...labelStyle, fontSize: '0.88rem' }}>
                      {lang === 'es' ? state.labelEs : state.labelEn}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Live styled state label indicator */}
                    <span
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        ...getStyleForState(state.id, config),
                      }}
                    >
                      例
                    </span>
                    <select
                      value=""
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.value) {
                          handleAddEffect(state.id, e.target.value as any);
                          setExpandedState(state.id);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                        border: `1px solid ${colors.border}`,
                        background: colors.cardBg,
                        color: colors.textMain,
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      <option value="" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>+ Add Effect</option>
                      <option value="text-colour" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Color de Texto', 'Text Color')}</option>
                      <option value="underline" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Subrayado', 'Underline')}</option>
                      <option value="background" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Fondo', 'Background')}</option>
                      <option value="opacity" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Opacidad', 'Opacity')}</option>
                      <option value="shadow" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>{t('Sombra', 'Shadow')}</option>
                    </select>
                  </div>
                </div>

                {/* Accordion Expanded Content */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: `1px solid ${colors.border}`,
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      background: isDark ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.01)',
                    }}
                  >
                    {stateConfig.effects.length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', padding: '6px 0' }}>
                        {t('Sin efectos de estilo activos.', 'No styling effects active.')}
                      </div>
                    ) : (
                      stateConfig.effects.map((effect, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: `1px solid ${colors.border}`,
                            borderRadius: '8px',
                            background: colors.popoverBg,
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            position: 'relative',
                          }}
                        >
                          {/* Effect Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${colors.border}`, paddingBottom: '6px', marginBottom: '2px' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: colors.accent, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                              {effect.type === 'text-colour' && t('Color de Texto', 'Text Color')}
                              {effect.type === 'underline' && t('Subrayado', 'Underline')}
                              {effect.type === 'background' && t('Fondo', 'Background')}
                              {effect.type === 'opacity' && t('Opacidad', 'Opacity')}
                              {effect.type === 'shadow' && t('Sombra', 'Shadow')}
                            </span>
                            <button
                              onClick={() => handleDeleteEffect(state.id, idx)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e03030',
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                              }}
                            >
                              ✕ Delete
                            </button>
                          </div>

                          {/* Effect Specific Fields */}
                          {effect.type === 'text-colour' && (
                            <ColorInputRow
                              label={t('Color', 'Color')}
                              value={effect.colour || '#ffffff'}
                              onChange={(v) => handleUpdateEffect(state.id, idx, { colour: v })}
                              colors={colors}
                            />
                          )}

                          {effect.type === 'underline' && (
                            <>
                              <ColorInputRow
                                label={t('Color', 'Color')}
                                value={effect.colour || '#ffffff'}
                                onChange={(v) => handleUpdateEffect(state.id, idx, { colour: v })}
                                colors={colors}
                              />
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                                <span style={{ fontSize: '0.78rem', color: colors.textMain }}>{t('Estilo', 'Style')}</span>
                                <select
                                  value={effect.style || 'solid'}
                                  onChange={(e) => handleUpdateEffect(state.id, idx, { style: e.target.value as any })}
                                  style={{
                                    padding: '3px 8px', fontSize: '0.75rem', borderRadius: '4px', border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.textMain, outline: 'none'
                                  }}
                                >
                                  <option value="solid" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>Solid</option>
                                  <option value="dotted" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>Dotted</option>
                                  <option value="dashed" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>Dashed</option>
                                  <option value="wavy" style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>Wavy</option>
                                </select>
                              </div>
                              <div style={{ marginTop: '6px' }}>
                                <SliderRowMini
                                  label={t('Grosor', 'Thickness')}
                                  value={effect.thickness || 2} min={1} max={5} step={1} unit="px"
                                  onChange={(v) => handleUpdateEffect(state.id, idx, { thickness: v })}
                                  colors={colors}
                                />
                              </div>
                            </>
                          )}

                          {effect.type === 'background' && (
                            <>
                              <ColorInputRow
                                label={t('Color', 'Color')}
                                value={effect.colour || '#ffffff'}
                                onChange={(v) => handleUpdateEffect(state.id, idx, { colour: v })}
                                colors={colors}
                              />
                              <div style={{ marginTop: '6px' }}>
                                <SliderRowMini
                                  label={t('Opacidad', 'Opacity')}
                                  value={effect.opacity !== undefined ? Math.round(effect.opacity * 100) : 15}
                                  min={5} max={100} step={5} unit="%"
                                  onChange={(v) => handleUpdateEffect(state.id, idx, { opacity: v / 100 })}
                                  colors={colors}
                                />
                              </div>
                            </>
                          )}

                          {effect.type === 'opacity' && (
                            <>
                              <SliderRowMini
                                label={t('Opacidad', 'Opacity')}
                                value={effect.value !== undefined ? Math.round(effect.value * 100) : 50}
                                min={10} max={100} step={5} unit="%"
                                onChange={(v) => handleUpdateEffect(state.id, idx, { value: v / 100 })}
                                colors={colors}
                              />
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginTop: '6px' }}>
                                <span style={{ fontSize: '0.78rem', color: colors.textMain }}>{t('Solo con Hover', 'Only on Hover')}</span>
                                <input
                                  type="checkbox"
                                  checked={!!effect.hoverOnly}
                                  onChange={(e) => handleUpdateEffect(state.id, idx, { hoverOnly: e.target.checked })}
                                  style={{ accentColor: colors.accent, cursor: 'pointer' }}
                                />
                              </div>
                            </>
                          )}

                          {effect.type === 'shadow' && (
                            <>
                              <ColorInputRow
                                label={t('Color', 'Color')}
                                value={effect.colour || '#ffffff'}
                                onChange={(v) => handleUpdateEffect(state.id, idx, { colour: v })}
                                colors={colors}
                              />
                              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <SliderRowMini
                                  label={t('Difuminado', 'Blur')}
                                  value={effect.blur || 6} min={1} max={20} step={1} unit="px"
                                  onChange={(v) => handleUpdateEffect(state.id, idx, { blur: v })}
                                  colors={colors}
                                />
                                <SliderRowMini
                                  label={t('Desplazamiento X', 'Offset X')}
                                  value={effect.offsetX !== undefined ? effect.offsetX : 0} min={-10} max={10} step={1} unit="px"
                                  onChange={(v) => handleUpdateEffect(state.id, idx, { offsetX: v })}
                                  colors={colors}
                                />
                                <SliderRowMini
                                  label={t('Desplazamiento Y', 'Offset Y')}
                                  value={effect.offsetY !== undefined ? effect.offsetY : 2} min={-10} max={10} step={1} unit="px"
                                  onChange={(v) => handleUpdateEffect(state.id, idx, { offsetY: v })}
                                  colors={colors}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const renderReview = () => (
    <>
      <div style={sectionTitleStyle}>{t('Repaso Masivo de Palabras', 'Mass Word Review')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Repasar Nuevas', 'Review New')}
          desc={t('Incluir palabras nuevas en el repaso masivo.', 'Include new words in mass review.')}
          value={settings.massReviewNew}
          onChange={(v) => updateSetting('massReviewNew', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Repasar Pendientes', 'Review Due')}
          desc={t('Incluir palabras pendientes de repaso.', 'Include due words in mass review.')}
          value={settings.massReviewDue}
          onChange={(v) => updateSetting('massReviewDue', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Repasar Jóvenes', 'Review Young')}
          desc={t('Incluir palabras recién aprendidas.', 'Include recently learned words.')}
          value={settings.massReviewYoung}
          onChange={(v) => updateSetting('massReviewYoung', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Repasar Maduras', 'Review Mature')}
          desc={t('Incluir palabras maduras/dominadas.', 'Include mature/mastered words.')}
          value={settings.massReviewMature}
          onChange={(v) => updateSetting('massReviewMature', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <SliderRow
          label={t('Enfriamiento (horas)', 'Cooldown (hours)')}
          value={settings.massReviewCooldownHours} min={1} max={48} step={1} unit="h"
          onChange={(v) => updateSetting('massReviewCooldownHours', v)}
          colors={colors} labelStyle={labelStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Confirmar antes de Repasar', 'Confirm Before Review')}
          desc={t('Pide confirmación antes de repasar todas las palabras.', 'Asks for confirmation before reviewing all words.')}
          value={settings.massReviewRequireConfirm}
          onChange={(v) => updateSetting('massReviewRequireConfirm', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>

      <div style={{ ...sectionTitleStyle, marginTop: '24px' }}>{t('Repetición Espaciada (FSRS 6)', 'Spaced Repetition (FSRS 6)')}</div>
      <div style={cardStyle}>
        <SliderRow
          label={t('Retención Deseada', 'Desired Retention')}
          value={settings.fsrsRetentionRate} min={0.70} max={0.99} step={0.01} unit=""
          onChange={(v) => updateSetting('fsrsRetentionRate', v)}
          colors={colors} labelStyle={labelStyle}
        />
        <div style={{ ...descStyle, marginTop: '4px' }}>
          {t('La probabilidad deseada de recordar una palabra en su fecha de repaso (por defecto 0.90).', 'The desired probability of recalling a word on its review date (default 0.90).')}
        </div>
      </div>
      <div style={cardStyle}>
        <NumberRow
          label={t('Intervalo Máximo (días)', 'Maximum Interval (days)')}
          desc={t('El intervalo de repaso máximo permitido en días.', 'The maximum allowed review interval in days.')}
          value={settings.fsrsMaxInterval} min={7} max={36500}
          onChange={(v) => updateSetting('fsrsMaxInterval', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Dispersión de Intervalos (Fuzz)', 'Interval Dispersion (Fuzz)')}
          desc={t('Añade aleatoriedad a los intervalos largos para evitar acumulación de repasos.', 'Adds randomness to long intervals to avoid review pileups.')}
          value={settings.fsrsEnableFuzz}
          onChange={(v) => updateSetting('fsrsEnableFuzz', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
    </>
  );

  const renderMining = () => (
    <>
      <div style={sectionTitleStyle}>{t('Configuración de Minado', 'Mining Configuration')}</div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Guardar Oraciones', 'Save Sentences')}
          desc={t('Guarda la oración de contexto al minar una palabra.', 'Saves the context sentence when mining a word.')}
          value={settings.setSentences}
          onChange={(v) => updateSetting('setSentences', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Añadir al Frente de Cola', 'Add to Front of Queue')}
          desc={t('Coloca palabras minadas al inicio de la cola de estudio.', 'Places mined words at the front of the study queue.')}
          value={settings.jitenAddToForq}
          onChange={(v) => updateSetting('jitenAddToForq', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Desactivar Reseñas', 'Disable Reviews')}
          desc={t('Desactiva completamente el sistema de reseñas.', 'Completely disables the review system.')}
          value={settings.jitenDisableReviews}
          onChange={(v) => updateSetting('jitenDisableReviews', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Usar Dos Calificaciones', 'Use Two Grades')}
          desc={t('Simplifica la calificación a solo Bien/Mal.', 'Simplifies grading to just Pass/Fail.')}
          value={settings.jitenUseTwoGrades}
          onChange={(v) => updateSetting('jitenUseTwoGrades', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <ToggleRow
          label={t('Auto-minar al Repasar', 'Auto-mine on Review')}
          desc={t('Mina automáticamente al repasar una palabra.', 'Automatically mines when reviewing a word.')}
          value={settings.jitenAutoMineOnReview}
          onChange={(v) => updateSetting('jitenAutoMineOnReview', v)}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
    </>
  );

  const renderKeybinds = () => (
    <>
      <div style={sectionTitleStyle}>{t('Atajos de Teclado', 'Keyboard Shortcuts')}</div>
      <div style={cardStyle}>
        <KeybindRow
          label={t('Mostrar Popup', 'Show Popup')}
          desc={t('Muestra el popup de definición en la palabra bajo el cursor.', 'Shows definition popup on word under cursor.')}
          value={settings.showPopupKey}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={cardStyle}>
        <KeybindRow
          label={t('Buscar Selección', 'Lookup Selection')}
          desc={t('Busca la definición del texto seleccionado.', 'Looks up the definition of selected text.')}
          value={settings.lookupSelectionKey}
          colors={colors} labelStyle={labelStyle} descStyle={descStyle}
        />
      </div>
      <div style={{ ...cardStyle, background: 'transparent', border: 'none', padding: '8px 0' }}>
        <div style={{ ...descStyle, fontStyle: 'italic', textAlign: 'center' }}>
          {t(
            'Los atajos de teclado son de solo lectura. Para modificarlos, edita la configuración de la extensión directamente.',
            'Keyboard shortcuts are read-only. To modify them, edit the extension configuration directly.',
          )}
        </div>
      </div>
    </>
  );

  const TAB_RENDERERS: Record<TabId, () => React.ReactNode> = {
    general: renderGeneral,
    popup: renderPopup,
    styling: renderStyling,
    review: renderReview,
    mining: renderMining,
    keybinds: renderKeybinds,
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10020,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: '16px',
          width: '92%',
          maxWidth: '580px',
          maxHeight: '88vh',
          boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 24px',
            borderBottom: `1px solid ${colors.border}`,
            background: colors.popoverBg,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚙️</span>
            <h3
              style={{
                margin: 0,
                color: colors.textMain,
                fontSize: '1.05rem',
                fontWeight: 700,
                fontFamily: 'var(--font-ui), sans-serif',
              }}
            >
              {t('Ajustes de Yoru Parser', 'Yoru Parser Settings')}
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saving && (
              <span style={{ color: colors.accent, fontSize: '0.72rem', fontFamily: 'var(--font-ui)' }}>
                {t('Guardando…', 'Saving…')}
              </span>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: colors.textMuted,
                cursor: 'pointer',
                fontSize: '1.2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
                borderRadius: '6px',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = colors.textMain)}
              onMouseLeave={(e) => (e.currentTarget.style.color = colors.textMuted)}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div
          style={{
            display: 'flex',
            gap: '2px',
            padding: '8px 16px',
            borderBottom: `1px solid ${colors.border}`,
            overflowX: 'auto',
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 700 : 500,
                  fontFamily: 'var(--font-ui), sans-serif',
                  color: isActive ? colors.accent : colors.textMuted,
                  background: isActive
                    ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
                    : 'transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: '0.9rem' }}>{tab.icon}</span>
                {lang === 'es' ? tab.labelEs : tab.labelEn}
              </button>
            );
          })}
        </div>

        {/* ── Body ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 24px 24px',
          }}
        >
          {!loaded ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: colors.textMuted }}>
              {t('Cargando ajustes…', 'Loading settings…')}
            </div>
          ) : (
            TAB_RENDERERS[activeTab]()
          )}
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, desc, value, onChange, colors, labelStyle, descStyle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}</div>
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
    <button
      onClick={() => onChange(!value)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        padding: '2px',
        cursor: 'pointer',
        background: value ? colors.accent : 'rgba(128,128,128,0.3)',
        transition: 'background 0.2s',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transform: value ? 'translateX(20px)' : 'translateX(0)',
          transition: 'transform 0.2s',
        }}
      />
    </button>
  </div>
);

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, step, unit, onChange, colors, labelStyle }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <span style={{ ...labelStyle, fontSize: '0.85rem' }}>{label}</span>
      <span style={{ color: colors.accent, fontSize: '0.82rem', fontWeight: 600, fontFamily: 'var(--font-ui), monospace' }}>
        {value}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: '100%',
        height: '4px',
        borderRadius: '2px',
        appearance: 'none',
        background: `linear-gradient(to right, ${colors.accent} 0%, ${colors.accent} ${((value - min) / (max - min)) * 100}%, rgba(128,128,128,0.25) ${((value - min) / (max - min)) * 100}%, rgba(128,128,128,0.25) 100%)`,
        outline: 'none',
        cursor: 'pointer',
        accentColor: colors.accent,
      }}
    />
  </div>
);

interface NumberRowProps {
  label: string;
  desc?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const NumberRow: React.FC<NumberRowProps> = ({ label, desc, value, min, max, onChange, colors, labelStyle, descStyle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}</div>
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
          onChange(Math.max(min, Math.min(max, val)));
        }
      }}
      style={{
        width: '100px',
        padding: '6px 10px',
        borderRadius: '6px',
        border: `1px solid ${colors.border}`,
        background: 'rgba(0,0,0,0.2)',
        color: colors.textMain,
        outline: 'none',
        fontSize: '0.85rem',
        textAlign: 'right',
        fontFamily: 'monospace',
      }}
    />
  </div>
);

interface SliderRowMiniProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  colors: YoruParserSettingsProps['colors'];
}

const SliderRowMini: React.FC<SliderRowMiniProps> = ({ label, value, min, max, step, unit, onChange, colors }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '0.78rem', color: colors.textMain }}>{label}</span>
      <span style={{ color: colors.accent, fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace' }}>
        {value}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: '100%',
        height: '3px',
        borderRadius: '1.5px',
        appearance: 'none',
        background: `linear-gradient(to right, ${colors.accent} 0%, ${colors.accent} ${((value - min) / (max - min)) * 100}%, rgba(128,128,128,0.25) ${((value - min) / (max - min)) * 100}%, rgba(128,128,128,0.25) 100%)`,
        outline: 'none',
        cursor: 'pointer',
        accentColor: colors.accent,
      }}
    />
  </div>
);

interface ColorRowProps {
  label: string;
  desc?: string;
  value: string;
  onChange: (v: string) => void;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const ColorRow: React.FC<ColorRowProps> = ({ label, desc, value, onChange, colors, labelStyle, descStyle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}</div>
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '32px',
          height: '32px',
          border: `2px solid ${colors.border}`,
          borderRadius: '8px',
          cursor: 'pointer',
          padding: '0',
          background: 'transparent',
        }}
      />
      <span style={{ color: colors.textMuted, fontSize: '0.78rem', fontFamily: 'monospace' }}>{value}</span>
    </div>
  </div>
);

interface ColorInputRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: YoruParserSettingsProps['colors'];
}

const ColorInputRow: React.FC<ColorInputRowProps> = ({ label, value, onChange, colors }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
    <span style={{ fontSize: '0.78rem', color: colors.textMain }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '24px',
          height: '24px',
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          cursor: 'pointer',
          padding: '0',
          background: 'transparent',
        }}
      />
      <span style={{ color: colors.textMuted, fontSize: '0.72rem', fontFamily: 'monospace' }}>{value}</span>
    </div>
  </div>
);

interface SelectRowProps {
  label: string;
  desc?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const SelectRow: React.FC<SelectRowProps> = ({ label, desc, value, options, onChange, colors, labelStyle, descStyle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}</div>
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '6px 10px',
        borderRadius: '8px',
        border: `1px solid ${colors.border}`,
        background: colors.cardBg,
        color: colors.textMain,
        fontSize: '0.85rem',
        fontFamily: 'var(--font-ui), sans-serif',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: colors.popoverBg || colors.bg, color: colors.textMain }}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

interface KeybindRowProps {
  label: string;
  desc?: string;
  value: string;
  colors: YoruParserSettingsProps['colors'];
  labelStyle: React.CSSProperties;
  descStyle: React.CSSProperties;
}

const KeybindRow: React.FC<KeybindRowProps> = ({ label, desc, value, colors, labelStyle, descStyle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}</div>
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
    <div
      style={{
        padding: '5px 12px',
        borderRadius: '6px',
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        color: colors.accent,
        fontSize: '0.82rem',
        fontWeight: 600,
        fontFamily: 'monospace',
        letterSpacing: '0.05em',
        flexShrink: 0,
      }}
    >
      {value}
    </div>
  </div>
);

export default YoruParserSettings;
