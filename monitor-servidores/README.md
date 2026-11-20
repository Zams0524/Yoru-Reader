# Monitor de los servidores de Yoru

Un programa aparte de la app. Vive en el PC de zams, que es donde están las cuatro
cosas de las que depende la app de todo el mundo, y hace dos trabajos:

- **Enseña** si Tailscale, el servidor de sincronización, Kavita y Audiobookshelf
  están encendidos y se alcanzan desde internet, y si no, en qué punto se corta.
- **Enciende** lo que esté apagado: al abrirlo, con un botón, y solo cuando algo se
  cae mientras está abierto.

Existe porque la app solo sabe decir «el servidor no responde», y eso son muchas
averías distintas.

## Abrirlo

Doble clic en **`ABRIR-MONITOR.bat`**. Enciende lo que falte y abre el panel en el
navegador: `http://127.0.0.1:3748/`.

No hay nada que instalar: usa solo lo que trae Node, como `servidor-sync/`.

Cerrar la ventana deja de vigilar, pero **no apaga nada**: los servidores siguen.
Abrirlo estando ya abierto no arranca otro: enciende lo apagado y enseña el panel.

Para verlo en la consola, sin panel:

```
node monitor-servidores/monitor.mjs --estado
```

## Qué mira

Cada servicio se comprueba por pasos, de dentro afuera. El primero que falla es la
avería.

| Servicio | Pasos |
| --- | --- |
| **Tailscale** | El servicio de Windows está abierto · está conectado al tailnet · Funnel tiene abiertos los puertos 443, 8443 y 10000 y cada uno apunta a su servidor |
| **Sincronización de Yoru** | Contesta en este PC (`:3747/api/salud`) · tiene las claves que reparte · se alcanza desde internet |
| **Kavita** | El programa está abierto · contesta en este PC (`:5000`) · acepta la clave que la app recibe · se alcanza desde internet (`:8443`) |
| **Audiobookshelf** | El programa está abierto · contesta en este PC (`:13378`) · acepta el testigo que la app recibe · se alcanza desde internet (`:10000`) |

Los colores:

- **Verde**: todo en orden.
- **Ámbar**: el programa funciona en el PC, pero algo impide que la app lo use: la
  salida a internet o la clave. Reabrir el programa no lo arregla, así que el monitor
  no lo intenta; dice qué es.
- **Rojo**: no contesta en el PC. Esto sí se enciende.

El paso de la clave es el que más cuesta ver desde la app: si alguien regenera la
clave en Kavita, todo sigue encendido y aun así nadie entra, porque
`servidor-sync/.env` se quedó con la vieja. Se pregunta cada cinco minutos. Las claves
se leen de ese `.env` y no salen de este proceso: ni al panel, ni al registro.

## Qué hace para encender

| Qué | Cómo |
| --- | --- |
| Kavita | Abre `C:\Kavita\Kavita.exe`, minimizado |
| Audiobookshelf | Abre `C:\Audiobookshelf\AudiobookshelfTray.exe` |
| Sincronización | Lanza la tarea programada `Yoru sync`; si Windows no deja sin ser administrador, abre `servidor-sync/servidor.mjs` en una ventana minimizada |
| Tailscale parado | Arranca el servicio de Windows. **Sale el aviso de permisos de Windows**: hay que aceptarlo |
| Tailscale desconectado | `tailscale up` |
| Funnel sin un puerto | `tailscale funnel --bg --https=<puerto> <destino>`, solo para el que falte |

Lo que no puede arreglar solo, y lo dice: Tailscale sin sesión iniciada, y una clave
que el servidor rechaza.

## Las dos opciones del panel

- **Reencender solo lo que se caiga** (puesta de fábrica). Con el monitor abierto, si
  un servidor deja de contestar lo vuelve a abrir, un intento por minuto como mucho.
  Quítala si vas a cerrar Kavita a propósito.
- **Abrir el monitor al iniciar sesión en Windows**. Deja un fichero en la carpeta de
  Inicio de Windows que arranca el monitor sin ventana. Con las dos puestas, después
  de reiniciar el PC todo queda encendido sin tocar nada. Apunta a la carpeta desde la
  que se activó: si el repositorio se muda, hay que quitarla y volver a ponerla.

## Qué ha pasado

El panel guarda un registro: cada vez que algo se cae, vuelve o se enciende, con la
hora y el motivo. Queda también en `monitor-servidores/datos/registro.jsonl` (git lo
ignora), así que sobrevive a cerrar el monitor. Solo apunta mientras está abierto.

## Ajustes

Todo tiene un valor que ya sirve en este PC. Las variables están para una mudanza:

| Variable | Por defecto |
| --- | --- |
| `YORU_MONITOR_PUERTO` | `3748` |
| `YORU_MONITOR_HOST` | `desktop-go1ujdd.tail6db786.ts.net` |
| `YORU_MONITOR_KAVITA_EXE` | `C:\Kavita\Kavita.exe` |
| `YORU_MONITOR_ABS_EXE` | `C:\Audiobookshelf\AudiobookshelfTray.exe` |
| `YORU_MONITOR_TAILSCALE_EXE` | `tailscale` |
| `YORU_MONITOR_SYNC_DIR` | `../servidor-sync` |
| `YORU_MONITOR_SYNC_TAREA` | `Yoru sync` |

## Quién puede usar el panel

Solo este PC. El panel escucha en `127.0.0.1`, no en la red. Y como lo que hace es
abrir programas, tampoco obedece a cualquier página abierta en el navegador: los
botones mandan un testigo que solo conoce la página que sirve el propio monitor, y se
comprueba la cabecera `Host`.

## Probarlo

```
node monitor-servidores/prueba.mjs
```

No toca el PC: usa un PC de mentira al que se le apaga Kavita, se le desconecta
Tailscale o se le rompe una clave, y comprueba que el panel diga la avería correcta y
que «encender» lance justo lo que hace falta.
