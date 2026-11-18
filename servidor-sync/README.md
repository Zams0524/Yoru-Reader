# Servidor de sincronización de Yoru

Guarda el progreso de lectura de cada miembro del Discord de Yoru (libros, posición,
marcadores, estados de palabras, tarjetas del SRS y ajustes) en el PC de zams. La app
lo alcanza por **Tailscale**, así que no hay nada publicado en internet: quien no esté
en el tailnet no llega.

- Dirección: `http://desktop-go1ujdd.tail6db786.ts.net:3747`
- IP de Tailscale: `100.121.94.3`
- Base de datos: `servidor-sync/datos/yoru-sync.db` (SQLite, git la ignora)

## Arrancarlo

Doble clic en **`INICIAR-SERVIDOR-SYNC.bat`**, o desde una terminal:

```
node servidor-sync/servidor.mjs
```

No hay nada que instalar: usa solo lo que trae Node (`node:http`, `node:sqlite`).
Hace falta **Node 22.5 o más nuevo** (el PC tiene 24.20).

Para comprobar que está vivo, desde cualquier equipo del tailnet:

```
curl http://desktop-go1ujdd.tail6db786.ts.net:3747/api/salud
```

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

## Dar acceso a los miembros (compartir el equipo)

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
| `POST` | `/api/sesion` | `{ accessToken }` → `{ token, expiraEn, usuarioId, nombre }` |
| `DELETE` | `/api/sesion` | Cierra la sesión de ese token |
| `GET` | `/api/progreso` | **Lo tuyo, entero**: `{ version, actualizadoEn, datos }` |
| `PUT` | `/api/progreso` | `{ baseVersion, datos }` → `{ version, actualizadoEn }`, o **409** |
| `GET` | `/api/progreso/<id>` | **De cualquiera, reducido**: `{ usuarioId, nombre, comparte, leyendo }` |
| `GET` | `/api/miembros` | Lo mismo para todos: `{ miembros: [...] }` |

Las dos últimas son para la tarjeta de Miembros, y la diferencia con `/api/progreso`
a secas es toda su seguridad: **`/api/progreso` devuelve lo tuyo entero y va por tu
propia sesión; `/api/progreso/<id>` devuelve de cualquiera solo un libro y un
porcentaje.** Lo que la app sube es la biblioteca completa —todos los libros, el
estado de cada palabra, las tarjetas del SRS, los ajustes—, y devolver eso a quien
pregunte convertiría una tarjeta de «qué está leyendo fulano» en una copia de su
cuenta. Nadie que entre con Discord espera eso.

`leyendo` es `null`, y `comparte` es `false`, cuando esa persona apagó
«Enseñar a los miembros lo que lees» (`shareReadingWithMembers`) o cuando el libro
está en su lista negra de Discord: un libro escondido allí no asoma por aquí.

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
