# Skill: publicar-apk
Úsalo cuando el usuario pida publicar, subir o lanzar el APK de Android.

## REGLA OBLIGATORIA
**Siempre preguntar al usuario si puede publicarse antes de ejecutar nada.** El usuario ha dicho explícitamente "Todavía no publiques el APK sin preguntar". Esto no tiene excepción.

## Pasos (solo si el usuario confirma)
1. Verificar que el APK compilado existe en `mobile/releases/`:
   ```powershell
   Get-ChildItem mobile\releases\*.apk | Sort-Object LastWriteTime | Select-Object -Last 3
   ```
2. Comprobar la versión actual publicada (para no regresar):
   ```powershell
   Get-Content mobile\mobile-stable.json
   ```
3. Verificar que `android/app/build.gradle` tiene el versionCode/versionName correcto para lo que se va a publicar.
4. Ejecutar la publicación:
   ```powershell
   .\publish-apk.ps1
   ```
   O doble clic en `PUBLICAR-APK.bat`.
5. Confirmar que `mobile/mobile-stable.json` se actualizó y se hizo push.
6. Informar al usuario con la versión publicada y el link a la release.

## Qué hace el script
- Sube el APK como `Yoru-Reader.apk` a la release `latest` de GitHub.
- Reescribe y empuja `mobile/mobile-stable.json` (la app Android compara ese `appVersion` con `CapacitorApp.getInfo().version`).
- **No toca** `mobile/mobile-ota.json` — eso lo gestiona el workflow de GitHub Actions.
