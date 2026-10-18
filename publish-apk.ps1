# Publica el APK ya compilado (build-apk.ps1) en la release "latest" de GitHub como Yoru-Reader.apk
# y actualiza mobile/mobile-stable.json, que es lo que lee la app de Android para avisar de actualizaciones.
# Uso: .\publish-apk.ps1   (o doble clic en PUBLICAR-APK.bat)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$repo = 'Zams0524/Yoru-Reader'
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = 'C:\Program Files\Git\cmd\git.exe' }

$gradleFile = Get-Content -Raw 'android\app\build.gradle'
$version = [regex]::Match($gradleFile, 'versionName\s+"([^"]+)"').Groups[1].Value
$code = [int][regex]::Match($gradleFile, 'versionCode\s+(\d+)').Groups[1].Value
$apk = "mobile\releases\Yoru-Reader-$version-debug.apk"
if (-not (Test-Path $apk)) { throw "No existe $apk. Compila primero con COMPILAR-APK.bat." }
Write-Host "== Publicando Yoru Reader Android $version ($code) ==" -ForegroundColor Yellow

Write-Host '1/3 Subiendo el APK a la release latest...' -ForegroundColor Cyan
$upload = Join-Path $env:TEMP 'Yoru-Reader.apk'
Copy-Item -LiteralPath $apk -Destination $upload -Force
& $gh release upload latest $upload --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir el APK (revisa la sesion de gh).' }
Remove-Item $upload

Write-Host '2/3 Actualizando mobile/mobile-stable.json...' -ForegroundColor Cyan
$manifest = [ordered]@{
  appVersion  = $version
  versionCode = $code
  apkUrl      = "https://github.com/$repo/releases/latest/download/Yoru-Reader.apk"
  description = "Yoru Reader Android v$version"
}
$json = ($manifest | ConvertTo-Json) + "`n"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'mobile\mobile-stable.json'), $json, [Text.UTF8Encoding]::new($false))

Write-Host '3/3 Subiendo el manifiesto a GitHub...' -ForegroundColor Cyan
& $git add mobile/mobile-stable.json
& $git commit -m "chore: publish Android $version" | Out-Null
& $git push
if ($LASTEXITCODE -ne 0) { throw 'No se pudo hacer push del manifiesto.' }

Write-Host ''
Write-Host "LISTO: https://github.com/$repo/releases/latest/download/Yoru-Reader.apk" -ForegroundColor Green
