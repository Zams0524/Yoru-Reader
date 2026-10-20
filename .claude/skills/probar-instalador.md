# Skill: probar-instalador
Úsalo cuando haya que verificar el instalador de Windows (NSIS) sin hacer una instalación real.

## Construir el instalador sin npm run build completo
```powershell
node node_modules\electron-builder\cli.js --win nsis --x64 --prepackaged dist-electron\Yoru-Reader-win32-x64 --config.directories.output=C:\Temp\yoru-installer-test
```
Necesita que `dist-electron\Yoru-Reader-win32-x64` exista (del último `npm run electron:build` o de la carpeta `releases/stable/`).

## Regenerar las imágenes del instalador (sidebar/header)
```powershell
.\build\make-installer-art.ps1
```
Regenera `build/installerSidebar.bmp` y `build/installerHeader.bmp` a 2x de escala. Ejecutar antes de reconstruir el instalador si se cambiaron colores o iconos.

## Probar el instalador SIN instalarlo (inspección visual)
```powershell
# Lanza el instalador y captura pantalla con un script externo
Start-Process "C:\Temp\yoru-installer-test\Yoru-Reader.Setup.exe"
```
Para verificar que los diálogos se ven bien: hacer screenshot manual o usar el script de inspección Win32 que recorre ventanas `#32770`.

## Probar el ejecutable compilado SIN tocar el perfil real
```powershell
$tmp = "$env:TEMP\yoru-test-$(Get-Random)"
New-Item -ItemType Directory $tmp | Out-Null
& "dist-electron\Yoru-Reader-win32-x64\Yoru-Reader.exe" --user-data-dir=$tmp --proxy-server=127.0.0.1:9
```
El `--proxy-server=127.0.0.1:9` bloquea toda red (evita que descargue actualizaciones reales).

## Archivos de tema
- `build/installer.nsh` — macros MUI2 (paleta oscura, DPI-aware, Segoe UI, botones oscuros)
- `build/make-installer-art.ps1` — genera los BMP del instalador
- `package.json` → sección `"nsis"` → `installerLanguages`, `displayLanguageSelector`, etc.
