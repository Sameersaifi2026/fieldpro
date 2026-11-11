# Renders FieldPro's PNG app icons (navy tile + orange map pin) with .NET drawing.
# Usage: powershell -ExecutionPolicy Bypass -File make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $dir | Out-Null
$navy = [Drawing.Color]::FromArgb(255, 0x13, 0x23, 0x3A)
$orange = [Drawing.Color]::FromArgb(255, 0xFB, 0x92, 0x3C)

function Draw-Icon([int]$size, [bool]$maskable, [string]$name) {
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)
  $bg = New-Object Drawing.SolidBrush $navy
  if ($maskable) {
    $g.FillRectangle($bg, 0, 0, $size, $size)
    $scale = $size * 0.50 / 24   # keep the pin inside the maskable safe zone
  } else {
    $r = [int]($size * 0.22); $d = $r * 2
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($size - $d, 0, $d, $d, 270, 90)
    $p.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $p.AddArc(0, $size - $d, $d, $d, 90, 90)
    $p.CloseFigure(); $g.FillPath($bg, $p)
    $scale = $size * 0.62 / 24
  }
  # Pin geometry in a 24-unit box (same as the SVG icon), centred.
  $ox = $size / 2 - 12 * $scale; $oy = $size / 2 - 12 * $scale
  $pt = { param($x, $y) New-Object Drawing.PointF ([float]($ox + $x * $scale)), ([float]($oy + $y * $scale)) }
  $pen = New-Object Drawing.Pen $orange, ([float](2 * $scale))
  $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $cx = 12; $cy = 9.5; $rad = 7
  $pin = New-Object Drawing.Drawing2D.GraphicsPath
  $pin.AddArc([float]($ox + ($cx - $rad) * $scale), [float]($oy + ($cy - $rad) * $scale), [float](2 * $rad * $scale), [float](2 * $rad * $scale), 150, 240)
  $right = & $pt ($cx + $rad * [math]::Cos(30 * [math]::PI / 180)) ($cy + $rad * [math]::Sin(30 * [math]::PI / 180))
  $left = & $pt ($cx + $rad * [math]::Cos(150 * [math]::PI / 180)) ($cy + $rad * [math]::Sin(150 * [math]::PI / 180))
  $tip = & $pt 12 21
  $pin.AddLine($right, $tip); $pin.AddLine($tip, $left); $pin.CloseFigure()
  $g.DrawPath($pen, $pin)
  $cr = 2.5 * $scale
  $g.DrawEllipse($pen, [float]($ox + $cx * $scale - $cr), [float]($oy + $cy * $scale - $cr), [float](2 * $cr), [float](2 * $cr))
  $out = Join-Path $dir $name
  $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "$name"
}
Draw-Icon 192 $false 'icon-192.png'
Draw-Icon 512 $false 'icon-512.png'
Draw-Icon 192 $true 'maskable-192.png'
Draw-Icon 512 $true 'maskable-512.png'
Draw-Icon 180 $true 'apple-touch-icon.png'
