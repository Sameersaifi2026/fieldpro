# Builds FieldPro.html: one self-contained file (styles, config and app inlined)
# that opens by double-click, with no server. Re-run after changing the app.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$read = { param($f) [IO.File]::ReadAllText((Join-Path $root $f), [Text.Encoding]::UTF8) }
$css = & $read 'styles.css'
$cfg = & $read 'config.js'
$app = & $read 'app.js'
$icon = 'data:image/svg+xml;base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'icon.svg')))

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#13233A">
  <title>FieldPro</title>
  <link rel="icon" href="$icon">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
__CSS__
  </style>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
__CFG__
  </script>
</head>
<body>
  <div id="root"><div class="boot">Loading FieldPro… (needs internet)</div></div>
  <script type="module">
__APP__
  </script>
</body>
</html>
"@
$html = $html.Replace('__CSS__', $css).Replace('__CFG__', $cfg).Replace('__APP__', $app)
$out = Join-Path $root 'FieldPro.html'
[IO.File]::WriteAllText($out, $html, (New-Object Text.UTF8Encoding($false)))
"Built $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
