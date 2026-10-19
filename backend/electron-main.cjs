const { app, BrowserWindow, shell, ipcMain, session, protocol, net, webContents } = require('electron');
const path = require('path');
const http = require('http');
const url = require('url');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { synthesizeEdgeTts } = require('./edgeTts.cjs');
const { setupUpdater } = require('./updater.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'yoru-reader-ext', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Override console.log and console.error to write to a log file
let logPath;
try {
  logPath = app.isPackaged 
    ? path.join(app.getPath('userData'), 'electron_debug.log') 
    : path.join(__dirname, '../electron_debug.log');
  fs.writeFileSync(logPath, '--- Electron Debug Log Start ---\n');
} catch (e) {
  console.warn("Could not initialize log file path:", e);
}

const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) {
  originalLog.apply(console, args);
  if (logPath) {
    try {
      fs.appendFileSync(logPath, args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    } catch (e) {}
  }
};
console.error = function(...args) {
  originalError.apply(console, args);
  if (logPath) {
    try {
      fs.appendFileSync(logPath, '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    } catch (e) {}
  }
};

let oauthServer = null;
let mainWindow = null;

const updater = setupUpdater({ app, ipcMain, shell, net, BrowserWindow, getMainWindow: () => mainWindow });

function getExtensionPath() {
  const possiblePaths = [
    path.join(__dirname, '../backend/reader-ext'),
    path.join(__dirname, 'backend/reader-ext'),
    path.join(__dirname, 'reader-ext'),
    path.join(__dirname, '../reader-ext'),
    path.join(app.getAppPath(), 'backend/reader-ext'),
    path.join(app.getAppPath(), 'reader-ext'),
    path.join(process.resourcesPath, 'app/backend/reader-ext'),
    path.join(process.resourcesPath, 'backend/reader-ext')
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

function getAjbPath() {
  const extDir = getExtensionPath();
  return path.join(extDir, 'js/ajb.js');
}

function createWindow() {
  // Clear HTTP cache on startup to ensure we don't load old compiled reader assets
  if (session && session.defaultSession) {
    session.defaultSession.clearCache().catch(e => console.error("Failed to clear cache:", e));
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: true,
    title: "Yoru Reader"
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

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const sourceFile = (sourceId && typeof sourceId === 'string') ? path.basename(sourceId) : 'unknown';
    console.log(`[RENDERER CONSOLE] (${sourceFile}:${line}): ${message}`);
  });

  win.webContents.on('did-finish-load', () => {
    // When the extension is loaded natively, ajb.js already runs as its content
    // script (with chrome.storage). Manual injection is only a fallback.
    if (readerExtensionId) return;
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

  // Built-in frontend, or the newer OTA bundle from userData when it matches this build.
  win.loadFile(updater.resolveIndexFile());
}

const crypto = require('crypto');

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

ipcMain.handle('start-google-oauth', async (event, clientId) => {
  return new Promise((resolve, reject) => {
    if (oauthServer) {
      try { oauthServer.close(); } catch(e) {}
    }

    // --- PKCE: code_verifier + code_challenge ---
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(
      crypto.createHash('sha256').update(codeVerifier).digest()
    );

    oauthServer = http.createServer(async (req, res) => {
      const reqUrl = url.parse(req.url, true);
      if (reqUrl.pathname === '/') {
        const code = reqUrl.query.code;
        const error = reqUrl.query.error;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#121214;color:#fff;">
            <h1 style="color:#f87171;">Error de autorización</h1>
            <p>${error}</p><p>Puedes cerrar esta ventana.</p></body></html>`);
          oauthServer.close();
          oauthServer = null;
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#121214;color:#fff;">
            <h1 style="color:#818cf8;">¡Conexión exitosa!</h1>
            <p>Tu cuenta de Google fue conectada. Puedes cerrar esta ventana y volver a Yoru Reader.</p>
            </body></html>`);

          req.socket.destroy();
          const assignedPort = oauthServer.address().port;
          const redirectUri = `http://127.0.0.1:${assignedPort}`;
          oauthServer.close();
          oauthServer = null;

          resolve({ code, redirectUri, codeVerifier });
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('Error: No authorization code received.');
          reject(new Error('No authorization code received'));
        }
      }
    });

    oauthServer.listen(0, '127.0.0.1', () => {
      const assignedPort = oauthServer.address().port;
      const redirectUri = `http://127.0.0.1:${assignedPort}`;

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email')}` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256` +
        `&access_type=offline` +
        `&prompt=consent`;

      shell.openExternal(authUrl);
    });

    oauthServer.on('error', (err) => {
      reject(err);
    });
  });
});

const https = require('https');

ipcMain.handle('download-google-drive', async (event, { urlString, id }) => {
  console.log('[download-google-drive] Requested download URL:', urlString);
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    function downloadFileDirect(urlStringDirect) {
      console.log('[download-google-drive] Downloading direct file from:', urlStringDirect);
      https.get(urlStringDirect, options, (res) => {
        console.log('[download-google-drive] Direct response status:', res.statusCode);
        
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log('[download-google-drive] Redirecting direct download to:', res.headers.location);
          downloadFileDirect(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP status code ${res.statusCode}`));
          return;
        }

        const totalLength = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedLength = 0;
        const chunks = [];
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
          downloadedLength += chunk.length;
          if (totalLength > 0) {
            const percent = Math.round((downloadedLength / totalLength) * 100);
            event.sender.send('download-progress-event', { id, percent, downloadedBytes: downloadedLength });
          } else {
            event.sender.send('download-progress-event', { id, percent: -1, downloadedBytes: downloadedLength });
          }
        });
        
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          console.log('[download-google-drive] Bypassed download completed. Total bytes:', buffer.length);
          resolve(buffer);
        });
      }).on('error', (err) => {
        console.error('[download-google-drive] Direct request error:', err);
        reject(err);
      });
    }

    function download(url) {
      console.log('[download-google-drive] Fetching URL:', url);
      https.get(url, options, (res) => {
        console.log('[download-google-drive] Response status:', res.statusCode);
        
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log('[download-google-drive] Redirecting to:', res.headers.location);
          download(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP status code ${res.statusCode}`));
          return;
        }

        const totalLength = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedLength = 0;
        const chunks = [];
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
          downloadedLength += chunk.length;
          if (totalLength > 0) {
            const percent = Math.round((downloadedLength / totalLength) * 100);
            event.sender.send('download-progress-event', { id, percent, downloadedBytes: downloadedLength });
          } else {
            event.sender.send('download-progress-event', { id, percent: -1, downloadedBytes: downloadedLength });
          }
        });
        
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const firstBytesStr = buffer.toString('utf8', 0, Math.min(buffer.length, 500));
          
          if (firstBytesStr.includes('Google Drive - Virus scan warning') || firstBytesStr.includes('can\'t scan this file for viruses')) {
            console.log('[download-google-drive] Virus scan warning page detected. Bypassing...');
            
            const html = buffer.toString('utf8');
            
            // Extract form action URL
            const formActionMatch = html.match(/<form[^>]+action="([^"]+)"/);
            if (!formActionMatch) {
              reject(new Error('Failed to parse download form from warning page'));
              return;
            }
            const actionUrl = formActionMatch[1];
            
            // Extract hidden inputs
            const inputRegex = /<input[^>]+type="hidden"[^>]*>/g;
            const inputs = html.match(inputRegex);
            if (!inputs) {
              reject(new Error('Failed to parse form inputs from warning page'));
              return;
            }
            
            const params = [];
            inputs.forEach(input => {
              const nameMatch = input.match(/name="([^"]+)"/);
              const valueMatch = input.match(/value="([^"]+)"/);
              if (nameMatch && valueMatch) {
                params.push(`${encodeURIComponent(nameMatch[1])}=${encodeURIComponent(valueMatch[1])}`);
              }
            });
            
            if (params.length === 0) {
              reject(new Error('No parameters extracted from warning page form'));
              return;
            }
            
            const bypassUrl = `${actionUrl}?${params.join('&')}`;
            console.log('[download-google-drive] Bypassing with URL:', bypassUrl);
            
            // Download the actual file now
            downloadFileDirect(bypassUrl);
          } else {
            console.log('[download-google-drive] Downloaded file directly. Total bytes:', buffer.length);
            resolve(buffer);
          }
        });
      }).on('error', (err) => {
        console.error('[download-google-drive] Request error:', err);
        reject(err);
      });
    }
    
    download(urlString);
  });
});

ipcMain.handle('speak-text', async (event, { text, voice, rate }) => {
  console.log('[speak-text] Requesting Edge TTS. Voice:', voice, 'Rate:', rate);
  try {
    const audioBuffer = await synthesizeEdgeTts(text, voice, rate);
    return audioBuffer;
  } catch (error) {
    console.error('[speak-text] Edge TTS error:', error);
    throw error;
  }
});

ipcMain.handle('anki-request', async (_event, { host, body }) => new Promise((resolve, reject) => {
  let endpoint;
  try {
    endpoint = new URL(host || 'http://127.0.0.1:8765');
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      throw new Error('AnkiConnect only supports HTTP or HTTPS.');
    }
  } catch (error) {
    reject(new Error(`Invalid AnkiConnect address: ${error.message}`));
    return;
  }

  const isHttps = endpoint.protocol === 'https:';
  const client = isHttps ? https : http;
  const payload = typeof body === 'string' ? body : JSON.stringify(body || {});
  const request = client.request({
    hostname: endpoint.hostname,
    port: endpoint.port || (isHttps ? 443 : 80),
    path: `${endpoint.pathname}${endpoint.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (response) => {
    let responseData = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { responseData += chunk; });
    response.on('error', reject);
    response.on('end', () => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`AnkiConnect responded with HTTP ${response.statusCode}.`));
        return;
      }
      try {
        resolve(JSON.parse(responseData));
      } catch {
        reject(new Error('AnkiConnect returned an invalid response.'));
      }
    });
  });

  request.setTimeout(10000, () => request.destroy(new Error('AnkiConnect connection timed out.')));
  request.on('error', (error) => {
    console.error('[anki-request] Proxy error:', error.message);
    reject(new Error(`Could not reach ${endpoint.origin}: ${error.message}`));
  });
  request.end(payload);
}));

const READER_EXT_SHARED_API_KEY = "ak_CXDEL1S6z4jy998v1Qx_HdaU9laoTILD8mwJp5p3VjA";
let readerExtensionId = null;

ipcMain.handle('get-reader-extension-id', () => {
  return readerExtensionId;
});

ipcMain.handle('open-reader-extension-settings', (event, theme) => {
  try {
    console.log(`[main] open-reader-extension-settings invoked. Extension ID: ${readerExtensionId}, Theme: ${theme}`);
    if (!readerExtensionId) {
      console.error("[main] readerExtensionId is null!");
      return false;
    }
    const settingsUrl = `chrome-extension://${readerExtensionId}/views/settings.html?theme=${theme || 'dark'}`;
    console.log(`[main] Loading settings URL: ${settingsUrl}`);
    
    const settingsWin = new BrowserWindow({
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      autoHideMenuBar: true,
      title: "Ajustes de la Extensión Yoru Reader"
    });
    
    settingsWin.loadURL(settingsUrl);
    return true;
  } catch (err) {
    console.error("[main] Error opening extension settings window:", err);
    return false;
  }
});

ipcMain.handle('read-local-file', async (event, filePath) => {
  try {
    console.log(`[main] read-local-file invoked for path: ${filePath}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const data = fs.readFileSync(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch (err) {
    console.error("[main] Error reading local file:", err);
    throw err;
  }
});


let extWordMap = {};
const pendingParses = new Map();
let parseRequestCounter = 0;

ipcMain.on('reply-parse-text', (event, { requestId, result, error }) => {
  const pending = pendingParses.get(requestId);
  if (pending) {
    if (error) {
      console.error(`[main] parse-text error for request ${requestId}:`, error);
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
    pendingParses.delete(requestId);
  }
});

function queryLocalWordStatuses(words) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve({});
      return;
    }
    const replyChannel = 'reply-query-word-statuses';
    const listener = (event, statuses) => {
      ipcMain.off(replyChannel, listener);
      resolve(statuses);
    };
    ipcMain.on(replyChannel, listener);
    mainWindow.webContents.send('query-word-statuses', words);
  });
}

function saveWordToLocalSrs(wordData) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve();
      return;
    }
    const replyChannel = 'reply-save-word-to-srs';
    const listener = () => {
      ipcMain.off(replyChannel, listener);
      resolve();
    };
    ipcMain.on(replyChannel, listener);
    mainWindow.webContents.send('save-word-to-srs', wordData);
  });
}

function updateWordStatusInApp(data) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve();
      return;
    }
    const replyChannel = 'reply-update-word-status';
    const listener = () => {
      ipcMain.off(replyChannel, listener);
      resolve();
    };
    ipcMain.on(replyChannel, listener);
    mainWindow.webContents.send('update-word-status', data);
  });
}

// Start local HTTP server for extension requests
let localExtServer = null;

function startLocalExtServer() {
  localExtServer = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    let pathName = reqUrl.pathname;
    // Normalize path by stripping /api/ prefix if present
    if (pathName.startsWith('/api/')) {
      pathName = pathName.slice(5);
    } else if (pathName.startsWith('/')) {
      pathName = pathName.slice(1);
    }

    console.log(`[local-ext-server] Request path: ${pathName}`);

    // Read POST body
    let bodyText = '';
    await new Promise((resolve) => {
      req.on('data', chunk => { bodyText += chunk; });
      req.on('end', resolve);
    });

    let payload = {};
    try {
      if (bodyText) payload = JSON.parse(bodyText);
    } catch (e) {}

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
        const data = await resultPromise;
        
        if (data && Array.isArray(data.vocabulary)) {
          data.vocabulary.forEach(v => {
            extWordMap[v.wordId] = v.spelling;
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify(data));
        return;
      }

      if (pathName === 'reader/lookup-vocabulary' || pathName === 'lookup-vocabulary' || pathName === 'api/lookup-vocabulary') {
        const results = [];
        const deckIds = [];
        const wordsList = [];

        if (payload.words && Array.isArray(payload.words)) {
          payload.words.forEach(([wordId, readingIndex]) => {
            const spelling = extWordMap[wordId] || '';
            wordsList.push(spelling);
          });

          const localStatuses = await queryLocalWordStatuses(wordsList);

          payload.words.forEach(([wordId, readingIndex]) => {
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
    } catch (err) {
      console.error(`[local-ext-server] Error handling ${pathName}:`, err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  localExtServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn('[local-ext-server] Port 23280 is already in use by another instance, skipping listener.');
    } else {
      console.error('[local-ext-server] Server error:', err);
    }
  });

  localExtServer.listen(23280, '127.0.0.1', () => {
    console.log('[local-ext-server] Listening on http://127.0.0.1:23280');
  });
}

app.whenReady().then(async () => {
  startLocalExtServer();
  // Register custom protocol handler for yoru-reader-ext
  protocol.handle('yoru-reader-ext', async (request) => {
    const url = new URL(request.url);
    const pathName = url.pathname.slice(1);
    console.log(`[yoru-reader-ext] Intercepted path: ${pathName}`);

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
        
        if (!mainWindow) {
          throw new Error("Main window not available");
        }
        
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
        
        const data = await resultPromise;
        
        if (data && Array.isArray(data.vocabulary)) {
          data.vocabulary.forEach(v => {
            extWordMap[v.wordId] = v.spelling;
          });
        }

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('[yoru-reader-ext] Error during native reader/parse:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (pathName === 'reader/lookup-vocabulary' || pathName === 'lookup-vocabulary') {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText);
        
        const results = [];
        const deckIds = [];
        const wordsList = [];

        payload.words.forEach(([wordId, readingIndex]) => {
          const spelling = extWordMap[wordId] || '';
          wordsList.push(spelling);
        });

        const localStatuses = await queryLocalWordStatuses(wordsList);

        payload.words.forEach(([wordId, readingIndex]) => {
          const spelling = extWordMap[wordId];
          const status = localStatuses[spelling];
          
          let state = [0]; // New
          if (status === 'known') state = [2]; // Mature
          else if (status === 'learning') state = [1]; // Young
          
          results.push(state);
          deckIds.push([1]); // Mock deck ID
        });

        return new Response(JSON.stringify({ result: results, decks: deckIds }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
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
      } catch (err) {
        console.error('[yoru-reader-ext] Error during set-vocabulary-state:', err);
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
      } catch (err) {
        console.error('[yoru-reader-ext] Error during study-decks words add:', err);
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
      console.log('[main] Cleared service worker cache.');
    } catch (e) {
      console.warn('[main] Failed to clear service worker cache:', e);
    }
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
        console.log('[main] Auto-configured extension with shared key.');
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
        console.log('[main] Pre-configured extension via temp window.');
      }
    } catch (e) {
      console.warn('[main] Failed to auto-configure extension:', e);
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

// Discord Rich Presence (IPC Named Pipe Engine)
let discordRpcSocket = null;
let discordRpcClientId = '1543447663561678989'; // Official Registered Yoru Reader App ID
let discordRpcActivePresence = null;
let isDiscordConnecting = false;
let isDiscordReady = false;

function sendDiscordRpcFrame(socket, opcode, payload) {
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

function connectDiscordRpc() {
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

      console.log(`[Discord RPC] Trying pipe: ${pipePath}`);
      const socket = net.createConnection(pipePath, () => {
        discordRpcSocket = socket;

        // Opcode 0: Handshake
        const handshake = JSON.stringify({ v: 1, client_id: discordRpcClientId });
        sendDiscordRpcFrame(socket, 0, handshake);

        socket.on('data', (data) => {
          try {
            const op = data.readInt32LE(0);
            const len = data.readInt32LE(4);
            const payload = JSON.parse(data.slice(8, 8 + len).toString());
            console.log('[Discord RPC] Event received:', payload.evt || payload.cmd);

            if (payload.evt === 'READY') {
              isDiscordConnecting = false;
              isDiscordReady = true;
              console.log('[Discord RPC] Handshake READY. Setting active presence...');
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

      socket.on('error', (err) => {
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

ipcMain.handle('update-discord-presence', async (event, presence) => {
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

