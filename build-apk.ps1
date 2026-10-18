# Compila el APK de Yoru Reader para Android (mismo proceso que usaba Codex).
# Uso: clic derecho -> "Ejecutar con PowerShell", o desde PowerShell en esta carpeta: .\build-apk.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$node = 'C:\Users\Zams\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }

$gradleFile = Get-Content -Raw 'android\app\build.gradle'
$version = [regex]::Match($gradleFile, 'versionName\s+"([^"]+)"').Groups[1].Value
$code = [regex]::Match($gradleFile, 'versionCode\s+(\d+)').Groups[1].Value
Write-Host "== Yoru Reader $version ($code) ==" -ForegroundColor Yellow

Write-Host '1/4 Compilando la interfaz (Vite)...' -ForegroundColor Cyan
& $node 'node_modules\vite\bin\vite.js' build
if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion de Vite.' }

Write-Host '2/4 Sincronizando con Capacitor...' -ForegroundColor Cyan
$shim = Resolve-Path 'mobile\scripts\node-userinfo-shim.cjs' -ErrorAction SilentlyContinue
if ($shim) { $env:NODE_OPTIONS = "--require=$($shim.Path)" }
& $node 'node_modules\@capacitor\cli\bin\capacitor' sync android
if ($LASTEXITCODE -ne 0) { throw 'Fallo cap sync.' }
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue

Write-Host '3/4 Generando el APK con Gradle (puede tardar varios minutos)...' -ForegroundColor Cyan
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Temp\yoru-android-apk-build\jdk'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Temp\yoru-android-apk-build\sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = (Resolve-Path '.android-build-tmp\gradle-home-132').Path
$androidUserHome = (Resolve-Path '.android-build-tmp\android-user-home').Path
$env:ANDROID_USER_HOME = $androidUserHome
Remove-Item Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
$env:ANDROID_AVD_HOME = Join-Path $androidUserHome 'avd'
$env:JAVA_TOOL_OPTIONS = "-Duser.home=$androidUserHome"
$log = Join-Path $PSScriptRoot ".android-build-tmp\build-$code.log"
Push-Location android
try {
  # Java/Gradle write notices to stderr; with 'Stop' Windows PowerShell 5.1 would abort on them.
  $ErrorActionPreference = 'Continue'
  & .\gradlew.bat :app:assembleDebug --no-daemon --init-script '..\mobile\scripts\gradle-init.gradle' *> $log
  $gradleExit = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
Get-Content $log -Tail 25
if ($gradleExit -ne 0) { throw "Gradle fallo. Log completo: $log" }

Write-Host '4/4 Verificando y copiando el APK...' -ForegroundColor Cyan
$apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
& $node 'mobile\scripts\verify-android-apk.js' $apk
if ($LASTEXITCODE -ne 0) { throw 'La verificacion del APK fallo (faltan clases de arranque).' }
$dest = "mobile\releases\Yoru-Reader-$version-debug.apk"
Copy-Item -LiteralPath $apk -Destination $dest -Force
& (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --print-certs $dest
if ($LASTEXITCODE -ne 0) { throw 'La firma del APK no es valida.' }

Write-Host ''
Write-Host "LISTO: $((Resolve-Path $dest).Path)" -ForegroundColor Green
