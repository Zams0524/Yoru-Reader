# Coherencia de Yoru Reader — inventario pantalla por pantalla

30 oct 2026 · rama `nix/catalogo-servidor`, commit `a3f1934`.
Esto es **solo el inventario**. No he arreglado nada: el orden lo decide zams.

---

## Cómo he mirado, y qué no he podido mirar

Levanté la app de verdad (`vite`, `http://localhost:5175`) en un perfil nuevo, en
español, e importé un EPUB de prueba (`qa-runs/apertura/book-before.epub`). Recorrí
**todas** las secciones de la barra lateral, la ficha del libro, el lector y los quince
apartados de Ajustes. Lo que digo de aspecto está medido sobre el código y las hojas de
estilo, no a ojo.

**Lo que no he podido ver funcionando, y por eso no lo juzgo:**

| No visto | Por qué |
| --- | --- |
| Kavita con contenido | el perfil de prueba no tiene credenciales; solo vi el estado vacío |
| Audiolibros con contenido, ficha de audiolibro, reproductor | lo mismo |
| El lector con diccionarios | sin diccionario instalado **todas** las palabras salen marcadas como desconocidas, así que su color y su tipografía no se pueden juzgar desde aquí |
| Los menús del lector (⋮, ajustes, capítulos) | la barra del lector se auto-oculta y no la pude sacar en el navegador |
| Android | no he tocado ningún teléfono |

Para las pantallas con datos reales me apoyo además en las capturas de zams del 29 oct
que hay en esta misma carpeta (`20-inicio-1.png`, `10-estadisticas.png`, `07-lector.png`).
Donde eso es lo único que tengo, lo digo.

---

## Lo que explica casi todo lo que viene después

La app son **dos interfaces pegadas**, y se nota:

- **La concha nueva** (`frontend/components/home/*`, `yoru-shell.css`): cabecera, barra
  lateral, Inicio, fichas, listas, estadísticas, vistas de servidor.
  **Cero colores a pelo.** Todo con los tokens de Yoru.
- **La app vieja** (`Library.tsx`, `Reader.tsx`, `VocabularyModal.tsx`,
  `SettingsModal.tsx`): Catálogo, lector, vocabulario, Ajustes, SRS.
  **266 colores escritos a mano**, repartidos así:

| Fichero | Colores a pelo |
| --- | --- |
| `Library.tsx` | 140 |
| `Reader.tsx` | 99 |
| `VocabularyModal.tsx` | 39 |
| `SettingsModal.tsx` | 28 |
| `WelcomeScreen.tsx` | 26 |
| `components/home/*` (toda la concha nueva) | **0** |

Y los radios: entre `index.css`, `yoru-design-system.css` y `yoru-shell.css` hay
**27 valores distintos de `border-radius`** (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 30, 34 y 999 px). **No existe ningún token de
radio.** `--shell-radius: 12px` existe, pero se usa en dos sitios.

Eso quiere decir que el deslizador de radio de esquinas del encargo 5 **no es un
deslizador: es crear el token primero y pasar 27 valores a él.** Es trabajo real, no un
control.

---

## 1 · Inicio

Es la pantalla que se abre y la que más carruseles tiene (hasta **once**: Continuar,
Añadidos recientemente, Continuar en el servidor, Audiolibros para ti, Series de libros,
Series de audiolibros, Libros aleatorios, Audiolibros aleatorios, Libros para ti, Series,
Descubre colecciones).

| | |
| --- | --- |
| **Aspecto** | Tokens de Yoru, limpio. **Dos pegas.** (a) La pestaña activa Inicio/Libros/Audiolibros se pinta **blanca**, no dorada: `.yoru-chip.active` usa `background: var(--text-main)` (`yoru-shell.css:335`). Es un token, pero el equivocado: el estado elegido de las pestañas principales no lleva la identidad de Yoru. Se ve en `20-inicio-1.png`. (b) **Cada carrusel arrastra su propia barra de desplazamiento** (`.yoru-rail-track { overflow-x: auto; scrollbar-width: thin }`, `yoru-shell.css:369`) y ninguno tiene flechas. Con once carruseles son once barras, más la de la página y la de la barra lateral. |
| **Funciona** | **Las pestañas Inicio/Libros/Audiolibros no navegan**: solo filtran los carruseles de esta misma pantalla (`HomeView.tsx`, estado `scope`). Y filtran a medias: con «Audiolibros» elegido siguen saliendo «Añadidos recientemente», «Libros para ti», «Series» y «Descubre colecciones», que son libros locales. **Las tarjetas de los seis carruseles de servidor no se pueden pulsar**: `ServerCard` y `SeriesStack` son `<div>`, no botones (`HomeServerSections.tsx:131` y `:155`). Parecen portadas pulsables y no hacen nada. **No hay menú de clic derecho** en ningún sitio de la app: `onContextMenu` no aparece ni una vez en todo el frontend. Queda además estado muerto: `filter`, `chips` y los tres chips Todo/Empezados/Sin abrir se calculan y se tiran con `void` (`HomeView.tsx:63-65`). |
| **Veredicto** | **Arreglar.** Es exactamente el encargo 2, y está confirmado punto por punto. Añado una cuarta cosa que zams no pidió y que es del mismo tamaño: **seis carruseles de portadas muertas**. |

---

## 2 · Lector

| | |
| --- | --- |
| **Aspecto** | **99 colores a pelo** en `Reader.tsx`: el segundo foco de deuda después de `Library.tsx`. Lo poco que vi en marcha (vertical japonés, modo continuo) se lee bien, pero **sin diccionarios todas las palabras salen coloreadas como desconocidas**, así que el color del texto no lo puedo juzgar y no lo juzgo. |
| **Funciona** | La barra del lector tiene sus siete botones bien etiquetados (Volver, Leer en voz alta, Buscar en el libro, Marcar esta página, Capítulos, Ajustes, Más opciones). El libro abrió, paginó y mostró el texto. **No pude abrir sus menús**, así que de lo que hay dentro no opino. En `YoruParserSettings.tsx:529` hay un `window.confirm()` del navegador. |
| **Veredicto** | **Pendiente de una pasada con diccionarios y con la barra a la vista.** Hoy solo puedo afirmar que la deuda de color es grande y que hay un `confirm()` nativo. |

---

## 3 · Biblioteca / Catálogo

Es `Library.tsx` (7 898 líneas) embebida dentro de la concha.

| | |
| --- | --- |
| **Aspecto** | **El peor de la app: 140 colores escritos a mano.** Chips, cajones, paneles y barras de selección con sus propios grises y sus propios radios. En marcha se ve bien, pero no comparte estilo con la concha: conviven los chips `yoru-chip` de la concha con los chips viejos del catálogo. Los dos iconos de arriba a la derecha (cuadrícula/lista y el menú) **no llevan etiqueta visible**, y detrás del segundo está casi todo lo que se puede hacer con los libros. |
| **Funciona** | **Las portadas no se pintan igual que en la concha, y esto es un fallo de verdad.** Un libro sin portada incrustada guarda en `book.cover` un **degradado CSS** (`linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)`). El catálogo viejo lo pinta como fondo y sale una portada de color; la concha nueva lo mete en `<img src=…>` (`primitives.tsx:7`), el navegador pide `http://localhost/linear-gradient(...)`, da 404 y **sale un rectángulo negro**. Comprobado en vivo: `naturalWidth: 0`. Afecta a Inicio, fichas, búsqueda, estantes y tarjetas de serie/autor/colección — a todo menos al propio catálogo viejo. |
| **Veredicto** | **Arreglar.** El rectángulo negro primero: es de una línea y se ve en seis pantallas. La deuda de color es otra conversación, más larga. |

---

## 4 · Audiolibros (servidor)

| | |
| --- | --- |
| **Aspecto** | Concha nueva, tokens limpios, cero colores a pelo. El estado vacío («Conecta tu servidor Audiobookshelf…» + «Configurar servidor») está bien escrito y lleva a Ajustes. Eso **sí** lo vi en marcha. |
| **Funciona** | Con contenido **no lo he visto**. Del código: es una cuadrícula que pide **48 elementos y nada más** (`getAudiobooks(id, 0, 48)`, `ServerViews.tsx`), pero el subtítulo imprime el **total**. Con los 500 de zams dirá «500 audiolibros» y enseñará 48, **sin paginación ni «cargar más»**. Y **no hay carrusel «Audiolibros aleatorios» en esta pantalla**: ese carrusel existe, pero vive en Inicio (`HomeServerSections.tsx:106`). |
| **Veredicto** | **Arreglar** — el encargo 4, confirmado: falta aquí. El tope de 48 lo apunto aparte, **sin comprobar contra su servidor**. |

---

## 5 · Reproductor y ficha de audiolibro

| | |
| --- | --- |
| **Aspecto** | **No visto.** Sin credenciales no se llega. Por código es concha nueva: cero colores a pelo. |
| **Funciona** | **No visto.** Por código tiene lo que hace falta: escuchar y pausar, barra de posición, ±15/30 s, velocidad, capítulos pulsables, vincular y desvincular un libro, y «Leer escuchando» cuando hay vínculo. Es lo que entregó la sesión anterior en `a3f1934`. |
| **Veredicto** | **Sin veredicto.** No lo he abierto, así que no lo juzgo. Si zams quiere, lo pruebo contra su Audiobookshelf. |

---

## 6 · Ajustes

Quince apartados en cuatro grupos, más tres tarjetas fijas arriba (estado del lector,
actualizaciones, guía). *(Nix hablaba de dieciocho: son 15 + 3.)*
Cuatro apartados son condicionales: Notificaciones, Atajos, Discord y Acerca de.

| Apartado | Aspecto | Funciona | Veredicto |
| --- | --- | --- | --- |
| **Apariencia e idioma** | Correcto, pero **titula en mayúsculas inglesas**: la barra dice «Apariencia e idioma» y el encabezado «Apariencia e Idioma». Igual con «Guía Rápida y Tutorial», «Buscar Actualizaciones» y «Actualizaciones del Sistema». En español es falta de ortografía, y choca con la concha nueva, que escribe en minúscula | Tema (Oscuro Yoru / Sepia Relajante / Claro Clásico) e idioma. **Los dos funcionan.** No hay esquema «Sistema», ni temas de acento, ni radio de esquinas, ni «Organizar inicio», ni interruptor de títulos bajo la portada | **Arreglar** — es el encargo 5 |
| **Estilo de texto** | La barra dice «Estilo de texto», el encabezado «Estilo de texto y Lector» | **Aquí hay un segundo tema**: «Tema del libro» (Blanco / Crema / Oscuro), «se aplica únicamente a la página de lectura». Es decir, **dos controles distintos llamados «tema», con vocabularios distintos** para lo mismo: Oscuro Yoru/Oscuro, Sepia/Crema, Claro Clásico/Blanco. Además, «Habilitar VPAL (Métrica de fuente proporcional)» es la única fila sin explicación de toda la sección | **Arreglar** — y es lo primero del encargo 5: los dos temas hay que reconciliarlos antes de añadir acentos |
| **Diccionarios** | Fichero propio, cero colores a pelo. Bien | No lo ejercité (no instalé ninguno) | Sin veredicto |
| **Atajos de teclado** | Viejo | `alert()` del navegador al restablecer (`Library.tsx:3238`) | Arreglar (menor) |
| **Estadísticas** | Viejo | No ejercitado | Sin veredicto |
| **Día de lectura** | Viejo | No ejercitado | Sin veredicto |
| **Vocabulario y Anki** | Viejo; 39 colores a pelo en el modal | **Botón muerto confirmado**: «Ayuda», en el pie del mapeador de campos de Anki, es `onClick={() => {}}` (`VocabularyModal.tsx:2374`). No hace absolutamente nada | **Arreglar** |
| **Sincronización** | Viejo | Varios `alert()` del navegador para errores de Google Drive (`Library.tsx:813, 819, 957`) | Arreglar (menor) |
| **Servidores multimedia** | **El más coherente de todo Ajustes.** Fichero propio, cero colores a pelo. Se ve en `10-estadisticas.png` | Probé el estado vacío y el camino desde Kavita y Audiolibros. Con servidor, no | **Bien** |
| **Discord** | Viejo | No ejercitado | Sin veredicto |
| **Copias de seguridad** | Viejo | Varios `alert()` (`SettingsModal.tsx:542-558`) | Arreglar (menor) |
| **Actualizaciones** | Viejo | No ejercitado (el perfil de prueba no tiene servidor de versiones) | Sin veredicto |
| **Acerca de / Diagnóstico** | Fichero propio (`AppAbout.tsx`), limpio | No ejercitado | Sin veredicto |
| **Zona de peligro** | Viejo, con su rojo propio | Usa `ConfirmModal`, no `confirm()` | **Bien** |
| **Notificaciones** | Solo en Android | **No visto** | Sin veredicto |

**Un fallo aparte, en el Ajustes de teléfono.** La lista de ajustes del móvil tiene una
fila «Diccionarios» que llama a `setActiveSettingsSection('sec-dictionaries')`
(`Library.tsx:2621`), pero **ese identificador no existe**: el real es `sec-dicts`, y esa
cadena no aparece en ningún otro sitio del repo. Abre un panel vacío.
**No lo he visto en un teléfono**, así que lo doy como fallo de código, no de pantalla.

---

## 7 · Yoru SRS

| | |
| --- | --- |
| **Aspecto** | Pestañas Mazos/Tarjetas/Estadísticas/Historial/Ajustes y un «Para hoy» con Nuevas/Aprendiendo/Repaso. Se lee bien. Pero su mapa de calor y el de Estadísticas **no son el mismo**: el de SRS rotula los días «L X V D» (faltan M, J y S) y el de Estadísticas «sáb dom lun mar mié jue vie». Dos mapas de calor con dos convenciones en la misma app |
| **Funciona** | Su estado vacío es de los mejores que tiene Yoru: «No tienes palabras en el sistema de repaso · Abre un libro, haz clic en una palabra y guárdala en un mazo para empezar». Dos `confirm()` del navegador: borrar mazo (`Library.tsx:4419`) y limpiar historial (`:5355`) |
| **Veredicto** | **Bien de fondo, arreglar los detalles**: unificar los dos mapas de calor y cambiar los dos `confirm()` por `ConfirmModal`, que ya existe |

---

## 8 · Estadísticas

| | |
| --- | --- |
| **Aspecto** | Concha nueva, cero colores a pelo. Hoy / Racha / Mejor racha / Días activos / Mejor día, mapa de calor anual, tendencia y récords. Bien montada |
| **Funciona** | Con biblioteca vacía **es una pared de ceros**: catorce cifras a cero y un mapa de calor en blanco, sin ningún estado vacío que diga «todavía no has leído». El único texto honesto es «No leíste ni escuchaste nada en este período». Y ahí hay una promesa que no se cumple: **el tiempo de escucha no se cuenta** — `/api/me/listening-stats` de Audiobookshelf existe y sigue sin usarse, como dejó anotado la sesión anterior |
| **Veredicto** | **Arreglar** (menor): un estado vacío de primera vez, y o se cuenta la escucha o el texto deja de prometerla |

---

## 9 · Colecciones — y por qué el encargo 3 es más grande de lo que parece

| | |
| --- | --- |
| **Aspecto** | La barra lateral tiene un bloque **ESTANTES** con cuatro estantes (En curso, Por empezar, Pendiente, Completado) y subtítulo «N libros». El encargo pide **COLECCIONES**, con «Estante» / «Estante · N elementos», icono tomado de la portada del primer libro y «+ Crea tu primera colección». Nada de eso está |
| **Funciona** | **Hoy no hay ninguna forma de crear una colección.** *(Corregido el 31 oct, comprobado en vivo. En la primera versión de este inventario escribí que el camino existía pero estaba enterrado: Catálogo → icono sin etiqueta → «Seleccionar libros» → «Añadir etiquetas» → `prompt()`. Intenté recorrerlo en la app y **no se puede**.)* El icono es el disparador de `LibraryMoreMenu`, el único `setIsLibraryMenuOpen(true)` del fichero (`Library.tsx:6063`), y está dentro de `{!embedded && …}` (`Library.tsx:6018`) — igual que el botón «Nueva colección» (`Library.tsx:6523`). La concha embebe **siempre** la biblioteca, así que ni ese menú ni «Seleccionar libros» se pueden abrir. En el catálogo embebido solo quedan los dos iconos de cuadrícula/lista y el menú por libro, que no tiene etiquetas. Y el botón «Nueva colección», cuando se pintaba, estaba roto: sin libros seleccionados pedía el nombre con `prompt()` y después soltaba un `alert()` diciendo que usaras el Modo Selección — tiraba el nombre recién escrito. **Desde la ficha del libro tampoco se pueden editar las etiquetas**: el modal «Detalles» solo cambia título, autor, serie y número, los cuatro con `prompt()` (`SettingsModal.tsx:112-160`). La vista «Colecciones» no tiene botón de crear, y su estado vacío dice «Añade series, autores o colecciones a tus libros desde sus detalles» — justo lo que los detalles **no** dejan hacer |
| **Veredicto** | **Arreglar, y es la pieza más grande del inventario.** El encargo 3 no sustituye un `prompt()` feo ni mejora una puerta mala: **hace la única puerta**. Mientras no exista, «Colecciones» en la barra lateral y «Descubre colecciones» en Inicio no se pueden llenar nunca |
| **Y una cosa que no puede existir** | El público/privado de la captura de referencia **exige cuentas**. Yoru no las tiene. Sería un interruptor muerto. Fuera, como ya se decidió |

---

## 10 · Series, Autores, Grupos

| | |
| --- | --- |
| **Aspecto** | Concha nueva, limpio. Las tarjetas apilan tres portadas — que con el fallo del degradado son **tres rectángulos negros** para los libros sin portada |
| **Funciona** | Navegan bien (lista → grupo → ficha), con «Volver» y buscador. **Las tres vistas comparten el mismo estado vacío**: «Añade series, autores o colecciones a tus libros desde sus detalles», incluso en «Autores», donde no tiene sentido |
| **Veredicto** | **Bien, con dos retoques**: un estado vacío por vista, y el fallo de portada, que es el mismo del punto 3 |

---

## 11 · Leer y escuchar

| | |
| --- | --- |
| **Aspecto** | Concha nueva, limpio |
| **Funciona** | Su estado vacío es **el mejor escrito de la app**: dice qué es la sección, cómo se llena y da dos botones que llevan donde hay que ir. Lo vi en marcha |
| **Veredicto** | **Bien.** No tocar |

---

## 12 · Kavita

| | |
| --- | --- |
| **Aspecto** | Estado vacío con tokens, bien. Con contenido **no visto** |
| **Funciona** | El estado vacío lleva a Ajustes correctamente, comprobado. Lo demás, no visto |
| **Veredicto** | Sin veredicto para el contenido |

---

## 13 · Búsqueda global

| | |
| --- | --- |
| **Aspecto** | Concha nueva, limpio. Las miniaturas sufren el fallo del degradado |
| **Funciona** | Busca por título, autor, serie y colección; cierra con Escape y con clic fuera. **Solo busca en la biblioteca local**: no entra en Kavita ni en Audiobookshelf, aunque la app ya tenga ese catálogo en caché |
| **Veredicto** | **Bien para lo que hace.** Que busque también en los servidores es una pieza nueva, no un arreglo |

---

## 14 · Cabecera y barra inferior

| | |
| --- | --- |
| **Aspecto** | Limpio |
| **Funciona** | **Dos iconos mienten.** La **campana** (`Bell`) lleva a Estadísticas, con el título «Tu progreso»: una campana es notificaciones en cualquier app. El **más** (`Plus`), titulado «Importar libros», solo cambia a Catálogo; no abre ningún diálogo de importar. La barra inferior de móvil pone «Colecciones» donde la lateral pone «Explorar», y no tiene ni Estadísticas ni SRS |
| **Veredicto** | **Arreglar** (menor): o la campana hace de campana, o se cambia por un icono de gráfico |

---

## 15 · Bienvenida, guía y creación de perfil

| | |
| --- | --- |
| **Aspecto** | Dorado de Yoru, oscuro, cuidado. Pero **26 colores a pelo** en `WelcomeScreen.tsx`. Y la última diapositiva de la guía tiene **dos botones dorados compitiendo** («Instalar todo» y «Ahora no, crear perfil»): uno de los dos debería ser secundario |
| **Funciona** | Recorrí el flujo entero y llegué a la app. **«Saltar» no salta**: lleva a la última diapositiva (la del diccionario), no fuera de la guía |
| **Veredicto** | **Bien de aspecto, arreglar «Saltar» y la jerarquía de los dos botones** |

---

## Resumen: todo lo que hay que arreglar, por tamaño

**Primero, porque se ven en muchas pantallas y son baratos:**

1. **El rectángulo negro de las portadas.** Una línea en `primitives.tsx:7`. Se ve en Inicio, fichas, búsqueda, estantes, series, autores y colecciones.
2. **Las seis tarjetas de servidor que no se pueden pulsar** en Inicio.
3. **La campana que no es una campana.**

**Luego, los encargos de zams, confirmados y en su orden:**

4. **Las tres de Inicio** (encargo 2): pestañas que naveguen, menú de clic derecho (hoy `onContextMenu` no existe en ningún sitio) y flechas en vez de once barras de desplazamiento.
5. **Bloque COLECCIONES y modal de crear** (encargo 3) — **más grande de lo que parecía**: hoy crear una colección son cuatro pasos tras un icono mudo y un `prompt()`, y el único botón que lo hacía ya no se pinta.
6. **Carrusel «Audiolibros aleatorios»** en la pantalla de Audiolibros (encargo 4): confirmado que falta; el carrusel existe, pero está en Inicio.
7. **Apariencia** (encargo 5) — **empieza por reconciliar los dos «tema»** (Apariencia e idioma contra Estilo de texto) antes de añadir acentos; y el deslizador de radio exige **crear antes el token de radio**: hoy hay 27 valores sueltos y ninguno.

**Deuda de fondo, para decidir aparte:**

8. **Los 266 colores a pelo** de la app vieja (`Library.tsx` 140, `Reader.tsx` 99, `VocabularyModal.tsx` 39, `SettingsModal.tsx` 28, `WelcomeScreen.tsx` 26).
9. **Los diálogos del navegador**: 9 `prompt()`, 20 `alert()` y 3 `confirm()`. `ConfirmModal` ya existe y la Zona de peligro ya lo usa bien — hay con qué sustituirlos.
10. **El botón «Ayuda» muerto** de Vocabulario y Anki.
11. **`sec-dictionaries` no existe** (Ajustes del teléfono) — fallo de código, sin comprobar en teléfono.
12. **Los dos mapas de calor** con convenciones distintas (SRS contra Estadísticas).
13. **Las mayúsculas inglesas** en los títulos de Ajustes.

---

## Cosas que parecen faltar y no faltan

Para que no vuelvan a aparecer en una lista de pendientes.

- **«Descargar» en el menú del libro.** No hay a qué apuntar. Un libro temporal de
  Kavita no llega a ser una portada: no tiene fila en la base y solo existe mientras lo
  lees (`handleKeepTemporary` trabaja sobre el libro activo y necesita el parseo en
  memoria). Y las tarjetas de servidor de Inicio apuntan a una **serie**, no a un tomo.
  La descarga vive donde se elige volumen: la ficha de la serie de Kavita. Comprobado el
  31 oct.
- **El filtro libro/audiolibro.** Ya existía como las pestañas de Inicio, y desde el
  31 oct esas pestañas navegan a su sección en vez de filtrar a medias.
- **«Otras obras del autor».** Existe desde antes en `BookDetailView.tsx:68`.

---

## Lo que no puede existir sin cuentas

- **Público / privado** en las colecciones.
- Cualquier cosa de compartir, seguir, o perfiles de otra gente.

Yoru guarda todo en el dispositivo y sincroniza con el Drive de zams. No hay servidor de
cuentas, y no lo va a haber por esto.
