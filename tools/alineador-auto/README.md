# Alineador automático

Hace que «Leer y escuchar» funcione solo: genera la alineación texto↔audio de cada
audiolibro de Audiobookshelf y la deja en `servidor-sync/datos/alineaciones/`, de donde
la app la descarga al abrir la novela con su audiolibro.

Corre en el PC donde están los EPUB y los audios. No va dentro de la app.

## Qué necesita

- **Node 22** o más nuevo (el mismo del servidor de sincronización).
- **[Bun](https://bun.sh/)** y un clon de **[Honomiya](https://github.com/Natsume-197/Honomiya)**
  (de Natsume, licencia MIT), con `bun install` hecho y el modelo japonés bajado:
  `bun run honomiya models pull quartznet15x5-ja`. Honomiya alinea con un modelo CTC que
  va en CPU: ni Python ni tarjeta gráfica.
- **ffmpeg** y **ffprobe** en el PATH (Audiobookshelf trae los suyos en `C:\Audiobookshelf`).
- La lista de parejas EPUB↔audiolibro (`all_read_listen_pairings.json`): dice qué EPUB va
  con qué audio por el nombre exacto de cada fichero. Sin pareja no se alinea: no se
  adivina por el título.

## Configurar

Copia `config.example.json` a `config.json` (git lo ignora) y pon las rutas de este PC.
La dirección y el token de Audiobookshelf se leen de `servidor-sync/.env`.

## Usar

```bash
node tools/alineador-auto/generar.mjs --ver     # qué haría, sin alinear nada
node tools/alineador-auto/generar.mjs --max 1   # alinear solo el primero pendiente
node tools/alineador-auto/generar.mjs           # todos los pendientes
```

Un tomo de ocho horas tarda del orden de veinte minutos. Se puede cortar con Ctrl-C y
volver a lanzar: lo hecho no se repite. Un audiolibro que falla queda apuntado en
`trabajo/<id>/FALLO.txt` y no se reintenta salvo con `--reintentar`.

## Qué deja

Un `<id de Audiobookshelf>.srt` por audiolibro: las frases del libro, en kanji, con el
momento del audio en que suenan contado desde el principio del audiolibro (aunque tenga
varias pistas). La primera línea es el veredicto que lee la app (`YORU-ALINEACION v1`):
`bueno` si la alineación cubre al menos el 80 % del libro, `parcial` si no.

El servidor los sirve en `GET /api/alineacion/<id>` a quien tenga sesión.
