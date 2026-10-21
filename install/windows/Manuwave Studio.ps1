# Manuwave Studio - start. Keep this window open while you work; closing it stops everything.
$Home_ = if ($env:MWS_HOME) { $env:MWS_HOME } else { $PSScriptRoot }
if (-not (Test-Path (Join-Path $Home_ "bridge.json"))) { $Home_ = Join-Path $env:USERPROFILE "ManuwaveStudio" }
$env:MWS_HOME = $Home_
$env:Path = (Join-Path $Home_ "tools\bin") + ";" + $env:Path
$py = (Get-Content (Join-Path $Home_ "python.txt") -ErrorAction Stop).Trim()
$AppPort = 8104; $WriterPort = 11440
$procs = @()
# This window restarts the app and the bridge whenever they end (update, new code, crash) - tell them so,
# then they exit instead of starting a copy of themselves.
$env:MWS_SUPERVISED = "1"
function Alive($url) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $url | Out-Null; return $true } catch { return $false } }
function Up($url) { for ($i = 0; $i -lt 80; $i++) { if (Alive $url) { return $true }; Start-Sleep -Milliseconds 250 }; return $false }
# Read the handle right after the start: without it Windows PowerShell cannot tell later whether the process ended.
function Track($p) { if ($p) { $null = $p.Handle }; return $p }
try {
  Write-Host "Manuwave Studio - $Home_"
  if (-not (Alive "http://127.0.0.1:$WriterPort/api/tags")) {
    $env:OLLAMA_MODELS = Join-Path $Home_ "models\ollama"; $env:OLLAMA_HOST = "127.0.0.1:$WriterPort"
    $procs += Start-Process -FilePath (Join-Path $Home_ "tools\ollama\ollama.exe") -ArgumentList "serve" -WindowStyle Hidden -PassThru `
      -RedirectStandardError (Join-Path $Home_ "writer.log")
    Remove-Item Env:OLLAMA_HOST
  }
  $env:HOST = "127.0.0.1"; $env:PORT = "$AppPort"
  function StartApp { Track (Start-Process -FilePath $py -ArgumentList "server.py" -WorkingDirectory (Join-Path $Home_ "app") -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $Home_ "app.log")) }
  function StartBridge { Track (Start-Process -FilePath $py -ArgumentList "`"$(Join-Path $Home_ 'app\bridge\manuwave_bridge.py')`"" -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $Home_ "bridge.log")) }
  $app = $null
  if (Alive "http://127.0.0.1:$AppPort/version") {
    Write-Host "The app is already running - using it."
  } else {
    $app = StartApp; $procs += $app
  }
  if (-not (Up "http://127.0.0.1:$AppPort/version")) { throw "The app did not start - see app.log" }
  $bridge = StartBridge; $procs += $bridge
  $token = (Get-Content (Join-Path $Home_ "bridge.json") | ConvertFrom-Json).token
  if (-not $env:MWS_NO_BROWSER) { Start-Process "http://127.0.0.1:$AppPort/#bridge=$token" }
  Write-Host "Running at http://127.0.0.1:$AppPort - close this window to stop."
  # Restart whatever ended - after an update, new code, or a crash. At most every 10 s, so a fault cannot spin.
  $appNext = Get-Date; $bridgeNext = Get-Date
  while ($true) {
    Start-Sleep -Seconds 2
    if ((-not $app -or $app.HasExited) -and (Get-Date) -ge $appNext -and -not (Alive "http://127.0.0.1:$AppPort/version")) {
      Write-Host "The app stopped - starting it again ..."
      $app = StartApp; $procs += $app; $appNext = (Get-Date).AddSeconds(10)
    }
    if ($bridge.HasExited -and (Get-Date) -ge $bridgeNext) {
      Write-Host "The bridge stopped - starting it again ..."
      $bridge = StartBridge; $procs += $bridge; $bridgeNext = (Get-Date).AddSeconds(10)
    }
  }
} finally {
  Write-Host "Stopping ..."
  foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
