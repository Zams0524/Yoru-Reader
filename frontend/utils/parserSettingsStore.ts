import { Capacitor } from '@capacitor/core';

/**
 * Storage for the Yoru Parser settings modal.
 *
 * On desktop the reader extension owns these settings (chrome.storage, reached through the
 * 'yoru-settings-*' DOM bridge in ajb.js). On Android there is no extension, so nothing answered
 * the bridge and every change was lost. There the settings live in localStorage instead, and the
 * word-state styles are applied to the native parser's `.jiten-word` spans by an injected sheet.
 */

const LOCAL_KEY = 'yoru_parser_settings_v1';
const STYLE_ELEMENT_ID = 'yoru-word-style-config';

export interface WordEffect {
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

export interface WordStyleThemeConfig {
  v: number;
  theme: string;
  states: Record<string, { effects: WordEffect[] }>;
}

/** True when the reader extension is not available and settings must be kept locally. */
export function usesLocalParserSettings(): boolean {
  // Only the Electron shell loads the extension; Android and a plain browser never have it.
  return Capacitor.isNativePlatform() || typeof (window as any).electronAPI === 'undefined';
}

function readLocal(): Record<string, any> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Synchronous read of a locally stored parser setting (null when unset). */
export function getLocalParserSetting(key: string): any {
  return readLocal()[key] ?? null;
}

let bridgeIdCounter = 0;

function readFromExtension(keys: string[]): Promise<Record<string, any> | null> {
  return new Promise((resolve) => {
    const id = `yoru-read-${++bridgeIdCounter}`;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id === id) {
        clearTimeout(timer);
        document.removeEventListener('yoru-settings-data', handler);
        resolve(detail.values || {});
      }
    };
    const timer = setTimeout(() => {
      document.removeEventListener('yoru-settings-data', handler);
      resolve(null);
    }, 3000);
    document.addEventListener('yoru-settings-data', handler);
    document.dispatchEvent(new CustomEvent('yoru-settings-read', { detail: { id, keys } }));
  });
}

function writeToExtension(entries: Record<string, any>): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `yoru-write-${++bridgeIdCounter}`;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id === id) {
        clearTimeout(timer);
        document.removeEventListener('yoru-settings-written', handler);
        resolve(!!detail.ok);
      }
    };
    const timer = setTimeout(() => {
      document.removeEventListener('yoru-settings-written', handler);
      resolve(false);
    }, 3000);
    document.addEventListener('yoru-settings-written', handler);
    document.dispatchEvent(new CustomEvent('yoru-settings-write', { detail: { id, entries } }));
  });
}

export async function readParserSettings(keys: string[]): Promise<Record<string, any>> {
  if (!usesLocalParserSettings()) {
    const fromExtension = await readFromExtension(keys);
    if (fromExtension) return fromExtension;
  }
  // No extension answered (Android, or the extension failed to load): use the local copy.
  const local = readLocal();
  const values: Record<string, any> = {};
  for (const key of keys) values[key] = local[key] ?? null;
  return values;
}

export async function writeParserSettings(entries: Record<string, any>): Promise<boolean> {
  // Keep a local copy everywhere so settings survive even when the extension is missing.
  let savedLocally = false;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), ...entries }));
    savedLocally = true;
  } catch {
    savedLocally = false;
  }

  if ('wordStyleConfig' in entries) applyLocalWordStyles();
  window.dispatchEvent(new CustomEvent('yoru-parser-settings-changed', { detail: { keys: Object.keys(entries) } }));
  if (usesLocalParserSettings()) return savedLocally;
  return (await writeToExtension(entries)) || savedLocally;
}

// ── Word-state styles for the native parser ───────────────────────────

// The native parser only emits some of these classes; the aliases match older class names.
const STATE_SELECTORS: Record<string, string[]> = {
  new: ['new'],
  young: ['young', 'learning'],
  mature: ['mature', 'known'],
  mastered: ['mastered'],
  due: ['due'],
  blacklisted: ['blacklisted', 'ignored'],
  suspended: ['suspended'],
  redundant: ['redundant'],
  frequent: ['frequent'],
  'i-plus-one': ['i-plus-one'],
  unparsed: ['unparsed'],
  heiban: ['heiban'],
  atamadaka: ['atamadaka'],
  nakadaka: ['nakadaka'],
  odaka: ['odaka'],
  kifuku: ['kifuku'],
};

function hexWithAlpha(colour: string, alpha: number): string {
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return colour;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function cssForEffects(effects: WordEffect[]): { base: string[]; hover: string[] } {
  // Reset what index.css hard-codes so that an empty state really looks unstyled.
  const base = ['color: inherit !important', 'text-decoration: none !important', 'opacity: 1 !important', 'text-shadow: none !important'];
  const hover: string[] = [];
  const shadows: string[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case 'text-colour':
        if (effect.colour) base.push(`color: ${effect.colour} !important`);
        break;
      case 'underline':
        base.push('text-decoration-line: underline !important');
        base.push(`text-decoration-style: ${effect.style || 'solid'} !important`);
        if (effect.colour) base.push(`text-decoration-color: ${effect.colour} !important`);
        base.push(`text-decoration-thickness: ${effect.thickness || 2}px !important`);
        base.push('text-underline-offset: 3px');
        break;
      case 'background':
        if (effect.colour) base.push(`background-color: ${hexWithAlpha(effect.colour, effect.opacity ?? 1)} !important`);
        break;
      case 'opacity':
        if (effect.value !== undefined) {
          if (effect.hoverOnly) hover.push(`opacity: ${effect.value} !important`);
          else base.push(`opacity: ${effect.value} !important`);
        }
        break;
      case 'shadow':
        if (effect.colour) shadows.push(`${effect.offsetX ?? 0}px ${effect.offsetY ?? 2}px ${effect.blur ?? 6}px ${effect.colour}`);
        break;
    }
  }
  if (shadows.length) base.push(`text-shadow: ${shadows.join(', ')} !important`);
  return { base, hover };
}

export function buildWordStyleCss(config: WordStyleThemeConfig): string {
  const rules: string[] = [];
  for (const [state, classes] of Object.entries(STATE_SELECTORS)) {
    const effects = config?.states?.[state]?.effects;
    if (!effects) continue;
    const { base, hover } = cssForEffects(effects);
    const selector = classes.map((cls) => `html .jiten-word.${cls}`).join(', ');
    rules.push(`${selector} { ${base.join('; ')}; }`);
    if (hover.length) {
      rules.push(`${classes.map((cls) => `html .jiten-word.${cls}:hover`).join(', ')} { ${hover.join('; ')}; }`);
    }
  }
  return rules.join('\n');
}

/** Applies the saved word-state styles to the native parser output (no-op on desktop). */
export function applyLocalWordStyles(): void {
  if (!usesLocalParserSettings() || typeof document === 'undefined') return;
  const raw = readLocal().wordStyleConfig;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!raw) {
    el?.remove();
    return;
  }
  let config: WordStyleThemeConfig;
  try {
    config = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildWordStyleCss(config);
}
