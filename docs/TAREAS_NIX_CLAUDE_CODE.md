# Tareas Prioritarias para Nix (Claude Code)
**Objetivo:** Resolver los bugs visuales del lector nativo Android, optimizar el rendimiento de cambio de página y reconectar el canal IPC de parseo local.  
**Documento de Referencia Técnica:** [INFORME_INGENIERIA_INVERSA_JITEN_YORU.md](INFORME_INGENIERIA_INVERSA_JITEN_YORU.md)

---

## Checklist de Tareas

- [x] **Tarea 1:** Corregir el corte de subrayados en Android (`NativeReaderPlugin.java`)
- [x] **Tarea 2:** Corregir la colisión de líneas de subrayado con el Furigana en texto vertical (`NativeReaderPlugin.java`)
- [ ] **Tarea 3:** Evitar pantallas negras y lag al cambiar páginas rápido (`NativeReaderPlugin.java` + `NativeReaderView.java`)
- [ ] **Tarea 4:** Tokenización progresiva / Lazy loading de libros (`nativeReaderWords.ts`)
- [ ] **Tarea 5:** Conectar el oyente IPC para el parseo local de la extensión (`frontend/App.tsx`)

---

## Especificación Técnica Detallada por Tarea

### Tarea 1: Corregir el corte de subrayados en Android
* **Archivo:** `android/app/src/main/java/com/yorureader/app/NativeReaderPlugin.java`
* **Métodos afectados:** `drawUnderlines()` (línea ~870) y `underlineAt()` (línea ~910).
* **Causa Raíz:**
  El método `underlineAt` busca un color de fondo invisible (`& 0xFFFFFF`) muestreando 8 píxeles en las esquinas de cada carácter con `bitmap.getPixel()`. El antialiasing del motor C++ EraEPUB difumina los bordes de los kanjis y altera ese valor. Si un carácter en medio de una palabra devuelve `null`, el bucle actual de `drawUnderlines` hace:
  ```java
  drawUnderline(canvas, run, current, c); // Corta la línea antes de tiempo
  current = u;
  run = u != null ? box : null;
  ```
* **Solución a implementar:**
  1. **Tolerancia a fallos por antialiasing:** Si la letra $i$ devuelve `u == null`, pero la letra previa tenía un `current` activo y la letra siguiente $i+1$ en la misma línea devuelve el mismo estado `current`, **no cortar el trazo**. Asumir que la letra intermedia pertenece a la misma palabra y unir su caja con `run.union(box)`.
  2. Aumentar el muestreo de píxeles hacia el centro interior del cuadro delimitador (`cx, cy - 2`, `cx, cy + 2`) para evitar zonas de antialiasing del borde.

---

### Tarea 2: Corregir la colisión con Furigana en texto vertical
* **Archivo:** `android/app/src/main/java/com/yorureader/app/NativeReaderPlugin.java`
* **Método afectado:** `drawUnderline(Canvas canvas, RectF run, Underline u, Config c)` (línea ~924).
* **Causa Raíz:**
  En `vertical-rl`, las columnas van de derecha a izquierda y el furigana se ubica a la **derecha** del kanji.
  El código actual hace:
  ```java
  if (c.vertical) {
      x0 = x1 = run.left - gap - t / 2; // Borde izquierdo
      y0 = run.top;
      y1 = run.bottom;
  }
  ```
  Al empujar la línea hacia la izquierda con `run.left - gap`, invade el canal intercolumna y colisiona con el furigana de la columna vecina izquierda.
* **Solución a implementar:**
  1. Pegar la línea vertical al lateral izquierdo del cuerpo del kanji reduciendo el `gap` a un margen proporcional fino (`gap = Math.max(0.5f, t * 0.2f)`).
  2. O verificar si la palabra actual tiene furigana a su derecha; si no tiene furigana propio, dibujarla en `run.right + gap + t / 2` donde el espacio está despejado.

---

### Tarea 3: Eliminar pantallas negras y lag al cambiar páginas rápido
* **Archivos:**
  - `android/app/src/main/java/com/yorureader/app/NativeReaderPlugin.java`
  - `android/app/src/main/java/com/yorureader/app/NativeReaderView.java`
* **Causa Raíz:**
  Al pulsar varias veces seguidas para avanzar página, `turn()` y `renderPage()` encolan múltiples renders pesados en `EraEngine`. El hilo principal de Android intenta mostrar la nueva página antes de que el motor termine de rasterizar el Bitmap y extraer el texto con `CMD_REQ_PAGE_TEXT`.
* **Solución a implementar:**
  1. **Debounce / Skip en ráfagas:** En `NativeReaderView.java`, si se detectan múltiples toques en menos de 250 ms, cancelar el procesamiento de subrayados y escaneo de píxeles de las páginas intermedias y renderizar directamente la página destino final.
  2. **Cachear los subrayados:** Guardar un mapa en memoria `Map<Integer, List<PathPaint>>` de los trazos ya calculados por página para que al retroceder de página no se vuelva a ejecutar `bitmap.getPixel()` ni `drawUnderlines()`.

---

### Tarea 4: Tokenización perezosa (Lazy Loading) de libros
* **Archivo:** `frontend/utils/nativeReaderWords.ts`
* **Método afectado:** `analyseBookWords()` (línea ~130).
* **Causa Raíz:**
  Kuromoji.js recorre todos los capítulos del libro en el hilo principal antes de permitir interactuar fluidamente.
* **Solución a implementar:**
  1. Modificar `analyseBookWords()` para que tokenice inmediatamente el **capítulo inicial** donde se encuentra el usuario (progreso guardado) y resuelva la promesa para abrir el libro de inmediato.
  2. Encolar los capítulos restantes en segundo plano mediante `requestIdleCallback` o en un Web Worker dedicado sin bloquear la UI ni el paso de páginas.

---

### Tarea 5: Conectar el oyente IPC para el parseo local de la extensión
* **Archivos:** `frontend/App.tsx` (o `frontend/components/reader/ReaderEngine.ts`).
* **Causa Raíz:**
  `electron-main.cjs:618` envía `mainWindow.webContents.send('parse-text-request', { requestId, paragraphs })`, pero en el frontend nadie escucha este evento. La extensión en `http://127.0.0.1:23280/api/parse` espera 20 segundos de timeout y falla.
* **Solución a implementar:**
  Registrar el oyente expuesto en `preload.cjs`:
  ```typescript
  useEffect(() => {
    if (!window.electronAPI?.onParseTextRequest) return;
    const unsubscribe = window.electronAPI.onParseTextRequest(async (data: { requestId: number; paragraphs: string[] }) => {
      try {
        const parsed = await parseWithLocalEngine(data.paragraphs);
        window.electronAPI.replyParseText({ requestId: data.requestId, data: parsed });
      } catch (err) {
        window.electronAPI.replyParseText({ requestId: data.requestId, data: null });
      }
    });
    return () => unsubscribe();
  }, []);
  ```
