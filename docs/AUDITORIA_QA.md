# Auditoría QA de Yoru Reader (Android, con teléfono conectado)

Esta auditoría **solo busca errores**. No es una demo ni una revisión de diseño: cada paso intenta romper algo
(cierres, pantallas negras, botones que no responden, datos que no se guardan, textos `undefined`, errores en logcat)
y deja evidencia (captura + logcat) de lo que encuentre. Después de la prueba, los bugs encontrados se arreglan.

La herramienta es `mobile/qa/auditoria.mjs` (Node, sin dependencias). Lee la checklist de **este mismo archivo**:
cada línea `- [ ] **ID** ...` de la sección 6 es un paso del modo guiado, así que para añadir o cambiar una prueba
basta con editar aquí.

---

## 1. Cuándo se lanza

Se lanza **cada vez que se juntan muchos cambios**, en concreto:

1. **Antes de abrir el PR de una rama de integración** (`nix/integracion-*`) o de un PR de versión (cuando sube
   `versionCode`/`versionName` en `android/app/build.gradle`). Es obligatoria: el PR no se pide fusionar a zams sin un
   informe de auditoría sin bugs S1/S2 abiertos.
2. Cuando se han fusionado **3 o más ramas `nix/*`** en una integración, aunque aún no haya versión nueva.
3. Antes de publicar una **OTA** que cambie el lector, el SRS, la sincronización o la carga de libros.
4. Para un arreglo pequeño y aislado basta con los pasos de la pantalla afectada (auditoría parcial, ver 5.4).

La lanza el hilo de auditoría que Nix asigne. Nix le asigna también el teléfono.

## 2. Reglas del teléfono (no negociables)

- Solo el teléfono que Nix asigne, siempre con `adb -s <serial>`. La herramienta exige `--serial` y lo añade a todo.
- Solo `adb install -r` con el keystore de Yoru (`android/keystore/yoru-reader-debug.keystore`, lo usa
  `build-apk.ps1`). El `versionCode` del APK debe ser **mayor** que el instalado (la herramienta lo comprueba).
- **Nunca** desinstalar, `pm clear`, borrar archivos de la app ni datos del usuario. La herramienta rechaza
  `uninstall`, `pm clear`, `rm`, `monkey` y `install` sin `-r`.
- **No calificar tarjetas de mazos reales** (en particular el mazo «xd»). Las pruebas del SRS se hacen solo en un
  mazo de prueba llamado `QA` creado por la auditoría.
- **No activar la sincronización automática con Drive.** Las pruebas de Drive que escriben en la nube solo se hacen
  con el ok de Nix (ver SYN).
- Si el teléfono tiene una OTA guardada (`files/web-bundles`), un APK de la misma versión sigue cargando la OTA:
  comprobarlo en ARR-03 antes de dar por buena la build.
- Los libros que importe la auditoría llevan el prefijo `QA-` en el título o archivo. Solo esos se pueden mover o
  borrar en las pruebas, y borrarlos requiere el ok de Nix.

## 3. Severidad

| Nivel | Qué es | ¿Bloquea el PR? |
|---|---|---|
| **S1** | Cierre, ANR, pérdida o corrupción de datos (progreso, tarjetas, biblioteca), pantalla negra permanente | Sí |
| **S2** | Función rota o resultado incorrecto (botón sin efecto, popup no abre, TTS no avanza, sync falla) | Sí |
| **S3** | Funciona pero mal: lentitud notable, salto visual, texto cortado, error repetido en logcat | No, pero se arregla en la misma ronda si es pequeño |
| **S4** | Cosmético | No; se anota |

## 4. Preparación

1. **Build**: compilar el APK de la rama a auditar con `build-apk.ps1` subiendo antes `versionCode` por encima del
   instalado (preguntar a Nix el número; no reutilizar uno ya usado en otro hilo).
2. **Teléfono**: pedirlo a Nix, conectarlo por USB y comprobar `adb devices`. Pantalla desbloqueada, brillo fijo, sin
   ahorro de batería.
3. **Material de prueba** (en el teléfono, carpeta Descargas o la que use el importador):
   - `QA-vertical.epub`: japonés vertical con furigana e imágenes (sirve cualquier novela con ruby).
   - `QA-horizontal.epub`: japonés horizontal.
   - `QA-largo.epub`: un libro de más de 500 páginas (rendimiento).
   - `QA-doc.pdf`, `QA-texto.txt`, `QA-subs.srt`: un archivo de cada formato soportado.
4. Mazo de prueba `QA` en el SRS (lo crea SRS-03 si no existe).

## 5. Cómo se corre

La herramienta se ejecuta en el PC con el teléfono conectado (desde la carpeta del repo). Busca `adb` en
`YORU_ADB`, en el `PATH` o en el SDK que usa `build-apk.ps1`.

### 5.1 Inicio

```powershell
node mobile/qa/auditoria.mjs inicio --serial 324751061679 [--apk ruta\al.apk] [--etiqueta integracion-1.4.5]
```

Hace: comprueba el teléfono y la versión instalada, instala el APK con `install -r` si se pasa `--apk` (rechaza un
`versionCode` igual o menor), mira si hay una OTA guardada, limpia el búfer de logcat, empieza a grabar logcat en
segundo plano, cierra y abre la app midiendo el arranque en frío (`am start -W`) y guarda la primera captura.
Todo va a `qa-runs/<fecha>-<etiqueta>/` (ignorado por git).

### 5.2 Pasos

Modo guiado (una persona o un agente con el teléfono delante):

```powershell
node mobile/qa/auditoria.mjs guiado [--desde LEC-01] [--solo LEC,TTS]
```

Muestra cada paso de la sección 6. En cada uno: Intro = pasó (captura), `b` = bug (pide severidad y descripción,
hace captura), `n` = nota, `s` = saltar, `q` = salir (se puede retomar con `--desde`).

Modo por comandos (para un agente que maneja el teléfono con `adb shell input`):

```powershell
node mobile/qa/auditoria.mjs paso LEC-03 [--nota "abre en 2,1 s"]
node mobile/qa/auditoria.mjs paso LEC-05 --bug "el subrayado se corta en 見る" --sev S2
```

Cada paso guarda: captura PNG, PID de la app (si cambia entre pasos, la app se cerró), memoria PSS y la posición en
el logcat, para atribuir cada error al paso en que apareció.

### 5.3 Fin e informe

```powershell
node mobile/qa/auditoria.mjs fin
```

Para el logcat, recoge el informe de cierre nativo (`files/yoru-last-crash.txt`, vía `run-as`, solo lectura), los
errores de JavaScript guardados en el WebView (`yoru_runtime_issues`) y genera `informe.md` en la carpeta de la
ejecución. `node mobile/qa/auditoria.mjs informe [carpeta]` lo regenera sin tocar el teléfono.

El informe incluye: datos del teléfono y build, arranque en frío, aperturas del lector nativo con su tiempo, cierres
(`FATAL EXCEPTION`, ANR, reinicios entre pasos), errores agrupados por tipo con el paso en que aparecieron, patrones
conocidos (ver 7), memoria por paso y la tabla de bugs marcados.

### 5.4 Auditoría parcial

`guiado --solo LEC,TTS` recorre solo esas pantallas. Siempre se incluyen además ARR-01 y GEN-01.

## 6. Checklist (solo búsqueda de errores)

Formato: `- [ ] **ID** Qué hacer → qué sería un error`. El modo guiado lee estas líneas.

### ARR · Arranque, actualización y navegación

- [ ] **ARR-01** Arranque en frío (lo mide `inicio`) → error si pasa de 4 s, hay pantalla blanca/negra más de 1 s o aparece la pantalla roja de ErrorBoundary.
- [ ] **ARR-02** Ajustes › Acerca de: comprobar versión y versionCode → error si no coinciden con la build instalada.
- [ ] **ARR-03** Revisar en el informe si hay OTA guardada (`files/web-bundles`) → error si la interfaz que se ve no es la de la build auditada.
- [ ] **ARR-04** Ir a segundo plano 60 s y volver → error si se pierde la pestaña, el libro abierto o la posición.
- [ ] **ARR-05** Botón atrás del sistema desde cada pestaña, ajuste, modal y menú abierto → error si no cierra lo de arriba primero, si sale de la app sin querer o si queda una capa fantasma.
- [ ] **ARR-06** Girar el teléfono en biblioteca y en el lector (si la rotación está permitida) → error si se rompe la maquetación o se reinicia el libro.

### BIB · Biblioteca y carga de libros

- [ ] **BIB-01** Importar `QA-vertical.epub` → error si tarda más de 10 s, no aparece la portada o el título sale mal.
- [ ] **BIB-02** Importar `QA-horizontal.epub`, `QA-doc.pdf`, `QA-texto.txt` y `QA-subs.srt` → error si alguno falla sin mensaje claro.
- [ ] **BIB-03** Importar otra vez el mismo archivo → error si se duplica sin avisar o se pierde el progreso del existente.
- [ ] **BIB-04** Menú ⋮ de un libro QA: probar cada opción (excepto borrar) → error si alguna no hace nada, el menú queda tapado por la barra o no se cierra.
- [ ] **BIB-05** Estado sobre la portada (leyendo/terminado/etc.) → error si no se guarda tras reiniciar la app.
- [ ] **BIB-06** Buscar, ordenar y filtrar la biblioteca → error si los resultados son incorrectos o la lista salta.
- [ ] **BIB-07** «Seleccionar libros» desde el ⋮ de la biblioteca, seleccionar varios y cancelar → error si queda el modo selección pegado.
- [ ] **BIB-08** Biblioteca con muchos libros: desplazarse rápido arriba y abajo → error si hay tirones fuertes, portadas en blanco permanentes o saltos.

### LEC · Lector

- [ ] **LEC-01** Abrir `QA-vertical.epub` → error si tarda más de 3 s (ver «opened … in … ms» en el informe) o el motor se abre 2 o más veces seguidas.
- [ ] **LEC-02** Comprobar texto vertical, furigana e imágenes → error si falta furigana, una imagen no carga («Unable to open asset URL») o hay solapes.
- [ ] **LEC-03** Pasar 20 páginas rápido tocando y otras 20 deslizando, adelante y atrás → error si sale una página negra, se salta páginas o se cuelga.
- [ ] **LEC-04** Subrayado de estados de palabra en vertical → error si una línea se corta a mitad de palabra o pisa el furigana de la columna vecina.
- [ ] **LEC-05** Tocar una palabra → error si el popup del diccionario no abre, abre otra palabra, sale vacío o no se puede cerrar.
- [ ] **LEC-06** Desde el popup, añadir la palabra al mazo `QA` → error si no se añade, se añade a otro mazo o sale un aviso con `undefined`.
- [ ] **LEC-07** Cambiar el estado de una palabra desde el popup → error si el subrayado no cambia o el libro se recarga entero varias veces.
- [ ] **LEC-08** Ajustes del lector: tamaño, fuente, interlineado, márgenes, vertical/horizontal, ocultar imágenes → error si alguno no se aplica, pierde la posición o no persiste al reabrir.
- [ ] **LEC-09** Índice, marcadores y notas del panel lateral → error si un enlace lleva a otro sitio o no se guarda un marcador.
- [ ] **LEC-10** Subrayar/resaltar texto y añadir una nota → error si se pierde al salir y volver a entrar.
- [ ] **LEC-11** Búsqueda dentro del libro → error si no encuentra un texto que está o no salta a él.
- [ ] **LEC-12** Barra de página: arrastrar a 50 % y volver → error si el número de página no coincide o la página se queda en blanco.
- [ ] **LEC-13** Salir del libro, cerrar la app (deslizar en recientes) y reabrir el libro → error si no vuelve a la misma página.
- [ ] **LEC-14** Abrir `QA-largo.epub` y avanzar 30 páginas → error si se calienta/lagea mucho o la memoria PSS sube más de 300 MB.
- [ ] **LEC-15** Abrir el PDF, el TXT y el SRT importados → error si alguno no abre o el popup no funciona en ellos.

### TTS · Lectura en voz

- [ ] **TTS-01** Iniciar lectura en voz en `QA-vertical.epub` → error si no suena, tarda más de 3 s o no aparece la barra.
- [ ] **TTS-02** Seguir 2 minutos → error si la guía amarilla no sigue a la oración, salta el primer carácter o la página no avanza con la voz.
- [ ] **TTS-03** Pausar, reanudar, siguiente/anterior oración → error si se duplica la voz o pierde la posición.
- [ ] **TTS-04** Cambiar voz y velocidad durante la lectura → error si se detiene sin aviso o no aplica el cambio.
- [ ] **TTS-05** Ocultar/mostrar la barra de voz → error si queda un hueco, se tapa contenido o la barra no vuelve.
- [ ] **TTS-06** Salir del libro con la voz activa → error si sigue sonando o al volver el resaltado queda pegado.
- [ ] **TTS-07** Apagar la pantalla 30 s con la voz activa y volver → error si la app se cierra o la voz se corta sin poder reanudar.

### SRS · Repaso de tarjetas (solo mazo QA)

- [ ] **SRS-01** Abrir la pestaña SRS → error si el calendario de actividad sale vacío con historial, con fechas erróneas o `NaN`.
- [ ] **SRS-02** Lista de mazos → error si un contador no cuadra (nuevas/aprender/repasar) o un mazo no abre.
- [ ] **SRS-03** Crear el mazo `QA` (si no existe) y renombrarlo y volver a `QA` → error si falla o duplica.
- [ ] **SRS-04** Ajustes del mazo QA: pausa y límite diario → error si no se guardan o no afectan a la cola.
- [ ] **SRS-05** Repasar el mazo QA con frente «palabra», «oración» y «solo audio» → error si el frente no corresponde, el audio no suena o el reverso no se muestra.
- [ ] **SRS-06** Calificar tarjetas del mazo QA con los cuatro botones y deshacer → error si deshacer no restaura, los intervalos son absurdos o sale un aviso `undefined`.
- [ ] **SRS-07** Salir del repaso a mitad y volver → error si se pierde el progreso de la sesión o se repite una tarjeta ya calificada.
- [ ] **SRS-08** Estadísticas, notas e historial del SRS → error si alguna pestaña sale en blanco o con `NaN`.
- [ ] **SRS-09** Comprobar que el mazo «xd» no cambió (mismos contadores que al inicio) → error si cambió.

### VOC · Vocabulario y diccionarios

- [ ] **VOC-01** Abrir vocabulario/diccionarios → error si la lista de diccionarios instalados está vacía sin motivo o no abre.
- [ ] **VOC-02** Buscar una palabra (expresión, lectura y kanji) → error si no da resultados para una palabra común.

### EST · Estadísticas y progreso

- [ ] **EST-01** Abrir estadísticas tras haber leído en la auditoría → error si no suma los caracteres/tiempo leídos o salen `NaN`.
- [ ] **EST-02** Panel de progreso de un libro → error si el porcentaje no coincide con la página actual.

### AJU · Ajustes

- [ ] **AJU-01** Abrir y cerrar cada sección de ajustes → error si alguna sale en blanco, no se puede cerrar o el botón atrás no la cierra.
- [ ] **AJU-02** Cambiar 3 ajustes, reiniciar la app → error si no persisten.
- [ ] **AJU-03** Revisar la sección Google Drive → error si la sincronización automática aparece activada (desactivarla y anotarlo) o el estado de la sesión es incoherente.

### SYN · Sincronización con Google Drive (solo con ok de Nix)

- [ ] **SYN-01** Ver el estado de la cuenta (conectada o no) → error si muestra conectado sin cuenta o al revés.
- [ ] **SYN-02** Con ok de Nix: sincronización manual una vez → error si reemplaza la biblioteca en vez de combinar, pierde progreso o tarjetas, o falla sin mensaje.
- [ ] **SYN-03** Tras SYN-02, verificar el progreso de `QA-vertical.epub` y los contadores de mazos → error si cambiaron hacia atrás.

### GEN · General (en todas las pantallas)

- [ ] **GEN-01** Buscar textos `undefined`, `NaN`, `null`, `[object Object]` o claves sin traducir en todas las capturas → error si aparece alguno.
- [ ] **GEN-02** Barras del sistema y zonas seguras → error si algún botón queda debajo de la barra de navegación o de la cámara.
- [ ] **GEN-03** Elementos táctiles → error si algún botón necesita varios toques o responde a toques fuera de él.
- [ ] **GEN-04** Revisar el informe: errores de logcat de la app → cada error nuevo y repetido es al menos un bug S3.

## 7. Qué busca la herramienta en logcat

Además de todo lo que la app escribe en nivel `E`/`W`, el informe resalta:

| Patrón | Qué indica |
|---|---|
| `FATAL EXCEPTION` / `YoruReaderCrash` | Cierre nativo (S1) |
| `ANR in com.yorureader.app` | La app se colgó (S1) |
| PID distinto entre pasos | La app murió y se reabrió (S1 si no lo hizo el auditor) |
| `YoruNativeReader … open failed` / `engine failed` | El motor del lector falló (S1/S2) |
| `opened N pages in X ms` | Tiempo de apertura del libro; varias seguidas = recargas encadenadas (S3) |
| `Unable to open asset URL` | Imagen o recurso que el WebView no encuentra (S3) |
| `Cleartext HTTP traffic … not permitted` | Petición HTTP bloqueada (S3) |
| `already registered` | Plugin registrado dos veces (S4) |
| `Skipped N frames` (N ≥ 30) | Tirón en el hilo principal (S3) |
| `OutOfMemoryError` | Memoria (S1) |
| `Capacitor/Console` nivel E, `Uncaught` | Error de JavaScript (S2/S3) |
| `YoruWebUpdater` W/E | La OTA no arrancó y se volvió a la interna (S2) |

## 8. Dónde se guardan los hallazgos

- **Evidencia completa** (capturas, logcat, `pasos.jsonl`, `informe.md`): `qa-runs/<fecha>-<etiqueta>/` en el PC
  (ignorado por git). Se copia también a la carpeta del proyecto `auditoria-qa/<fecha>-<etiqueta>/` para que otros
  hilos la vean.
- **Informe que se versiona**: `docs/qa/informes/<fecha>-<etiqueta>.md`, copiado de `informe.md` y completado a mano
  con la causa raíz y el estado de cada bug. Va en la rama de la auditoría.
- **Cada bug** tiene un ID `QA-<AAAAMMDD>-<NN>` con: severidad, paso de la checklist, pasos para reproducir,
  evidencia (captura/logcat), causa raíz, rama del arreglo y estado (`abierto`, `arreglado`, `verificado`,
  `no se arregla: motivo`).
- El PR de integración enlaza el informe y no se pide fusionar con bugs S1/S2 en estado `abierto`.

## 9. Después de la prueba: arreglar

1. Ordenar los bugs por severidad. Para cada uno, buscar la causa raíz en el código (consultar antes el grafo de
   graphify) y no aplicar parches de síntoma.
2. Los arreglos van en una rama `nix/qa-arreglos-<fecha>` (o en la misma rama de integración si Nix lo prefiere),
   un commit por bug con el ID en el mensaje: `fix(lector): ... (QA-20261023-03)`.
3. Compilar una build nueva (otro `versionCode` mayor), instalar con `install -r` y **repetir los pasos afectados**
   más ARR-01 y GEN-01 (`guiado --solo ...`). Marcar cada bug como `verificado` con la nueva evidencia.
4. Si un arreglo es grande o cambia el comportamiento que zams pidió, se le pregunta a Nix antes.
5. Actualizar `docs/qa/informes/...` y abrir/actualizar el PR en borrador.

## 10. Plantilla de bug en el informe

```markdown
### QA-20261023-01 · S2 · LEC-05 · El popup no abre en palabras con furigana
- Pasos: abrir QA-vertical.epub, página 12, tocar 見る (columna 3).
- Esperado: popup con 見る. Obtenido: no pasa nada.
- Evidencia: capturas/LEC-05.png, logcat 06:31:12 `Capacitor/Console E ... TypeError`.
- Causa raíz: ...
- Arreglo: rama nix/qa-arreglos-20261023, commit abc1234.
- Estado: arreglado → verificado en build 153.
```
