# Yoru Reader

Una app para aprender japonés leyendo: lector de novelas, diccionario al toque, repaso espaciado y estadísticas de lectura, en el escritorio y en Android. Entras con tu cuenta de Discord y tu progreso te sigue de un aparato a otro.

<img width="1914" height="1078" alt="La pantalla de inicio de Yoru Reader en el escritorio" src="docs/capturas/inicio.png" />

Abres un EPUB, un PDF, un TXT o unos subtítulos, lo lees en vertical u horizontal, y cuando una palabra no te suena la tocas: sale su lectura, su significado, el acento y la frecuencia, reconocida aunque esté conjugada. Si quieres recordarla, va a tu mazo y Yoru te la pregunta cuando toca, con el mismo algoritmo (FSRS) que usa Anki. Mientras tanto lleva la cuenta de los caracteres que has leído, a qué ritmo y cuánto tiempo, libro a libro.

## Instalación

1. Descarga la versión de tu sistema desde la [última release](https://github.com/Zams0524/Yoru-Reader/releases/latest):

   | Sistema | Archivo |
   | :--- | :--- |
   | Windows (x64) | [`Yoru-Reader.Setup.exe`](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader.Setup.exe) |
   | Android 7.0 o más nuevo | [`Yoru-Reader.apk`](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader.apk) |
   | macOS con Apple Silicon | [`Yoru-Reader-arm64.dmg`](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-arm64.dmg) |
   | macOS con Intel | [`Yoru-Reader-x64.dmg`](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-x64.dmg) |
   | Linux (x86_64) | [`Yoru-Reader-x86_64.flatpak`](https://github.com/Zams0524/Yoru-Reader/releases/latest/download/Yoru-Reader-x86_64.flatpak) |

2. Instálala:

   - **Windows**: el instalador aún no está firmado, así que SmartScreen avisa de un «editor desconocido». Pulsa **Más información → Ejecutar de todas formas**.
   - **Android**: abre el APK y deja que tu navegador o gestor de archivos instale apps desconocidas. Para actualizar, instala la versión nueva encima de la anterior: si desinstalas, pierdes lo que no esté sincronizado.
   - **Linux**:

     ```sh
     flatpak install --user Yoru-Reader-x86_64.flatpak
     flatpak run com.yorureader.app
     ```

3. Abre Yoru y entra con Discord. La app es para los miembros del servidor de Yoru Cafe: lo comprueba una vez y después no vuelve a molestar. La primera vez instala sola los diccionarios, y a partir de ahí se actualiza sola cuando sale una versión nueva.

Para leer, pulsa **+** e importa una novela desde tu aparato, o abre una de la biblioteca compartida en **Explorar Kavita**. Los audiolibros están en **Audiolibros**.

## Desarrollo local

Requisitos: Node 22 o más nuevo y npm. Para compilar el APK, además, Android Studio con el JDK 21.

```sh
npm install
cp .env.example .env.local   # rellena los valores de Google OAuth (sincronización con Drive)
npm run dev                  # la interfaz, en http://localhost:5173
npm run electron:start       # la app de escritorio, en otra terminal
```

Es un solo frontend en React + Vite (`frontend/`) que se empaqueta con Electron para el escritorio (`backend/`) y con Capacitor para Android (`android/`). El servidor de sincronización vive en `servidor-sync/` y tiene su propio [README](servidor-sync/README.md).

En Windows, `COMPILAR-APK.bat` deja el APK firmado en `mobile/releases/`. Las versiones de escritorio las compila y publica [GitHub Actions](.github/workflows/build-all-releases.yml) con cada cambio que entra en `main`.

Yoru no recopila analíticas ni telemetría: qué servicios externos usa y cuándo está en la [política de privacidad](docs/PRIVACY.md). La firma de los instaladores de Windows sigue la [política de firma de código](docs/CODE_SIGNING_POLICY.md).

## Contribución y atribución

<table>
    <tr>
        <td align="center">
            <a href="https://github.com/Zams0524">
                <img src="https://github.com/Zams0524.png?size=100" width="100;" alt="Zams0524"/>
                <br />
                <sub><b>Zams0524</b></sub>
            </a>
        </td>
    </tr>
</table>

Yoru Reader es software libre bajo la [GPL-2.0-or-later](LICENSE). Hasta la 1.3.x era MIT; cambió al incorporar el motor de lectura nativo de Android.

- El lector nativo de Android usa el motor **EraEPUB** de [OpenReadEra](https://readera.org/open-readera) (© READERA LLC, GPL-2.0), basado en [CoolReader / crengine](https://github.com/buggins/coolreader). `liberaepub.so` se compila sin cambios desde OpenReadEra 21.12.11 ([código usado](https://github.com/champignoom/OpenReadEra/tree/664251abd5584b97b5c6941a3ef5e8856d2c0efc)); cómo compilarlo, en [docs/NATIVE_READER.md](docs/NATIVE_READER.md).
- La extensión de lectura del escritorio (`backend/reader-ext`) es una versión modificada de [Jiten Reader](https://github.com/Sirush/JitenReader), basada a su vez en [Anki JPDB Reader](https://github.com/Kagu-chan/anki-jpdb.reader), las dos MIT ([licencia](backend/reader-ext/LICENSE.md)).
