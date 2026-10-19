# Solicitud a SignPath Foundation (borrador)

Formulario: <https://signpath.org/apply.html> · Condiciones: <https://signpath.org/terms>

## 1. Antes de enviar (lo tiene que hacer el dueño del repo)

- [ ] **Activar la verificación en dos pasos (2FA) en GitHub** para la cuenta Zams0524: Settings → Password and authentication. SignPath lo exige a todo el equipo, y también en la cuenta de SignPath que se cree después.
- [x] **Compilar `backend/reader-ext/` desde su código fuente.** Hecho: es [Jiten Reader](https://github.com/Sirush/JitenReader) 1.3.2 (MIT) con los cambios de Yoru, que ahora están como código fuente en el fork [Zams0524/JitenReader, rama `yoru`](https://github.com/Zams0524/JitenReader/tree/yoru) (ver su `YORU.md`). El workflow lo compila desde el tag fijado en `build/reader-ext.json`, con `build/build-reader-ext.mjs`, antes de empaquetar.
- [ ] **Revisar las fuentes de `index.html`.** Se cargan desde el CDN de Migaku, y GT Maru es una fuente comercial. No van dentro del instalador, pero SignPath prohíbe componentes propietarios; lo seguro es usar fuentes libres (por ejemplo, Inter y M PLUS Rounded 1c de Google Fonts) o incluir fuentes con licencia OFL.
- [ ] **Usar un correo de contacto que leas**, porque SignPath responde por correo.

## 2. Respuestas para el formulario (en inglés)

**Project name:** Yoru-Reader. Debe coincidir con el *product name* del ejecutable; `productName` en `package.json` es `Yoru-Reader`.

**Repository URL:** https://github.com/Zams0524/Yoru-Reader

**License:** MIT (LICENSE file at the repository root)

**Download / release page:** https://github.com/Zams0524/Yoru-Reader/releases/latest

**Code signing policy:** https://github.com/Zams0524/Yoru-Reader/blob/main/docs/CODE_SIGNING_POLICY.md

**Privacy policy:** https://github.com/Zams0524/Yoru-Reader/blob/main/docs/PRIVACY.md

**Artifacts to sign:** Windows NSIS installer (`Yoru-Reader.Setup.exe`) built by electron-builder, and the Electron application executable it contains.

**Build system:** GitHub Actions (`.github/workflows/build-all-releases.yml`), building from the public repository on every push to `main`.

**Project description:**

> Yoru Reader is a free, open-source desktop and Android app for learning Japanese by reading. It is a light-novel/e-book reader (EPUB, PDF, TXT, HTML, subtitles) with an instant pop-up dictionary, pitch-accent graphs, an Anki-style spaced-repetition system (FSRS) with AnkiConnect integration, and reading statistics. It is built with React + Vite, packaged with Electron for Windows/macOS/Linux and with Capacitor for Android. Windows users currently get a SmartScreen "unknown publisher" warning on the installer; we would like to sign the Windows installer and executable through SignPath.

## 3. Después de la aprobación

SignPath enviará el *organization ID* y permitirá crear un proyecto y un token de API. Pasos:

1. En SignPath: crear el proyecto `Yoru-Reader`, conectarlo al repo de GitHub y crear una *artifact configuration* para el instalador NSIS. Debe exigir product name = `Yoru-Reader` y la misma versión en todos los archivos, como piden las condiciones.
2. En GitHub (Settings → Secrets and variables → Actions):
   - Secret `SIGNPATH_API_TOKEN`
   - Variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` (`release-signing`)
3. En el job `build-windows` del workflow: subir el `.exe` sin firmar como artefacto y añadir un paso con la acción oficial `signpath/github-action-submit-signing-request` (con `wait-for-completion: true`). Después, sustituir el `.exe` por el firmado antes de `Save Windows installer`. Comprueba los nombres exactos de los parámetros en la documentación de SignPath antes de activarlo.
4. Cada publicación esperará la aprobación manual en SignPath (rol *Approver*).
5. Cambiar «Status: pending» por la frase de atribución en `docs/CODE_SIGNING_POLICY.md`.

Nota: SignPath decide a su criterio, y para ejecutables de usuario final exige más reputación (antigüedad del proyecto, descargas, actividad) que para librerías. Un proyecto recién publicado puede tener que esperar o ser rechazado al principio.
