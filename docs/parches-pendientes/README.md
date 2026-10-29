# Parches pendientes

Parches preparados que todavía no se pueden aplicar sobre `main`. Se guardan aquí
para que no vivan solo en el disco de una máquina.

## tablet-responsive.patch

**Estado: no aplica sobre `main`. Falta su parche base.**

Qué pretende: que una tablet Android reciba la interfaz compacta de teléfono
(barra superior, barra inferior de pestañas, cajón lateral) pero ampliada, en vez
del marcado de teléfono con la hoja de estilos de escritorio. La decisión pasa a
`frontend/utils/platform.ts` y se refleja en `html.yoru-compact`, que sustituye a
`@media (max-width: 768px)` como condición del CSS de teléfono.

Toca 6 archivos (552 inserciones, 469 borrados):

- `frontend/components/Library.tsx`
- `frontend/hooks/useDeviceClass.ts` (nuevo)
- `frontend/index.css`
- `frontend/main.tsx`
- `frontend/utils/platform.ts`
- `frontend/yoru-design-system.css`

### Por qué no aplica

Ninguno de los cinco blobs base del parche existe en el repositorio
(`git cat-file -t 5a9c76d 92fdf4b cf05e2b 516ba85 4efd1d8` → `Not a valid object
name`), así que `git apply -3` tampoco puede resolverlo: avisa de que
`repository lacks the necessary blob to perform 3-way merge`. No es un problema de
finales de línea: `Library.tsx` normalizado a LF da el mismo blob que `main`.

El parche es el **segundo** paso de un trabajo cuyo **primer** paso nunca llegó a
`main`. Sus líneas de contexto dan por hecho que `frontend/utils/platform.ts` ya
contiene `PHONE_MAX_WIDTH`, `TABLET_MAX_WIDTH`, `getDeviceClass()`,
`isTabletUI()`, `isDesktopUI()`, `applyDeviceClasses()`, `watchDeviceClass()` y
las clases `html.yoru-phone` / `.yoru-tablet` / `.yoru-desktop`. En `main` ese
archivo tiene 15 líneas y una sola función, `isPhoneUI()`, basada en
`platform-android` y `(pointer: coarse)`.

Ese andamiaje no aparece en ninguna rama `origin/nix/*`, en ningún PR abierto ni
en ningún archivo del árbol de trabajo.

### Para retomarlo hace falta una de estas tres

1. El parche base, el que introduce `getDeviceClass` / `applyDeviceClasses` /
   `yoru-phone`, para aplicar los dos en orden.
2. La rama o el commit desde el que se generó este parche, y entonces
   `git apply -3` puede resolver los conflictos.
3. Un parche regenerado contra `main`. Es la opción más limpia, porque `main` ya
   tiene su propio `isPhoneUI()` que este parche sustituiría.

No se reconstruyó a mano: son 1.021 líneas tocadas, dos de ellas en hojas de
estilo grandes, y adivinar el andamiaje que falta daría un resultado distinto del
que se probó.
