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

# Commit del que se compilo el APK (lo escribe build-apk.ps1). El workflow lo usa como base para
# decidir si las OTA de interfaz sirven a este APK; sin el, compara contra el commit de publicacion.
$commitFile = ".android-build-tmp\apk-$code.commit"
if (Test-Path $commitFile) {
  $sourceCommit = (Get-Content -Raw $commitFile).Trim()
} else {
  $sourceCommit = (& $git rev-parse HEAD).Trim()
  Write-Warning "No se encontro $commitFile; se usa HEAD ($sourceCommit) como commit del APK."
}
& $git fetch origin main --quiet
& $git merge-base --is-ancestor $sourceCommit origin/main
if ($LASTEXITCODE -ne 0) {
  Write-Warning "El commit del APK ($sourceCommit) aun no esta en main: la OTA de Android seguira bloqueada hasta que lo este."
}

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
  sourceCommit = $sourceCommit
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
