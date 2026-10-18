// Reader settings hook for Yoru Reader

// Persists to localStorage and reflects changes into CSS variables

import { useState, useCallback, useEffect } from 'react';

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
  theme: 'light' | 'sepia' | 'dark';
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
  return {
    fontSize: getNumber(LS_KEYS.fontSize, 20),
    lineHeight: getNumber(LS_KEYS.lineHeight, 1.8),
    fontFamily: getString(LS_KEYS.fontFamily, '__default__'),
    verticalPadding: getNumber(LS_KEYS.verticalPadding, 3),
    horizontalPadding: getNumber(LS_KEYS.horizontalPadding, 8),
    vertical: getBool(LS_KEYS.vertical, false),
    paginated: getBool(LS_KEYS.paginated, true),
    showFurigana: getBool(LS_KEYS.showFurigana, true),
    disableCss: getBool(LS_KEYS.disableCss, false),
    theme: getString(LS_KEYS.theme, 'dark') as 'light' | 'sepia' | 'dark',
    showProgressLine: getBool(LS_KEYS.showProgressLine, true),
    direction: getString(LS_KEYS.direction, 'auto') as 'auto' | 'vertical' | 'horizontal',
    autoScrollEnabled: getBool(LS_KEYS.autoScrollEnabled, false),
    autoScrollSpeed: getNumber(LS_KEYS.autoScrollSpeed, 1.0),
    tapZoneMode: (getString(LS_KEYS.tapZoneMode, 'edge') as 'edge' | 'kindle'),
    invertTapZones: getBool(LS_KEYS.invertTapZones, false),
    volumeKeysNavigation: getBool(LS_KEYS.volumeKeysNavigation, true),
    invertVolumeKeys: getBool(LS_KEYS.invertVolumeKeys, false),
    readerBrightness: getNumber(LS_KEYS.readerBrightness, 100),
    readerMaxWidth: getString(LS_KEYS.readerMaxWidth, 'none'),
    pagePadding: (getString(LS_KEYS.pagePadding, 'normal') as 'compact' | 'normal' | 'spacious'),
  };
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
