const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'stable.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const repository = process.env.GITHUB_REPOSITORY || 'Zams0524/Yoru-Reader';
const releaseBase = `https://github.com/${repository}/releases/download/latest`;
const buildVersion = process.env.YORU_BUILD_VERSION;
const appVersion = process.env.YORU_APP_VERSION;
const backendVersion = process.env.YORU_BACKEND_VERSION;
const nativeCommit = process.env.YORU_NATIVE_COMMIT;

if (!buildVersion || !appVersion || !backendVersion) {
  throw new Error('Set YORU_BUILD_VERSION, YORU_APP_VERSION and YORU_BACKEND_VERSION before preparing the update manifest.');
}

manifest.appVersion = appVersion;
manifest.backendVersion = backendVersion;
manifest.hotUpdateVersion = buildVersion;
manifest.hotUpdateUrl = `${releaseBase}/dist.zip`;
manifest.url = `${releaseBase}/Yoru-Reader.Setup.exe`;
manifest.windowsUrl = `${releaseBase}/Yoru-Reader.Setup.exe`;
manifest.macArmUrl = `${releaseBase}/Yoru-Reader-arm64.dmg`;
manifest.macUrl = `${releaseBase}/Yoru-Reader-x64.dmg`;
manifest.linuxUrl = `${releaseBase}/Yoru-Reader-x86_64.flatpak`;
manifest.description = `Yoru Reader Desktop v${appVersion} (Windows, Mac & Linux)`;

if (nativeCommit) manifest.nativeCommit = nativeCommit;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
