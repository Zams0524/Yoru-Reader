// Runs the actual import, IndexedDB and native-export modules in an isolated Chromium profile.
// Usage: node build/verify-import-readings.cjs [path-to-book.epub]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow } = require('electron');
    const directory = process.argv[2];
    app.setPath('userData', path.join(directory, 'profile'));
    await app.whenReady();
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', details => {
      if (details.level === 'error') console.error(details.message);
    });
    await window.loadFile(path.join(directory, 'index.html'));
    const epub = process.argv[3] ? fs.readFileSync(process.argv[3]).toString('base64') : undefined;
    try {
      const result = await window.webContents.executeJavaScript(
        `(async () => { try { return await window.runImportReadingsTests(${JSON.stringify(epub)}); }
          catch (error) { return { failure: error.stack || String(error) }; } })()`);
      if (result.failure) throw new Error(result.failure);
      for (const line of result) console.log(`PASS ${line}`);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
    return;
  }
  const { build } = await import('vite');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-import-readings-'));
  await build({
    configFile: false, root: path.resolve(__dirname, '..'), logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: directory, emptyOutDir: false,
      lib: { entry: path.resolve(__dirname, '../tests/import-readings.ts'), name: 'ImportReadings',
        formats: ['es'], fileName: () => 'test.js' },
    },
  });
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="test.js"></script>');
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, directory,
    ...process.argv.slice(2).map(p => path.resolve(p))], { env, stdio: 'inherit', timeout: 120000, windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch(error => { console.error(error); process.exit(1); });
