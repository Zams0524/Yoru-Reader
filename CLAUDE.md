# Yoru Reader: contexto para Claude Code

App para aprender japonés leyendo (lector de novelas + diccionario tipo Yomitan/Jiten + SRS tipo Anki + estadísticas de lectura).
Escritorio: Electron. Android: Capacitor (`android/`, paquete `com.yorureader.app`). Frontend React + Vite en `frontend/`.
El usuario habla español; **responde siempre en español**.
Repo: https://github.com/Zams0524/Yoru-Reader (público, rama `main`).
Git: `gh` autenticado como Zams0524 con scope `workflow`. Commits con `Zams0524@users.noreply.github.com`. Carpeta marcada como `safe.directory` (dueño: CodexSandboxOffline).
Licencia: **GPL-2.0-or-later** (cambió de MIT en 1.4.0 al incorporar el motor nativo Android OpenReadEra).
Código de terceros cedido por su autor: `THIRD-PARTY-GRANTS.md`. Nada se porta de otro proyecto sin quedar anotado ahí primero, y cada fichero portado lo dice en su cabecera.

Lee también: docs/VISION_APRENDIZAJE_JAPONES.md, docs/OPTIMIZACION_PLATAFORMAS_Y_UX.md, docs/ARQUITECTURA_MULTI_AGENTE.md, docs/TAREAS_NIX_CLAUDE_CODE.md, docs/INFORME_INGENIERIA_INVERSA_JITEN_YORU.md, docs/PROJECT_GUIDELINES.md, docs/YORU_READER_ENGINEERING_PROMPT.md, docs/SRS_ANKI_PARITY_AUDIT.md.
Antes de un PR de integración o de versión: auditoría QA con el teléfono, ver `docs/AUDITORIA_QA.md` (`node mobile/qa/auditoria.mjs`).

## Tareas Prioritarias en Curso (Nix / Claude Code)
Ver especificación técnica y soluciones en `docs/TAREAS_NIX_CLAUDE_CODE.md`:
1. **Corregir corte de subrayados en Android**: En `NativeReaderPlugin.java`, el muestreo por píxeles de `underlineAt()` falla por antialiasing en letras intermedias; implementar tolerancia a fallos entre caracteres adyacentes de la misma palabra.
2. **Evitar colisión con Furigana en vertical**: Ajustar el cálculo de `run.left` en `drawUnderline()` para no invadir el canal de furigana de la columna vecina izquierda.
3. **Optimizar paso de páginas rápido (evitar pantalla negra)**: Debounce/cancelación de renders obsoletos y caché de Paths en `NativeReaderPlugin.java` y `NativeReaderView.java`.
4. **Lazy loading de análisis Kuromoji**: En `nativeReaderWords.ts`, tokenizar de inmediato solo el capítulo visible y el resto en segundo plano.
5. ~~**Reconectar IPC de parseo local**~~ — **ya está hecho**: `App.tsx` registra `onParseTextRequest` y responde con `replyParseText`, y `preload.cjs` expone las dos. Se deja tachado en vez de borrado para que nadie lo vuelva a empezar. Ojo: `docs/INFORME_INGENIERIA_INVERSA_JITEN_YORU.md` y `docs/TAREAS_NIX_CLAUDE_CODE.md` siguen describiéndolo como pendiente; son informes de su fecha, no el estado de hoy.

## Archivos clave
- `frontend/components/Library.tsx`: casi toda la UI (barra superior móvil ~6744, barra inferior ~7714, ajustes `renderSettingsTab` ~3486).
- `frontend/index.css` (estilos base, muchos `!important`) y `frontend/yoru-design-system.css` (carga después; `html.platform-android` manda en Android).
- `frontend/utils/googleDriveService.ts`, `android/.../GoogleDriveAuthPlugin.java`: sync Google Drive.
- Lector nativo Android (1.4.0): motor EraEPUB como `jniLibs/arm64-v8a/liberaepub.so`, `NativeReaderPlugin.java`, `NativeReaderView.java`, `EraEngine.java`, `frontend/components/reader/NativeReaderHost.tsx`, `frontend/utils/nativeReader.ts`. Detalles y fases pendientes en `docs/NATIVE_READER.md`.

## Secretos / variables de entorno
Los valores OAuth de Google Drive están en `.env.local` (git-ignorado; plantilla en `.env.example`) y como secrets de GitHub Actions (`VITE_GDRIVE_CLIENT_ID`, `VITE_GDRIVE_CLIENT_SECRET`, `VITE_GDRIVE_ANDROID_CLIENT_ID`). El workflow falla rápido si los dos primeros faltan.

## Servidores multimedia — no se configuran desde la app
Kavita y Audiobookshelf vienen puestos y se conectan solos al arrancar: **la app ya no tiene pantalla para editarlos** (decisión de zams, 7 nov 2026). Para cambiar dirección o credenciales se edita `frontend/config/serverDefaults.ts`, o se ponen `VITE_KAVITA_URL`, `VITE_KAVITA_API_KEY`, `VITE_ABS_URL` y `VITE_ABS_TOKEN` en `.env.local`, que manda sobre el fichero.
Si un servidor no responde, la pantalla lo dice y el motivo queda en la consola con el host (`[servidor] …`): es el único diagnóstico que queda.

## Sincronización de progreso (Discord + Tailscale Funnel)
El progreso de cada miembro del Discord de Yoru se guarda en un servidor propio que corre en el PC de zams (`servidor-sync/`, Node a secas + SQLite, sin dependencias) y sale a internet con Tailscale Funnel: `https://desktop-go1ujdd.tail6db786.ts.net` (sin puerto; Funnel solo sirve 443/8443/10000). Entrar con Discord es lo único que hace falta; nadie instala Tailscale ni configura nada en la app. Dentro del tailnet el mismo servidor sigue en `http://desktop-go1ujdd.tail6db786.ts.net:3747`, que es lo que usa `VITE_YORU_SYNC_URL` para probar.
Al estar expuesto, `POST /api/sesion` es la única puerta sin sesión y tiene freno: diez **fallos** por dirección cada diez minutos → 429. Los aciertos no cuentan, así que abrir la app no gasta intentos.
No sustituye a Google Drive, son dos sitios donde dejar lo mismo, y **comparten combinador**: los dos usan `mergeDatabaseExports` (`frontend/utils/cloudMerge.ts`). El servidor no combina nada, solo guarda y lleva un contador de versiones (409 cuando otro aparato escribió entremedias).
Detalles en `docs/SINCRONIZACION_YORU.md`; cómo arrancar el servidor y dejarlo arrancado, en `servidor-sync/README.md`.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
