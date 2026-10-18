import { app, BrowserWindow, ipcMain, shell, protocol, session, webContents } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import url from 'url';
import net from 'net';
import { createHash, randomBytes } from 'crypto';
import { synthesizeEdgeTts } from './edgeTts.js';

let mainWindow: BrowserWindow | null = null;
let readerExtensionId: string | null = null;
let cancelGoogleOAuth: (() => void) | null = null;

// Ext word map to map numeric word IDs back to dictionary spelling
const extWordMap: Record<string, string> = {};

// Hot-update Version Configuration
const CURRENT_APP_VERSION = '1.2.8';
const CURRENT_BACKEND_VERSION = '1.2.8';
const CURRENT_HOT_UPDATE_VERSION = '1.2.8.0';
const STABLE_JSON_URL = 'https://raw.githubusercontent.com/Zams0524/Yoru-Reader/main/stable.json';

// Shared API Key for native communication with Yoru Reader extension
const READER_EXT_SHARED_API_KEY = 'yoru-reader-internal-key-v1';

// Custom schema configuration for Chrome extension compatibility
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yoru-reader-ext',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function getExtensionPath(): string {
  const possiblePaths = [
    path.join(__dirname, '../backend/reader-ext'),
    path.join(__dirname, 'backend/reader-ext'),
    path.join(__dirname, 'reader-ext'),
    path.join(__dirname, '../reader-ext'),
    path.join(app.getAppPath(), 'backend/reader-ext'),
    path.join(app.getAppPath(), 'reader-ext'),
    path.join(process.resourcesPath, 'app/backend/reader-ext'),
    path.join(process.resourcesPath, 'backend/reader-ext'),
  ];
  for (const p of possiblePaths) {
    let cleanP = p;
    if (cleanP.includes('app.asar')) {
      cleanP = cleanP.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(cleanP)) return cleanP;
  }
  return path.join(__dirname, '../backend/reader-ext');
}

function getAjbPath(): string {
  const extDir = getExtensionPath();
  return path.join(extDir, 'js/ajb.js');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: true,
    title: 'Yoru Reader'
  });
  mainWindow = win;



  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (url.startsWith('chrome-extension://')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    const sourceFile = (sourceId && typeof sourceId === 'string') ? path.basename(sourceId) : 'unknown';
    console.log(`[RENDERER CONSOLE] (${sourceFile}:${line}): ${message}`);
  });

  win.webContents.on('did-finish-load', () => {
    try {
      const ajbPath = getAjbPath();
      if (fs.existsSync(ajbPath)) {
        const scriptCode = fs.readFileSync(ajbPath, 'utf8');
        win.webContents.executeJavaScript(scriptCode).catch(() => {});
        console.log('[main] Injected Yoru Reader Extension content script into window from:', ajbPath);
      } else {
        console.warn('[main] ajb.js not found at:', ajbPath);
      }
    } catch (e) {
      console.warn('[main] Content script injection warning:', e);
    }
  });

  // 1. Check if an OTA update bundle is installed in userData (Stable only)
  const otaDistDir = path.join(app.getPath('userData'), 'ota_dist');
  const otaIndex = path.join(otaDistDir, 'index.html');
  const appName = app.getName();
  const execPath = process.execPath;
  const isDevBuild = appName.toLowerCase().includes('dev') || execPath.toLowerCase().includes('dev');

  if (!isDevBuild && fs.existsSync(otaIndex)) {
    console.log('[OTA] Loading updated frontend bundle from:', otaIndex);
    win.loadFile(otaIndex);
  } else {
    const defaultIndex = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(defaultIndex)) {
      console.log('[main] Loading built-in frontend bundle from:', defaultIndex);
      win.loadFile(defaultIndex);
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
    }
  }
}

// -------------------------------------------------------------
// IPC Handlers
// -------------------------------------------------------------

ipcMain.handle('speak-text', async (_event, { text, voice, rate }) => {
  try {
    const audioBuffer = await synthesizeEdgeTts(text, voice || 'ja-JP-NanamiNeural', rate || 1.0);
    return audioBuffer;
  } catch (err: any) {
    console.error('Edge TTS IPC Error:', err);
    throw err;
  }
});

ipcMain.handle('read-local-file', async (_event, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (err: any) {
    console.error('[main] read-local-file failed:', err);
    throw err;
  }
});

ipcMain.handle('anki-request', async (_event, { host, body }) => {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(host || 'http://127.0.0.1:8765');
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        throw new Error('AnkiConnect only supports HTTP or HTTPS.');
      }
      const dataString = typeof body === 'string' ? body : JSON.stringify(body);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataString)
        }
      }, (res) => {
        let responseData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`AnkiConnect responded with HTTP ${res.statusCode}.`));
            return;
          }
          try {
            resolve(JSON.parse(responseData));
          } catch {
            reject(new Error('AnkiConnect returned an invalid response.'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('AnkiConnect connection timed out.')));

      req.write(dataString);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
});

ipcMain.handle('get-reader-extension-id', () => {
  return readerExtensionId || 'local-fallback';
});

ipcMain.handle('open-reader-extension-settings', async (_event, theme = 'dark') => {
  if (!readerExtensionId) {
    console.warn('[main] Reader extension is not loaded.');
    return false;
  }
  try {
    const extSettingsUrl = `chrome-extension://${readerExtensionId}/views/settings.html?theme=${encodeURIComponent(theme)}`;
    const settingsWin = new BrowserWindow({
      width: 950,
      height: 720,
      title: 'Yoru Reader - Configuración del Parser',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    settingsWin.loadURL(extSettingsUrl);
    return true;
  } catch (err) {
    console.error('[main] Failed to open extension settings:', err);
    return false;
  }
});

// ── Production-Grade Live OTA Hot Updater & Extractor ─────────────────────
ipcMain.handle('check-hot-update', async () => {
  const appName = app.getName();
  const execPath = process.execPath;
  const isDevBuild = appName.toLowerCase().includes('dev') || execPath.toLowerCase().includes('dev') || !app.isPackaged;
  
  if (isDevBuild) {
    console.log('[OTA] Running in Dev version, skipping hot update checks.');
    return { hasUpdate: false, isDev: true };
  }

  // Check currently installed OTA version from disk if available
  let activeVersion = CURRENT_HOT_UPDATE_VERSION;
  try {
    const versionFile = path.join(app.getPath('userData'), 'ota_version.json');
    if (fs.existsSync(versionFile)) {
      const saved = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      if (saved.version) activeVersion = saved.version;
    }
  } catch (e) {
    console.warn('[OTA] Error reading ota_version.json:', e);
  }

  return new Promise((resolve) => {
    https.get(STABLE_JSON_URL, { headers: { 'User-Agent': 'Yoru-Reader-App' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const config = JSON.parse(data);
          const remoteHotVersion = config.hotUpdateVersion;
          if (remoteHotVersion && remoteHotVersion !== activeVersion) {
            resolve({
              hasUpdate: true,
              currentVersion: activeVersion,
              version: remoteHotVersion,
              url: config.hotUpdateUrl,
              description: config.description || 'Mejoras de rendimiento y correcciones del sistema.'
            });
          } else {
            resolve({ hasUpdate: false, currentVersion: activeVersion });
          }
        } catch {
          resolve({ hasUpdate: false, currentVersion: activeVersion });
        }
      });
    }).on('error', () => resolve({ hasUpdate: false, currentVersion: activeVersion }));
  });
});

ipcMain.handle('download-hot-update', async (_event, { url, version }) => {
  try {
    const JSZip = (await import('jszip')).default;
    const otaDistDir = path.join(app.getPath('userData'), 'ota_dist');
    const versionFile = path.join(app.getPath('userData'), 'ota_version.json');
    
    console.log('[OTA] Starting download of update from:', url);

    const downloadZip = (targetUrl: string): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        https.get(targetUrl, { headers: { 'User-Agent': 'Yoru-Reader-App' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return downloadZip(res.headers.location).then(resolve).catch(reject);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed with HTTP status: ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          const chunks: Buffer[] = [];

          res.on('data', (chunk) => {
            chunks.push(chunk);
            receivedBytes += chunk.length;
            if (totalBytes > 0 && mainWindow) {
              const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
              mainWindow.webContents.send('ota-download-progress', { percent, receivedBytes, totalBytes });
            }
          });

          res.on('end', () => {
            resolve(Buffer.concat(chunks));
          });
          res.on('error', reject);
        }).on('error', reject);
      });
    };

    const zipBuffer = await downloadZip(url);
    console.log('[OTA] Download complete (' + zipBuffer.length + ' bytes). Extracting bundle...');

    const zip = await JSZip.loadAsync(zipBuffer);
    
    // Ensure clean destination directory
    if (fs.existsSync(otaDistDir)) {
      fs.rmSync(otaDistDir, { recursive: true, force: true });
    }
    fs.mkdirSync(otaDistDir, { recursive: true });

    // Extract all files
    const entries = Object.keys(zip.files);
    for (const filename of entries) {
      const entry = zip.files[filename];
      const destPath = path.join(otaDistDir, filename);
      if (entry.dir) {
        fs.mkdirSync(destPath, { recursive: true });
      } else {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const content = await entry.async('nodebuffer');
        fs.writeFileSync(destPath, content);
      }
    }

    // Save installed version marker
    fs.writeFileSync(versionFile, JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2));
    console.log('[OTA] Update successfully extracted and verified to:', otaDistDir);

    return { success: true, version };
  } catch (err: any) {
    console.error('[OTA] Failed to download and extract update:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('apply-hot-update-and-relaunch', () => {
  console.log('[OTA] Relaunching application to apply update...');
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('clear-ota-cache', async () => {
  try {
    const otaDistDir = path.join(app.getPath('userData'), 'ota_dist');
    if (fs.existsSync(otaDistDir)) {
      fs.rmSync(otaDistDir, { recursive: true, force: true });
      console.log('[OTA] Cache cleared safely:', otaDistDir);
    }
    return true;
  } catch (err) {
    console.error('[OTA] Error clearing cache:', err);
    return false;
  }
});

ipcMain.handle('reload-app', () => {
  if (mainWindow) {
    mainWindow.reload();
  }
});

// Google OAuth for Electron uses the system browser, a loopback callback and PKCE.
// Google blocks embedded webviews for OAuth, and implicit token responses cannot
// be exchanged by the renderer for the refresh token required by Drive sync.
ipcMain.handle('start-google-oauth', async (_event, clientId: string) => {
  if (!clientId?.trim()) throw new Error('Google OAuth client ID is missing.');

  return new Promise((resolve, reject) => {
    const state = randomBytes(24).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const redirectUri = 'http://127.0.0.1:42813/callback';
    const server = http.createServer();
    let settled = false;

    const finish = (error?: Error, result?: { code: string; redirectUri: string; codeVerifier: string }) => {
      if (settled) return;
      settled = true;
      if (cancelGoogleOAuth === cancel) cancelGoogleOAuth = null;
      clearTimeout(timeout);
      if (server.listening) server.close();
      if (error) reject(error);
      else resolve(result);
    };

    const timeout = setTimeout(() => finish(new Error('Google sign-in timed out. Please try again.')), 5 * 60 * 1000);
    const cancel = () => finish(new Error('Google sign-in was cancelled.'));
    cancelGoogleOAuth = cancel;

    server.on('request', (req, res) => {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(req.url || '/', 'http://127.0.0.1');
      } catch {
        res.writeHead(400).end('Invalid callback.');
        return;
      }

      if (callbackUrl.pathname !== '/callback') {
        res.writeHead(404).end('Not found.');
        return;
      }

      const returnedState = callbackUrl.searchParams.get('state');
      const code = callbackUrl.searchParams.get('code');
      const oauthError = callbackUrl.searchParams.get('error');
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Sign-in state did not match. Return to Yoru Reader and try again.');
        finish(new Error('Google sign-in could not be verified. Please try again.'));
        return;
      }

      if (oauthError || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<html><body style="font-family:system-ui"><h2>Google sign-in cancelled</h2><p>You can close this tab and return to Yoru Reader.</p></body></html>');
        finish(new Error(oauthError ? `Google sign-in failed: ${oauthError}` : 'Google did not return an authorization code.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<html><body style="font-family:system-ui;text-align:center;padding:4rem"><h2>✓ Google Drive connected</h2><p>You can return to Yoru Reader.</p></body></html>');
      finish(undefined, { code, redirectUri, codeVerifier });
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'EADDRINUSE'
        ? 'The Google Drive sign-in port is already in use. Close the other sign-in window and try again.'
        : `Could not start Google sign-in: ${error.message}`;
      finish(new Error(message));
    });

    server.listen(42813, '127.0.0.1', async () => {
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.search = new URLSearchParams({
        client_id: clientId.trim(),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
      }).toString();

      try {
        await shell.openExternal(authUrl.toString());
      } catch (error: any) {
        finish(new Error(`Could not open your browser for Google sign-in: ${error?.message || error}`));
      }
    });
  });
});

ipcMain.handle('cancel-google-oauth', () => {
  cancelGoogleOAuth?.();
});

// -------------------------------------------------------------
// Extension Local Server & Yoru Parser Protocol
// -------------------------------------------------------------

let localExtServer: http.Server | null = null;
let parseRequestCounter = 0;
const pendingParses = new Map<number | string, { resolve: (data: any) => void; reject: (err: any) => void }>();

async function queryLocalWordStatuses(words: string[]): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return resolve({});
    }
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('reply-query-word-statuses');
      resolve({});
    }, 5000);

    ipcMain.once('reply-query-word-statuses', (_event, statuses) => {
      clearTimeout(timeout);
      resolve(statuses || {});
    });

    mainWindow.webContents.send('query-word-statuses', words);
  });
}

async function updateWordStatusInApp(data: any): Promise<void> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve();
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('reply-update-word-status');
      resolve();
    }, 5000);

    ipcMain.once('reply-update-word-status', () => {
      clearTimeout(timeout);
      resolve();
    });

    mainWindow.webContents.send('update-word-status', data);
  });
}

async function saveWordToLocalSrs(wordData: any): Promise<void> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve();
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('reply-save-word-to-srs');
      resolve();
    }, 5000);

    ipcMain.once('reply-save-word-to-srs', () => {
      clearTimeout(timeout);
      resolve();
    });

    mainWindow.webContents.send('save-word-to-srs', wordData);
  });
}

ipcMain.on('reply-parse-text', (_event, { requestId, result, error }) => {
  if (pendingParses.has(requestId)) {
    const { resolve, reject } = pendingParses.get(requestId)!;
    pendingParses.delete(requestId);
    if (error) reject(new Error(error));
    else resolve(result);
  }
});

function startLocalExtServer(): void {
  localExtServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`);
    let pathName = reqUrl.pathname;
    if (pathName.startsWith('/api/')) {
      pathName = pathName.slice(5);
    } else if (pathName.startsWith('/')) {
      pathName = pathName.slice(1);
    }

    let bodyText = '';
    await new Promise((resolve) => {
      req.on('data', chunk => { bodyText += chunk; });
      req.on('end', resolve);
    });

    let payload: any = {};
    try {
      if (bodyText) payload = JSON.parse(bodyText);
    } catch {}

    res.setHeader('Content-Type', 'application/json');

    try {
      if (pathName === 'reader/ping' || pathName === 'ping' || pathName === 'api/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }
      
      if (pathName === 'reader/parse' || pathName === 'parse' || pathName === 'api/parse') {
        if (!mainWindow) throw new Error("Main window not available");
        
        const requestId = ++parseRequestCounter;
        const resultPromise = new Promise((resolve, reject) => {
          pendingParses.set(requestId, { resolve, reject });
          setTimeout(() => {
            if (pendingParses.has(requestId)) {
              pendingParses.delete(requestId);
              reject(new Error("Parse request timed out"));
            }
          }, 20000);
        });
        
        mainWindow.webContents.send('parse-text-request', { requestId, paragraphs: payload.text });
        const data: any = await resultPromise;
        
        if (data && Array.isArray(data.vocabulary)) {
          data.vocabulary.forEach((v: any) => {
            extWordMap[v.wordId] = v.spelling;
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify(data));
        return;
      }

      if (pathName === 'reader/lookup-vocabulary' || pathName === 'lookup-vocabulary' || pathName === 'api/lookup-vocabulary') {
        const results: any[] = [];
        const deckIds: any[] = [];
        const wordsList: string[] = [];

        if (payload.words && Array.isArray(payload.words)) {
          payload.words.forEach(([wordId]: [string, number]) => {
            const spelling = extWordMap[wordId] || '';
            wordsList.push(spelling);
          });

          const localStatuses = await queryLocalWordStatuses(wordsList);

          payload.words.forEach(([wordId]: [string, number]) => {
            const spelling = extWordMap[wordId];
            const status = localStatuses[spelling];
            
            let state = [0]; // New
            if (status === 'known') state = [2]; // Mature
            else if (status === 'learning') state = [1]; // Young
            
            results.push(state);
            deckIds.push([1]);
          });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ result: results, decks: deckIds }));
        return;
      }

      if (pathName === 'srs/reader-study-decks' || pathName === 'reader-study-decks') {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          result: [{ id: 1, name: "Yoru Local SRS", wordCount: 0 }]
        }));
        return;
      }

      if (pathName === 'srs/set-vocabulary-state' || pathName === 'set-vocabulary-state') {
        const wordIdStr = String(payload.wordId || '');
        let spelling = payload.spelling || payload.word;
        if (!spelling && wordIdStr.includes(':')) {
          spelling = wordIdStr.split(':')[0];
        }
        if (!spelling && payload.wordId) {
          spelling = extWordMap[payload.wordId];
        }

        if (spelling) {
          await updateWordStatusInApp({
            word: spelling,
            state: payload.state
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathName.startsWith('srs/study-decks/') || pathName.startsWith('study-decks/')) {
        const wordIdStr = String(payload.wordId || '');
        let spelling = payload.spelling || payload.word;
        if (!spelling && wordIdStr.includes(':')) {
          spelling = wordIdStr.split(':')[0];
        }
        if (!spelling && payload.wordId) {
          spelling = extWordMap[payload.wordId];
        }

        let reading = payload.reading || '';
        if (!reading && wordIdStr.includes(':')) {
          reading = wordIdStr.split(':')[1];
        }

        if (spelling) {
          await saveWordToLocalSrs({
            word: spelling,
            reading: reading,
            sentence: payload.sentence || '',
            source: payload.source || ''
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err: any) {
      console.error(`[local-ext-server] Error handling ${pathName}:`, err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  localExtServer.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn('[local-ext-server] Port 23280 is already in use by another instance.');
    } else {
      console.error('[local-ext-server] Server error:', err);
    }
  });

  localExtServer.listen(23280, '127.0.0.1', () => {
    console.log('[local-ext-server] Listening on http://127.0.0.1:23280');
  });
}

// -------------------------------------------------------------
// App Lifecycle
// -------------------------------------------------------------

app.whenReady().then(async () => {
  startLocalExtServer();

  protocol.handle('yoru-reader-ext', async (request) => {
    const reqUrl = new URL(request.url);
    const pathName = reqUrl.pathname.slice(1);

    if (pathName === 'reader/ping' || pathName === 'ping') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (pathName === 'reader/parse' || pathName === 'parse') {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText);
        if (!mainWindow) throw new Error("Main window not available");
        
        const requestId = ++parseRequestCounter;
        const resultPromise = new Promise((resolve, reject) => {
          pendingParses.set(requestId, { resolve, reject });
          setTimeout(() => {
            if (pendingParses.has(requestId)) {
              pendingParses.delete(requestId);
              reject(new Error("Parse request timed out"));
            }
          }, 20000);
        });
        
        mainWindow.webContents.send('parse-text-request', { requestId, paragraphs: payload.text });
        const data: any = await resultPromise;
        
        if (data && Array.isArray(data.vocabulary)) {
          data.vocabulary.forEach((v: any) => {
            extWordMap[v.wordId] = v.spelling;
          });
        }

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        console.error('[yoru-reader-ext] Error during reader/parse:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (pathName === 'reader/lookup-vocabulary' || pathName === 'lookup-vocabulary') {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText);
        const results: any[] = [];
        const deckIds: any[] = [];
        const wordsList: string[] = [];

        payload.words.forEach(([wordId]: [string, number]) => {
          const spelling = extWordMap[wordId] || '';
          wordsList.push(spelling);
        });

        const localStatuses = await queryLocalWordStatuses(wordsList);

        payload.words.forEach(([wordId]: [string, number]) => {
          const spelling = extWordMap[wordId];
          const status = localStatuses[spelling];
          
          let state = [0];
          if (status === 'known') state = [2];
          else if (status === 'learning') state = [1];
          
          results.push(state);
          deckIds.push([1]);
        });

        return new Response(JSON.stringify({ result: results, decks: deckIds }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        console.error('[yoru-reader-ext] Error during lookup-vocabulary:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (pathName === 'srs/reader-study-decks' || pathName === 'reader-study-decks') {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 1, name: "Yoru Local SRS", wordCount: 0 }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathName === 'srs/set-vocabulary-state' || pathName === 'set-vocabulary-state') {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText);
        const wordIdStr = String(payload.wordId || '');
        let spelling = payload.spelling || payload.word;
        if (!spelling && wordIdStr.includes(':')) {
          spelling = wordIdStr.split(':')[0];
        }
        if (!spelling && payload.wordId) {
          spelling = extWordMap[payload.wordId];
        }

        if (spelling) {
          await updateWordStatusInApp({
            word: spelling,
            state: payload.state
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (pathName.startsWith('srs/study-decks/') || pathName.startsWith('study-decks/')) {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText);
        const wordIdStr = String(payload.wordId || '');
        let spelling = payload.spelling || payload.word;
        if (!spelling && wordIdStr.includes(':')) {
          spelling = wordIdStr.split(':')[0];
        }
        if (!spelling && payload.wordId) {
          spelling = extWordMap[payload.wordId];
        }

        let reading = payload.reading || '';
        if (!reading && wordIdStr.includes(':')) {
          reading = wordIdStr.split(':')[1];
        }

        if (spelling) {
          await saveWordToLocalSrs({
            word: spelling,
            reading: reading,
            sentence: payload.sentence || '',
            source: payload.source || ''
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  try {
    try {
      await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] });
    } catch {}
    
    const extensionPath = getExtensionPath();
    const ext = await session.defaultSession.loadExtension(extensionPath, { allowFileAccess: true });
    readerExtensionId = ext.id;
    console.log(`[main] Loaded Yoru Reader Extension natively from ${extensionPath}: ${ext.name} (${ext.id})`);

    // Auto-inject shared API key into extension storage
    try {
      const allWebContents = webContents.getAllWebContents();
      const extWebContents = allWebContents.find(wc => 
        wc.getURL().startsWith(`chrome-extension://${readerExtensionId}`)
      );
      if (extWebContents) {
        await extWebContents.executeJavaScript(`chrome.storage.local.set({ yoruApiKey: "${READER_EXT_SHARED_API_KEY}", yoruApiEndpoint: "http://127.0.0.1:23280/api" })`);
      } else {
        const tempWin = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });
        await tempWin.loadURL(`chrome-extension://${readerExtensionId}/views/settings.html`);
        await tempWin.webContents.executeJavaScript(`chrome.storage.local.set({ yoruApiKey: "${READER_EXT_SHARED_API_KEY}", yoruApiEndpoint: "http://127.0.0.1:23280/api" })`);
        tempWin.close();
      }
    } catch (e) {
      console.warn('[main] Extension storage configuration warning:', e);
    }
  } catch (err) {
    console.error('[main] Failed to load Yoru Reader Extension natively:', err);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// -------------------------------------------------------------
// Discord Rich Presence (IPC Named Pipe Engine)
// -------------------------------------------------------------

let discordRpcSocket: net.Socket | null = null;
let discordRpcClientId = '1543447663561678989'; // Registered Yoru Reader Discord App ID
let discordRpcActivePresence: any = null;
let isDiscordConnecting = false;
let isDiscordReady = false;

function sendDiscordRpcFrame(socket: net.Socket, opcode: number, payload: any): void {
  try {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadStr, 'utf8');
    const totalLength = 8 + payloadBuffer.length;
    const packet = Buffer.alloc(totalLength);
    packet.writeInt32LE(opcode, 0);
    packet.writeInt32LE(payloadBuffer.length, 4);
    payloadBuffer.copy(packet, 8);

    socket.write(packet);
  } catch (err) {
    console.error('[Discord RPC] Send frame error:', err);
  }
}

function connectDiscordRpc(): Promise<net.Socket> {
  if (discordRpcSocket && isDiscordReady) return Promise.resolve(discordRpcSocket);
  if (isDiscordConnecting) {
    return new Promise((resolve, reject) => {
      let checks = 0;
      const interval = setInterval(() => {
        checks++;
        if (discordRpcSocket && isDiscordReady) {
          clearInterval(interval);
          resolve(discordRpcSocket);
        } else if (checks > 20) {
          clearInterval(interval);
          reject(new Error('Discord connection timeout'));
        }
      }, 100);
    });
  }

  isDiscordConnecting = true;
  isDiscordReady = false;

  return new Promise((resolve, reject) => {
    let pipeIndex = 0;

    const tryNextPipe = () => {
      if (pipeIndex >= 10) {
        isDiscordConnecting = false;
        return reject(new Error('No active Discord IPC pipe found'));
      }

      let pipePath = process.platform === 'win32'
        ? `\\\\.\\pipe\\discord-ipc-${pipeIndex}`
        : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp', `discord-ipc-${pipeIndex}`);

      const socket = net.createConnection(pipePath, () => {
        discordRpcSocket = socket;

        // Opcode 0: Handshake
        const handshake = JSON.stringify({ v: 1, client_id: discordRpcClientId });
        sendDiscordRpcFrame(socket, 0, JSON.parse(handshake));

        socket.on('data', (data) => {
          try {
            const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const op = frame.readInt32LE(0);
            const len = frame.readInt32LE(4);
            const payload = JSON.parse(frame.slice(8, 8 + len).toString());
            if (payload.evt === 'READY') {
              isDiscordConnecting = false;
              isDiscordReady = true;
              if (discordRpcActivePresence) {
                sendDiscordRpcFrame(socket, 1, {
                  cmd: 'SET_ACTIVITY',
                  args: { pid: process.pid, activity: discordRpcActivePresence },
                  nonce: String(Date.now())
                });
              }
              resolve(socket);
            }
          } catch (e) {
            // ignore non-json frames
          }
        });
      });

      socket.on('error', () => {
        socket.destroy();
        pipeIndex++;
        tryNextPipe();
      });

      socket.on('close', () => {
        isDiscordConnecting = false;
        isDiscordReady = false;
        discordRpcSocket = null;
      });
    };

    tryNextPipe();
  });
}

ipcMain.handle('update-discord-presence', async (_event, presence) => {
  if (!presence) {
    if (discordRpcSocket && isDiscordReady) {
      sendDiscordRpcFrame(discordRpcSocket, 1, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce: String(Date.now())
      });
    }
    discordRpcActivePresence = null;
    return true;
  }

  discordRpcActivePresence = presence;
  try {
    const socket = await connectDiscordRpc();
    sendDiscordRpcFrame(socket, 1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: presence },
      nonce: String(Date.now())
    });
    return true;
  } catch (e) {
    console.warn('[Discord RPC] Could not update presence:', e);
    return false;
  }
});
