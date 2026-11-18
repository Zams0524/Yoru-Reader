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
| `GET` | `/api/progreso` | `{ version, actualizadoEn, datos }` |
| `PUT` | `/api/progreso` | `{ baseVersion, datos }` → `{ version, actualizadoEn }`, o **409** |

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
