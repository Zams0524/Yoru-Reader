<!-- claude-projects-attribution -->
_Requested by **zams** · [project thread](https://claude.ai/code/project/chan_01RiZpfzpFGLk8WJMKHzPkMJ?thread=cmsg_01RiZpfzpFGLk8WJMKHzPkMJ3V68reW5Jz5LNREoCjHcVb)_

## fix(ui): la interfaz de teléfono también en tablets, ampliada

### Problema

En la Redmi Pad Pro la biblioteca salía rota: el menú lateral se quedaba abierto empujando el contenido, el título «Novelas» aparecía enorme y sin barra, y la página se desplazaba en horizontal. En PC y en teléfono se veía bien.

**Causa raíz:** el armazón de React y la hoja de estilos usaban criterios distintos para decidir qué interfaz mostrar.

- `Library.tsx` elegía la interfaz compacta con `Capacitor.getPlatform() === 'android' || innerWidth <= 768 || /Android|Mobile/.test(userAgent)`. Una tablet Android cumple la primera condición, así que siempre recibía el **marcado de teléfono**.
- Todo el CSS de teléfono (incluido el bloque `html.platform-android`) vive dentro de `@media (max-width: 768px)`. Una tablet mide más de 768 px, así que recibía la **hoja de estilos de escritorio**.

Marcado de teléfono + estilos de escritorio = exactamente lo que se ve en la captura.

### Solución

La decisión se toma una sola vez y la leen los dos lados.

- **`frontend/utils/platform.ts`** — única fuente de verdad. `isCompactShell()` responde «¿interfaz de teléfono?» (sí en todo Android y en cualquier ventana estrecha) y `getDeviceClass()` responde «¿de qué tamaño?» (`phone` ≤768, `tablet` 769–1279, `desktop` ≥1280). `applyDeviceClasses()` refleja ambas en `<html>` como `yoru-compact` y `yoru-phone` / `yoru-tablet` / `yoru-desktop`, más `yoru-touch`; `watchDeviceClass()` sigue la rotación, la pantalla dividida y el redimensionado.
- **`frontend/hooks/useDeviceClass.ts`** (nuevo) — hook que re-renderiza al cambiar y mantiene las clases de `<html>` sincronizadas, de modo que el marcado y el CSS ya no pueden discrepar.
- **`frontend/index.css` y `frontend/yoru-design-system.css`** — los 21 bloques `@media (max-width: 768px)` y `@media (min-width: 769px)` pasan a estar condicionados por la clase en lugar de por el ancho: cada selector lleva `:where(.yoru-compact)` o `:where(:not(.yoru-compact))`. `:where()` tiene especificidad cero, así que la especificidad y el orden de cascada no cambian en absoluto, y los bloques de 480 y 680 px siguen siendo solo de teléfono.
- **Nueva sección «Compact shell on a big screen»** — amplía esa misma interfaz en tablet: márgenes que crecen con la pantalla, barra superior de 64 px con iconos de 48, varias tarjetas de libro por fila (2 en vertical, 3 en horizontal) con portada de 92 px, cabeceras de sección mayores, barra inferior de 72 px con las pestañas agrupadas en el centro en vez de estiradas de esquina a esquina, y cajón de 340 px. Áreas seguras de Android respetadas en los cuatro lados.
- **`frontend/components/Library.tsx`** — `isMobile` pasa a venir del hook. Los gestos de deslizamiento quedan limitados a la interfaz compacta. Discord RPC y los atajos de teclado pasan de `!isMobile` a `hasDesktopIntegrations()` (Electron), para que no dependan de «pantalla ancha».

### Comprobado

Render con Playwright del CSS real, comparando estilos computados de **todos** los elementos antes y después del parche:

| Ancho | Antes vs. después |
|---|---|
| 360 px | sin cambios |
| 412 px | sin cambios |
| 480 px | sin cambios |
| 768 px | sin cambios |
| 1024 px (PC) | sin cambios |
| 1366 px (PC) | sin cambios |
| 1920 px (PC) | sin cambios |

(La única diferencia detectada fue un redondeo de subpíxel en el `translateX` del cajón cerrado, muestreado a mitad de su transición.)

En tablet, con áreas seguras de Android simuladas: 800×1280 da 2 columnas y 1280×800 da 3, sin desplazamiento horizontal en ningún ancho. Capturas en `tablet-vertical-800.png` y `tablet-horizontal-1280.png`.

### Falta por hacer

No se ha compilado el APK ni se ha probado en la tablet física. Hace falta `npm run build` y una instalación en la Redmi Pad Pro para confirmarlo en el aparato.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01VYXySmM52hbTjE74RzPsVo
