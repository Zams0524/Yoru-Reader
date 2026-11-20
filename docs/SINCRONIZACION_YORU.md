# Sincronización de progreso de Yoru (Discord + Tailscale)

Tu progreso te sigue del PC al teléfono sin configurar nada. Entras con Discord —que
ya es la puerta de Yoru— y a partir de ahí los libros, por dónde vas, los marcadores,
los estados de palabras, las tarjetas del SRS y los ajustes se guardan en el servidor
de Yoru, que corre en el PC de zams y se alcanza por **Tailscale**.

Nada de esto está publicado en internet: un nombre `.ts.net` no resuelve fuera del
tailnet, así que quien no esté dentro no llega ni a la puerta.

## Las piezas

| Dónde | Qué |
| --- | --- |
| `servidor-sync/servidor.mjs` | El servidor. Node a secas + SQLite, sin dependencias |
| `servidor-sync/README.md` | Cómo arrancarlo, dejarlo arrancado y el cortafuegos |
| `frontend/utils/yoruSyncNucleo.ts` | Las decisiones (cuándo, qué significa cada fallo). Puro |
| `frontend/utils/yoruSyncService.ts` | El trato con el servidor: bajar, combinar, subir |
| `frontend/hooks/useYoruSync.ts` | Quién la arranca y cuándo. Lo monta `App`, que es lo único que está siempre: `YoruShell` no existe con un libro abierto, y `Library` solo en Catálogo, SRS y Ajustes |
| `frontend/components/settings/YoruSyncSettings.tsx` | La tarjeta de Ajustes |
| `frontend/config/serverDefaults.ts` | La dirección del servidor |
| `tests/yoru-sync.test.ts` | Pruebas de las decisiones |
| `servidor-sync/prueba.mjs` | Pruebas del servidor, con un Discord de mentira |

- Dirección: `https://desktop-go1ujdd.tail6db786.ts.net` (Tailscale Funnel; sin puerto,
  porque Funnel solo sirve el 443, el 8443 y el 10000)
- Dentro del tailnet el mismo servidor sigue en
  `http://desktop-go1ujdd.tail6db786.ts.net:3747`
- Se puede apuntar a otro sitio con `VITE_YORU_SYNC_URL` en `.env.local`. Vacía,
  la sincronización queda apagada y la app funciona como antes.

Funnel es lo que hace que **nadie tenga que instalar Tailscale**: la primera versión
apuntaba al nombre del tailnet, y ese nombre no resuelve para quien no esté dentro, así
que cada miembro habría tenido que instalarlo y aceptar una invitación antes de poder
usar la app (decisión de zams, 18 nov 2026). El precio es que el PC queda al alcance de
internet, y de ahí el freno de `POST /api/sesion`: diez fallos por dirección cada diez
minutos y luego 429. Los aciertos no cuentan.

## Cómo se identifica cada uno

La identidad la pone Discord, no Yoru:

1. La app manda **el token de Discord del usuario** a `POST /api/sesion`.
2. El servidor pregunta a Discord quién es y en qué servidores está.
3. Si está en el de Yoru (`1372928430634565775`), recibe un **token propio** que vale
   una semana; el resto de peticiones van con ese. Así el token de Discord no viaja en
   cada petición y Discord no recibe una pregunta por cada página que alguien pasa.
4. Si no está, 403. Si el token no vale, 401. **Si Discord no contesta, 503 y no se
   echa a nadie**: no saber no es lo mismo que saber que no, igual que en
   `discordAccess.ts`.

El servidor no guarda el token de Discord de nadie ni la lista de servidores en los
que está: solo su ID, su nombre y su progreso.

## Qué se sube, y quién combina

Lo mismo que se sube a Google Drive: `db.exportFullDatabase()`. Y se combina con el
mismo `mergeDatabaseExports` (`frontend/utils/cloudMerge.ts`), que es lo importante:
**hay un solo sitio donde se decide qué copia de un libro gana**. Dos combinadores
distintos para los mismos datos serían dos sitios donde perder horas de lectura, y el
segundo se descubriría tarde.

El servidor no combina nada: guarda el bulto y lleva un contador de versiones. Si
entre que la app lee y escribe ha escrito otro aparato, contesta **409**, y la app
vuelve a empezar con lo que haya. Eso es lo que impide que, leyendo en el PC y en el
móvil a la vez, el segundo en llegar borre lo del primero.

### Un perfil por cuenta, aunque cambie el identificador

El perfil se crea solo al entrar con Discord, con un identificador nuevo en cada
instalación (`profile-<fecha>`), y el combinador junta los perfiles por identificador.
Sin más, quien borra los datos de la app o la instala en otro aparato recibe su
progreso en un perfil aparte y se queda con el recién creado, vacío, como activo:
Inicio en blanco con todo guardado al lado.

Por eso, antes de combinar, `reconciliarPerfiles()` (`yoruSyncNucleo.ts`) quita los
perfiles **vacíos** que se llaman igual que otro —o el único perfil vacío de un aparato
recién estrenado— y deja como activo el que tiene los datos. Dos perfiles con datos no
se funden nunca: eso no tiene vuelta atrás.

Esto **no sustituye a Google Drive**: son dos sitios donde dejar lo mismo, y quien
tenga Drive configurado lo sigue teniendo igual.

### El progreso de Kavita y de Audiobookshelf también va

Un tomo abierto directamente del servidor no es un libro de la biblioteca: su progreso
se apunta por perfil en `localStorage` (`utils/serverProgress.ts`), y lo mismo el de
los audiolibros. Hasta el 20 nov 2026 eso no entraba en `exportFullDatabase()`, así
que **no salía nunca del aparato**: como casi todo se lee ya desde el servidor, el
progreso no pasaba del teléfono al PC por mucho que la sincronización dijera «Al día».

Ahora va en cada perfil como `serverProgress: { kavita, audiobooks }`, y el combinador
lo junta entrada por entrada: gana la que se tocó más tarde (`at`). «Eliminar» una
serie de la Biblioteca no borra su entrada, la deja marcada (`borrado`) con su fecha,
para que el otro aparato no la devuelva. Cuando lo único que llega es esto, la pantalla
no se recarga: Inicio se repinta con `LOCAL_PROGRESS_EVENT`.

## Cuándo se sincroniza

- **Al abrir la app**: en los dos sentidos, tras dos segundos de espera.
- **Al volver a la app** (del fondo en el teléfono, al foco de la ventana en el PC), si
  no hay un libro abierto: en los dos sentidos, como mucho cada dos minutos. Es el
  momento en que se cambia de aparato; sin esto, una app que se quedó abierta no se
  enteraba nunca de lo leído en el otro.
- **Al irse al fondo**: se sube siempre y sin esperar turno, haya o no un libro abierto.
- **Cada 5 minutos con la app abierta, también leyendo, y al cerrar un libro**: solo se
  sube. No se le cambia la biblioteca por debajo a quien acaba de salir de su libro;
  eso parece un fallo aunque sea correcto.
- **A mano**: botón «Sincronizar ahora» en Ajustes → Sincronización de Yoru.

Con un libro abierto nunca se recarga la pantalla.

Si la combinación trae cosas de otro aparato, la pantalla se recarga, como mucho una
vez por minuto: sin ese tope, una combinación mal hecha dejaría la app recargándose
sola para siempre y no habría forma de llegar a Ajustes a apagarla.

Nada de esto estorba. Sin red, con el PC de zams apagado o con el token caducado, la
app se abre y se lee igual; lo único que pasa es que el progreso espera.

## Qué ven los demás miembros

Desde el 20 nov 2026 un miembro ve de otro **su perfil de lectura**: sus libros, sus
audiolibros, por dónde va en cada uno, y si está leyendo o escuchando ahora mismo.
Antes era un libro y un porcentaje; zams pidió que la tarjeta de Miembros abriera el
perfil del otro como se ve el propio.

Dos rutas, las dos con sesión:

- `GET /api/miembros`: la ficha corta de todos los que han sincronizado. Es lo que
  pregunta la lista de Miembros cada minuto.
- `GET /api/progreso/<usuarioId>`: la misma ficha con `perfil`, sus dos listas. Es
  lo que pregunta «Ver perfil».

En la app, `fichasDeMiembros()` y `fichaDeMiembro(id)` en `yoruSyncService.ts`.

```json
{ "usuarioId": "111", "nombre": "zams", "alias": ["zams", "zams0524"],
  "actualizadoEn": 1795016000000, "comparte": true,
  "leyendo": { "origen": "local", "titulo": "よつばと!", "autor": "Azuma Kiyohiko",
               "portada": "", "capitulo": "Capítulo 2", "porcentaje": 43,
               "estado": "leyendo", "ultimaLectura": 1795010000000 },
  "escuchando": { "itemId": "abs-1", "titulo": "キノの旅", "autor": "時雨沢恵一",
                  "porcentaje": 25, "ultimaEscucha": 1794900000000 },
  "ahora": "leyendo",
  "perfil": { "libros": [ … ], "audiolibros": [ … ] } }
```

- **`ahora`** es `"leyendo"`, `"escuchando"` o `null`. Lo decide el servidor: lo último
  que hizo, si fue hace menos de doce minutos (`VENTANA_AHORA_MS`). La app sube cada
  cinco minutos mientras se lee, así que con doce de margen quien está leyendo no
  parpadea entre subida y subida. No es tiempo real: va con el retraso de la última
  subida.
- **`alias`** son los nombres por los que se reconoce a esa cuenta en la lista de
  Discord. La lista sale del widget, que no da el id de Discord, así que se casa por
  nombre (`fichaPara` en `miembrosFichas.ts`). El de usuario se guarda al entrar; a
  quien entró antes de este cambio le aparece cuando renueve la sesión (como mucho,
  una semana).
- **Los libros** son los importados y las series que se leen en Kavita sin importar
  (`origen: "kavita"`, con `seriesId` y `volumeId`). De las de Kavita y de los
  audiolibros no viaja portada: Kavita y Audiobookshelf son los mismos para todos, y la
  app la pide con su propia sesión (`memberCovers.ts`). De un libro importado viaja la
  suya si es pequeña (hasta 120 KB cada una y 1,5 MB entre todas); si no, sale el hueco
  con el título.

La diferencia con `GET /api/progreso` a secas sigue siendo toda la seguridad de esto:
**`/api/progreso` devuelve lo tuyo entero y va por tu propia sesión;
`/api/progreso/<id>` devuelve de cualquiera solo esa ficha**, construida campo a campo.
Lo que la app sube es la cuenta completa, y de ella no salen nunca los estados de cada
palabra, las tarjetas del SRS, los ajustes ni el texto de los libros. Hay una prueba
que lo vigila (`y no ve nada más de él` en `servidor-sync/prueba.mjs`).

El resumen de cada cuenta se guarda en memoria hasta su siguiente subida, para no
trocear megas de biblioteca en cada pregunta de la lista.

Dos formas de no salir:

- **El interruptor** «Enseñar a los miembros lo que lees» (`shareReadingWithMembers`),
  en Ajustes → Sincronización de Yoru. **Viene encendido**; apagarlo deja de enseñar
  desde la siguiente subida, también el perfil. Si zams prefiere que venga apagado, es
  cambiar el `!== false` por `=== true` en `YoruSyncSettings.tsx` y en `loCompartido()`.
- **La lista negra de Discord** (`discordBlacklist`) vale también aquí, con la misma
  regla que en `discordRpc.ts`. Un libro escondido allí no sale en ninguna lista, y si
  es justo el último que se abrió no se enseña nada.

## Android

Con la dirección de Funnel (`https`) Android no necesita ningún permiso especial: el
certificado es de verdad. Las entradas de `network_security_config.xml` para el nombre
de Tailscale y `100.121.94.3` se quedan solo para poder probar contra el PC desde
dentro del tailnet con `VITE_YORU_SYNC_URL`.

Aun así, el APK publicado lleva la dirección dentro, así que **cambiarla es cambio
nativo de hecho**: hace falta APK nuevo, no basta con una OTA.

## Probar

```
node servidor-sync/prueba.mjs      # el servidor, con un Discord de mentira
node tests/run-yoru-sync-test.mjs  # las decisiones del cliente
```

Y que el servidor está vivo, desde cualquier sitio:

```
curl https://desktop-go1ujdd.tail6db786.ts.net/api/salud
```
