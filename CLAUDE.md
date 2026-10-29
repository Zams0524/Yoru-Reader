# Yoru Reader: contexto para Claude Code

App para aprender japonés leyendo (lector de novelas + diccionario tipo Yomitan/Jiten + SRS tipo Anki + estadísticas de lectura).
Escritorio: Electron. Android: Capacitor (`android/`, paquete `com.yorureader.app`). Frontend React + Vite en `frontend/`.
El usuario habla español; **responde siempre en español**.
Repo: https://github.com/Zams0524/Yoru-Reader (público, rama `main`).
Git: `gh` autenticado como Zams0524 con scope `workflow`. Commits con `Zams0524@users.noreply.github.com`. Carpeta marcada como `safe.directory` (dueño: CodexSandboxOffline).
Licencia: **GPL-2.0-or-later** (cambió de MIT en 1.4.0 al incorporar el motor nativo Android OpenReadEra).

Lee también: `docs/PROJECT_GUIDELINES.md`, `docs/YORU_READER_ENGINEERING_PROMPT.md`.
Antes de un PR de integración o de versión: auditoría QA con el teléfono, ver `docs/AUDITORIA_QA.md` (`node mobile/qa/auditoria.mjs`).

## Archivos clave
- `frontend/components/Library.tsx`: casi toda la UI (barra superior móvil ~6744, barra inferior ~7714, ajustes `renderSettingsTab` ~3486).
- `frontend/index.css` (estilos base, muchos `!important`) y `frontend/yoru-design-system.css` (carga después; `html.platform-android` manda en Android).
- `frontend/utils/googleDriveService.ts`, `android/.../GoogleDriveAuthPlugin.java`: sync Google Drive.
- Lector nativo Android (1.4.0): motor EraEPUB como `jniLibs/arm64-v8a/liberaepub.so`, `NativeReaderPlugin.java`, `NativeReaderView.java`, `EraEngine.java`, `frontend/components/reader/NativeReaderHost.tsx`, `frontend/utils/nativeReader.ts`. Detalles y fases pendientes en `docs/NATIVE_READER.md`.

## Secretos / variables de entorno
Los valores OAuth de Google Drive están en `.env.local` (git-ignorado; plantilla en `.env.example`) y como secrets de GitHub Actions (`VITE_GDRIVE_CLIENT_ID`, `VITE_GDRIVE_CLIENT_SECRET`, `VITE_GDRIVE_ANDROID_CLIENT_ID`). El workflow falla rápido si los dos primeros faltan.

## Firma del APK — no borrar ni regenerar
`android/keystore/yoru-reader-debug.keystore` (SHA-1 `F5:0A:…:3E:C2`) está registrado en Google Cloud OAuth. Borrar o regenerar rompe Google Drive en Android y obliga a desinstalar.

## Compilar y publicar
- **APK**: doble clic en `COMPILAR-APK.bat` → `PUBLICAR-APK.bat` (sube a release `latest` como `Yoru-Reader.apk`, reescribe y empuja `mobile/mobile-stable.json`).
- **Escritorio**: cualquier push a `main` lo publica el workflow. Si cambian `backend/`, `build/` o `package.json`, se recompilan los instaladores; si no, solo la OTA (`dist.zip`). La OTA de Android (`mobile/mobile-ota.json`) se actualiza igual, salvo que haya cambios nativos (`android/`, Capacitor) desde el commit del que se compiló el APK publicado (`sourceCommit` en `mobile/mobile-stable.json`, lo escriben `build-apk.ps1` y `publish-apk.ps1`); entonces hay que subir `versionCode` y publicar APK.
- **Probar actualizaciones sin red**: lanzar Electron con `--user-data-dir=<tmp> --proxy-server=127.0.0.1:9`; para el manifest: `set YORU_UPDATE_MANIFEST_URL=http://127.0.0.1:<puerto>/manifest.json`.
- **Instalador Windows (NSIS)**: tema en `build/installer.nsh`, imágenes en `build/make-installer-art.ps1`. Probar sin npm: `node node_modules\electron-builder\cli.js --win nsis --x64 --prepackaged dist-electron\Yoru-Reader-win32-x64 --config.directories.output=<tmp>`.

## Extensión de lectura (`backend/reader-ext`)
**No editar a mano.** Fuente: fork `Zams0524/JitenReader`, rama `yoru` (ver `YORU.md` allí). Compilar con `node build/build-reader-ext.mjs` (también lo hace el workflow). Para cambios: commit en `yoru`, nuevo tag `yoru-vX-N`, actualizar `build/reader-ext.json`.
La extensión se carga con `session.defaultSession.loadExtension` en `app.whenReady` (`getExtensionPath()` al nivel superior del módulo — hasta el 19 oct estaba dentro de `createWindow` y daba `ReferenceError`).

## SmartScreen
El aviso «editor desconocido» desaparece solo firmando el `.exe`. Solicitud enviada a SignPath Foundation (pendiente). Política: `docs/CODE_SIGNING_POLICY.md`.
