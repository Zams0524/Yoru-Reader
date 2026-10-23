# Informe de auditoría QA · Escritorio (PC) · tras la 1.4.5 (23-10-2026)

Auditoría equivalente a la del teléfono ([AUDITORIA_QA.md](../../AUDITORIA_QA.md)), adaptada a PC: sin adb, con la
app web y con Electron de verdad. Busca errores en la versión de escritorio después de fusionar la integración 1.4.5
(PR #17) y comprueba si los arreglos del teléfono llegaron al PC.

- Código auditado: `main` @ `d2ae6b9` (escritorio: OTA 1.2.8.47, la que publicó el workflow al fusionar el PR #17).
- Arreglos: rama `nix/pc-1.4.5`.
- Entorno: `vite build` servido en local y abierto con Chromium (Playwright) a 1440×900, y Electron 43 con
  `backend/electron-main.cjs` (Playwright `_electron`, Xvfb, `--user-data-dir` temporal, manifest de
  actualizaciones apuntando a `127.0.0.1:9`). Para comparar, la misma prueba se pasó a una build de `main` y a otra
  de la rama.
- Material: `QA-vertical.epub` (vertical, furigana, imagen), `QA-horizontal.epub`, `QA-largo.epub` (60 capítulos),
  `QA-texto.txt`, `QA-subs.srt`. Sin PDF. Mazo de prueba `QA`. Perfil nuevo, sin datos reales.

## ¿Recibió el PC los cambios de la 1.4.5?

Sí, casi todos. El escritorio usa el mismo `frontend/` que Android, y cada push a `main` publica la OTA de escritorio
(`dist.zip`). En el PR #17 no hay ningún cambio de `frontend/` limitado a Android: rediseño del SRS, ajustes por mazo,
frente de la tarjeta, búsqueda de ancho completo, voz que no se salta la oración, idioma del índice y del popup,
libro terminado que no vuelve a «leyendo», barra de páginas que no salta con un toque, etc.

No llegan los arreglos del lector nativo (Java), porque en PC el libro lo dibuja el lector web (`ReaderEngine`):

| Arreglo en Android | ¿Pasa en PC? | Qué se hizo |
|---|---|---|
| QA-20261023-03: cambiar el tamaño de letra retrocede páginas (`8319037`) | Sí, y también al cambiar el tamaño de la ventana, el interlineado o los márgenes | Adaptado: QA-PC-20261023-01 |
| QA-20261023-23: reabrir vuelve una página atrás (`2603bb3`) | Sí, cuando el párrafo guardado empezaba en la página anterior | Adaptado: QA-PC-20261023-02 |
| QA-20261023-04: el teclado de búsqueda rehace las páginas (`a88e9e3`) | No (sin teclado en pantalla); el redimensionado de ventana es el caso de PC | Cubierto por QA-PC-01 |
| Líneas cortadas en vertical (`fe6c9ba`) | No: el lector web usa CSS | Nada |

## Resumen

| | |
|---|---|
| Bugs S1/S2 abiertos | QA-PC-20261023-06 (JMdict en inglés recortado): necesita decisión |
| Arreglados y verificados | QA-PC-01, 02, 03, 04, 05 |
| Abiertos S3/S4 | QA-PC-07 (= QA-20261023-05 en PC), QA-PC-08, QA-PC-09 |
| Sin poder probar aquí | Voz real (el contenedor no tiene voces), Google Drive, instalador NSIS y SmartScreen |

## Bugs

| ID | Sev | Paso | Qué | Estado |
|---|---|---|---|---|
| QA-PC-20261023-01 | S2 | LEC-08 | Cambiar el tamaño de letra, el interlineado, los márgenes o el tamaño de la ventana mostraba otro texto: el lector guardaba el número de página. Prueba A/B (primer carácter de la página, letra +6, ventana 1000×700): en `main` se pierde; en la rama sigue en pantalla en libros vertical y horizontal. | **Arreglado** en `nix/pc-1.4.5` (`ReaderEngine`: ancla de lectura párrafo + carácter, se restaura tras cada cambio de maquetación). |
| QA-PC-20261023-02 | S3 | LEC-13 | Al volver a abrir el libro, si el párrafo guardado empezaba en la página anterior, se abría una página antes (`QA-horizontal`, 118→103 en `main`). | **Arreglado**: se guarda también el carácter y se usa al reabrir; en la rama 118→118 y otros 4 casos iguales. |
| QA-PC-20261023-03 | S2 | LEC-05 | Durante el primer minuto (se instala el diccionario de pitch accent) la búsqueda local pasaba de 1,5 s y el popup decía «No se encontró definición» aunque la palabra estaba. Tocar otra vez la misma palabra no volvía a buscar. | **Arreglado**: si tampoco hay resultado online se espera a la búsqueda local; la misma palabra se vuelve a buscar si no se encontró. Rama: 4 de 4 con definición; `main`: 1 de 4 vacía. |
| QA-PC-20261023-04 | S2 | ARR-01 | Elegir «Español» en la bienvenida dejaba el JMdict en inglés: el primer arranque lo instala antes de elegir idioma y la guía decía «Diccionario listo». | **Arreglado**: la guía solo da por listo un diccionario del idioma elegido y ofrece instalar el de español. Verificado: 名前 → «nombre». |
| QA-PC-20261023-05 | S3 | GEN-04 | Presencia de Discord rota desde siempre: `net` es el de Electron y no tiene `createConnection`; el primer intento lanzaba `TypeError` y los siguientes daban «Discord connection timeout». | **Arreglado** en `backend/electron-main.cjs` (usa el `net` de Node). Verificado con un servidor IPC falso: READY y `SET_ACTIVITY` («Leyendo: QA-largo»). Cambia `backend/`, así que el workflow recompilará los instaladores. |
| QA-PC-20261023-06 | S2 | VOC-02 | El `public/dictionaries/JMdict_english.zip` incluido está recortado: 100 000 entradas en 10 bancos (el JMdict completo tiene muchas más). Faltan palabras comunes: 名前, 猫, 天気, 日本語, 本 (ほん). Afecta también a Android, y es el diccionario por defecto (la app arranca en inglés). | **Abierto**: hay que cambiar el archivo por el completo de yomidevs/jmdict-yomitan (más peso en la OTA y el APK). Decisión para Nix/zams. |
| QA-PC-20261023-07 | S3 | TTS-05 | La barra de voz tapa el final de las columnas mientras está en pausa o con las barras del lector visibles (con la voz sonando se oculta a los 4 s). Es QA-20261023-05 en PC. | **Abierto**, se deja al hilo del lector, que tiene QA-05 pendiente. |
| QA-PC-20261023-08 | S4 | GEN-01 | En el popup con la interfaz en español quedan «Blacklist» y «Deck +» en inglés. | Abierto. |
| QA-PC-20261023-09 | S4 | ARR-01 | Electron avisa de `webSecurity` desactivado, `allowRunningInsecureContent` y sin CSP (solo sale sin empaquetar). | Anotado, no se toca. |

## Pasos que pasaron sin errores

- **ARR**: arranque y guía de bienvenida; Electron abre `dist/index.html`, carga la extensión de lectura y expone
  `electronAPI` (parseo, estados de palabras, SRS, voz, Anki, Discord, actualizador). Reiniciar Electron mantiene la
  biblioteca y la posición (`QA-largo` 35→35 y 61→61).
- **BIB**: importar EPUB, TXT y SRT (5 a la vez), reimportar sin duplicar, estados de la portada.
- **LEC**: abrir en ~2,4 s, pasar páginas con flechas, AvPág y rueda, popup del diccionario, añadir al mazo `QA`
  sin avisos `undefined`, búsqueda de «ABC1» en texto de ancho completo (76 resultados) y salto al resultado, índice,
  ocultar imágenes (desenfoca y vuelve), reabrir en la misma página.
- **SRS**: crear el mazo `QA`, 5 tarjetas desde el lector, repaso con frente «palabra», calificar con 1–4, deshacer
  con Z y Ctrl+Z, calendario con hoy en viernes.
- **EST / AJU / GEN-01**: pestañas del SRS (Tarjetas, Estadísticas, Historial, Ajustes), Estadísticas y Ajustes sin
  `undefined`, `NaN`, `null` ni `[object Object]`.

## Riesgos y avisos

- El contenedor no tiene voces japonesas ni acceso a Google: la voz (TTS-01…07) y Drive (SYN) hay que mirarlos en el PC
  de zams.
- Las fuentes del CDN de Migaku no cargan en el contenedor; las capturas usan IPAGothic.
- `QA-PC-06` y `QA-PC-07` no se arreglan en esta rama.
