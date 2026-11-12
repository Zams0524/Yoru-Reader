# PR 37 — qué vas a ver distinto

Rama `nix/catalogo-servidor`. Esto es lo que cambia **al abrir la app**, pantalla por
pantalla. Al final, lo que está probado y lo que no, que es lo que te conviene mirar
antes de fusionar.

Nada de esto está en `main` todavía. No se ha publicado OTA ni APK, el keystore y el
`versionCode` están intactos.

---

## Lo primero que vas a notar

**Los libros sin portada ya no son un agujero negro.** Un libro sin imagen incrustada
guarda un degradado de color, y hasta ahora la pantalla de Inicio lo metía donde va una
imagen: resultado, un rectángulo negro. Pasaba en Inicio, en las fichas, en la búsqueda,
en los estantes, en series, en autores y en colecciones — en todo menos en el Catálogo,
que sí lo pintaba bien. **Y en tu avatar**, que se genera igual y dejaba el disco de
arriba a la derecha vacío en todas las pantallas a la vez.

Ahora sale el mismo color que el Catálogo lleva enseñando desde siempre, con el título
encima. Inicio y Catálogo por fin enseñan lo mismo del mismo libro.

---

## Inicio

- **Las pestañas Inicio / Libros / Audiolibros llevan a su sección.** Antes solo
  filtraban esta pantalla, y a medias: con «Audiolibros» elegido seguían saliendo
  «Añadidos recientemente» y «Libros para ti», que son libros tuyos.
- **Las portadas de los servidores se pueden pulsar.** Eran seis filas que parecían
  botones y no hacían nada. Ahora una portada de Kavita abre su serie y una de
  Audiobookshelf abre su tomo.
- **La tarjeta «Serie A · 3 audiolibros» lleva a los tres.** Antes te dejaba en el
  primero, que es peor que no llevarte a ningún sitio porque crees que has llegado. Hay
  una vista de serie con sus tomos en orden, cada uno con su «Escuchar».
- **Los carruseles van con flechas, no con barras.** Inicio puede llegar a once
  carruseles: eran once barritas de desplazamiento, más la de la página y la de la barra
  lateral.
- **Clic derecho sobre un libro** → Leer o Continuar, Ver detalles, Añadir a colección,
  y Quitar de Continuar cuando lo haces sobre la tarjeta de «Continuar». Ese «Quitar» no
  te toca el progreso ni la fecha: solo lo aparta de ahí.

---

## Colecciones

**Esto es lo más grande del PR, y no es lo que parecía.** Al ir a arreglarlo descubrí
que **no había ninguna forma de crear una colección**. No estaba escondida: no existía.
El botón que lo hacía vivía en una barra lateral que la interfaz nueva ya no pinta. Por
eso «Colecciones» y «Descubre colecciones» no podían llenarse nunca.

Ahora:

- La barra lateral tiene un bloque **COLECCIONES** con tus cuatro estantes y tus
  colecciones, cada uno con la portada de su primer libro por icono, y
  **«Crea tu primera colección»**.
- El modal ofrece dos caminos: **colección manual** (eliges tú qué entra) o
  **dinámica** (se llena sola con una regla: autor, serie, estado o etiqueta). La
  dinámica te dice cuántos libros entrarían antes de crearla.
- **Las colecciones se editan desde la ficha del libro.** Esto era lo que faltaba de
  verdad: antes la ficha las enseñaba y no dejaba tocarlas, mientras el estado vacío
  decía «añádelas desde sus detalles» — justo lo que no se podía hacer.

**Sin público/privado.** Eso exige cuentas de usuario y Yoru guarda todo en tu
dispositivo: sería un interruptor que no hace nada.

Dos reglas que dejé fuera y por qué: **idioma** y **servidor**. La app no guarda el
idioma de un libro (en Yoru todo es japonés; el «JA» de la ficha está escrito a mano) ni
de dónde vino, así que un libro traído de Kavita no se distingue de uno arrastrado a la
ventana. Serían dos desplegables incapaces de filtrar nada. Para que «servidor» exista
hay que sellar el origen al importar: es trabajo aparte, y está anotado.

---

## Ajustes → Apariencia

**Había dos controles llamados «tema» y eran el mismo.** Uno en Apariencia (Oscuro Yoru
/ Sepia Relajante / Claro Clásico) y otro en Estilo de texto (Blanco / Crema / Oscuro).
Escribían el mismo ajuste, y el segundo mentía sobre sí mismo: decía «se aplica
únicamente a la página de lectura» cuando cambiarlo teñía también el catálogo.

Ahora hay uno solo, **Esquema**: Sistema / Claro / Oscuro / Sepia.

- **Sistema** sigue a Windows y cambia con él.
- **El sepia se queda.** Para leer de noche es el que más sirve.
- «Estilo de texto» se queda con lo suyo: tipografía, dirección, interlineado, márgenes.

Y cuatro cosas nuevas:

- **Acento**: el color de los botones y de lo marcado. **Tu dorado va primero y es el
  que viene puesto** — es la identidad de Yoru, no una opción más. Los otros cuatro
  están por si quieres cambiar.
- **Esquinas**: un deslizador, de esquina viva a muy redondeada. Antes había **27
  valores distintos** de redondeo repartidos por las hojas de estilo y ninguna forma de
  tocarlos.
- **Organizar inicio**: sube, baja y esconde los once carruseles. Con flechas y no
  arrastrando, para que funcione también con el teclado. Tiene «Volver al orden de
  siempre».
- **Títulos bajo la portada**: un interruptor global. No tiene nada que ver con
  «difuminar portada», que es por libro.

---

## Audiolibros

**«Audiolibros aleatorios» ya está en la pantalla de Audiolibros**, con su «Actualizar».
Existía, pero solo en Inicio, que es donde menos falta hace: aquí es donde se viene a
buscar qué escuchar.

---

## Dos botones que no hacían nada

- El **«Ayuda»** del mapeador de campos de Anki estaba literalmente vacío. Ahora explica
  qué es un marcador y qué pone cada uno en la tarjeta.
- En el **Ajustes del teléfono**, la fila «Diccionarios» apuntaba a una sección que no
  existe y abría un panel en blanco.

---

## Lo que la rama ya traía de antes

El PR no es solo la pasada de interfaz. También lleva lo de las semanas anteriores: la
interfaz nueva con su barra lateral, la integración con Kavita y Audiobookshelf, la
lectura temporal (abrir del servidor sin guardar), el reproductor de audiolibros
sueltos, la ficha del libro del servidor, las estadísticas con rachas y mapa de calor, y
la herramienta de alineación texto-audio. Eso ya lo fuiste viendo.

---

## PROBADO Y NO PROBADO — léelo antes de fusionar

**Probado en vivo**, abriendo la app y haciéndolo:

- Las portadas sin imagen y el avatar: de 1 imagen rota a 0 en la página.
- Las pestañas de Inicio llevan a su sección.
- Los carruseles: el que desborda saca flechas, el que cabe no; ninguno enseña barra.
- El clic derecho, en la tarjeta de Continuar y en una portada de carrusel.
- Crear una colección manual, meterle un libro desde la ficha, crear una dinámica, y
  —esto es lo importante— **marcar el libro como leído y ver cómo se sale solo de la
  dinámica mientras la manual se lo queda**.
- El Esquema en sus cuatro posiciones, incluido Sistema con Windows en claro.
- Los acentos, el deslizador de esquinas, Organizar inicio (subir, esconder y
  restaurar) y el interruptor de títulos.
- La vista de serie de audiolibros, con los tomos en orden 1, 2, 10 (no 1, 10, 2).

**NO probado, y no lo doy por bueno:**

1. **Que las fichas de Kavita y Audiobookshelf se abran de verdad al pulsar una portada
   desde Inicio.** Probé que te lleva a la sección correcta y que viaja el identificador
   bueno, pero no que la ficha se abra: **hace falta tu Kavita y tu Audiobookshelf**.
   Esto es lo primero que te pediría comprobar.
2. **Que el reproductor de un audiolibro suene** desde la vista de serie. Mismo motivo.
3. **Nada en el teléfono.** El arreglo de la fila «Diccionarios» va como corregido y
   **no verificado en un teléfono**.
4. **El «Ayuda» de Anki**: corregido y compila, pero no conseguí abrir ese panel en la
   sesión de pruebas.
5. **Que el tema cambie en caliente** al pasar Windows de claro a oscuro con la app ya
   abierta. Al arrancar sí lo coge bien; el cambio en vivo no lo pude provocar.

**Estado técnico:** tipos limpios, build correcto, 74/74 pruebas de servidores
multimedia y 3/3 de la auditoría del móvil.

---

## Una cosa que dejé sin hacer a propósito

Se propuso volver manuales los estantes «Quiero empezar» y «Pendiente», sacado de una
captura de referencia. **No lo hice**: hoy «Por empezar» se llena sola con los libros
que nunca has abierto, y volverla manual te la vacía y te obliga a etiquetar a mano para
recuperar lo que ya tenías. Además, desde este PR esa lista se puede reconstruir cuando
quieras como colección dinámica con la regla *Estado = Sin empezar*. Quedó anotado para
que no lo rehaga nadie leyendo la captura.
