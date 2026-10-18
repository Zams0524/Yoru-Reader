import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAndroidApk } from './verify-android-apk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🚀 [Mobile] Iniciando compilación de Yoru Reader para Android...');

try {
  const projectRoot = path.resolve(__dirname, '../..');
  const androidDir = path.join(projectRoot, 'android');
  const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
  const appGradle = fs.readFileSync(appGradlePath, 'utf8');
  const versionMatch = appGradle.match(/versionName\s+["']([^"']+)["']/);

  if (!versionMatch) {
    throw new Error('No se pudo leer versionName desde android/app/build.gradle.');
  }

  const appVersion = versionMatch[1];

  // 1. Build frontend
  console.log('📦 [Mobile] Paso 1: Compilando assets del frontend (Vite)...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

  // 2. Sync with Capacitor
  console.log('🔄 [Mobile] Paso 2: Sincronizando con Capacitor Android...');
  execSync('npx cap sync android', { cwd: projectRoot, stdio: 'inherit' });

  // 3. Build a fresh, installable debug APK instead of accidentally copying an old one.
  console.log('🤖 [Mobile] Paso 3: Generando el APK de prueba...');
  const gradleCommand = process.platform === 'win32'
    ? '.\\gradlew.bat :app:assembleDebug --no-daemon'
    : './gradlew :app:assembleDebug --no-daemon';
  execSync(gradleCommand, { cwd: androidDir, stdio: 'inherit', shell: true });

  // 4. Verify packaged startup classes before creating a distributable copy.
  const apkDebugSrc = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const destDir = path.join(__dirname, '../releases');
  const apkDest = path.join(destDir, `Yoru-Reader-${appVersion}-debug.apk`);

  if (!fs.existsSync(apkDebugSrc)) {
    throw new Error('Gradle terminó sin generar android/app/build/outputs/apk/debug/app-debug.apk.');
  }

  const verification = await verifyAndroidApk(apkDebugSrc);
  console.log(`🔎 [Mobile] ${verification.requiredClasses} clases de arranque verificadas en el APK.`);

  // 5. Copy the exact APK just built, using its actual app version.
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(apkDebugSrc, apkDest);
  console.log(`✅ [Mobile] APK de prueba listo: ${apkDest}`);
  console.log('🎉 [Mobile] ¡Proceso completado con éxito!');
} catch (error) {
  console.error('❌ [Mobile] Error durante la compilación:', error.message);
  process.exit(1);
}
