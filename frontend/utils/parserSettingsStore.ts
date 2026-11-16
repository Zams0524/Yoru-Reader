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

/** The "Default" styling theme; also what the native reader shows until the user saves another. */
export const DEFAULT_WORD_STYLE_CONFIG: WordStyleThemeConfig = {
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
};

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

// ── Qué analizador parte las palabras ─────────────────────────────────

/** `jiten`: el parser de jiten.moe. `nativo`: el analizador que lleva la app (Kuromoji). */
export type ModoAnalizador = 'jiten' | 'nativo';

/** True cuando hay una clave de Jiten guardada en esta instalación. */
export function hayClaveJiten(): boolean {
  const clave = getLocalParserSetting('jitenApiKey');
  return typeof clave === 'string' && clave.trim().length > 0;
}

/**
 * El modo que se usa cuando el usuario no ha elegido ninguno.
 *
 * No es «lo que la plataforma puede hacer» sino lo que esta instalación venía haciendo, para
 * que nadie note el cambio al pasar de deducir el modo a elegirlo: en escritorio parte las
 * palabras la extensión de lectura, y en el resto mandaba la clave guardada más el interruptor
 * `jitenUseParser`, que esta elección sustituye.
 */
export function modoAnalizadorPorDefecto(): ModoAnalizador {
  if (!usesLocalParserSettings()) return 'jiten';
  const usaba = getLocalParserSetting('jitenUseParser');
  return hayClaveJiten() && usaba !== false && usaba !== 'false' ? 'jiten' : 'nativo';
}

/** El modo elegido, o el de siempre si no se ha elegido ninguno. */
export function modoAnalizador(): ModoAnalizador {
  const guardado = getLocalParserSetting('parserEngine');
  if (guardado === 'jiten' || guardado === 'nativo') return guardado;
  return modoAnalizadorPorDefecto();
}

export type MotivoModoNoDisponible = 'sin-clave' | 'solo-extension' | 'sin-comprobar';

/**
 * Si la extensión de lectura sabe pararse cuando se lo pedimos. `null` mientras no se ha
 * comprobado: no es «no», y la interfaz no debe decir que el modo nativo está disponible
 * hasta que haya respuesta.
 */
let extensionSabePararse: boolean | null = null;

/**
 * Pregunta a la extensión si entiende la pausa, y guarda la respuesta.
 *
 * No adivina por número de versión: lee `parsingPaused` por el puente y mira **de qué tipo**
 * vuelve. La extensión que sabe pararse contesta una booleana, porque devuelve esa clave por
 * `getParsingPaused`; una anterior la busca en `profile:<id>:parsingPaused`, donde nadie la ha
 * escrito, y contesta null o una cadena.
 *
 * No escribe nada: la lectura ya distingue las dos, así que no hace falta tocar el ajuste de
 * nadie para averiguarlo.
 *
 * Si nadie contesta al puente se queda en `null`, sin decidir. Sería cómodo tomarlo por «no hay
 * extensión, así que el analizador de la app manda», pero también es lo que pasa cuando la
 * extensión está y su puente no responde: ahí no podemos pedirle que pare, y ofrecer el modo
 * nativo sería ofrecer un botón que no hace nada. Mejor decir que no se pudo comprobar.
 */
export async function comprobarPausaDeExtension(): Promise<boolean | null> {
  // Sin extensión, las palabras las parte la app: el modo nativo es justo lo que ya pasa.
  if (usesLocalParserSettings()) {
    extensionSabePararse = true;
    return true;
  }
  const valores = await readFromExtension(['parsingPaused']);
  if (valores === null) return extensionSabePararse;
  extensionSabePararse = typeof valores.parsingPaused === 'boolean';
  return extensionSabePararse;
}

/**
 * Por qué un modo no se puede usar aquí, o null si sí se puede.
 *
 * - `sin-clave`: el parser de Jiten es un servicio, y sin clave de la cuenta no contesta.
 * - `solo-extension`: en escritorio las palabras las parte la extensión de lectura, y esta
 *   versión suya no sabe pararse, así que no se puede elegir el analizador de la app.
 * - `sin-comprobar`: todavía no se le ha preguntado, o la pregunta falló. No es lo mismo que
 *   «no se puede», y el mensaje tiene que decir eso y no inventarse otro motivo.
 */
export function motivoModoNoDisponible(modo: ModoAnalizador): MotivoModoNoDisponible | null {
  if (modo === 'jiten') return hayClaveJiten() ? null : 'sin-clave';
  // Sin extensión de por medio no hay a quién preguntar: las palabras ya las parte la app.
  if (usesLocalParserSettings()) return null;
  if (extensionSabePararse === null) return 'sin-comprobar';
  return extensionSabePararse ? null : 'solo-extension';
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
  /*
    Elegir el analizador en escritorio es, para la extensión, pausar o reanudar su parseo: es
    quien parte las palabras allí. Va en la misma escritura que el ajuste para que no quede un
    momento con la elección guardada y la extensión a lo suyo.

    Ojo: la pausa surte efecto en el siguiente parseo, no al instante, porque el aviso no puede
    llegar desde el puente al parser de su propia pestaña. Que haga falta recargar la vista del
    lector al cambiar de modo está sin comprobar: se ve con la extensión nueva delante.
  */
  const aGuardar =
    'parserEngine' in entries && !usesLocalParserSettings()
      ? { ...entries, parsingPaused: entries.parserEngine === 'nativo' }
      : entries;

  // Keep a local copy everywhere so settings survive even when the extension is missing.
  let savedLocally = false;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), ...aGuardar }));
    savedLocally = true;
  } catch {
    savedLocally = false;
  }

  if ('wordStyleConfig' in aGuardar) applyLocalWordStyles();
  window.dispatchEvent(new CustomEvent('yoru-parser-settings-changed', { detail: { keys: Object.keys(aGuardar) } }));
  if (usesLocalParserSettings()) return savedLocally;
  return (await writeToExtension(aGuardar)) || savedLocally;
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
  // Only the state's own effects: the shared reset in buildWordStyleCss clears the rest, so a
  // word with several states (e.g. "new frequent") keeps the effects of all of them.
  const base: string[] = [];
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
  // Clear the colours index.css hard-codes (.jiten-word.new etc.) so only saved effects show.
  // ".jiten-word.jiten-word" outranks index.css; each state rule below outranks this reset.
  const rules: string[] = [
    'html .jiten-word.jiten-word { color: inherit !important; text-decoration: none !important; opacity: 1 !important; text-shadow: none !important; }',
  ];
  for (const [state, classes] of Object.entries(STATE_SELECTORS)) {
    const effects = config?.states?.[state]?.effects;
    if (!effects?.length) continue;
    const { base, hover } = cssForEffects(effects);
    if (base.length) rules.push(`${classes.map((cls) => `html .jiten-word.jiten-word.${cls}`).join(', ')} { ${base.join('; ')}; }`);
    if (hover.length) {
      rules.push(`${classes.map((cls) => `html .jiten-word.jiten-word.${cls}:hover`).join(', ')} { ${hover.join('; ')}; }`);
    }
  }
  return rules.join('\n');
}

/** The saved word-state styles on Android (the Default theme until the user saves another). */
export function getLocalWordStyleConfig(): WordStyleThemeConfig {
  const raw = readLocal().wordStyleConfig;
  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // An unreadable value keeps the Default theme instead of leaving index.css colours.
      if (parsed && typeof parsed === 'object' && parsed.states) return parsed;
    } catch {
      /* keep the Default theme */
    }
  }
  return DEFAULT_WORD_STYLE_CONFIG;
}

/** Applies the saved word-state styles to the native parser output (no-op on desktop). */
export function applyLocalWordStyles(): void {
  if (!usesLocalParserSettings() || typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  // Nothing saved yet: use the Default theme, so the reader matches what the settings show.
  const config = getLocalWordStyleConfig();
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildWordStyleCss(config);
}
