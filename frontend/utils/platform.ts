import { Capacitor } from '@capacitor/core';

/**
 * Phone vs desktop UI. The Android app (and the ?android browser preview) adds `platform-android`
 * to <html>; a touch-only small screen counts as a phone too. Use this to keep phone features
 * (gestures, long-press, system voices) off the desktop and desktop features (keyboard shortcuts,
 * hover lookups, Discord) off the phone.
 */
export function isPhoneUI(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.classList.contains('platform-android')) return true;
  if (Capacitor.isNativePlatform()) return true;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse && window.innerWidth <= 768;
}
