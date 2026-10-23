# Lector nativo de Android (motor OpenReadEra EraEPUB)

Desde la 1.4.0 (versionCode 143), Android dibuja los libros con un motor nativo en lugar del lector WebView, para que el paso de página sea tan fluido como en ReadEra. El lector WebView (`ReaderEngine.tsx`) sigue existiendo: es el de escritorio, y en Android se usa si se desactiva **Ajustes del libro → Motor nativo**, si el APK no tiene el plugin (OTA en APK antiguos) o si el motor falla al abrir un libro.

## Cómo funciona

- **Motor**: EraEPUB de [OpenReadEra](https://readera.org/open-readera) 21.12.11 (GPL-2.0, © READERA LLC; fork de CoolReader/crengine). Es un ejecutable, no una biblioteca: se empaqueta como `android/app/src/main/jniLibs/arm64-v8a/liberaepub.so` con `useLegacyPackaging` (build.gradle) y `extractNativeLibs` (manifest), porque Android solo permite ejecutar binarios desde `nativeLibraryDir`. Solo hay versión arm64-v8a; en otras arquitecturas el plugin responde `NO_ENGINE` y se usa el lector WebView.
- **Protocolo** (`EraEngine.java`): el motor corre en su propio proceso y habla por dos FIFO (orebridge/StProtocol). Comandos usados: `SET_FONT_CONFIG`, `FONT_NAMES` (fuentes CJK JP del sistema), `SET_CONFIG`, `OPEN` (HTML), `PAGE_RENDER` (RGBA), `CRE_PAGE_XPATH` / `CRE_PAGE_BY_XPATH` (posición).
- **Vista** (`NativeReaderView.java`): bitmaps de la página actual y las vecinas, renderizados en segundo plano (hilo `native-reader`), y deslizamiento entre ellos. Vertical: la siguiente página entra por la izquierda; tercio izquierdo/derecho = pasar página, centro = evento `tap` (muestra/oculta las barras de Yoru). Se dibuja encima del WebView; los **huecos** (`setHoles`) son las zonas donde se ven y reciben toques las barras, popovers y paneles del WebView. `NativeReaderHost.tsx` los calcula a partir de los elementos visibles del lector.
- **Libro** (`frontend/utils/nativeReader.ts`): el libro de IndexedDB se exporta a un único XHTML con sus imágenes, y el plugin lo empaqueta como EPUB mínimo (`files/native-reader/<id>-<hash>-v<versión>/book.epub`; se guardan los 4 últimos). Tiene que ser EPUB: con un HTML suelto el motor no tiene contenedor y no puede abrir las imágenes (salen cuadrados blancos). Las xpaths quedan como `/body/DocFragment/body/html/body/p[n]/…`. Cada imagen que ocupa una línea propia del libro va en su propia página (`page-break-before/after`), y el plugin dibuja esas páginas él mismo (`drawPicturePage`, índice `pictures.idx` creado al empaquetar; `img/` se conserva): imagen ajustada entre los márgenes y centrada, como ReadEra. Al exportar una versión nueva de un libro se borran las anteriores. Cada bloque es un `<p>` hijo de `body` (los títulos son `<p class="h1">`, los capítulos empiezan con salto de página), así que la xpath del motor (`/html/body/p[n]/…`) da el bloque, y `blockParagraph` lo traduce al índice de párrafo de Yoru (el mismo que usa el lector WebView). La furigana del libro (`{base|lectura}` y 《》 de Aozora) se convierte en `<ruby>`.
- **Posición**: el progreso compartido del libro (capítulo/sección, párrafo, %) se guarda igual que en el lector WebView (`handleCharsUpdate` → `db.updateBookProgress`, con espera de 1,5 s porque reescribe toda la biblioteca). Además, la xpath exacta de la página se guarda en `localStorage` (`native-reader:position:<id>`) y se usa al reabrir si el párrafo guardado no ha cambiado (si se leyó en otro lector, se abre en ese párrafo).
- **Diccionario** (fase 2): tras cada página el plugin pide al motor las cajas de sus letras (`CMD_REQ_PAGE_TEXT`, coordenadas 0..1 ya rotadas en vertical). Un toque sobre una letra (gana sobre las zonas de pasar página, como en el lector web) pide su xpath (`CMD_REQ_XPATH_BY_RECT_ID`, índice de la letra en esa lista) y envía el evento `word`. `NativeReaderHost` pasa la xpath a posición en el texto del bloque sin furigana (`xpathToTextOffset`), dibuja ese párrafo fuera de pantalla con el mismo tokenizador del lector web (`renderLineWords`; con Jiten activo espera su análisis, `prepareLineWords`) y abre el popup de siempre con `triggerWordLookup(span, rect)`. Con el popup abierto (`setPopupOpen`) un toque en la página solo lo cierra. La palabra buscada se resalta en la página (`highlight`: letras antes/después de la tocada, sin furigana, una caja por línea, color de acento al 35 %); se quita al cerrar el popup o pasar página.
- **Ajustes**: tamaño de letra (px CSS × densidad), interlineado (el 100 del motor ≈ 1,2 em; máx. 200), márgenes (los % del lector + barras del sistema; en vertical el motor rota la página, de ahí el cambio de lados en `layoutConfig`), colores del tema, alineación, fuente (Noto Serif/Sans CJK JP del sistema según la fuente elegida). Al cambiarlos se rehace la maquetación y se conserva la página.

## Pendiente (fases 2-4)

### Furigana incompleta en libros ya importados

El importador EPUB/HTML conservaba solo el primer `<rt>` de cada `<ruby>`. Por ejemplo,
`<ruby>舞<rt>ぶ</rt>台<rt>たい</rt></ruby>` quedaba guardado como `{舞台|ぶ}`.
Ahora guarda todas las lecturas en orden (`{舞台|ぶたい}`); el fallo afectaba a ambos lectores.
Los libros guardados necesitan reimportarse desde el archivo original, porque las lecturas
descartadas no se pueden recuperar de la base de datos.

La reimportación actualiza las lecturas del libro existente solo si coinciden los capítulos,
su texto base, saltos de línea, títulos e imágenes. Conserva el ID, progreso, marcadores,
subrayados y demás metadatos. Una edición con texto distinto sigue sin reemplazar el libro.
El exportado nativo cambia de clave al cambiar las lecturas y se vuelve a generar.

Prueba local de importación, persistencia y exportación nativa (Chromium aislado, sin usar el perfil real):
`node build/verify-import-readings.cjs [ruta-al-libro.epub]`.
Esta prueba comprueba los datos y el HTML; no sustituye la comprobación visual en Android.

Funciones del lector web y su estado en el nativo (20 oct):

- Funcionan igual (son paneles del WebView sobre la página): barra superior y menú ⋮, ajustes del libro, índice, búsqueda (salta al párrafo), marcadores e índice de subrayados (salto), galería de imágenes, ir a posición, barra de páginas, medidor de velocidad y sesión de lectura, estadísticas de caracteres.
- Hechas para el nativo: colores de estado de palabra y furigana en palabras nuevas (`nativeReaderWords.ts`, 1.4.2: el análisis en palabras con Kuromoji se hace una vez por libro y se guarda en IndexedDB `yoru-native-reader`, porque no depende de los estados; marcar los estados es solo construir texto, así que el libro se abre ya con colores (la primera vez muestra «Preparando el libro…» con progreso) y un cambio de estado recarga en milisegundos al mismo carácter. Las líneas que Jiten ha analizado usan `renderLineWords`. Cada palabra queda como `<span class="w-<estado>">`; el CSS sale de los estilos de palabra de los ajustes, con colores mezclados con el fondo porque el motor no tiene transparencias, y va en `style.css` del EPUB, leído sin filtrar con `CONFIG_ERA_EMBEDDED_STYLES=5`. **Subrayados:** el motor solo dibuja subrayados de 1-2 px, del color del texto y cruzando la furigana, así que no se usan: cada estado subrayado lleva un fondo que difiere del de la página en 1-5 del canal azul (invisible) y el plugin reconoce esas palabras en los píxeles de cada página (con las cajas de letras de `PAGE_TEXT`) y dibuja la línea con su color, grosor y estilo (sólido, discontinuo, punteado, ondulado): debajo en horizontal, a la izquierda en vertical. La posición guardada incluye el bloque y el carácter (`offset`), así que se recupera aunque cambie el marcado); diccionario al tocar una palabra con resaltado; imágenes (cada ilustración en su página, logos dentro del texto); lectura en voz alta (lee desde la página en pantalla y la página sigue al párrafo que se lee; el resaltado de la frase no se ve en la página nativa); teclas de volumen; brillo (velo negro sobre la página); mostrar/ocultar furigana (exportación aparte del libro, clave `…n`).
- 1.4.5: **líneas cortadas abajo en vertical** (la furigana más ancha que su palabra hace que el motor estire la línea más de lo que midió, y el margen de la página corta las últimas letras): cada bloque lleva `padding-right: 1em` (`LINE_END_RESERVE_EM`, export v8) y el plugin quita lo mismo al margen del final de línea (`lineEndReserve`), así las líneas acaban donde antes pero sobra sitio. **Resaltado de la voz**: `highlightRange` recibe el texto de la frase y la busca entre las letras de la página (la aparición más cercana a la posición contada; si la corta la página, la parte visible); contar bloques y letras se desviaba una línea con bloques vacíos o furigana mal reconocida (ahora la letra típica es la mediana). **Ocultar imágenes (spoilers)**: ajuste `hideImages`; las páginas de imagen se dibujan difuminadas con un aviso y se descubren al tocarlas (por libro, mientras la app sigue abierta); en el lector web, `img.yoru-book-img` con `filter: blur`.
- 1.4.6: **la barra de voz ya no tapa el final de las columnas** (QA-20261023-05): mientras está abierta, `bottomReserve` (CSS px, los que mide `ReadAloudBar` desde abajo hasta su borde en la posición baja) sube el margen inferior de la página; al cerrarla se rehace con el margen normal. Son dos relayouts (abrir y cerrar) en el mismo sitio, no uno por cada vez que la barra se oculta.
- Faltan:
  1. Selección de texto (pulsación larga): subrayar, notas, crear marcadores, copiar, Anki desde una selección. Los subrayados guardados tampoco se pintan en la página nativa.
  4. Grosor de letra y fuentes de la app (KleeOne, Shippori Mincho); modo «kindle» de zonas de toque; desplazamiento continuo (el nativo solo pagina).
  5. Detalles del motor: huecos raros al justificar y la raya ―― horizontal en vertical.

## Compilar el motor

Solo hace falta para cambiar o actualizar el motor (el binario está en el repo):

```
powershell -ExecutionPolicy Bypass -File mobile\scripts\build-reader-engine.ps1
```

El script instala el NDK 20.1.5948944 en el SDK de compilación de Yoru si falta, clona el código en `%LOCALAPPDATA%\Temp\ore\src` (ruta corta: ndk-build falla con rutas largas), lo fija al commit `664251abd5584b97b5c6941a3ef5e8856d2c0efc` de https://github.com/champignoom/OpenReadEra (copia de OpenReadEra 21.12.11; el código oficial está en https://readera.org/open-readera), compila el objetivo `eraepub` con `APP_ABI=arm64-v8a APP_PLATFORM=android-24 APP_STL=c++_static APP_CFLAGS="-no-integrated-as -w" APP_CPPFLAGS="-include cmath"` y copia el binario sin símbolos. No se modifica el código del motor.

## Licencia

El motor es GPL-2.0, por eso Yoru Reader pasó de MIT a GPL-2.0-or-later (ver `LICENSE` y el README). Quien distribuya el APK debe poder ofrecer el código del motor: el enlace al commit de arriba y este documento cumplen ese papel; si la copia de champignoom desapareciera, conviene tener un fork propio (p. ej. `Zams0524/OpenReadEra`).
