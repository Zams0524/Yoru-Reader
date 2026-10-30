# Alineador de Yoru

Le das un EPUB japonés y su audiolibro, y te deja un **SRT** con los cues: qué frase del
libro suena en cada momento. Eso es lo que convierte «tengo el libro y tengo el audio» en
«el texto se subraya solo mientras escucho».

Vive fuera de la app a propósito. Necesita Python y PyTorch, y **Python no se puede
embarcar a los usuarios**: Yoru es Electron y Android. Esto se ejecuta una vez por libro,
en un ordenador, y lo que viaja a la app es el SRT.

```bash
pip install -r requirements.txt
python alinear.py --libro novela.epub --audio novela.m4b
```

Deja junto al audio dos ficheros: `novela.srt` y `novela.alineacion.json`.

## Lo primero: tarda horas

En un portátil normal (medido en un i5-8365U de 15 W, sin GPU) son **unas 4,4 horas por
cada 10 horas de audio**. No es un cuelgue: es el modelo acústico, que se lleva el 99,6 %
del tiempo. Todo lo demás —preparar el audio, leer el EPUB, colocar el texto— son
segundos.

Se puede **cortar con Ctrl-C y volver a lanzar el mismo comando**: sigue por donde iba.
Va diciendo por dónde va y cuánto le falta.

La idea es dejarlo por la noche. Es una vez por libro, para siempre.

## Lo segundo: mira el veredicto antes de usar el SRT

Al terminar imprime algo así:

```
  veredicto:      OK
  del libro:      99.9 % alineado   (anclaje 99.9 %)
  del audio:      89.8 % con texto
  cues:           124
  hueco mayor:    2.0 s
  velocidad:      7.2 kana/s   (1 cues fuera de banda)
  inversiones:    0
```

Cuatro veredictos:

| | Qué significa |
| --- | --- |
| **OK** | Úsalo |
| **PARCIAL** | El audio está cubierto pero solo cubre parte del libro. Normal con un tomo partido en varios audios. Vale para el tramo que cubre |
| **DUDOSO** | Hay cues con el tiempo hacia atrás. No debería pasar; míralo antes de usarlo |
| **NO ES PAREJA** | Queda voz sin colocar. Lo más probable es que el EPUB y el audiolibro no sean la misma obra, o no el mismo tomo. **No lo uses** |

Las dos cifras que mandan son **del libro** y **del audio**, y hacen falta las dos. Que
quede poco libro alineado puede ser un libro partido (bien) o una pareja equivocada (mal);
lo que las distingue es si el **audio** quedó cubierto. Si hay voz que no supimos colocar
en ningún sitio, es que ese audio no es de ese libro.

Esto se midió, no se supuso. Se probó a alinear un EPUB real contra el audiolibro de otra
obra: salió 1,9 % del libro y 57,9 % del audio, con 27,2 kana/s (una narración humana va a
6–9) y 76 de 111 cues fuera de banda. Lo rechazó.

Y una que **no** sirve, para que nadie la añada creyendo que ayuda: la confianza del CTC.
En esa misma prueba el caso malo sacó la mejor confianza de todas. El anclaje ya ha
descartado lo que no casa antes de que la alineación forzada lo vea, así que la confianza
mide lo que queda, no lo que se tiró. Se calcula igual, porque sirve para señalar *dónde*
falla dentro de un libro ya aceptado.

## Cómo funciona

El problema del japonés no es que no tenga espacios —a un alineador CTC los espacios le
dan igual— sino la **ortografía**: el libro está en kanji y el modelo acústico no puede
leer kanji, porque un kanji no tiene un sonido, tiene varios.

Así que nunca se le pide que lea kanji:

```
EPUB (kanji)  →  furigana del propio EPUB, y janome para el resto  →  kana
                                                                       ↓
                                       86 símbolos, 0 fuera de vocabulario
                                                                       ↓
       se mira qué oye el modelo por su cuenta, y se empareja con la lectura
                                                                       ↓
            los tramos que casan son anclajes; los que no, se quedan fuera
                                                                       ↓
          entre anclaje y anclaje, alineación forzada → tiempos → cues en KANJI
```

Las dos fuentes de lectura se tapan los huecos la una a la otra: **manda el furigana del
EPUB** cuando lo hay, porque cubre justo los kanji raros donde un analizador falla, y
janome hace el resto. Sobre un tomo real quedó un 1 % de piezas sin lectura, y casi todo
era katakana (que ya es su propia lectura) o signos.

Modelo: [`vumichien/wav2vec2-large-xlsr-japanese-hiragana`](https://huggingface.co/vumichien/wav2vec2-large-xlsr-japanese-hiragana),
Apache-2.0. Se baja solo la primera vez (1,26 GB) y queda en la caché de Hugging Face.

### Por qué por bloques, y por qué eso importa

Entre anclaje y anclaje se alinea por separado. En parte porque el enrejado de Viterbi
sobre 44.000 marcos y 12.000 caracteres no cabe en memoria, pero sobre todo porque así
**un error no se propaga**: cada bloque es independiente.

Se midió estropeando el texto a propósito, como se estropea un EPUB frente a una narración
real: una frase que el narrador se salta, un epígrafe que nadie lee en voz alta, un número
leído de otra manera. Con los tres destrozos a la vez más cuatro cortes repartidos, los
cues volvían a su sitio **en 0 a 4 caracteres**, el 99,4 % quedaba a menos de 200 ms, y no
hubo **ni una** inversión de tiempo.

### La regla de la casa

**Antes dejar un tramo sin alinear que colocar un cue a ojo.** Quien lee esto está
aprendiendo japonés, y un subrayado que va medio segundo tarde enseña mal: es peor que no
tener subrayado. Por eso cuando un bloque no es creíble se queda sin tiempo, y por eso el
veredicto puede decir que no uses el resultado.

### El cue lleva kanji

El SRT lleva **el texto del libro**, en kanji. El kana es andamio interno y se tira. Si
acabara dentro del cue, `timeOfText` de `frontend/utils/readAlongAlignment.ts` compararía
`カタオモイノアイテ` contra `片思いの相手` y no casaría nunca, porque normaliza puntuación
pero no convierte lecturas: fallaría en todos los libros japoneses. El contrato está
escrito en la cabecera de ese módulo.

## Opciones

| | |
| --- | --- |
| `--libro` | el EPUB (obligatorio) |
| `--audio` | el audiolibro: `.m4b`, `.mp3`, lo que ffmpeg sepa leer (obligatorio) |
| `--salida` | dónde dejar el SRT. Por omisión, junto al audio |
| `--durante N` | alinear solo los primeros N segundos. Para probar sin esperar horas |
| `--desde N` | empezar en el segundo N |
| `--hilos N` | hilos de CPU. 0 (por omisión) deja que torch decida |
| `--conservar-cache` | no tirar las emisiones al acabar |
| `--trabajo` | dónde va la carpeta de trabajo |

### La caché de emisiones

Mientras trabaja guarda lo que sale del modelo en `.alineacion/`, y **lo tira al
terminar**. Son ~0,3 GB por un libro de diez horas.

Sirve para dos cosas: que un Ctrl-C no cueste cuatro horas, y que rehacer los cues sea
instantáneo. Si vas a tocar cómo se trocean los cues, usa `--conservar-cache` y la segunda
pasada tarda segundos en vez de horas.

## ffmpeg

Hace falta ffmpeg y ffprobe. Si no están en el PATH, los busca en sitios habituales —entre
ellos `C:\Audiobookshelf\`, porque Audiobookshelf trae el suyo—. También se le puede decir
dónde están:

```
set FFMPEG=C:\ruta\a\ffmpeg.exe
set FFPROBE=C:\ruta\a\ffprobe.exe
```

## Qué hay en cada fichero

| | |
| --- | --- |
| `alinear.py` | la línea de órdenes; une los pasos |
| `yoru_alineador/texto.py` | EPUB → texto en kanji, lectura en kana, y el puente entre los dos |
| `yoru_alineador/audio.py` | ffmpeg: a WAV de 16 kHz, y los capítulos del `.m4b` |
| `yoru_alineador/acustico.py` | el modelo, y la caché que se puede retomar |
| `yoru_alineador/alineado.py` | anclaje difuso y alineación forzada por bloques |
| `yoru_alineador/salida.py` | cues, SRT, y el portero que decide si esa pareja es pareja |

## Un detalle que cuesta una tarde

El tokenizador de este modelo declara **88** entradas, pero el modelo emite **86** clases,
y **el blank es el id 85, no el 0** — el id 0 es `お`. Si das por supuesto que el blank es
el 0, todo corre sin un solo error y escupe números plausibles mientras trata una vocal
como si fuera silencio. Pregúntaselo siempre al tokenizador (`pad_token_id`) y comprueba
que cae dentro de las clases del modelo. Está hecho en `acustico.vocabulario()`.
