<div align="center">

<img src="build/icons/png/256x256.png" width="112" alt="Yoru Reader" />

# Yoru Reader

**Aprende japonés leyendo.** Lector de novelas ligeras con diccionario al toque, repaso espaciado estilo Anki y estadísticas de lectura.

[![Release](https://img.shields.io/github/v/release/Zams0524/Yoru-Reader?label=release&color=FFE000&labelColor=0c0e13&style=for-the-badge)](https://github.com/Zams0524/Yoru-Reader/releases/latest)
[![Plataformas](https://img.shields.io/badge/Windows%20·%20macOS%20·%20Linux%20·%20Android-ff8a6b?style=for-the-badge&labelColor=0c0e13)](#-descargas)
[![SRS](https://img.shields.io/badge/SRS-FSRS-22c55e?style=for-the-badge&labelColor=0c0e13)](https://github.com/open-spaced-repetition/ts-fsrs)

</div>

---

## 📥 Descargas

| Plataforma | Archivo | Descarga directa |
| :--- | :--- | :--- |
| 🪟 **Windows** (x64) | Instalador `.exe` | [**Yoru-Reader.Setup.exe**](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader.Setup.exe) |
| 📱 **Android** (7.0+) | `.apk` | [**Yoru-Reader.apk**](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader.apk) |
| 🍎 **macOS** Apple Silicon (M1–M4) | `.dmg` | [**Yoru-Reader-arm64.dmg**](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-arm64.dmg) |
| 🍎 **macOS** Intel | `.dmg` | [**Yoru-Reader-x64.dmg**](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-x64.dmg) |
| 🐧 **Linux** (x86_64) | `.flatpak` | [**Yoru-Reader-x86_64.flatpak**](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-x86_64.flatpak) |

Todas las versiones están en la página de [**Releases**](https://github.com/Zams0524/Yoru-Reader/releases/latest). La app avisa sola cuando hay una versión nueva.

<details>
<summary><b>Windows dice «Windows protegió tu PC»</b></summary>

El instalador todavía no está firmado con un certificado de editor, así que SmartScreen lo marca como «editor desconocido». Para instalarlo: **Más información → Ejecutar de todas formas**.
</details>

<details>
<summary><b>Android: cómo instalar el APK</b></summary>

1. Descarga `Yoru-Reader.apk` desde el teléfono.
2. Ábrelo y permite **Instalar apps desconocidas** para tu navegador o gestor de archivos cuando Android lo pida.
3. Para actualizar, instala la nueva versión **encima** de la anterior (no desinstales: perderías tus datos locales).
</details>

<details>
<summary><b>Linux: instalar el .flatpak</b></summary>

```bash
flatpak install --user Yoru-Reader-x86_64.flatpak
```

```bash
flatpak run com.yorureader.app
```
</details>

---

## ✨ Qué hace

**📖 Lector**
- EPUB, PDF, HTML, TXT y subtítulos (SRT, VTT, ASS).
- Texto vertical (縦書き) u horizontal, con paginación o desplazamiento.
- Furigana, temas claro/sepia/oscuro y ajustes de fuente, márgenes y brillo.

**🔍 Diccionario al toque**
- Toca o pasa el cursor (con `Shift`) sobre una palabra y aparece su definición.
- Diccionarios incluidos y activos desde el primer momento, más soporte para diccionarios de Yomitan.
- Gráfico de acento tonal (pitch accent), frecuencia y audio.
- Análisis morfológico con Kuromoji: reconoce conjugaciones y la forma base de cada palabra.

**🎴 Repaso espaciado (SRS)**
- Algoritmo FSRS, como el de Anki, con mazos propios.
- Integración con **AnkiConnect** para crear tarjetas con la frase de contexto.
- Calendario de actividad y rachas.

**📊 Estadísticas**
- Caracteres leídos, tiempo y velocidad de lectura (con medidor de sesión en el lector).
- Progreso por libro.

**☁️ Sincronización**
- Copia de seguridad y sincronización entre PC y Android con **Google Drive**.

---

## ⌨️ Atajos (escritorio)

| Tecla | Acción |
| :--- | :--- |
| `→` / `←` | Página siguiente / anterior |
| `F` | Pantalla completa |
| `Esc` | Mostrar u ocultar el menú |
| `T` | Leer en voz alta |
| `Shift` + cursor | Buscar la palabra en el diccionario |

Se pueden cambiar en **Ajustes → Atajos de teclado**.

---

## 🛠️ Desarrollo

Un solo frontend (React + Vite, en `frontend/`) que se empaqueta con **Electron** para escritorio y con **Capacitor** para Android.

```text
frontend/        Interfaz compartida (React + TypeScript)
backend/         Proceso principal de Electron
android/         Proyecto nativo de Android (Capacitor)
mobile/scripts/  Compilación y verificación del APK
build/           Iconos y recursos del instalador
docs/            Guías del proyecto
```

**Preparar el entorno**

```bash
npm install
```

Copia `.env.example` como `.env.local` y rellena los valores de Google OAuth (necesarios para la sincronización con Google Drive).

**Escritorio**

```bash
npm run dev
```

```bash
npm run electron:start
```

**Android** (Windows)

- `COMPILAR-APK.bat`: compila el APK firmado en `mobile/releases/`.
- `PUBLICAR-APK.bat`: lo sube a la release `latest` como `Yoru-Reader.apk` y avisa a las apps instaladas.

**Publicar escritorio**

Cada push a `main` ejecuta [GitHub Actions](.github/workflows/build-all-releases.yml), que compila Windows, macOS y Linux y los publica en la release `latest`.
