# Lo que hay que comprobar en la app en cuanto esté abierta

Cuatro cambios de la rama `nix/catalogo-servidor` están probados en banco de pruebas pero
**no en la app de verdad**: las dos columnas, el seguimiento por banda, las cuatro teclas
nuevas y el resaltado por frase. Esta nota es la lista para pasarlos de una sentada, sin
tener que reconstruir el contexto otra vez.

Las capturas van a esta misma carpeta, numeradas desde la 61.

## Antes de empezar

- La app tiene que estar **abierta y a la vista**. Minimizada o detrás, Chromium deja de
  pintar: las capturas salen congeladas y las medidas de estilo salen viejas. Eso ya pasó
  y me llevó a un diagnóstico falso.
- Hace falta el puerto de depuración (`--remote-debugging-port=9222`) para poder medir y
  no solo mirar.
- La app tiene que llevar el código de la rama, no el de la última compilación publicada.

## 1. Dos columnas en horizontal

**Libro**: cualquiera. Vale el de Re:Zero, que sé que está en su biblioteca.

Con el lector en **horizontal y paginado**:

- Ventana ancha (más de 1000 px de caja): **dos columnas**, y el renglón ocupa media
  pantalla en vez de la pantalla entera.
- Estrechar por debajo de 1000: vuelve a **una**, sin quedarse a medias.
- Con los márgenes muy subidos en Ajustes: también vuelve a una, en vez de dejar dos
  columnas ridículas.
- **Lo que importa**: pasar páginas con las dos columnas y ver que el texto avanza de la
  columna izquierda a la derecha y luego salta de página entera, sin repetir ni saltarse
  nada. En banco de pruebas la frontera de página caía exacta; aquí lo que se juzga es si
  **se siente bien** al pasar, que es lo que no se puede medir.
- Volver a vertical: tiene que seguir con **una** columna, como siempre.

## 2. Seguimiento por banda, con su pausa y su reanudar

**Libro**: uno que tenga **alineación cargada**. No sé cuál es, y no puedo saberlo desde
aquí: las alineaciones están en IndexedDB y solo se leen con la app abierta. La señal es
el **botón de seguir el texto** en la barra del reproductor, que solo aparece cuando ese
libro tiene alineación. Si ninguno la tiene, hay que cargar un `.srt` antes; el propio
reproductor lo ofrece.

Con el audio sonando y el seguimiento encendido:

- En lectura continua, el texto **no debe moverse en cada frase**: solo salta cuando la
  narración se sale de la banda. Antes se movía sin parar; si sigue haciéndolo, el cambio
  no está surtiendo efecto.
- En paginada, la página **solo cambia cuando la frase no está en ella**.
- Con el reproductor abierto, una frase que caiga **detrás de la barra** cuenta como no
  visible y tiene que traerla.
- **Apartar el texto a mano** (rueda, arrastre o pasar página) deja de seguir, y el botón
  de la barra pasa a decir «Volver a la narración».
- Pulsarlo devuelve a la frase que suena y vuelve a seguir.
- Apagar y encender el seguimiento parte de cero, sin quedarse en pausa.

## 3. Las cuatro teclas

**Libro**: cualquiera, pero con **más de un capítulo** para poder probar N y M.

- **B**: pone y quita marcador en la página. Tiene que salir la cinta y aparecer en la
  barra lateral de marcadores: es la lista de siempre, no una nueva.
- **R**: lleva al último marcador. Sin ninguno, avisa en vez de no hacer nada.
- **N** y **M**: capítulo siguiente y anterior. En los extremos avisan.
- **Que no se inviertan en vertical**: N sigue siendo el siguiente en los dos modos. Es a
  propósito.
- En **Ajustes → Atajos** tienen que aparecer las cuatro y poder cambiarse. Y comprobar
  que aparecen **aunque ya hubiera atajos guardados de antes**, que era el fallo que se
  corrigió de paso.
- Que no pisan nada: escribir una nota o buscar dentro del libro y ver que la B y la N se
  escriben, no disparan el atajo.

## 4. Resaltado por frase

**Libro**: el mismo del punto 2, el que tenga alineación.

- Con el audio sonando se marca **la frase**, no el párrafo entero.
- La marca **avanza con el audio** sin parpadear ni dar tirones.
- **El texto no se mueve al marcar.** Es lo más importante y lo más fácil de ver: si al
  cambiar de frase el libro da un salto o se repagina, algo está mal.
- Se ve bien en **oscuro, claro y sepia**. En banco de pruebas quedó en 1,38 / 1,34 /
  1,35 de contraste; aquí lo que se juzga es si molesta al leer.
- En un párrafo de **varias líneas o partido entre dos columnas**, la marca cubre solo su
  frase y la sigue a la columna siguiente.
- Si alguna frase sale marcada **entera a nivel de párrafo**, no es un fallo: es el
  respaldo de cuando el anclaje no resuelve. Pero si pasa **a menudo**, hay que mirarlo.
- Tocar una frase sigue llevando el audio ahí, como antes.

## Lo que queda fuera

La **barra del reproductor dentro del lector** sigue esperando a que zams diga si la
quiere igual que la del reproductor suelto. No se ha tocado.
