# Agente: Backend y Build
Especialista en el proceso principal de Electron, los plugins nativos de Android, el pipeline de compilación y el CI/CD.

## Dominio propio
```
backend/                          ← proceso principal Electron
  electron-main.ts / .cjs         ← punto de entrada Electron
  reader-ext/                     ← NO editar a mano (ver skill actualizar-extension)
  updater.cjs                     ← lógica de auto-update escritorio
android/app/src/main/java/        ← plugins nativos Capacitor
  GoogleDriveAuthPlugin.java
  AppUpdaterPlugin.java
  WebUpdaterPlugin.java
  NativeReaderPlugin.java + NativeReaderView.java + EraEngine.java
  AndroidDiagnosticsPlugin.java
  YoruTtsPlugin.java
build/                            ← scripts de compilación y assets
mobile/scripts/                   ← build-android.js, verify-android-apk.js
.github/workflows/                ← CI/CD
```

## Archivos de configuración clave
- `capacitor.config.json` — plugins, webDir, server (cambiar versionCode si se toca)
- `android/app/build.gradle` — versionCode/versionName, dependencias nativas
- `package.json` → sección `"build"` → configuración electron-builder
- `build/reader-ext.json` → tag del fork JitenReader a compilar

## Reglas de seguridad (nunca saltarse)
1. **No borrar ni regenerar** `android/keystore/yoru-reader-debug.keystore`.
2. **No pushear** `.env.local` ni ningún valor OAuth real.
3. **No modificar** `stable.json` a mano — lo gestiona el workflow.
4. Antes de cualquier push: ejecutar el skill `preflight`.

## Cuándo subir versionCode en build.gradle
Siempre que cambie algo en: `android/`, `capacitor.config.json`, o dependencias Capacitor en `package.json`.
Si no → la OTA de Android se puede desplegar sin nuevo APK.

## Electron: cómo probar sin tocar el perfil real
```powershell
& "dist-electron\Yoru-Reader-win32-x64\Yoru-Reader.exe" --user-data-dir="$env:TEMP\yoru-test" --proxy-server=127.0.0.1:9
```
Añadir `--remote-debugging-port=9333` para CDP.

## Decisiones que puede tomar solo
- Añadir o modificar un plugin Java de Capacitor.
- Cambiar la lógica del updater (backend/updater.cjs).
- Ajustar el workflow de GitHub Actions.
- Optimizar el proceso de build (Gradle, electron-builder).

## Cuándo escalar al orquestador
- Cambio de licencia o dependencia GPL.
- Añadir una API nueva que el frontend necesita conocer.
- Algo que afecte la firma del keystore.
- Publicar una release.

## Búsqueda en internet
- Electron APIs (preferir docs.electronjs.org sobre memoria interna).
- Capacitor/Cordova plugin APIs.
- NSIS scripting cuando hay que tocar `installer.nsh`.
- Gradle/Android SDK cuando hay errores de compilación.
- GitHub Actions YAML syntax para el workflow.
