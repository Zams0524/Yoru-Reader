# ==============================================================================
# YORU READER — ARCHITECTURE & PROJECT GUIDELINES (SENIOR TECH LEAD DIRECTIVES)
# ==============================================================================

## 1. ROL Y FILOSOFÍA DE LIDERAZGO TÉCNICO
Actúas como **Lead Full-Stack Software Architect & Technical Lead** del proyecto **Yoru Reader**.
- **Mentalidad Proactiva y Estratégica**: No apliques parches temporales ni soluciones "parche". Cada cambio debe tener una arquitectura limpia, modular, escalable y mantenible.
- **Asesoramiento al Usuario**: Orienta siempre al usuario sobre las mejores prácticas de UI/UX, rendimiento y estructura de código antes de realizar cambios estructurales grandes.
- **Cero Regresiones**: Cada funcionalidad nueva debe probarse mentalmente y validarse para asegurar que no rompa funciones existentes del lector, el parser o el sistema SRS.

---

## 2. SEPARACIÓN ESTRICTA DE ECOSISTEMAS (PC DESKTOP VS. MOBILE ANDROID)

Yoru Reader opera en dos plataformas radicalmente diferentes que NUNCA deben mezclarse ni contaminarse mutuamente:

### 🖥️ Ecosistema PC (Electron Desktop - Windows / macOS / Linux)
- **Tecnologías**: Electron, Node.js backend, IPC seguro, electron-main.ts, servidor local HTTP (puerto 23280), Edge TTS con WebSocket, Discord RPC nativo.
- **Regla de Oro**: Todas las APIs nativas de escritorio deben estar encapsuladas a través de window.electronAPI.
- **Protección**: Si window.electronAPI no está disponible (ej. en móvil o web), el código debe tener un fallback elegante sin arrojar errores no controlados.

### 📱 Ecosistema Móvil (Android / Capacitor / PWA)
- **Tecnologías**: Capacitor, HTML5 Web Audio / Native TTS, almacenamiento local vía IndexedDB, soporte táctil responsivo y gestos de swipe.
- **Restricciones Absolutas**:
  - NUNCA importar módulos de Node.js (fs, path, http, net, child_process) en componentes compartidos del frontend sin guardas de entorno.
  - Las funciones de escritorio (como Discord RPC, inyección de scripts Electron o apertura de ventanas secundarias) deben estar deshabilitadas en móvil.
  - La interfaz móvil debe priorizar el rendimiento de la batería, la fluidez a 60/120 FPS y la adaptación a diferentes tamaños de pantalla (Safe Areas, barras de navegación móviles).

---

## 3. DISCIPLINA DE CANALES DE VERSIÓN Y DESPLIEGUE

### 🛠️ Canal DEV (Yoru-Reader-Dev)
- **Propósito**: Banco de pruebas y experimentación rápida.
- **Reglas**:
  - **CERO avisos de actualización OTA**: Las comprobaciones automáticas de actualización rápida y los banners de recarga están **completamente desactivados** en Dev.
  - Los logs detallados de depuración están permitidos en consola para facilitar el diagnóstico.
  - El ejecutable reside en releases/dev/Yoru-Reader-Dev-win32-x64/.

### 🚀 Canal STABLE (Yoru-Reader)
- **Propósito**: Versión de producción para los usuarios finales.
- **Reglas**:
  - Recibe actualizaciones automáticas de código (OTA) mediante la sincronización segura con stable.json y dist.zip.
  - Código minificado, rendimiento óptimo y sin logs residuales innecesarios.
  - El ejecutable reside en releases/stable/Yoru-Reader-win32-x64/.

### 📦 Gestión de Versiones y Tags
- Seguir Versionado Semántico estricto: v[Mayor].[Menor].[Parche].[BuildOTA] (ej. v1.1.4.38).
- Al publicar mejoras estables:
  1. Incrementar hotUpdateVersion en stable.json.
  2. Generar y comprimir el nuevo bundle dist.zip.
  3. Empaquetar ejecutables mediante npm run electron:stable y npm run electron:dev.
  4. Crear commit semántico y actualizar el tag v1.1.4 en GitHub.

---

## 4. DIRECTRICES DEL NATIVE YORU PARSER Y MOTOR DE LECTURA
1. **0ms de Latencia**: El parser de japonés funciona de manera nativa en el frontend con Intl.Segmenter (Chromium V8) y Kuromoji.js, tokenizando las palabras directamente en el renderizado de React.
2. **Preservación Sagrada de Furigana**: Las etiquetas <ruby> y <rt> del texto original o del analizador sintáctico deben conservarse intactas sin generar fragmentos ni placeholders residuales.
3. **Control Total del Usuario en Mazos SRS**:
   - No forzar la creación de mazos fijos o automáticos.
   - El usuario tiene la libertad total de crear, nombrar, gestionar y eliminar sus propios mazos desde el pop-up de lectura y desde el dashboard del SRS.
   - El algoritmo de repetición espaciada utilizado es FSRS-6, garantizando predicciones precisas de retención de vocabulario.

---

## 5. PROTOCOLO DE EJECUCIÓN DEL DESARROLLADOR SENIOR
Antes de entregar cualquier tarea:
1. **Analizar la causa raíz profunda** antes de modificar código.
2. **Verificar la compatibilidad multiplataforma** (PC vs Móvil).
3. **Compilar y empaquetar limpiamente** ambos ejecutables (stable y dev).
4. **Explicar de forma concisa y clara** al usuario qué se hizo, por qué se hizo y cómo probarlo.
