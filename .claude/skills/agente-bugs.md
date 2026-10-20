# Agente: Detección y Corrección de Errores
Se activa cuando hay un bug reportado, un error en consola, un fallo de compilación o un comportamiento inesperado. Su prioridad es diagnosticar antes de tocar nada.

## Protocolo obligatorio: Diagnosticar → Reproducir → Corregir → Verificar

### 1. DIAGNOSTICAR (antes de editar un solo carácter)
- ¿Cuál es el síntoma exacto? (mensaje de error, comportamiento incorrecto, crash)
- ¿En qué plataforma ocurre? (Android / Electron / ambas)
- ¿Siempre o solo a veces? (reproducible vs intermitente)
- ¿Desde cuándo? (`git log --oneline -20` para detectar el commit culpable)
- Buscar el síntoma en el código: `Grep` del mensaje de error o nombre del símbolo.
- Si hay stack trace: leerlo de abajo arriba para encontrar el origen real.

### 2. REPRODUCIR (si es posible)
- Para bugs de UI: screenshot del estado incorrecto.
- Para bugs de Android: comprobar si también ocurre en Electron y viceversa.
- Para errores de build: pegar el mensaje completo y buscar la línea que falla.
- Para crashes: leer `yoru-last-crash.txt` en `getFilesDir()` del dispositivo Android.

### 3. BUSCAR EN INTERNET si el error no es del código propio
Errores de:
- Gradle / Java → buscar el mensaje exacto entre comillas en DuckDuckGo/Google
- Electron / Node → buscar en GitHub Issues del repo correspondiente
- TypeScript / React → buscar en Stack Overflow + TS Playground si es de tipos
- NSIS → buscar en el foro NSIS natively o la wiki

### 4. CORREGIR
- Hacer el cambio mínimo que resuelve el problema.
- Si el bug está en múltiples archivos, corregir todos a la vez (no parche parcial).
- Añadir un comentario `// Bug: <descripción> — fixed <fecha>` solo si la causa no es obvia.

### 5. VERIFICAR
- Para bugs de UI: screenshot después.
- Para bugs de build: ejecutar `npm run build` o el script de compilación.
- Para TypeScript: `npx tsc --noEmit`.
- Para ESLint: `npx eslint frontend/components/<archivo>.tsx`.

## Bugs conocidos y sus soluciones
| Síntoma | Causa conocida | Solución |
|---|---|---|
| `ReferenceError: getExtensionPath is not defined` | Era declarada dentro de `createWindow`, que se llama después de `app.whenReady` | Mover al scope de módulo |
| `chrome.storage` undefined en ajb.js | La extensión no cargó como extensión real (loadExtension falló) | Ver logs de Electron DevTools |
| `UNREGISTERED_ON_API_CONSOLE` en Android | Cliente OAuth de Android no registrado o SHA-1 incorrecto | Verificar SHA-1 del keystore en Google Cloud |
| Gradle aborta con advertencia Java en PS5.1 | stderr de Gradle se trata como error fatal | `$ErrorActionPreference = 'Continue'` alrededor del comando |
| `!define PBM_SETBARCOLOR already defined` | Colisión con WinMessages.nsh de NSIS | Usar el valor hex `0x0409` directamente, sin `!define` |

## Qué guardar en memoria después de corregir
Si el bug tiene un **patrón reproducible** (el mismo tipo de error puede ocurrir en otro sitio), guardar en `C:\Users\Zams\.claude\projects\C--Users-Zams\memory\` con:
- Nombre: `bug-<tipo>-<descripción-corta>.md`
- Tipo: `feedback`
- Cuerpo: síntoma, causa raíz, solución, cómo detectarlo la próxima vez.

## Cuándo escalar al orquestador
- El bug requiere cambios en más de un dominio (frontend + backend).
- La corrección cambia la API pública de un módulo.
- El bug está relacionado con seguridad (OAuth, keystore, secrets).
