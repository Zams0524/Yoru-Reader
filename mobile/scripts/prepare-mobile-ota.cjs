// Writes mobile/mobile-ota.json: the Android over-the-air UI update (dist.zip), read by
// frontend/hooks/useAppUpdater.ts and applied by WebUpdaterPlugin.java.
// Usage: node mobile/scripts/prepare-mobile-ota.cjs <stable.json with assetHashes> <output>
// Env: YORU_ANDROID_VERSION_CODE (the APK versionCode the bundle was built against) and
// YORU_ANDROID_OTA ('true' unless Android native code changed without a versionCode bump).
const fs = require('node:fs');

const [stablePath, outputPath] = process.argv.slice(2);
if (!stablePath || !outputPath) throw new Error('Usage: node mobile/scripts/prepare-mobile-ota.cjs <stable.json> <output>');

const stable = JSON.parse(fs.readFileSync(stablePath, 'utf8'));
const nativeVersionCode = Number(process.env.YORU_ANDROID_VERSION_CODE);
if (!Number.isInteger(nativeVersionCode) || nativeVersionCode <= 0) throw new Error('Set YORU_ANDROID_VERSION_CODE.');
const bundle = stable.assetHashes && stable.assetHashes['dist.zip'];
if (!bundle) throw new Error('stable.json has no assetHashes for dist.zip.');

const offered = process.env.YORU_ANDROID_OTA === 'true';
const manifest = {
  webVersion: stable.hotUpdateVersion,
  nativeVersionCode,
  url: offered ? stable.hotUpdateUrl : null,
  sha256: bundle.sha256,
  size: bundle.size,
  description: `Yoru Reader interface v${stable.hotUpdateVersion}`
};
if (!offered) {
  manifest.blockedReason = 'Android native code changed without a versionCode bump; publish a new APK.';
  console.log(`::warning::${manifest.blockedReason}`);
}
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`mobile-ota.json: web ${manifest.webVersion} for APK ${nativeVersionCode}, offered: ${offered}`);
