import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import stableManifest from '../../stable.json';

// One update flow for every platform, all of it inside the app:
// - Electron (current builds): backend/updater.cjs downloads the installer or the OTA bundle
//   with progress and applies it (silent NSIS install + relaunch, or reload into the new bundle).
// - Electron (builds older than the updater): the legacy downloadAndInstallUpdate IPC, which
//   downloads the installer in-app and opens it. Reached when a newer OTA frontend runs there.
// - Android, UI only: WebUpdaterPlugin downloads dist.zip (mobile/mobile-ota.json) in the
//   background when it was built for the installed APK, and applies it on the next start
//   or right away from "Reiniciar para actualizar".
// - Android, native changes: AppUpdaterPlugin downloads the APK and opens the system installer.
// The GitHub releases page is only offered as a fallback link after an error.

export type UpdaterStatus =
  | 'idle' | 'disabled' | 'checking' | 'up-to-date' | 'available'
  | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  kind: 'installer' | 'ota' | 'apk' | null;
  current: { appVersion: string; hotVersion?: string };
  latest: { appVersion: string; hotVersion?: string; description?: string } | null;
  progress: { percent: number; transferred?: number; total?: number } | null;
  error: string | null;
  platform: string;
  silentInstall?: boolean;
  fallbackUrl: string;
}

interface AppUpdaterPlugin {
  download(options: { url: string }): Promise<{ versionName: string; versionCode: number; size: number }>;
  install(): Promise<{ status: 'installer-opened' | 'permission-denied' }>;
  addListener(event: 'downloadProgress', listener: (progress: { percent: number; transferred: number; total: number }) => void): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

interface WebUpdaterPlugin {
  getState(): Promise<{ nativeVersionCode: number; currentVersion: string | null; pendingVersion: string | null; trial: boolean; lastRollback: string | null }>;
  download(options: { url: string; sha256: string; size: number; version: string; nativeVersionCode: number }): Promise<{ version: string; ready: boolean }>;
  applyNow(): Promise<void>;
  notifyAppReady(): Promise<{ currentVersion: string | null }>;
  addListener(event: 'downloadProgress', listener: (progress: { percent: number; transferred: number; total: number }) => void): Promise<PluginListenerHandle>;
}

// Only in APKs from 1.3.11 on; older ones update by APK alone.
const WebUpdater = registerPlugin<WebUpdaterPlugin>('WebUpdater');
const hasWebUpdater = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('WebUpdater');

/** Tells WebUpdaterPlugin this UI started; without it a freshly applied OTA is rolled back. */
export function notifyWebBundleReady() {
  if (hasWebUpdater()) WebUpdater.notifyAppReady().catch(() => {});
}

const REPO = 'Zams0524/Yoru-Reader';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const DESKTOP_MANIFESTS = [
  `https://raw.githubusercontent.com/${REPO}/main/stable.json`,
  `https://raw.githubusercontent.com/${REPO}/master/stable.json`
];
const ANDROID_OTA_MANIFESTS = [
  `https://github.com/${REPO}/releases/latest/download/mobile-ota.json`,
  `https://raw.githubusercontent.com/${REPO}/main/mobile/mobile-ota.json`
];
const ANDROID_MANIFESTS = [
  `https://raw.githubusercontent.com/${REPO}/main/mobile/mobile-stable.json`,
  `https://raw.githubusercontent.com/${REPO}/master/mobile/mobile-stable.json`
];

export const isNewerVersion = (remote?: string, local?: string) => {
  if (!remote || !local) return false;
  const r = remote.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const l = local.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) !== (l[i] || 0)) return (r[i] || 0) > (l[i] || 0);
  }
  return false;
};

async function fetchFirstJson(urls: string[]) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (_) { /* try the next mirror */ }
  }
  throw new Error('No se pudo conectar con el servidor de actualizaciones.');
}

type Mode = 'electron' | 'electron-legacy' | 'android' | 'none';

function detectMode(): Mode {
  const api = (window as any).electronAPI;
  if (api?.updater) return 'electron';
  if (api?.downloadAndInstallUpdate) return 'electron-legacy';
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') return 'android';
  return 'none';
}

const initialState = (mode: Mode): UpdaterState => ({
  status: mode === 'none' ? 'disabled' : 'idle',
  kind: null,
  current: { appVersion: stableManifest.appVersion, hotVersion: stableManifest.hotUpdateVersion },
  latest: null,
  progress: null,
  error: null,
  platform: mode,
  fallbackUrl: RELEASES_URL
});

export function useAppUpdater() {
  const modeRef = useRef<Mode>(detectMode());
  const mode = modeRef.current;
  const [state, setState] = useState<UpdaterState>(() => initialState(mode));
  const stateRef = useRef(state);
  const remoteRef = useRef<any>(null);
  const otaRef = useRef<any>(null);
  const patch = useCallback((next: Partial<UpdaterState>) => {
    setState(prev => {
      const merged = { ...prev, ...next };
      stateRef.current = merged;
      return merged;
    });
  }, []);

  // Electron: the main process owns the state; mirror it.
  useEffect(() => {
    if (mode !== 'electron') return;
    const api = (window as any).electronAPI.updater;
    let alive = true;
    api.getState().then((s: UpdaterState) => { if (alive && s) patch(s); });
    const off = api.onState((s: UpdaterState) => patch(s));
    return () => { alive = false; off(); };
  }, [mode, patch]);

  // Android: report the installed APK version, not the desktop manifest bundled in the web code.
  useEffect(() => {
    if (mode !== 'android') return;
    CapacitorApp.getInfo()
      .then(info => patch({ current: { appVersion: info.version, hotVersion: stableManifest.hotUpdateVersion } }))
      .catch(() => {});
  }, [mode, patch]);

  // Android: if the user backs out of the system installer, offer the install again.
  useEffect(() => {
    if (mode !== 'android') return;
    const handle = CapacitorApp.addListener('resume', () => {
      if (stateRef.current.status === 'installing') patch({ status: 'ready' });
    });
    return () => { handle.then(h => h.remove()); };
  }, [mode, patch]);

  // Legacy Electron: progress from the old installer downloader.
  useEffect(() => {
    if (mode !== 'electron-legacy') return;
    const api = (window as any).electronAPI;
    if (!api.onUpdateDownloadProgress) return;
    return api.onUpdateDownloadProgress((data: any) => {
      if (data?.status === 'installing') patch({ status: 'installing', progress: { percent: 100 } });
      else if (typeof data?.percent === 'number') patch({ status: 'downloading', progress: { percent: data.percent } });
    });
  }, [mode, patch]);

  // Android OTA: download the UI bundle; WebUpdaterPlugin applies it on the next start.
  const downloadOta = useCallback(async () => {
    const ota = otaRef.current;
    if (!ota) return;
    patch({ status: 'downloading', error: null, progress: { percent: 0 } });
    const handle = await WebUpdater.addListener('downloadProgress', p => patch({ progress: p }));
    try {
      await WebUpdater.download({
        url: ota.url,
        sha256: ota.sha256,
        size: ota.size,
        version: ota.webVersion,
        nativeVersionCode: ota.nativeVersionCode
      });
    } finally {
      handle.remove();
    }
    patch({ status: 'ready', progress: { percent: 100 } });
  }, [patch]);

  const check = useCallback(async (options: { autoDownload?: boolean } = {}): Promise<UpdaterState> => {
    if (mode === 'electron') {
      const s = await (window as any).electronAPI.updater.check(options);
      patch(s);
      return s;
    }
    if (mode === 'none') return stateRef.current;
    patch({ status: 'checking', error: null });
    try {
      if (mode === 'android') {
        const remote = await fetchFirstJson(ANDROID_MANIFESTS);
        remoteRef.current = remote;
        const info = await CapacitorApp.getInfo();
        const installedCode = parseInt(info.build, 10) || 0;
        const newer = remote.versionCode && installedCode
          ? remote.versionCode > installedCode
          : isNewerVersion(remote.appVersion, info.version);
        const current = { appVersion: info.version, hotVersion: stableManifest.hotUpdateVersion };
        const latest = { appVersion: remote.appVersion, description: remote.description };
        if (newer) {
          // Native code changed: only a new APK brings it (and it replaces any downloaded UI).
          patch({ status: 'available', kind: 'apk', current, latest });
        } else if (hasWebUpdater()) {
          const ota = await fetchFirstJson(ANDROID_OTA_MANIFESTS).catch(() => null);
          const web = await WebUpdater.getState();
          const offered = Boolean(ota?.url) && ota.nativeVersionCode === installedCode
            && ota.webVersion !== web.lastRollback
            && isNewerVersion(ota.webVersion, current.hotVersion);
          otaRef.current = offered ? ota : null;
          if (offered) {
            const staged = web.pendingVersion === ota.webVersion;
            patch({
              status: staged ? 'ready' : 'available',
              kind: 'ota',
              current,
              latest: { ...latest, hotVersion: ota.webVersion }
            });
            if (!staged && options.autoDownload) {
              downloadOta().catch((err: any) => patch({ status: 'error', error: err?.message || String(err), progress: null }));
            }
          } else {
            patch({ status: 'up-to-date', kind: null, current, latest: { ...latest, hotVersion: ota?.webVersion } });
          }
        } else {
          patch({ status: 'up-to-date', kind: null, current, latest });
        }
      } else {
        const remote = await fetchFirstJson(DESKTOP_MANIFESTS);
        remoteRef.current = remote;
        const newer = isNewerVersion(remote.appVersion, stableManifest.appVersion);
        patch({
          status: newer ? 'available' : 'up-to-date',
          kind: newer ? 'installer' : null,
          latest: { appVersion: remote.appVersion, hotVersion: remote.hotUpdateVersion, description: remote.description }
        });
      }
    } catch (err: any) {
      patch({ status: 'error', error: err?.message || String(err) });
    }
    return stateRef.current;
  }, [mode, patch, downloadOta]);

  const updateNow = useCallback(async () => {
    const current = stateRef.current;
    try {
      if (mode === 'electron') {
        const api = (window as any).electronAPI.updater;
        if (current.status !== 'ready') await api.download();
        await api.install();
        return;
      }
      if (mode === 'android' && current.kind === 'ota') {
        if (current.status !== 'ready') await downloadOta();
        patch({ status: 'installing', error: null });
        await WebUpdater.applyNow();
        return;
      }
      if (mode === 'android') {
        const url = remoteRef.current?.apkUrl || `https://github.com/${REPO}/releases/latest/download/Yoru-Reader.apk`;
        if (current.status !== 'ready') {
          patch({ status: 'downloading', error: null, progress: { percent: 0 } });
          const handle = await AppUpdater.addListener('downloadProgress', p => patch({ progress: p }));
          try {
            await AppUpdater.download({ url });
          } finally {
            handle.remove();
          }
          patch({ status: 'ready', progress: { percent: 100 } });
        }
        const result = await AppUpdater.install();
        if (result.status === 'permission-denied') {
          patch({ status: 'ready', error: 'android-permission' });
        } else {
          patch({ status: 'installing', error: null });
        }
        return;
      }
      if (mode === 'electron-legacy') {
        const remote = remoteRef.current || await fetchFirstJson(DESKTOP_MANIFESTS);
        const url = remote.windowsUrl || remote.url;
        patch({ status: 'downloading', error: null, progress: { percent: 0 } });
        await (window as any).electronAPI.downloadAndInstallUpdate(url);
      }
    } catch (err: any) {
      // In Electron the main process already broadcast the error state with a clean message.
      if (mode === 'electron') return;
      patch({ status: 'error', error: err?.message || String(err), progress: null });
    }
  }, [mode, patch, downloadOta]);

  const openFallback = useCallback(async () => {
    if (mode === 'electron') {
      await (window as any).electronAPI.updater.openFallback();
    } else if (mode === 'android') {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: RELEASES_URL });
    } else {
      window.open(RELEASES_URL, '_blank');
    }
  }, [mode]);

  return { state, mode, check, updateNow, openFallback };
}
