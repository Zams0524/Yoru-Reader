# Lector nativo de Android (motor OpenReadEra EraEPUB)

Desde la 1.4.0 (versionCode 143), Android dibuja los libros con un motor nativo en lugar del lector WebView, para que el paso de página sea tan fluido como en ReadEra. El lector WebView (`ReaderEngine.tsx`) sigue existiendo: es el de escritorio, y en Android se usa si se desactiva **Ajustes del libro → Motor nativo**, si el APK no tiene el plugin (OTA en APK antiguos) o si el motor falla al abrir un libro.

## Cómo funciona

- **Motor**: EraEPUB de [OpenReadEra](https://readera.org/open-readera) 21.12.11 (GPL-2.0, © READERA LLC; fork de CoolReader/crengine). Es un ejecutable, no una biblioteca: se empaqueta como `android/app/src/main/jniLibs/arm64-v8a/liberaepub.so` con `useLegacyPackaging` (build.gradle) y `extractNativeLibs` (manifest), porque Android solo permite ejecutar binarios desde `nativeLibraryDir`. Solo hay versión arm64-v8a; en otras arquitecturas el plugin responde `NO_ENGINE` y se usa el lector WebView.
- **Protocolo** (`EraEngine.java`): el motor corre en su propio proceso y habla por dos FIFO (orebridge/StProtocol). Comandos usados: `SET_FONT_CONFIG`, `FONT_NAMES` (fuentes CJK JP del sistema), `SET_CONFIG`, `OPEN` (HTML), `PAGE_RENDER` (RGBA), `CRE_PAGE_XPATH` / `CRE_PAGE_BY_XPATH` (posición).
- **Vista** (`NativeReaderView.java`): bitmaps de la página actual y las vecinas, renderizados en segundo plano (hilo `native-reader`), y deslizamiento entre ellos. Vertical: la siguiente página entra por la izquierda; tercio izquierdo/derecho = pasar página, centro = evento `tap` (muestra/oculta las barras de Yoru). Se dibuja encima del WebView; los **huecos** (`setHoles`) son las zonas donde se ven y reciben toques las barras, popovers y paneles del WebView. `NativeReaderHost.tsx` los calcula a partir de los elementos visibles del lector.
- **Libro** (`frontend/utils/nativeReader.ts`): el libro de IndexedDB se exporta a un único HTML (`files/native-reader/<id>-<hash>-v<versión>/book.html`, imágenes en `img/`; se guardan los 4 últimos). Cada bloque es un `<p>` hijo de `body` (los títulos son `<p class="h1">`, los capítulos empiezan con salto de página), así que la xpath del motor (`/html/body/p[n]/…`) da el bloque, y `blockParagraph` lo traduce al índice de párrafo de Yoru (el mismo que usa el lector WebView). La furigana del libro (`{base|lectura}` y 《》 de Aozora) se convierte en `<ruby>`.
- **Posición**: el progreso compartido del libro (capítulo/sección, párrafo, %) se guarda igual que en el lector WebView (`handleCharsUpdate` → `db.updateBookProgress`, con espera de 1,5 s porque reescribe toda la biblioteca). Además, la xpath exacta de la página se guarda en `localStorage` (`native-reader:position:<id>`) y se usa al reabrir si el párrafo guardado no ha cambiado (si se leyó en otro lector, se abre en ese párrafo).
- **Diccionario** (fase 2): tras cada página el plugin pide al motor las cajas de sus letras (`CMD_REQ_PAGE_TEXT`, coordenadas 0..1 ya rotadas en vertical). Un toque sobre una letra (gana sobre las zonas de pasar página, como en el lector web) pide su xpath (`CMD_REQ_XPATH_BY_RECT_ID`, índice de la letra en esa lista) y envía el evento `word`. `NativeReaderHost` pasa la xpath a posición en el texto del bloque sin furigana (`xpathToTextOffset`), dibuja ese párrafo fuera de pantalla con el mismo tokenizador del lector web (`renderLineWords`; con Jiten activo espera su análisis, `prepareLineWords`) y abre el popup de siempre con `triggerWordLookup(span, rect)`. Con el popup abierto (`setPopupOpen`) un toque en la página solo lo cierra.
- **Ajustes**: tamaño de letra (px CSS × densidad), interlineado (el 100 del motor ≈ 1,2 em; máx. 200), márgenes (los % del lector + barras del sistema; en vertical el motor rota la página, de ahí el cambio de lados en `layoutConfig`), colores del tema, alineación, fuente (Noto Serif/Sans CJK JP del sistema según la fuente elegida). Al cambiarlos se rehace la maquetación y se conserva la página.

## Pendiente (fases 2-4)

1. ~~Tocar una palabra → diccionario~~ (hecho en la fase 2). Falta: resaltar en la página la palabra elegida, selección larga / varias palabras.
2. Colores de estado de palabra y furigana en palabras nuevas: exportar el HTML ya tokenizado por Yoru (clases por estado → CSS) y volver a exportar cuando cambien los estados.
3. Lectura en voz alta, marcadores/subrayados con desplazamiento dentro del párrafo, búsqueda (`SEARCH_*`), índice con títulos reales (`OUTLINE`), brillo, teclas de volumen, grosor de letra, fuentes de la app (KleeOne, Shippori Mincho).
4. Detalles vistos en la prueba: huecos raros al justificar y la raya ―― horizontal en vertical.

## Compilar el motor

Solo hace falta para cambiar o actualizar el motor (el binario está en el repo):

```
powershell -ExecutionPolicy Bypass -File mobile\scripts\build-reader-engine.ps1
```

El script instala el NDK 20.1.5948944 en el SDK de compilación de Yoru si falta, clona el código en `%LOCALAPPDATA%\Temp\ore\src` (ruta corta: ndk-build falla con rutas largas), lo fija al commit `664251abd5584b97b5c6941a3ef5e8856d2c0efc` de https://github.com/champignoom/OpenReadEra (copia de OpenReadEra 21.12.11; el código oficial está en https://readera.org/open-readera), compila el objetivo `eraepub` con `APP_ABI=arm64-v8a APP_PLATFORM=android-24 APP_STL=c++_static APP_CFLAGS="-no-integrated-as -w" APP_CPPFLAGS="-include cmath"` y copia el binario sin símbolos. No se modifica el código del motor.

## Licencia

El motor es GPL-2.0, por eso Yoru Reader pasó de MIT a GPL-2.0-or-later (ver `LICENSE` y el README). Quien distribuya el APK debe poder ofrecer el código del motor: el enlace al commit de arriba y este documento cumplen ese papel; si la copia de champignoom desapareciera, conviene tener un fork propio (p. ej. `Zams0524/OpenReadEra`).
