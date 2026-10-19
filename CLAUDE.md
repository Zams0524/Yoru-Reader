# Yoru Reader: contexto para Claude Code

App para aprender japonés leyendo (lector de novelas + diccionario tipo Yomitan/Jiten + SRS tipo Anki + estadísticas de lectura).
Escritorio: Electron. Android: Capacitor (carpeta `android/`, paquete `com.yorureader.app`). Frontend React + Vite en `frontend/`.
Repo: https://github.com/Zams0524/Yoru-Reader
El usuario habla español; responde en español.
GitHub: el 18 oct se cambiaron todas las referencias de `zams0527-eng` a la cuenta nueva `Zams0524`. El repo es público, porque las actualizaciones automáticas leen `stable.json` y `mobile/mobile-stable.json` desde raw.githubusercontent. Las versiones ya instaladas siguen buscando actualizaciones en la cuenta antigua.
Git: repo público https://github.com/Zams0524/Yoru-Reader, rama `main`, subido el 18 oct. Git y gh instalados con winget (en PowerShell hay que recargar el PATH). `gh` tiene sesión como Zams0524 con permiso `workflow`. Commits con `Zams0524@users.noreply.github.com`. Esta carpeta está marcada como `safe.directory`, porque su dueño es el usuario CodexSandboxOffline.
Secretos: los valores OAuth de Google Drive están en `.env.local` (no se sube; plantilla en `.env.example`) y se leen con `import.meta.env.VITE_GDRIVE_*` en `googleDriveService.ts`. GitHub push protection bloquea subirlos. El workflow `.github/workflows/build-all-releases.yml` publica releases en cada push a main y se detiene si faltan los secrets `VITE_GDRIVE_CLIENT_ID` y `VITE_GDRIVE_CLIENT_SECRET` (`VITE_GDRIVE_ANDROID_CLIENT_ID` es opcional). Pendiente: que el usuario los cree.

Lee también: `docs/.agentrules`, `docs/PROJECT_GUIDELINES.md`, `docs/YORU_READER_ENGINEERING_PROMPT.md` (objetivo: la mejor app de adquisición de japonés; actuar como programador senior, mantener orden y optimización).

## Archivos clave
- `frontend/components/Library.tsx`: casi toda la UI (barra superior móvil ~línea 6744, barra inferior ~7714, ajustes `renderSettingsTab` ~3486).
- `frontend/index.css` (estilos antiguos, muchos `!important`) y `frontend/yoru-design-system.css` (se carga después; los bloques `html.platform-android` mandan en Android).
- `frontend/components/ProgressDashboard.tsx`: estadísticas.
- `frontend/utils/googleDriveService.ts` y `android/app/src/main/java/com/yorureader/app/GoogleDriveAuthPlugin.java`: sincronización con Google Drive.
- `mobile/scripts/build-android.js`, `mobile/scripts/verify-android-apk.js`: compilación y verificación del APK.

## Compilar el APK
Doble clic en `COMPILAR-APK.bat` (ejecuta `build-apk.ps1`): Vite build → `cap sync android` → Gradle con el JDK/SDK en `%LOCALAPPDATA%\Temp\yoru-android-apk-build` y `GRADLE_USER_HOME=.android-build-tmp\gradle-home-132` → verificación → copia a `mobile\releases\Yoru-Reader-<versión>-debug.apk`.
Node: `C:\Users\Zams\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` si `node` no está en el PATH.
La versión se sube en `android/app/build.gradle` (versionCode / versionName). Instalar siempre encima, sin desinstalar (misma firma debug).
Firma: `android/keystore/yoru-reader-debug.keystore` (SHA-1 F5:0A:…:3E:C2, registrado en Google Cloud). **No borrar ni regenerar**: cambiaría la firma, obligaría a desinstalar y rompería Google Drive. La usa `mobile/scripts/gradle-init.gradle`, que se pasa a Gradle con `--init-script`. `.android-build-tmp/` solo contiene cachés (gradle-home-132) y logs.

## Publicar
- Android: `COMPILAR-APK.bat` y luego `PUBLICAR-APK.bat` (`publish-apk.ps1`). Sube el APK a la release `latest` como `Yoru-Reader.apk` y reescribe `mobile/mobile-stable.json` (appVersion = versionName de Gradle); el script hace commit y push. La app de Android compara ese valor con la versión del APK instalado (`CapacitorApp.getInfo()` en Library.tsx), no con `stable.json`.
- Escritorio: cada push a `main` lo publica el workflow. Si cambian `backend/`, `build/` o `package.json` se recompilan los instaladores; si no, solo la OTA (`dist.zip`).
- Instalador de Windows (NSIS): el tema está en `build/installer.nsh` (paleta de la app, compatible con DPI, Segoe UI, botones oscuros, página de bienvenida, sin texto de marca). Las imágenes se regeneran con `build/make-installer-art.ps1` (a 2x). Para probarlo sin npm: `node node_modules\electron-builder\cli.js --win nsis --x64 --prepackaged dist-electron\Yoru-Reader-win32-x64 --config.directories.output=<tmp>`.
- Extensión de lectura (`backend/reader-ext`): **no se edita a mano**. Su código fuente es el fork Zams0524/JitenReader, rama `yoru` (Jiten Reader 1.3.2 + cambios de Yoru; ver YORU.md allí). Se compila con `node build/build-reader-ext.mjs` desde el tag de `build/reader-ext.json` (también lo hace el workflow). Para cambiarla: commit en la rama `yoru`, tag `yoru-vX-N`, actualizar `build/reader-ext.json` y ejecutar el script.
- La extensión se carga con `session.defaultSession.loadExtension` en `app.whenReady` (`getExtensionPath()` está al nivel superior del módulo; hasta el 19 oct estaba dentro de `createWindow` en el `.cjs` y daba ReferenceError). `ajb.js` corre como content script de la extensión (con `chrome.storage`); la inyección manual en `did-finish-load` solo ocurre si la carga falla. Para probar sin tocar el perfil real: `node_moduleselectrondistelectron.exe . --user-data-dir=<tmp> --proxy-server=127.0.0.1:9` (añadir `--remote-debugging-port=9333` para manejarla por CDP).
- SmartScreen («editor desconocido») solo desaparece firmando el .exe con un certificado de firma de código. Aún no está hecho.

## Historial reciente (Codex, 16-17 oct 2026)
- SRS rehecho al estilo Anki (usando el código fuente de Anki como referencia), integración con AnkiConnect, parser mejorado con JitenReader, diccionarios incluidos dentro de la app y activos por defecto, gráficos de pitch accent en el popup, actualizaciones automáticas, rediseño de UI, medidor de velocidad de lectura con botón en el lector.
- Android: se cerraba al arrancar. 1.3.5 lo arregló (faltaba `androidx.concurrent.futures.ResolvableFuture` por una exclusión en Gradle; ahora hay una verificación que lo detecta).
- About / Diagnostics (versión + copiar informe de cierre) está en Settings → Data, solo en Android y solo si el perfil se llama "Zams" (`showDiagnostics` en `renderSettingsTab`). Movido el 18 oct; aún no está en ningún APK.

## Estado actual (18 oct 2026, versión 1.3.6, cambios hechos pero sin compilar/probar)
Hecho en 1.3.6 (Claude):
- Ajustes Android: quitado el contenedor de altura fija que dejaba ~80 px vacíos; ahora desplaza con la página. Igual en Estadísticas.
- Barra superior centrada de verdad (columnas laterales iguales, clase `mobile-top-actions`), subrayado de acento en el título, pestaña de ajustes titulada "Configuración/Settings".
- Ocultos en Android los títulos duplicados (`settings-page-heading`, `progress-page-heading`).
- Barra inferior: `<nav>` con indicador activo tipo píldora (::before), línea de brillo superior, `aria-current`.
- Mensaje claro para el error `UNREGISTERED_ON_API_CONSOLE`.
- Lector: tocar una palabra en el borde ya no pasa página (`ReaderEngine.tsx`, zonas de toque reconocen `[data-word]`; con popup abierto, el toque solo lo cierra). En móvil (<768 px) el popup se ancla abajo/arriba de la pantalla, en la mitad opuesta a la palabra, máx. 45% de alto. El encabezado ya no incluye la furigana (彼女, no 彼女ヒロイン).
- SRS: la palabra del frente se ajusta al ancho (una sola línea) y "Toca para mostrar" en táctil.
Todo el CSS nuevo está al final de `yoru-design-system.css` ("Android shell v1.3.6").

Hecho en 1.3.7 (compilada 18 oct, `mobile\releases\Yoru-Reader-1.3.7-debug.apk`, sin probar en el teléfono):
- Pantalla de borde a borde estilo YouTube: `viewport-fit=cover` en `index.html` + `SystemBars` en `capacitor.config.json` (insetsHandling css, style DARK). `--yoru-safe-*` (index.css) toma primero `--safe-area-inset-*` que inyecta Capacitor; la barra inferior se extiende bajo la barra de gestos/botones y la superior bajo la de estado. El popup y la cabecera del repaso SRS respetan esos márgenes.
- En el teléfono la 1.3.7 seguía mostrando franjas grises (#303030, el fondo de ventana del tema), arriba y abajo: el paso de márgenes de Capacitor no se activó.

Hecho en 1.3.8 (compilada 18 oct, sin probar): `MainActivity.blendSystemBarsWithApp()` pone el fondo de la ventana y del decorView a #0c0e13, barras del sistema transparentes y `setNavigationBarContrastEnforced(false)` (quita el velo gris que pone Android 15/16 detrás de los 3 botones). Limitación: con el tema claro o sepia del lector, las franjas siguen siendo oscuras.
Observado en el teléfono, sin arreglar: tocar があります da "No se encontraron definiciones" (el parser agrupa があります como una sola palabra).

Pendiente:
1. 1.3.6 compilada (18 oct, `mobile\releases\Yoru-Reader-1.3.6-debug.apk`); falta que el usuario la pruebe en su teléfono (Samsung SM-S906U, Android 16). `build-apk.ps1` corregido: Gradle se ejecuta con ErrorActionPreference=Continue porque el aviso de Java en stderr abortaba el script en PowerShell 5.1.
2. Google Drive en Android (`UNREGISTERED_ON_API_CONSOLE`): el 18 oct se creó en Google Cloud (proyecto `heroic-calculus-501703-e5`, n.º 658624509601) el cliente Android "Yoru Reader Android (debug F5:0A)", con ID `658624509601-q25gt3i1l44fj806d9mgg9pg0dgl2u9f`, paquete `com.yorureader.app` y SHA-1 `F5:0A:75:2F:0C:89:F2:88:FC:2D:CB:B3:19:E9:27:15:C4:4C:3E:C2`. El cliente antiguo "Yoru Reader Android" tiene el SHA-1 de una firma vieja (`77:83:98:…:43:56`); se dejó intacto. Drive API activada; la app está "En producción", sin usuarios de prueba. Falta comprobar en el teléfono que sincroniza (Google tarda entre 5 min y unas horas en aplicar el cambio).
3. Los estilos Android solo aplican hasta 768 px de ancho; considerar el modo horizontal.
