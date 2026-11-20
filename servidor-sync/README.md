# Servidor de sincronización de Yoru

Guarda el progreso de lectura de cada miembro del Discord de Yoru (libros, posición,
marcadores, estados de palabras, tarjetas del SRS y ajustes) en el PC de zams. La app
lo alcanza por **Tailscale Funnel**, así que los miembros no instalan nada: entran con
Discord y ya. Eso significa que la puerta está en internet, y lo único que la guarda es
ser miembro del Discord, más el freno de intentos de `POST /api/sesion`.

- Dirección pública: `https://desktop-go1ujdd.tail6db786.ts.net` (sin puerto)
- Dentro del tailnet: `http://desktop-go1ujdd.tail6db786.ts.net:3747`
- IP de Tailscale: `100.121.94.3`
- Base de datos: `servidor-sync/datos/yoru-sync.db` (SQLite, git la ignora)

## Arrancarlo

Doble clic en **`INICIAR-SERVIDOR-SYNC.bat`**, o desde una terminal:

```
node servidor-sync/servidor.mjs
```

No hay nada que instalar: usa solo lo que trae Node (`node:http`, `node:sqlite`).
Hace falta **Node 22.5 o más nuevo** (el PC tiene 24.20).

Para comprobar que está vivo, desde cualquier sitio:

```
curl https://desktop-go1ujdd.tail6db786.ts.net/api/salud
```

Si eso no contesta pero `curl http://127.0.0.1:3747/api/salud` sí, el servidor está
bien y lo que falta es Funnel: ver más abajo.

## Que arranque solo con Windows

Una tarea programada, que es lo que sobrevive a un reinicio sin tener la sesión
abierta. En PowerShell **como administrador**, una sola vez:

```powershell
$accion   = New-ScheduledTaskAction -Execute "node" -Argument "servidor.mjs" -WorkingDirectory "C:\Users\Zams\Documents\Codex\2026-10-16\co\work\Yoru-Reader\servidor-sync"
$arranque = New-ScheduledTaskTrigger -AtStartup
$ajustes  = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Yoru sync" -Action $accion -Trigger $arranque -Settings $ajustes -User "SYSTEM" -RunLevel Highest
```

Y abrir el puerto en el cortafuegos **solo para Tailscale**, que es la diferencia entre
un servidor privado y uno que contesta a toda la red del piso:

```powershell
New-NetFirewallRule -DisplayName "Yoru sync (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 3747 -RemoteAddress 100.64.0.0/10 -Action Allow
```

## La otra opción, sin exponer el PC: compartir el equipo del tailnet

Esto es lo que se hacía antes de Funnel, y sigue valiendo si algún día se prefiere que
el PC no esté en internet. El precio es que cada miembro instala Tailscale.

Un nombre `.ts.net` **no existe fuera del tailnet**: mientras un aparato no esté
dentro, la app no llega al servidor. Lo decidido (zams, 18 nov 2026) es **compartir
solo este equipo** (*node sharing*), no invitar a nadie al tailnet entero: así el
invitado ve esta máquina y nada más de la red de casa.

En la consola de Tailscale, **Machines** → el equipo `desktop-go1ujdd` → menú `...` →
**Share**. Dos formas:

- **Copy invite link** → activar **Reusable link** → **Copy share link**. Un enlace
  que vale para todos, hasta 1.000 usos, y es el que se pega en el Discord.
- **Share by email**, si se prefiere uno por persona.

Los enlaces sin usar caducan a los 30 días, y hay que tratarlos como una contraseña:
quien tenga el enlace entra. Para quitar a alguien: Share → `...` → **Revoke invite**.

Quien acepte necesita su propia cuenta de Tailscale (gratuita) y aceptar desde ella.
El primer aparato que hay que meter es el teléfono de zams, que es lo que hace falta
para probar el ciclo entero.

Si un invitado llega al tailnet pero el servidor no le responde, es la lista de
control de acceso del tailnet. La regla que lo abre, en el editor de la consola:

```json
{ "src": ["autogroup:shared"], "dst": ["100.121.94.3"], "ip": ["3747"] }
```

Pone el puerto 3747 de este equipo al alcance de los invitados, y solo ese puerto.

## Publicarlo con Funnel — esto es lo que usa la app

Esta es la forma en que la app llega al servidor (decisión de zams, 18 nov 2026:
«solo quiero que la gente entre y use la app ya»). Compartir el equipo por el tailnet
obligaba a cada miembro a instalar Tailscale y aceptar una invitación antes de abrir la
app siquiera. Funnel pone el mismo servidor detrás de una dirección pública con HTTPS
de verdad, y así no instalan nada:

```powershell
tailscale funnel --bg 3747
```

Se queda puesto, también después de reiniciar. Para ver cómo está: `tailscale funnel
status`. Para quitarlo: `tailscale funnel --bg off` (o `tailscale funnel reset`).

Lo que trae:

- La URL es `https://desktop-go1ujdd.tail6db786.ts.net`, sin puerto (Funnel solo sirve
  el 443, el 8443 y el 10000). Está en `frontend/config/serverDefaults.ts`.
- Nadie instala nada. Al ser HTTPS, además Android no necesita ningún permiso de
  tráfico en claro.
- A cambio, este PC queda al alcance de cualquiera en internet. La única puerta sin
  sesión es `POST /api/sesion`, y lo único que la guarda es ser miembro del Discord.

Por eso esa puerta tiene freno: diez **fallos** por dirección cada diez minutos, y
luego un 429 durante el resto de la ventana. Solo se cuentan los fallos, así que
abrir la app muchas veces no molesta a nadie; probar tokens a ciegas sí se corta, y
Discord no recibe la ráfaga. Con Funnel, la dirección de quien llama se lee de
`X-Forwarded-For`, y solo si la conexión viene de la propia máquina (que es por donde
entra Tailscale); de cualquier otro sitio esa cabecera se ignora, porque la escribe
quien llama.

## Las claves de Kavita y de Audiobookshelf

Este servidor también guarda las claves de los dos servidores de medios y se las da
a los miembros. No es un añadido caprichoso: hasta el 18 de noviembre de 2026 esas
dos claves venían escritas en el código de la app, en
`frontend/config/serverDefaults.ts`, y como el repositorio es público eso era
publicarlas. Mientras Kavita y Audiobookshelf solo escuchaban en `localhost` el daño
era limitado, porque no había dirección a la que ir; al publicarlos con Funnel
pasaron a ser dirección y clave, las dos publicadas.

Ahora viven en `servidor-sync/.env`, que git ignora. Hay una plantilla en
`.env.example`: cópiala a `.env`, pon los valores y **reinicia el servidor**, que lo
lee una sola vez al arrancar. Al arrancar dice por cada servidor si lo reparte o si
le falta la clave, porque un `.env` que falta se nota tarde y mal: la app dice «no
responde» y a nadie se le ocurre mirar aquí.

| Variable | Para qué |
| --- | --- |
| `YORU_SYNC_KAVITA_API_KEY` | La clave de Kavita. Sin ella, Kavita no se reparte |
| `YORU_SYNC_KAVITA_URL` | Por dónde llega este proceso. `http://localhost:5000` |
| `YORU_SYNC_KAVITA_URL_PUBLICA` | Por dónde llega el teléfono de un miembro: la salida de Funnel |
| `YORU_SYNC_ABS_TOKEN` | El testigo de Audiobookshelf |
| `YORU_SYNC_ABS_URL` | `http://localhost:13378` |
| `YORU_SYNC_ABS_URL_PUBLICA` | La salida de Funnel de ABS |

Son dos direcciones por servidor porque no son la misma: una es por dónde llega este
proceso, que está en el mismo PC, y la otra por dónde llega el móvil de un miembro.
Si falta la pública se manda la interna.

Sin `.env` el servidor arranca igual y la sincronización funciona. Lo único que queda
apagado es `/api/medios`, y entonces cada uno configura sus servidores a mano, como
antes de que existiera nada de esto.

### Lo que esto arregla y lo que no

Arregla lo gordo: la puerta pasa de «saber leer GitHub» a «ser miembro del Discord de
Yoru». Y hace que rotar una clave sirva de algo, porque ya no hay copias publicadas
en el historial de git: se cambia el `.env`, se reinicia, y los aparatos recogen la
nueva dentro de medio día.

No arregla esto: la clave acaba en el aparato del miembro, porque es su propia app la
que habla con Kavita. Quien abra las herramientas del navegador la verá, y con ella
puede entrar en Kavita por su cuenta.

El siguiente paso, si algún día hace falta, es que el tráfico de los medios pase por
aquí en vez de ir directo: una ruta `/api/kavita/*` y otra `/api/abs/*` que repitan la
petición contra `localhost` poniendo la clave aquí, y que la app use su propio testigo
de sesión de Yoru. Así la clave no saldría nunca de este PC. Tiene trabajo de verdad:
hay que pasar el `Range` para que el audio se pueda mover, y las portadas y las pistas
van por `?token=` en la dirección porque un `<img>` o un `<audio>` no mandan cabeceras.
No está hecho.

## Ajustes

Todo por variables de entorno, y todas tienen un valor por defecto que ya sirve:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `YORU_SYNC_PUERTO` | `3747` | Puerto donde escucha |
| `YORU_SYNC_HOST` | `0.0.0.0` | Interfaz. Ver la nota de abajo |
| `YORU_SYNC_GUILD` | `1372928430634565775` | El servidor de Discord de Yoru |
| `YORU_SYNC_DB` | `servidor-sync/datos/yoru-sync.db` | Dónde vive la base |
| `YORU_SYNC_DISCORD_API` | `https://discord.com/api` | Solo para pruebas |

Escucha en `0.0.0.0` a propósito: la dirección de Tailscale solo existe cuando
Tailscale ya levantó su interfaz, y atarse a ella haría que el servidor fallara al
arrancar con Windows, justo cuando nadie está mirando. Quien decide a quién se
contesta es la regla del cortafuegos de arriba.

## Cómo decide quién entra

1. La app manda **el token de Discord del usuario** a `POST /api/sesion`.
2. El servidor le pregunta a Discord quién es (`/users/@me`) y en qué servidores está
   (`/users/@me/guilds`).
3. Si está en el de Yoru, le devuelve un **token propio** que vale una semana. Si no
   está, 403; si el token no vale, 401; si Discord no contesta, **503 y no se echa a
   nadie** — no saber no es lo mismo que saber que no.
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

Esas dos son para Miembros, y la diferencia con `/api/progreso` a secas es toda su
seguridad: **`/api/progreso` devuelve lo tuyo entero y va por tu propia sesión;
`/api/progreso/<id>` devuelve de cualquiera solo su perfil de lectura**: sus libros y
audiolibros con su avance (`perfil`), lo último que leyó y escuchó, y si lo está
haciendo ahora (`ahora`, cuando su última lectura es de hace menos de doce minutos).
Lo que la app sube es la cuenta completa, y de ella no salen nunca el estado de cada
palabra, las tarjetas del SRS, los ajustes ni el texto de los libros. Detalles en
`docs/SINCRONIZACION_YORU.md`.

Todo sale vacío, y `comparte` es `false`, cuando esa persona apagó
«Enseñar a los miembros lo que lees» (`shareReadingWithMembers`). Un libro de su lista
negra de Discord no sale en ninguna lista.

Al arrancar con una base de antes se añade sola la columna `alias` a `usuarios`.

El 409 es la pieza que evita que dos aparatos se pisen. `baseVersion` es la versión
que el cliente leyó antes de combinar; si entretanto escribió otro, el número ya no
cuadra, el servidor dice que no y devuelve lo que hay para que el cliente lo combine y
vuelva. Sin eso, el segundo en llegar borraría lo del primero.

**Aquí no se combina nada**: el servidor guarda el bulto tal cual. Quien combina es la
app, con `mergeDatabaseExports` (`frontend/utils/cloudMerge.ts`), el mismo código que
ya combina con Google Drive. Dos combinadores distintos para los mismos datos serían
dos sitios donde perder horas de lectura.

## Pruebas

```
node servidor-sync/prueba.mjs
```

Levanta el servidor de verdad en un puerto libre, con la base en memoria y un Discord
de mentira, y recorre lo que puede salir mal: un token que no vale, alguien que no está
en el servidor, Discord caído, y dos aparatos escribiendo a la vez.

## Copias de seguridad

`servidor-sync/datos/yoru-sync.db` es todo. Copiarlo (con el servidor parado, o con
`sqlite3 yoru-sync.db ".backup copia.db"` en caliente) basta para no perder nada.
