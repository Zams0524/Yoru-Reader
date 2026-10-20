# Skill: subir-version
Úsalo cuando el usuario pida "sube la versión", "bump version", o preparar una nueva release.

## Archivos que hay que actualizar (siempre los mismos)
| Archivo | Qué cambiar |
|---|---|
| `package.json` | `"version"` |
| `android/app/build.gradle` | `versionCode` (entero, incrementar) y `versionName` (string, e.g. "1.4.1") |

El instalador de Windows y la OTA de escritorio toman la versión de `package.json`. El APK de Android usa `build.gradle`. Deben coincidir en el `versionName` / `version`.

## Cuándo también hay que subir versionCode en build.gradle
Siempre que cambie algo nativo de Android:
- `android/` (Java, recursos, permisos)
- `capacitor.config.json`
- Dependencias de Capacitor/Cordova en `package.json`

Si no cambia nada nativo, se puede subir solo `package.json` (la OTA de escritorio usará la nueva versión; la OTA de Android también, mientras el `versionCode` coincida con el APK instalado).

## Verificar antes de hacer commit
```powershell
Select-String -Path package.json -Pattern '"version"'
Select-String -Path android\app\build.gradle -Pattern 'versionCode|versionName'
```

## Commit sugerido
```
chore: bump to vX.Y.Z
```
