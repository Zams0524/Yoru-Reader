# Servidor de sincronización de Yoru

Guarda el progreso de lectura de cada miembro del Discord de Yoru (libros, posición,
marcadores, estados de palabras, tarjetas del SRS y ajustes) para que le siga de un
aparato a otro. Se entra con Discord: lo único que da acceso es ser miembro del
servidor de Discord de Yoru, más un freno de intentos en `POST /api/sesion`.

La base de datos vive en `servidor-sync/datos/yoru-sync.db` (SQLite, git la ignora).

## Arrancarlo

Doble clic en **`INICIAR-SERVIDOR-SYNC.bat`**, o desde una terminal:

```
node servidor-sync/servidor.mjs
```

No hay nada que instalar: usa solo lo que trae Node (`node:http`, `node:sqlite`).
Hace falta **Node 22.5 o más nuevo**.

Para comprobar que está vivo:

```
curl http://127.0.0.1:3747/api/salud
```

La app lo busca en la dirección de `VITE_YORU_SYNC_URL` (ver `.env.example` en la raíz),
o en la de serie de `frontend/config/serverDefaults.ts`. Para que lleguen los teléfonos
de los miembros hay que publicarlo detrás de HTTPS (un proxy inverso o un túnel); cómo
hacerlo depende de cada instalación.

### Freno de intentos

`POST /api/sesion` es la única puerta sin sesión. Admite diez **fallos** por dirección
cada diez minutos y luego contesta 429 durante el resto de la ventana. Solo se cuentan
los fallos, así que abrir la app muchas veces no molesta a nadie. Detrás de un proxy, la
dirección de quien llama se lee de `X-Forwarded-For`, y solo si la conexión viene de la
propia máquina; de cualquier otro sitio esa cabecera se ignora.

## Las claves de Kavita y de Audiobookshelf

Este servidor también guarda las claves de los dos servidores de medios y se las da a
los miembros por `/api/medios`, para que no vayan escritas dentro de la app.

Viven en `servidor-sync/.env`, que git ignora. Hay una plantilla en `.env.example`:
cópiala a `.env`, pon los valores y **reinicia el servidor**, que lo lee una sola vez al
arrancar. Al arrancar dice por cada servidor si lo reparte o si le falta la clave.

| Variable | Para qué |
| --- | --- |
| `YORU_SYNC_KAVITA_API_KEY` | La clave de Kavita. Sin ella, Kavita no se reparte |
| `YORU_SYNC_KAVITA_URL` | Por dónde llega este proceso. `http://localhost:5000` |
| `YORU_SYNC_KAVITA_URL_PUBLICA` | Por dónde llega el teléfono de un miembro |
| `YORU_SYNC_ABS_TOKEN` | El testigo de Audiobookshelf |
| `YORU_SYNC_ABS_URL` | `http://localhost:13378` |
| `YORU_SYNC_ABS_URL_PUBLICA` | Por dónde llega el teléfono de un miembro a ABS |

Si falta la dirección pública se manda la interna. Sin `.env` el servidor arranca igual y
la sincronización funciona; lo único que queda apagado es `/api/medios`, y entonces cada
uno configura sus servidores a mano.

La clave acaba en el aparato del miembro, porque es su propia app la que habla con
Kavita. Quien abra las herramientas del navegador puede verla.

## Ajustes

Todo por variables de entorno, y todas tienen un valor por defecto que ya sirve:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `YORU_SYNC_PUERTO` | `3747` | Puerto donde escucha |
| `YORU_SYNC_HOST` | `0.0.0.0` | Interfaz |
| `YORU_SYNC_GUILD` | `1372928430634565775` | El servidor de Discord de Yoru |
| `YORU_SYNC_DB` | `servidor-sync/datos/yoru-sync.db` | Dónde vive la base |
| `YORU_SYNC_DISCORD_API` | `https://discord.com/api` | Solo para pruebas |
| `YORU_SYNC_TEXTOS` | `servidor-sync/datos/textos` | El texto de los libros, una carpeta por cuenta |
| `YORU_SYNC_CUOTA_TEXTOS_MB` | `3072` | Lo que puede ocupar en disco (comprimido) el texto de una cuenta |

## Cómo decide quién entra

1. La app manda **el token de Discord del usuario** a `POST /api/sesion`.
2. El servidor le pregunta a Discord quién es (`/users/@me`) y en qué servidores está
   (`/users/@me/guilds`).
3. Si está en el de Yoru, le devuelve un **token propio** que vale una semana. Si no
   está, 403; si el token no vale, 401; si Discord no contesta, **503 y no se echa a
   nadie**: no saber no es lo mismo que saber que no.
4. El resto de peticiones van con ese token, así Discord no recibe una pregunta por
   cada página que alguien pasa.

El servidor **no guarda el token de Discord de nadie**, ni la lista de servidores en
los que está: solo su ID, su nombre y su progreso.

## La API

| | | |
| --- | --- | --- |
| `GET` | `/api/salud` | `{ ok: true }`. Sin token |
| `POST` | `/api/sesion` | `{ accessToken }` → `{ token, expiraEn, usuarioId, nombre }`, o **429** tras diez fallos |
| `DELETE` | `/api/sesion` | Cierra la sesión de ese token |
| `GET` | `/api/progreso` | **Lo tuyo, entero**: `{ version, actualizadoEn, datos }` |
| `PUT` | `/api/progreso` | `{ baseVersion, datos }` → `{ version, actualizadoEn }`, o **409** |
| `GET` | `/api/progreso/<id>` | **De cualquiera, reducido**: `{ usuarioId, nombre, alias, comparte, leyendo, escuchando, ahora, perfil }` |
| `GET` | `/api/miembros` | Lo mismo para todos, sin `perfil`: `{ miembros: [...] }` |
| `GET` | `/api/medios` | Las claves de Kavita y de ABS: `{ kavita, audiobookshelf }`, cada una `null` si no hay |
| `GET` | `/api/textos` | Los libros cuyo texto tienes guardado: `{ textos: [{ clave, bytes }] }` |
| `GET` | `/api/textos/<clave>` | El texto de un libro tuyo: `{ title, author, cover, chapters }`, o **404** |
| `PUT` | `/api/textos/<clave>` | Lo guarda (comprimido); **400** sin capítulos, **413** si pasa de 64 MB, **507** si se pasa la cuota |

`/api/progreso` devuelve lo tuyo entero y va por tu propia sesión; `/api/progreso/<id>`
devuelve de cualquiera solo su perfil de lectura: sus libros y audiolibros con su avance
(`perfil`), lo último que leyó y escuchó, y si lo está haciendo ahora (`ahora`, cuando su
última lectura es de hace menos de doce minutos). De ahí no salen nunca el estado de cada
palabra, las tarjetas del SRS, los ajustes ni el texto de los libros.

Todo sale vacío, y `comparte` es `false`, cuando esa persona apagó «Enseñar a los
miembros lo que lees» (`shareReadingWithMembers`). Un libro de su lista negra de Discord
no sale en ninguna lista.

Al arrancar con una base de antes se añade sola la columna `alias` a `usuarios`.

El 409 es la pieza que evita que dos aparatos se pisen. `baseVersion` es la versión que
el cliente leyó antes de combinar; si entretanto escribió otro, el número ya no cuadra,
el servidor dice que no y devuelve lo que hay para que el cliente lo combine y vuelva.

**Aquí no se combina nada**: el servidor guarda el bulto tal cual. Quien combina es la
app, con `mergeDatabaseExports` (`frontend/utils/cloudMerge.ts`), el mismo código que ya
combina con Google Drive.

## Pruebas

```
node servidor-sync/prueba.mjs
```

Levanta el servidor de verdad en un puerto libre, con la base en memoria y un Discord de
mentira, y recorre lo que puede salir mal: un token que no vale, alguien que no está en
el servidor, Discord caído, y dos aparatos escribiendo a la vez.

## Copias de seguridad

`servidor-sync/datos/yoru-sync.db` es todo. Copiarlo (con el servidor parado, o con
`sqlite3 yoru-sync.db ".backup copia.db"` en caliente) basta para no perder nada.
