import { Capacitor } from '@capacitor/core';

/**
 * One source of truth for "what kind of screen is this", shared by the React
 * shell and the stylesheet.
 *
 * Two independent questions:
 *
 *  - **Which chrome?** `isPhoneUI()` / `isCompactShell()`. The compact shell is
 *    the phone one: top app bar, bottom tab bar, sidebar as a drawer. Android
 *    always uses it, tablets included, and so does any touch-only small screen.
 *    `html.yoru-compact` carries the answer to the CSS, which is why the phone
 *    rules are gated on that class instead of `@media (max-width: 768px)`.
 *    Before, the shell asked the platform and the stylesheet asked the width,
 *    so an Android tablet got the phone markup under the desktop stylesheet:
 *    the drawer stuck open, an oversized title and a page that scrolled
 *    sideways.
 *
 *  - **How big?** `getDeviceClass()`, mirrored as `html.yoru-phone` /
 *    `yoru-tablet` / `yoru-desktop`. This only scales the shell: a tablet gets
 *    the same phone layout with more columns, wider bars and larger type.
 */
export const PHONE_MAX_WIDTH = 768;
export const TABLET_MAX_WIDTH = 1279;

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/** Running inside the Capacitor native app (Android), or its `?android` browser preview. */
export function isNativeApp(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('platform-android')) return true;
  return Capacitor.isNativePlatform();
}

/** Running inside the Electron desktop app, where `window.electronAPI` is injected. */
export function isElectronApp(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;
}

/** Touch is the primary pointer: finger-sized targets, no hover-only affordances. */
export function isTouchPrimary(): boolean {
  if (isNativeApp()) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function viewportWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return window.visualViewport?.width ?? window.innerWidth;
}

/** How much room there is, independently of which chrome is in use. */
export function getDeviceClass(): DeviceClass {
  const width = viewportWidth();
  if (width <= PHONE_MAX_WIDTH) return 'phone';
  if (width <= TABLET_MAX_WIDTH) return 'tablet';
  return 'desktop';
}

/**
 * The compact (phone) chrome. Same rule as before — the Android app and its
 * browser preview always, plus any touch-only small screen — so every existing
 * `isPhoneUI()` call keeps its exact meaning.
 */
export function isCompactShell(): boolean {
  if (typeof document === 'undefined') return false;
  if (isNativeApp()) return true;
  return isTouchPrimary() && getDeviceClass() === 'phone';
}

/**
 * Phone vs desktop UI. Keeps phone features (gestures, long-press, system
 * voices) off the desktop and desktop features (keyboard shortcuts, hover
 * lookups, Discord) off the phone. An Android tablet counts as a phone UI: it
 * uses the same shell, only scaled up.
 */
export function isPhoneUI(): boolean {
  return isCompactShell();
}

export function isTabletUI(): boolean {
  return getDeviceClass() === 'tablet';
}

/**
 * Desktop-only integrations (Discord RPC, keyboard shortcuts, secondary
 * windows). Not the same as "wide screen": an Android tablet is wide and has
 * none of them.
 */
export function hasDesktopIntegrations(): boolean {
  return !isNativeApp() && !isCompactShell();
}

/** Mirrors the current shell and size onto <html> so the CSS can key off them. */
export function applyDeviceClasses(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const size = getDeviceClass();
  root.classList.toggle('yoru-compact', isCompactShell());
  root.classList.toggle('yoru-phone', size === 'phone');
  root.classList.toggle('yoru-tablet', size === 'tablet');
  root.classList.toggle('yoru-desktop', size === 'desktop');
  root.classList.toggle('yoru-touch', isTouchPrimary());
}

/**
 * Calls `listener` whenever the shell or the size class changes (rotation,
 * split screen, window resize). Returns an unsubscribe function.
 */
export function watchDeviceClass(listener: (deviceClass: DeviceClass) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = `${isCompactShell()}:${getDeviceClass()}`;
  const check = () => {
    const next = `${isCompactShell()}:${getDeviceClass()}`;
    if (next === last) return;
    last = next;
    listener(getDeviceClass());
  };
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  window.visualViewport?.addEventListener('resize', check);
  return () => {
    window.removeEventListener('resize', check);
    window.removeEventListener('orientationchange', check);
    window.visualViewport?.removeEventListener('resize', check);
  };
}
