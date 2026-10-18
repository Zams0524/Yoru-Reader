const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📱 [Mobile Build] Iniciando compilación de APK y sistema OTA móvil...');

const rootDir = 'C:\\Users\\zams\\.gemini\\antigravity\\scratch\\Yoru-Reader';
const mobileDir = path.join(rootDir, 'mobile');
const androidDir = path.join(rootDir, 'android');
const releasesDir = path.join(mobileDir, 'releases');

if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir, { recursive: true });

// 1. Build Vite frontend
console.log('📦 1/4 Compilando frontend (Vite)...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

// 2. Build mobile-dist.zip for Mobile OTA
console.log('⚡ 2/4 Empaquetando mobile/mobile-dist.zip para OTA rápida...');
execSync('powershell Compress-Archive -Path dist\\* -DestinationPath mobile\\mobile-dist.zip -Force', { cwd: rootDir, stdio: 'inherit' });

// 3. Sync with Capacitor Android
console.log('🔄 3/4 Sincronizando con Capacitor Android...');
execSync('npx cap sync android', { cwd: rootDir, stdio: 'inherit' });

// 4. Compile APK with Gradle
console.log('🔨 4/4 Compilando APK nativo de Android con Gradle...');
const env = {
  ...process.env,
  JAVA_HOME: 'C:\\Program Files\\Microsoft\\jdk-21.0.12.101-hotspot',
  ANDROID_HOME: 'C:\\Users\\zams\\AppData\\Local\\Android\\Sdk'
};

execSync('.\\gradlew.bat assembleDebug', { cwd: androidDir, env, stdio: 'inherit' });

// 5. Copy APK output
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.1.6';

const apkSource = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
const apkDestStandard = path.join(releasesDir, `Yoru-Reader-${version}.apk`);
const apkDestV = path.join(releasesDir, `Yoru-Reader-v${version}.apk`);
const apkDebugDest = path.join(releasesDir, 'app-debug.apk');

if (fs.existsSync(apkSource)) {
  fs.copyFileSync(apkSource, apkDestStandard);
  fs.copyFileSync(apkSource, apkDestV);
  fs.copyFileSync(apkSource, apkDebugDest);
  const stats = fs.statSync(apkDestStandard);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ ¡APK generado con éxito! (${sizeMb} MB) -> ${apkDestStandard}`);
} else {
  console.error('❌ No se encontró el archivo APK generado por Gradle.');
}

// 6. Generate mobile-stable.json
const mobileManifest = {
  appVersion: version,
  versionCode: parseInt(version.replace(/\\./g, '')) || 10106,
  hotUpdateVersion: version,
  hotUpdateUrl: "https://raw.githubusercontent.com/Zams0524/Yoru-Reader/main/mobile/mobile-dist.zip",
  apkUrl: `https://github.com/Zams0524/Yoru-Reader/releases/download/v${version}/Yoru-Reader-${version}.apk`,
  description: `Yoru Reader Mobile v${version} (Diccionario al toque con el dedo, deslizamiento swipe y mejoras táctiles)`
};
fs.writeFileSync(path.join(mobileDir, 'mobile-stable.json'), JSON.stringify(mobileManifest, null, 2), 'utf8');

// Also save build script inside mobile/scripts/
const scriptPath = path.join(mobileDir, 'scripts/build-mobile.js');
fs.writeFileSync(scriptPath, fs.readFileSync(__filename, 'utf8'), 'utf8');

console.log('🎉 [Mobile Build] ¡Proceso móvil completo! APK y OTA listos.');
