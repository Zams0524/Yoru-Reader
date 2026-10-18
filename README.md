# Yoru Reader 🌙 📖
> **Lector moderno de novelas ligeras y documentos en japonés con análisis morfológico Kuromoji, diccionario Yomitan integrado, Review Heatmap Anki y sistema SRS con FSRS-6.**

<div align="center">

[![Version](https://img.shields.io/badge/version-v1.1.4-FFE000?style=for-the-badge&logo=electron&logoColor=black)](https://github.com/Zams0524/Yoru-Reader/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-a855f7?style=for-the-badge)](https://github.com/Zams0524/Yoru-Reader/releases)
[![License](https://img.shields.io/badge/license-MIT-38bdf8?style=for-the-badge)](LICENSE)
[![FSRS](https://img.shields.io/badge/SRS%20Engine-FSRS--6-22c55e?style=for-the-badge)](https://github.com/open-spaced-repetition/fsrs4anki)

</div>

---

## 📥 Descargas Oficiales (v1.1.4)

| Plataforma | Paquete / Tipo | Enlace de descarga |
| :--- | :--- | :--- |
| **🪟 Windows** | Instalador (`.exe`) / Portable (`.zip`) | [⬇️ Descargar Windows x64](https://github.com/Zams0524/Yoru-Reader/releases/latest) |
| **🍎 macOS (Apple Silicon)** | DMG / App Bundle (M1 / M2 / M3 / M4) | [⬇️ Descargar macOS arm64](https://github.com/Zams0524/Yoru-Reader/releases/latest) |
| **🍎 macOS (Intel)** | DMG / App Bundle (Intel x64) | [⬇️ Descargar macOS x64](https://github.com/Zams0524/Yoru-Reader/releases/latest) |
| **🐧 Linux (Flathub)** | Tienda Oficial Flathub | `flatpak install flathub com.yorureader.app` |
| **🐧 Linux (Flatpak Standalone)** | Paquete independiente (`.flatpak`) | [⬇️ Descargar Flatpak x86_64](https://github.com/Zams0524/Yoru-Reader/releases/latest) |
| **📱 Android** | Archivo APK | [⬇️ Descargar Android APK](https://github.com/Zams0524/Yoru-Reader/releases/latest) |

---

## ✨ Características Principales

### 1. ⚡ Analizador Morfológico Japonés de Alta Precisión (Kuromoji & Yoru Native Parser)
- **100% de Cobertura de Caracteres**: Identificación morfológica y segmentación precisa de verbos, partículas, adjetivos, conjugaciones e inflexiones.
- **Estados de Vocabulario en Tiempo Real**: Resaltado automático de palabras según tu nivel SRS (`Nuevo`, `En Aprendizaje`, `Maduro/Conocido`, `Pendiente`).
- **Soporte Completo de Furigana y Ruby**: Renderizado nativo `<ruby>` y generación automática de lecturas en hiragana.

### 2. 🎴 Anki Review Heatmap & Motor SRS FSRS-6
- **Review Heatmap Completo (Paridad con Anki Add-on)**: Gráfico de actividad anual con racha actual, récord histórico de días consecutivos, promedio diario, % de días aprendidos e intensidad en 5 niveles de color.
- **Pronóstico de Repasos Futuros (Forecast)**: Bloques cian que muestran la carga de tarjetas pendientes proyectadas según los intervalos calculados por FSRS-6.
- **Integración con AnkiConnect**: Exporta e importa tarjetas y mazos con audio TTS, captura de pantalla y contexto de la oración en un solo clic.

### 3. 🔍 Diccionario Yomitan Offline Integrado
- **Búsquedas a 0ms de Latencia**: Base de datos IndexedDB local ultra optimizada para diccionarios JMDict, KANJIDIC, frecuencias y meta-bancos.
- **Gráficos de Acento Tonal (Pitch Accent)**: Visualización de las curvas de entonación (Heiban, Atamadaka, Nakadaka, Odaka).
- **Pronunciación TTS y Audio Nativo**: Reproducción de audio y síntesis de voz con velocidad ajustable.

### 4. 📖 Experiencia de Lectura Inmersiva
- **Modos Vertical (Tategaki 縦書き) y Horizontal (Yokogaki 横書き)**: Paginación inteligente fluida, diseño sin saltos y ajuste tipográfico.
- **Formatos Compatibles**: EPUB, PDF, HTML, TXT y subtítulos de anime/videos (SRT, VTT, ASS).
- **Estadísticas de Inmersión**: Contador de caracteres leídos por sesión, velocidad de lectura (cpm) y desglose de comprensión por libro.

### 5. 🔄 Actualizaciones en Vivo (Live In-App OTA)
- **Actualización sin reinstalar**: Descarga de actualizaciones directamente dentro de la aplicación con barra de progreso en vivo y reinicio automático instantáneo.

---

## 🐧 Instalación en Linux

### Opción A: Flathub (Recomendado)
```bash
# Agregar repositorio Flathub si no lo tienes
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# Instalar Yoru Reader
flatpak install flathub com.yorureader.app

# Ejecutar
flatpak run com.yorureader.app
```

### Opción B: Paquete Flatpak descargado (.flatpak)
```bash
flatpak install --user Yoru-Reader-1.1.4-x86_64.flatpak
flatpak run com.yorureader.app
```

---

## ⌨️ Atajos de Teclado Principales

| Atajo | Acción |
| :--- | :--- |
| **`Shift` + Cursor / Hover** | Consulta instantánea en el diccionario Yomitan |
| **`A` / `D`** o **`←` / `→`** | Página anterior / Página siguiente |
| **`W` / `S`** o **`↑` / `↓`** | Capítulo anterior / Capítulo siguiente |
| **`F`** | Modo Pantalla Completa |
| **`Q`** | Panel rápido de ajustes de visualización (fuente, espaciado, vertical) |
| **`P`** | Pronunciar selección con síntesis de voz |
| **`S`** | Guardar palabra en mazo de repaso SRS |

---

## 🛠️ Desarrollo y Compilación Local

Si deseas compilar o contribuir al desarrollo de Yoru Reader:

```bash
# 1. Clonar el repositorio
git clone https://github.com/Zams0524/Yoru-Reader.git
cd Yoru-Reader

# 2. Instalar dependencias
npm install

# 3. Iniciar entorno de desarrollo
npm run electron:start

# 4. Compilar para producción (Windows)
npm run electron:stable

# 5. Compilar para desarrollo con inspector
npm run electron:dev
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT** - consulta el archivo [LICENSE](LICENSE) para más detalles.
