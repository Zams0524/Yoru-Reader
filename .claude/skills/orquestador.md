# Skill: orquestador
Cómo enrutar cualquier tarea al agente correcto y cómo funciona el sistema multi-agente de Yoru Reader.

## Los 4 agentes especializados y cuándo usarlos

| Tarea que llega | Agente | Skill a invocar |
|---|---|---|
| Bug en un componente React, hook, estado UI | agente-frontend | `/agente-frontend` |
| Colores, espaciado, animaciones, instalador visual | agente-diseño | `/agente-diseño` |
| Electron, plugins Java, Gradle, CI/workflow | agente-backend | `/agente-backend` |
| Mensaje de error, crash, comportamiento inesperado | agente-bugs | `/agente-bugs` |

## Cuándo delegar a una side-session vs hacerlo inline

**Side-session** (tarea propia, puede durar varias horas, resultado en su propio commit):
- Implementar una feature nueva de varias pantallas.
- Portar un componente a Android native.
- Reescribir un pipeline de build.
- Investigar y corregir un bug complejo con pruebas.

**Inline en esta sesión** (menos de 10–15 tool calls, sin su propio commit):
- Corregir un bug sencillo en un archivo.
- Ajustar CSS o añadir un prop.
- Actualizar un texto o una constante.
- Responder preguntas sobre el código.

## Cómo delegar a una side-session con el agente correcto

Ejemplo: llega un bug de Android.
1. Invocar `/agente-bugs` para saber exactamente qué investigar.
2. Proponer una side-session con `start_session`, initiation `"own_initiative"` o `"offer"`.
3. En el brief, incluir: dominio afectado, síntoma exacto, archivos sospechosos, y la regla "toca solo tu dominio".
4. Esperar la notificación y verificar el resultado antes de reportar al usuario.

## Cómo el orquestador aprende (el sistema de memoria)

Guardar en `C:\Users\Zams\.claude\projects\C--Users-Zams\memory\` cuando:
- Se arregla un bug con un patrón reproducible → `bug-<tipo>.md`
- Se toma una decisión de diseño que afectará futuras decisiones → `decision-diseño-<tema>.md`
- Se descubre una quirk de la plataforma → `quirk-<plataforma>-<descripción>.md`
- El usuario corrige mi comportamiento → actualizar `feedback` existente o crear uno nuevo

NO guardar:
- Cambios que ya están en git (el código lo documenta).
- Detalles de implementación que se pueden deducir leyendo el archivo.
- El historial de versiones (eso es para CLAUDE.md o el changelog).

## Reglas globales del orquestador (siempre activas)
1. Antes de cualquier push o publicación → invocar `/preflight`.
2. Antes de publicar el APK → invocar `/publicar-apk` y confirmar con el usuario.
3. Nunca tocar `android/keystore/yoru-reader-debug.keystore`.
4. Nunca mergear ramas de side-sessions sin que el usuario lo pida.
5. Responder siempre en español.
6. Si algo visual está mal → hacer screenshot, no solo describirlo.
7. Si no sé algo de una API (Electron, Capacitor, Android) → buscar con `WebSearch` antes de inventar.
