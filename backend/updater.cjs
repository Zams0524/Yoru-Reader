// In-app updater for the desktop build.
//
// Two kinds of update come from stable.json (published by build-all-releases.yml):
//   - installer: appVersion is newer than the installed native build. The NSIS installer
//     (or the .dmg / .flatpak) is downloaded into userData/updates and, on Windows, run
//     silently with --updated /S --force-run, so it reuses the existing install location
//     and relaunches the app. The installer is not code-signed yet, so nothing here checks
//     Authenticode; integrity comes from the sha256/size in stable.json's assetHashes.
//   - ota: only hotUpdateVersion is newer. dist.zip is extracted into userData/ota_dist and
//     is loaded instead of the built-in frontend while it matches the installed native build.
//
// Shared by electron-main.cjs and src/electron-main.ts so both entry points behave the same.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'Zams0524/Yoru-Reader';
// The release copy first: it is replaced together with the assets it describes, while
// raw.githubusercontent can serve a cached copy for a few minutes after a release.
const MANIFEST_URLS = [
  `https://github.com/${REPO}/releases/download/latest/stable.json`,
  `https://raw.githubusercontent.com/${REPO}/main/stable.json`,
  `https://raw.githubusercontent.com/${REPO}/master/stable.json`
];
const FALLBACK_URL = `https://github.com/${REPO}/releases/latest`;
const USER_AGENT = 'Yoru-Reader-Updater/2';

function isNewer(remote, local) {
  if (!remote || !local) return false;
  const r = String(remote).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const l = String(local).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) !== (l[i] || 0)) return (r[i] || 0) > (l[i] || 0);
  }
  return false;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function setupUpdater({ app, ipcMain, shell, net, BrowserWindow, getMainWindow }) {
  const userData = app.getPath('userData');
  const otaDir = path.join(userData, 'ota_dist');
  const otaStagingDir = path.join(userData, 'ota_dist_staging');
  const updatesDir = path.join(userData, 'updates');
  const builtInIndex = path.join(app.getAppPath(), 'dist', 'index.html');

  // YORU_UPDATE_MANIFEST_URL points the updater at a local or test manifest (and enables it
  // in unpackaged/dev runs, which otherwise only report that updates are disabled).
  const manifestOverride = process.env.YORU_UPDATE_MANIFEST_URL || '';
  const isDevBuild = !app.isPackaged || /dev/i.test(app.getName()) || /dev/i.test(process.execPath);
  const enabled = !isDevBuild || Boolean(manifestOverride);

  // The manifest packaged with this build says which native and frontend versions it ships.
  // Builds from before stable.json was packaged fall back to package.json's version.
  const bundled = readJson(path.join(app.getAppPath(), 'stable.json')) || {};
  const nativeVersion = bundled.appVersion || app.getVersion();
  const builtInHotVersion = bundled.hotUpdateVersion || nativeVersion;

  function readOtaManifest() {
    return readJson(path.join(otaDir, 'ota_manifest.json'));
  }

  // The OTA bundle is only valid for the native build it was published with, and only
  // while it is newer than the frontend packaged inside that build.
  function usableOta() {
    const ota = readOtaManifest();
    if (!ota || !fs.existsSync(path.join(otaDir, 'index.html'))) return null;
    if (ota.nativeVersion && ota.nativeVersion !== nativeVersion) return null;
    if (!isNewer(ota.hotUpdateVersion, builtInHotVersion)) return null;
    return ota;
  }

  function resolveIndexFile() {
    if (enabled) {
      const ota = usableOta();
      if (ota) {
        console.log(`[updater] Loading OTA frontend ${ota.hotUpdateVersion} from ${otaDir}`);
        return path.join(otaDir, 'index.html');
      }
      if (fs.existsSync(otaDir)) {
        // Left over from an older native build or superseded by the installer.
        try { fs.rmSync(otaDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
    return builtInIndex;
  }

  function currentHotVersion() {
    const ota = usableOta();
    return ota ? ota.hotUpdateVersion : builtInHotVersion;
  }

  let state = {
    status: enabled ? 'idle' : 'disabled',
    kind: null,
    current: { appVersion: nativeVersion, hotVersion: currentHotVersion() },
    latest: null,
    progress: null,
    error: null,
    platform: process.platform,
    silentInstall: process.platform === 'win32',
    fallbackUrl: FALLBACK_URL
  };
  let manifest = null;
  let downloadedFile = null;
  let downloadPromise = null;
  let autoInstallOnQuit = false;
  let installing = false;
  let lastProgressSent = 0;

  function setState(patch) {
    state = { ...state, ...patch, current: { appVersion: nativeVersion, hotVersion: currentHotVersion() } };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater-state', state);
    }
  }

  async function fetchManifest() {
    const urls = manifestOverride ? [manifestOverride] : MANIFEST_URLS;
    let lastError = null;
    for (const url of urls) {
      try {
        const res = await net.fetch(url, { cache: 'no-store', headers: { 'User-Agent': USER_AGENT } });
        if (res.ok) return await res.json();
        lastError = new Error(`HTTP ${res.status} (${url})`);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('No se pudo leer el manifiesto de actualizaciones.');
  }

  function installerUrlFor(remote) {
    if (process.platform === 'darwin') return process.arch === 'arm64' ? remote.macArmUrl : remote.macUrl;
    if (process.platform === 'linux') return remote.linuxUrl;
    return remote.windowsUrl || remote.url;
  }

  function expectedAsset(url) {
    const hashes = manifest && manifest.assetHashes;
    if (!hashes || !url) return null;
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch (_) {}
    return hashes[name] || null;
  }

  async function check({ autoDownload = false } = {}) {
    if (!enabled) return state;
    if (downloadPromise || installing) return state;
    if (state.status === 'ready') return state;
    setState({ status: 'checking', error: null });
    try {
      manifest = await fetchManifest();
    } catch (err) {
      console.error('[updater] Manifest check failed:', err);
      setState({ status: 'error', error: err.message || String(err) });
      return state;
    }

    const latest = {
      appVersion: manifest.appVersion,
      hotVersion: manifest.hotUpdateVersion,
      description: manifest.description || ''
    };
    let kind = null;
    if (isNewer(manifest.appVersion, nativeVersion) && installerUrlFor(manifest)) {
      kind = 'installer';
    } else if (manifest.hotUpdateUrl && isNewer(manifest.hotUpdateVersion, currentHotVersion()) &&
               !isNewer(manifest.appVersion, nativeVersion)) {
      kind = 'ota';
    }
    console.log(`[updater] Installed ${nativeVersion}/${currentHotVersion()}, latest ${latest.appVersion}/${latest.hotVersion}: ${kind || 'up to date'}`);
    setState({ status: kind ? 'available' : 'up-to-date', kind, latest, progress: null });
    if (kind && autoDownload) download().catch(() => {});
    return state;
  }

  async function downloadFile(url, dest) {
    const res = await net.fetch(url, { cache: 'no-store', headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al descargar la actualización.`);
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    const partial = `${dest}.part`;
    const out = fs.createWriteStream(partial);
    const hash = crypto.createHash('sha256');
    const reader = res.body.getReader();
    let transferred = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        hash.update(chunk);
        transferred += chunk.length;
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
        const now = Date.now();
        if (now - lastProgressSent > 120) {
          lastProgressSent = now;
          setState({ progress: { percent: total ? Math.min(99, Math.floor(transferred * 100 / total)) : -1, transferred, total } });
        }
      }
      await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      try { fs.rmSync(partial, { force: true }); } catch (_) {}
      throw err;
    }
    if (total && transferred !== total) {
      fs.rmSync(partial, { force: true });
      throw new Error(`Descarga incompleta (${transferred} de ${total} bytes).`);
    }
    const sha256 = hash.digest('hex');
    const expected = expectedAsset(url);
    if (expected && ((expected.sha256 && expected.sha256 !== sha256) || (expected.size && expected.size !== transferred))) {
      fs.rmSync(partial, { force: true });
      throw new Error('El archivo descargado no coincide con el publicado (sha256). Inténtalo de nuevo.');
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(partial, dest);
    setState({ progress: { percent: 100, transferred, total: total || transferred } });
    return dest;
  }

  async function extractOta(zipFile) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(zipFile));
    fs.rmSync(otaStagingDir, { recursive: true, force: true });
    fs.mkdirSync(otaStagingDir, { recursive: true });
    const root = path.resolve(otaStagingDir) + path.sep;
    for (const [name, entry] of Object.entries(zip.files)) {
      const dest = path.resolve(otaStagingDir, name);
      if (!dest.startsWith(root)) throw new Error(`Ruta no válida en dist.zip: ${name}`);
      if (entry.dir) {
        fs.mkdirSync(dest, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await entry.async('nodebuffer'));
      }
    }
    if (!fs.existsSync(path.join(otaStagingDir, 'index.html'))) {
      throw new Error('dist.zip no contiene index.html.');
    }
    fs.writeFileSync(path.join(otaStagingDir, 'ota_manifest.json'), JSON.stringify({
      hotUpdateVersion: manifest.hotUpdateVersion,
      nativeVersion: manifest.appVersion || nativeVersion,
      installedAt: new Date().toISOString()
    }, null, 2));
    fs.rmSync(otaDir, { recursive: true, force: true });
    fs.renameSync(otaStagingDir, otaDir);
  }

  function download() {
    if (downloadPromise) return downloadPromise;
    if (state.status === 'ready') return Promise.resolve(state);
    if (!manifest || !state.kind) return Promise.reject(new Error('No hay ninguna actualización disponible.'));
    const kind = state.kind;
    downloadPromise = (async () => {
      setState({ status: 'downloading', error: null, progress: { percent: 0, transferred: 0, total: 0 } });
      fs.mkdirSync(updatesDir, { recursive: true });
      for (const old of fs.readdirSync(updatesDir)) {
        try { fs.rmSync(path.join(updatesDir, old), { recursive: true, force: true }); } catch (_) {}
      }
      if (kind === 'installer') {
        const url = installerUrlFor(manifest);
        const ext = path.extname(new URL(url).pathname) || '.exe';
        downloadedFile = await downloadFile(url, path.join(updatesDir, `Yoru-Reader-${manifest.appVersion}${ext}`));
      } else {
        const zipFile = await downloadFile(manifest.hotUpdateUrl, path.join(updatesDir, `dist-${manifest.hotUpdateVersion}.zip`));
        await extractOta(zipFile);
        fs.rmSync(zipFile, { force: true });
        downloadedFile = null;
      }
      console.log(`[updater] ${kind} update ${kind === 'ota' ? manifest.hotUpdateVersion : manifest.appVersion} ready`);
      setState({ status: 'ready' });
      return state;
    })().catch(err => {
      console.error('[updater] Download failed:', err);
      fs.rmSync(otaStagingDir, { recursive: true, force: true });
      setState({ status: 'error', error: err.message || String(err), progress: null });
      throw err;
    }).finally(() => {
      downloadPromise = null;
    });
    return downloadPromise;
  }

  function runInstaller(relaunch) {
    if (!downloadedFile || !fs.existsSync(downloadedFile)) throw new Error('No se encontró el instalador descargado.');
    if (process.platform !== 'win32') {
      // A .dmg or .flatpak has to be opened by the system; it cannot replace the app silently.
      shell.openPath(downloadedFile);
      return false;
    }
    // electron-builder's NSIS script: --updated skips the wizard pages and keeps the previous
    // install mode/location (it asks for UAC itself on per-machine installs), /S is silent and
    // --force-run starts the app again when it finishes.
    const args = ['--updated', '/S'];
    if (relaunch) args.push('--force-run');
    console.log('[updater] Running installer:', downloadedFile, args.join(' '));
    const child = spawn(downloadedFile, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  }

  function install() {
    if (state.status !== 'ready') throw new Error('La actualización todavía no está descargada.');
    if (state.kind === 'ota') {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.loadFile(resolveIndexFile());
      setState({ status: 'up-to-date', kind: null, progress: null });
      return state;
    }
    const quits = runInstaller(true);
    if (quits) {
      installing = true;
      setState({ status: 'installing' });
      setTimeout(() => app.quit(), 600);
    }
    return state;
  }

  app.on('will-quit', () => {
    if (installing || !autoInstallOnQuit || state.status !== 'ready' || state.kind !== 'installer') return;
    if (process.platform !== 'win32') return;
    try {
      installing = true;
      runInstaller(false);
    } catch (err) {
      console.error('[updater] Install on quit failed:', err);
    }
  });

  ipcMain.handle('updater:get-state', () => state);
  ipcMain.handle('updater:check', (_event, options) => check(options || {}));
  ipcMain.handle('updater:download', () => download());
  ipcMain.handle('updater:install', () => install());
  ipcMain.handle('updater:set-auto-install', (_event, value) => {
    autoInstallOnQuit = Boolean(value);
    return autoInstallOnQuit;
  });
  ipcMain.handle('updater:open-fallback', () => shell.openExternal(FALLBACK_URL));
  ipcMain.handle('clear-ota-cache', () => {
    try { fs.rmSync(otaDir, { recursive: true, force: true }); } catch (_) {}
    return true;
  });
  ipcMain.handle('reload-app', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.loadFile(resolveIndexFile());
    return true;
  });

  return { resolveIndexFile };
}

module.exports = { setupUpdater, isNewer };
