# Genera build/installerSidebar.bmp (164x314) y build/installerHeader.bmp (150x57) para el instalador NSIS
# con la paleta de la app. Uso: powershell -ExecutionPolicy Bypass -File build\make-installer-art.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icon = [Drawing.Image]::FromFile((Join-Path $root 'build\icons\png\512x512.png'))

$bgTop = [Drawing.Color]::FromArgb(255, 22, 25, 33)     # #161921
$bg    = [Drawing.Color]::FromArgb(255, 12, 14, 19)     # #0c0e13 (app background)
$yellow = [Drawing.Color]::FromArgb(255, 255, 228, 92)  # #ffe45c
$coral  = [Drawing.Color]::FromArgb(255, 255, 138, 107) # #ff8a6b
$muted  = [Drawing.Color]::FromArgb(255, 150, 156, 172)

# Drawn at 2x: MUI stretches the bitmaps to their control (FitControl), so they stay sharp
# on 150-200 % display scaling and are downscaled smoothly at 100 %.
$Scale = 2

function New-Canvas($w, $h) {
  $bmp = New-Object Drawing.Bitmap ($w * $Scale), ($h * $Scale), ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.ScaleTransform($Scale, $Scale)
  return @($bmp, $g)
}

function Get-RoundedPath([float]$x, [float]$y, [float]$s, [float]$r) {
  $p = New-Object Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $s - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $s - $d, $y + $s - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $s - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function Draw-Icon($g, [float]$x, [float]$y, [float]$s) {
  # Fill an anti-aliased rounded square with the scaled icon (SetClip would leave jagged corners).
  $n = [int][Math]::Ceiling($s * $Scale)
  $scaled = New-Object Drawing.Bitmap $n, $n
  $sg = [Drawing.Graphics]::FromImage($scaled); $sg.InterpolationMode = 'HighQualityBicubic'
  $sg.DrawImage($icon, 0, 0, $n, $n); $sg.Dispose()
  $brush = New-Object Drawing.TextureBrush $scaled
  # The texture is at device resolution; undo the canvas scale for it.
  $brush.TranslateTransform($x, $y)
  $brush.ScaleTransform(1 / $Scale, 1 / $Scale)
  $g.FillPath($brush, (Get-RoundedPath $x $y $s ($s * 0.22)))
  $brush.Dispose(); $scaled.Dispose()
}

function Draw-Glow($g, [float]$cx, [float]$cy, [float]$r, [int]$alpha) {
  $p = New-Object Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($cx - $r, $cy - $r, $r * 2, $r * 2)
  $b = New-Object Drawing.Drawing2D.PathGradientBrush $p
  $b.CenterColor = [Drawing.Color]::FromArgb($alpha, 255, 214, 80)
  $b.SurroundColors = @([Drawing.Color]::FromArgb(0, 255, 214, 80))
  $g.FillPath($b, $p)
}

# ---- Sidebar (welcome / finish pages) ----
$c = New-Canvas 164 314; $bmp = $c[0]; $g = $c[1]
$rect = New-Object Drawing.Rectangle 0, 0, 164, 314
$g.FillRectangle((New-Object Drawing.Drawing2D.LinearGradientBrush $rect, $bgTop, $bg, 90), $rect)
Draw-Glow $g 82 104 90 70
Draw-Icon $g 38 60 88
$center = New-Object Drawing.StringFormat; $center.Alignment = 'Center'
$g.DrawString('Yoru Reader', (New-Object Drawing.Font 'Segoe UI Semibold', 13), (New-Object Drawing.SolidBrush ([Drawing.Color]::White)), (New-Object Drawing.RectangleF 0, 164, 164, 26), $center)
$tagline = -join [char[]](0x8AAD,0x3093,0x3067,0x899A,0x3048,0x308B)  # 読んで覚える
$g.DrawString($tagline, (New-Object Drawing.Font 'Yu Gothic UI', 8.5), (New-Object Drawing.SolidBrush $muted), (New-Object Drawing.RectangleF 0, 190, 164, 18), $center)
$accent = New-Object Drawing.Rectangle 62, 216, 40, 3
$g.FillRectangle((New-Object Drawing.Drawing2D.LinearGradientBrush $accent, $yellow, $coral, 0), $accent)
$g.Dispose(); $bmp.Save((Join-Path $root 'build\installerSidebar.bmp'), [Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()

# ---- Header (top-right of the inner pages) ----
$c = New-Canvas 150 57; $bmp = $c[0]; $g = $c[1]
$g.Clear($bg)  # Clear ignores the transform and fills the whole bitmap
Draw-Glow $g 122 28 34 45
Draw-Icon $g 104 10 37
$g.Dispose(); $bmp.Save((Join-Path $root 'build\installerHeader.bmp'), [Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()

$icon.Dispose()
Write-Host 'Installer art written to build\installerSidebar.bmp and build\installerHeader.bmp'
