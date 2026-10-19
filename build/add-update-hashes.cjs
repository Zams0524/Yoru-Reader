// Records the sha256 and size of each published update asset in stable.json (assetHashes),
// so backend/updater.cjs can reject a truncated or corrupted download before applying it.
// Usage: node build/add-update-hashes.cjs <stable.json> <asset>...
// Assets not rebuilt in this run keep the entry from the previous manifest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [manifestPath, ...assets] = process.argv.slice(2);
if (!manifestPath) throw new Error('Usage: node build/add-update-hashes.cjs <stable.json> <asset>...');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.assetHashes = manifest.assetHashes || {};
for (const asset of assets) {
  if (!fs.existsSync(asset)) continue;
  const data = fs.readFileSync(asset);
  manifest.assetHashes[path.basename(asset)] = {
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    size: data.length
  };
  console.log(`${path.basename(asset)}: ${data.length} bytes`);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
