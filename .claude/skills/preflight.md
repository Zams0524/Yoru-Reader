# Skill: preflight
Comprobaciones rápidas antes de cualquier operación de riesgo (push, publicar APK, mergear branches, hacer rebuild grande).

## Ejecutar siempre antes de pushear o publicar
```powershell
cd "C:\Users\Zams\Documents\Codex\2026-10-16\co\work\Yoru-Reader"

# 1. Estado del repo
git status -sb

# 2. Cuántos commits adelante/atrás de origin/main
git rev-list --left-right --count origin/main...HEAD

# 3. Versión actual en package.json y build.gradle
Select-String -Path package.json -Pattern '"version"' | Select-Object -First 1
Select-String -Path android\app\build.gradle -Pattern 'versionCode|versionName'

# 4. Último APK publicado
Get-Content mobile\mobile-stable.json | ConvertFrom-Json | Select-Object appVersion, publishedAt
```

## Señales de alerta
- Cambios no commiteados en `android/`, `capacitor.config.json` o dependencias Capacitor → hay que subir `versionCode` antes de publicar OTA de Android.
- `git rev-list` muestra commits en `origin/main` que no están en HEAD → hacer `git pull --rebase` antes de pushear.
- `mobile-stable.json` tiene una versión igual o mayor a la que se quiere publicar → no publicar.

## Reglas permanentes (no negociables)
- Nunca borrar `android/keystore/yoru-reader-debug.keystore`.
- Nunca publicar el APK sin confirmar con el usuario primero.
- Nunca mergear ramas de side-sessions sin instrucción explícita del usuario.
