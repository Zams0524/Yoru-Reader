# Compila el motor del lector nativo de Android (OpenReadEra EraEPUB, GPL-2.0) y lo copia a
# android/app/src/main/jniLibs/arm64-v8a/liberaepub.so. Solo hace falta para cambiar el motor:
# el binario ya está en el repositorio. Detalles: docs/NATIVE_READER.md.
# Uso, desde la carpeta del repo: powershell -ExecutionPolicy Bypass -File mobile\scripts\build-reader-engine.ps1
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$sourceUrl = 'https://github.com/champignoom/OpenReadEra.git'   # copia de OpenReadEra 21.12.11
$sourceCommit = '664251abd5584b97b5c6941a3ef5e8856d2c0efc'
$ndkVersion = '20.1.5948944'                                     # la que pide el readme del motor

$sdk = Join-Path $env:LOCALAPPDATA 'Temp\yoru-android-apk-build\sdk'
$ndk = Join-Path $sdk "ndk\$ndkVersion"
if (-not (Test-Path (Join-Path $ndk 'ndk-build.cmd'))) {
  Write-Host "Instalando el NDK $ndkVersion..." -ForegroundColor Cyan
  $env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Temp\yoru-android-apk-build\jdk'
  $sdkmanager = Get-ChildItem -Path (Join-Path $sdk 'cmdline-tools') -Recurse -Filter 'sdkmanager.bat' | Select-Object -First 1
  if (-not $sdkmanager) { throw "No se encontró sdkmanager en $sdk\cmdline-tools." }
  & $sdkmanager.FullName --sdk_root=$sdk "ndk;$ndkVersion"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el NDK.' }
}

# Ruta corta: ndk-build en Windows falla con las rutas largas de los objetos del motor.
$work = Join-Path $env:LOCALAPPDATA 'Temp\ore'
$src = Join-Path $work 'src'
if (-not (Test-Path (Join-Path $src '.git'))) {
  New-Item -ItemType Directory -Force $work | Out-Null
  git clone $sourceUrl $src
  if ($LASTEXITCODE -ne 0) { throw 'git clone falló.' }
}
git -C $src fetch --quiet origin
git -C $src checkout --quiet $sourceCommit
if ($LASTEXITCODE -ne 0) { throw "No se encontró el commit $sourceCommit." }
$jni = Join-Path $work 'jni'
if (Test-Path $jni) { Remove-Item -Recurse -Force $jni }
robocopy $src $jni /E /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host 'Compilando eraepub (arm64-v8a)...' -ForegroundColor Cyan
Push-Location $work
try {
  # -include cmath: EraEpubTexts/EraEpubLinks usan funciones de <cmath> sin incluirlo.
  & (Join-Path $ndk 'ndk-build.cmd') -j $env:NUMBER_OF_PROCESSORS `
    NDK_PROJECT_PATH=. APP_BUILD_SCRIPT=jni/Android.mk `
    APP_ABI=arm64-v8a APP_PLATFORM=android-24 APP_STL=c++_static `
    'APP_CFLAGS=-no-integrated-as -w' 'APP_CPPFLAGS=-include cmath' eraepub
  if ($LASTEXITCODE -ne 0) { throw 'ndk-build falló.' }
} finally { Pop-Location }

$built = Join-Path $work 'obj\local\arm64-v8a\eraepub'
$strip = Get-ChildItem -Path (Join-Path $ndk 'toolchains') -Recurse -Filter 'aarch64-linux-android-strip.exe' | Select-Object -First 1
$dest = Join-Path $repo 'android\app\src\main\jniLibs\arm64-v8a\liberaepub.so'
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
& $strip.FullName -o $dest $built
if ($LASTEXITCODE -ne 0) { throw 'strip falló.' }
Write-Host "LISTO: $dest ($((Get-Item $dest).Length) bytes)" -ForegroundColor Green
