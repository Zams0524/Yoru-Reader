import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

// Android back button. Every screen or panel that can be closed registers how to close itself
// while it is open; back closes the most recently opened one. With nothing left to close the
// app goes to the background, like any Android app.

type Entry = { close: () => void };
const stack: Entry[] = [];

export function useBackHandler(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { close: () => closeRef.current() };
    stack.push(entry);
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [active]);
}

let installed = false;

export function installBackButton() {
  if (installed || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  installed = true;
  CapacitorApp.addListener('backButton', () => {
    const top = stack[stack.length - 1];
    if (top) top.close();
    else CapacitorApp.minimizeApp().catch(() => {});
  }).catch(() => {});
}
