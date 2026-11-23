// Reader settings hook for Yoru Reader

// Persists to localStorage and reflects changes into CSS variables

import { useState, useCallback, useEffect } from 'react';

/** Book colour modes. The extra ones are variants of light, sepia or dark (see baseReaderTheme). */
export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'night-contrast' | 'sepia-contrast' | 'twilight' | 'console' | 'grafito';

export function baseReaderTheme(theme: string): 'light' | 'sepia' | 'dark' {
  if (theme === 'light') return 'light';
  if (theme === 'sepia' || theme === 'sepia-contrast') return 'sepia';
  return 'dark';
}

export interface ReaderSettingsState {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  verticalPadding: number;
  horizontalPadding: number;
  vertical: boolean;
  paginated: boolean;
  showFurigana: boolean;
  disableCss: boolean;
  theme: ReaderTheme;
  showProgressLine: boolean;
  direction: 'auto' | 'vertical' | 'horizontal';
  autoScrollEnabled: boolean;
  autoScrollSpeed: number;
  tapZoneMode: 'edge' | 'kindle';
  invertTapZones: boolean;
  volumeKeysNavigation: boolean;
  invertVolumeKeys: boolean;
  readerBrightness: number;
  readerMaxWidth: string;
  pagePadding: 'compact' | 'normal' | 'spacious';
  /** CSS font-weight for the book text (ReadEra's font thickness). */
  fontWeight: number;
  textAlign: 'original' | 'justify' | 'left' | 'center' | 'right';
  hyphenation: boolean;
  /** Android: draw the book with the native engine (NativeReaderPlugin) instead of the WebView. */
  nativeEngine: boolean;
  /** The book's pictures are blurred (spoilers) until tapped. */
  hideImages: boolean;
  /**
   * Dónde se coloca la tarjeta del diccionario, en PC y tablet (en el teléfono se acopla
   * al borde de la pantalla y esto no se usa).
   * - 'leido': sobre lo que ya has leído, mirando el modo de escritura (arriba en
   *   horizontal, a la derecha en vertical). Es lo de ahora.
   * - 'clasico': como antes del cambio, pegada a la palabra y donde haya hueco (debajo si
   *   cabe, y si no encima).
   */
  dictPopupPlacement: 'leido' | 'clasico';
  /**
   * Modo limpio: el libro con todas las palabras del color del texto (el subrayado y el
   * resto de marcas del análisis se quedan) y el audiolibro como barra fija a lo ancho,
   * abajo. Al encenderlo se ponen además el color «Grafito» y la fuente Noto Serif JP,
   * que luego se pueden cambiar por separado.
   */
  modoLimpio: boolean;
}

const LS_KEYS: Record<keyof ReaderSettingsState, string> = {
  fontSize: 'reader:fontSize',
  lineHeight: 'reader:lineHeight',
  fontFamily: 'reader:fontFamily',
  verticalPadding: 'reader:verticalPadding',
  horizontalPadding: 'reader:horizontalPadding',
  vertical: 'reader:vertical',
  paginated: 'reader:paginated',
  showFurigana: 'reader:showFurigana',
  disableCss: 'reader:disableCss',
  theme: 'reader:theme',
  showProgressLine: 'reader:showProgressLine',
  direction: 'reader:direction',
  autoScrollEnabled: 'reader:autoScrollEnabled',
  autoScrollSpeed: 'reader:autoScrollSpeed',
  tapZoneMode: 'reader:tapZoneMode',
  invertTapZones: 'reader:invertTapZones',
  volumeKeysNavigation: 'reader:volumeKeysNavigation',
  invertVolumeKeys: 'reader:invertVolumeKeys',
  readerBrightness: 'reader:readerBrightness',
  readerMaxWidth: 'reader:readerMaxWidth',
  pagePadding: 'reader:pagePadding',
  fontWeight: 'reader:fontWeight',
  textAlign: 'reader:textAlign',
  hyphenation: 'reader:hyphenation',
  nativeEngine: 'reader:nativeEngine',
  hideImages: 'reader:hideImages',
  dictPopupPlacement: 'reader:dictPopupPlacement',
  modoLimpio: 'reader:modoLimpio',
};

function getNumber(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v !== null ? Number(v) : fallback;
}

function getBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v !== null ? v === 'true' : fallback;
}

function getString(key: string, fallback: string): string {
  const v = localStorage.getItem(key);
  return v !== null ? v : fallback;
}

export const BUILT_IN_FONTS = [
  { label: 'Default (System Font)', value: '__default__' },
  { label: 'Noto Sans JP', value: 'Noto Sans JP' },
  { label: 'Noto Serif JP', value: 'Noto Serif JP' },
  { label: 'KleeOne', value: 'KleeOne' },
  { label: 'Shippori Mincho', value: 'Shippori Mincho' },
];

function loadSettings(): ReaderSettingsState {
  limpioDeFabrica();
  ponerAlDiaLimpio();
  const direction = getString(LS_KEYS.direction, 'auto') as 'auto' | 'vertical' | 'horizontal';
  return {
    fontSize: getNumber(LS_KEYS.fontSize, 20),
    lineHeight: getNumber(LS_KEYS.lineHeight, 1.8),
    fontFamily: getString(LS_KEYS.fontFamily, '__default__'),
    verticalPadding: getNumber(LS_KEYS.verticalPadding, 3),
    horizontalPadding: getNumber(LS_KEYS.horizontalPadding, 8),
    // Japanese books read top-to-bottom, right-to-left by default; 'auto' means vertical too.
    vertical: direction !== 'horizontal',
    paginated: getBool(LS_KEYS.paginated, true),
    showFurigana: getBool(LS_KEYS.showFurigana, true),
    disableCss: getBool(LS_KEYS.disableCss, false),
    theme: getString(LS_KEYS.theme, 'dark') as ReaderTheme,
    showProgressLine: getBool(LS_KEYS.showProgressLine, true),
    direction,
    autoScrollEnabled: getBool(LS_KEYS.autoScrollEnabled, false),
    autoScrollSpeed: getNumber(LS_KEYS.autoScrollSpeed, 1.0),
    tapZoneMode: (getString(LS_KEYS.tapZoneMode, 'edge') as 'edge' | 'kindle'),
    invertTapZones: getBool(LS_KEYS.invertTapZones, false),
    volumeKeysNavigation: getBool(LS_KEYS.volumeKeysNavigation, true),
    invertVolumeKeys: getBool(LS_KEYS.invertVolumeKeys, false),
    readerBrightness: getNumber(LS_KEYS.readerBrightness, 100),
    readerMaxWidth: getString(LS_KEYS.readerMaxWidth, 'none'),
    pagePadding: (getString(LS_KEYS.pagePadding, 'normal') as 'compact' | 'normal' | 'spacious'),
    fontWeight: getNumber(LS_KEYS.fontWeight, 400),
    textAlign: getString(LS_KEYS.textAlign, 'original') as ReaderSettingsState['textAlign'],
    hyphenation: getBool(LS_KEYS.hyphenation, false),
    nativeEngine: getBool(LS_KEYS.nativeEngine, true),
    hideImages: getBool(LS_KEYS.hideImages, false),
    dictPopupPlacement: getString(LS_KEYS.dictPopupPlacement, 'leido') === 'clasico' ? 'clasico' : 'leido',
    modoLimpio: getBool(LS_KEYS.modoLimpio, true),
  };
}

/*
  ── Modo limpio: la disposición del texto ────────────────────────────────
  Los valores: Noto Serif JP a 28 px, interlineado 1,65, texto justificado
  y un 5 % de margen por cada lado. Los 28 px son de una pantalla de 412 px de
  ancho; en un teléfono más estrecho se baja en proporción, para que quepan las
  mismas columnas y no la misma cifra.
*/
const ANTES_DE_LIMPIO = 'reader:antesDeLimpio';
const LIMPIO_TEXTO_HECHO = 'reader:limpioTexto';

type DeLimpio = Pick<ReaderSettingsState,
  'theme' | 'fontFamily' | 'fontSize' | 'lineHeight' | 'horizontalPadding' | 'verticalPadding' | 'textAlign' | 'fontWeight'>;

export function valoresDeLimpio(): DeLimpio {
  const ancho = typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) : 412;
  const fontSize = ancho < 412 ? Math.max(20, Math.round(28 * ancho / 412)) : 28;
  return {
    theme: 'grafito',
    fontFamily: 'Noto Serif JP',
    fontSize,
    lineHeight: 1.65,
    horizontalPadding: 5,
    verticalPadding: 5,
    textAlign: 'justify',
    fontWeight: 400,
  };
}

const CLAVES_DE_LIMPIO = ['theme', 'fontFamily', 'fontSize', 'lineHeight', 'horizontalPadding', 'verticalPadding', 'textAlign', 'fontWeight'] as const;

/** Guarda lo que había antes de entrar al modo limpio, sin pisar lo ya guardado. */
export function guardarAntesDeLimpio(actual: Partial<DeLimpio>): void {
  try {
    const ya = JSON.parse(localStorage.getItem(ANTES_DE_LIMPIO) || '{}') as Partial<DeLimpio>;
    const antes: Record<string, unknown> = { ...ya };
    for (const clave of CLAVES_DE_LIMPIO) if (antes[clave] === undefined && actual[clave] !== undefined) antes[clave] = actual[clave];
    localStorage.setItem(ANTES_DE_LIMPIO, JSON.stringify(antes));
    localStorage.setItem(LIMPIO_TEXTO_HECHO, '1');
  } catch { /* sin sitio: al salir se vuelve a los valores de fábrica */ }
}

/** Lo que había antes del modo limpio (y lo olvida): a eso se vuelve al apagarlo. */
export function recuperarAntesDeLimpio(): Partial<DeLimpio> {
  let antes: Partial<DeLimpio> = {};
  try { antes = JSON.parse(localStorage.getItem(ANTES_DE_LIMPIO) || '{}'); } catch { /* se queda vacío */ }
  try { localStorage.removeItem(ANTES_DE_LIMPIO); localStorage.removeItem(LIMPIO_TEXTO_HECHO); } catch { /* da igual */ }
  return antes;
}

/*
  El modo limpio viene encendido de fábrica (lo pidió zams, 23 nov 2026). A quien
  nunca lo ha tocado, sea nuevo o ya tuviera la app, se le enciende una vez, igual
  que con el interruptor: se guarda lo que tenía (o los valores de fábrica, si no
  había cambiado nada) para devolvérselo si lo apaga, y se ponen el color, la fuente
  y la disposición del modo. Quien ya lo encendió o lo apagó alguna vez tiene la
  clave escrita y no se le toca.
*/
function limpioDeFabrica(): void {
  try {
    if (localStorage.getItem(LS_KEYS.modoLimpio) !== null) return;
    guardarAntesDeLimpio({
      theme: getString(LS_KEYS.theme, 'dark') as ReaderTheme,
      fontFamily: getString(LS_KEYS.fontFamily, '__default__'),
      fontSize: getNumber(LS_KEYS.fontSize, 20),
      lineHeight: getNumber(LS_KEYS.lineHeight, 1.8),
      horizontalPadding: getNumber(LS_KEYS.horizontalPadding, 8),
      verticalPadding: getNumber(LS_KEYS.verticalPadding, 3),
      textAlign: getString(LS_KEYS.textAlign, 'original') as ReaderSettingsState['textAlign'],
      fontWeight: getNumber(LS_KEYS.fontWeight, 400),
    });
    const valores = valoresDeLimpio();
    for (const clave of CLAVES_DE_LIMPIO) localStorage.setItem(LS_KEYS[clave], String(valores[clave]));
    localStorage.setItem(LS_KEYS.modoLimpio, 'true');
  } catch { /* sin almacenamiento se queda como estaba */ }
}

/*
  Quien ya tenía el modo limpio puesto cuando solo cambiaba colores y fuente: la
  disposición se le aplica una vez, al abrir, guardando lo que tenía.
*/
function ponerAlDiaLimpio(): void {
  try {
    if (localStorage.getItem(LS_KEYS.modoLimpio) !== 'true' || localStorage.getItem(LIMPIO_TEXTO_HECHO) === '1') return;
    const antes: Record<string, unknown> = {};
    for (const clave of ['fontSize', 'lineHeight', 'horizontalPadding', 'verticalPadding', 'fontWeight'] as const) {
      const valor = localStorage.getItem(LS_KEYS[clave]);
      if (valor !== null && Number.isFinite(Number(valor))) antes[clave] = Number(valor);
    }
    const alineado = localStorage.getItem(LS_KEYS.textAlign);
    if (alineado) antes.textAlign = alineado;
    guardarAntesDeLimpio(antes as Partial<DeLimpio>);
    const valores = valoresDeLimpio();
    for (const clave of ['fontSize', 'lineHeight', 'horizontalPadding', 'verticalPadding', 'textAlign', 'fontWeight'] as const) {
      localStorage.setItem(LS_KEYS[clave], String(valores[clave]));
    }
  } catch { /* sin almacenamiento no hay nada que poner al día */ }
}

export function useReaderSettings(): [ReaderSettingsState, <K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => void] {
  const [settings, setSettingsState] = useState<ReaderSettingsState>(loadSettings);

  const setSetting = useCallback(<K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => {
    localStorage.setItem(LS_KEYS[key], String(value));
    setSettingsState(prev => ({ ...prev, [key]: value }));
  }, []);

  // Reflect font-family CSS variable whenever it changes
  useEffect(() => {
    if (settings.fontFamily && settings.fontFamily !== '__default__') {
      document.body.style.setProperty('--reader-font', `"${settings.fontFamily}"`);
    } else {
      document.body.style.removeProperty('--reader-font');
    }
  }, [settings.fontFamily]);

  // Reflect furigana visibility
  useEffect(() => {
    if (!settings.showFurigana) {
      document.body.classList.add('hide-furigana');
    } else {
      document.body.classList.remove('hide-furigana');
    }
  }, [settings.showFurigana]);

  return [settings, setSetting];
}
