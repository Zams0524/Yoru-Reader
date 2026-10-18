import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');

try {
  // 1. Read package.json version
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const newVersion = packageJson.version; // e.g. "1.0.1"

  console.log(`[Version Sync] New version detected from package.json: ${newVersion}`);

  if (!fs.existsSync(gradlePath)) {
    console.log(`[Version Sync] Gradle file not found at ${gradlePath}. Skipping Android version update.`);
    process.exit(0);
  }

  // 2. Read build.gradle
  let gradleContent = fs.readFileSync(gradlePath, 'utf8');

  // 3. Update versionName
  const versionNameRegex = /(versionName\s+)"([^"]+)"/;
  if (versionNameRegex.test(gradleContent)) {
    gradleContent = gradleContent.replace(versionNameRegex, `$1"${newVersion}"`);
    console.log(`[Version Sync] Updated versionName to "${newVersion}"`);
  } else {
    console.warn('[Version Sync] Could not find versionName inside build.gradle');
  }

  // 4. Increment versionCode
  const versionCodeRegex = /(versionCode\s+)(\d+)/;
  if (versionCodeRegex.test(gradleContent)) {
    const match = gradleContent.match(versionCodeRegex);
    const currentCode = parseInt(match[2], 10);
    const newCode = currentCode + 1;
    gradleContent = gradleContent.replace(versionCodeRegex, `$1${newCode}`);
    console.log(`[Version Sync] Incremented versionCode from ${currentCode} to ${newCode}`);
  } else {
    console.warn('[Version Sync] Could not find versionCode inside build.gradle');
  }

  // 5. Write back build.gradle
  fs.writeFileSync(gradlePath, gradleContent, 'utf8');
  console.log('[Version Sync] Saved build.gradle successfully.');

  // 6. Stage the file in git so it gets committed in the release commit
  try {
    execSync('git add android/app/build.gradle', { cwd: rootDir, stdio: 'inherit' });
    console.log('[Version Sync] Staged android/app/build.gradle in Git.');
  } catch (gitErr) {
    console.error('[Version Sync] Failed to stage build.gradle in Git:', gitErr.message);
  }

} catch (err) {
  console.error('[Version Sync] Failed to sync versions:', err.message);
  process.exit(1);
}
