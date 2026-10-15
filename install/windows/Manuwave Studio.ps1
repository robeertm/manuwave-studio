# Manuwave Studio — start. Keep this window open while you work; closing it stops everything.
$Home_ = if ($env:MWS_HOME) { $env:MWS_HOME } else { $PSScriptRoot }
if (-not (Test-Path (Join-Path $Home_ "bridge.json"))) { $Home_ = Join-Path $env:USERPROFILE "ManuwaveStudio" }
$env:MWS_HOME = $Home_
$env:Path = (Join-Path $Home_ "tools\bin") + ";" + $env:Path
$py = (Get-Content (Join-Path $Home_ "python.txt") -ErrorAction Stop).Trim()
$AppPort = 8104; $WriterPort = 11440
$procs = @()
function Up($url) { for ($i = 0; $i -lt 80; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $url | Out-Null; return $true } catch { Start-Sleep -Milliseconds 250 } }; return $false }
try {
  Write-Host "Manuwave Studio — $Home_"
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$WriterPort/api/tags" | Out-Null } catch {
    $env:OLLAMA_MODELS = Join-Path $Home_ "models\ollama"; $env:OLLAMA_HOST = "127.0.0.1:$WriterPort"
    $procs += Start-Process -FilePath (Join-Path $Home_ "tools\ollama\ollama.exe") -ArgumentList "serve" -WindowStyle Hidden -PassThru `
      -RedirectStandardError (Join-Path $Home_ "writer.log")
    Remove-Item Env:OLLAMA_HOST
  }
  $env:HOST = "127.0.0.1"; $env:PORT = "$AppPort"
  $procs += Start-Process -FilePath $py -ArgumentList "server.py" -WorkingDirectory (Join-Path $Home_ "app") -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $Home_ "app.log")
  if (-not (Up "http://127.0.0.1:$AppPort/version")) { throw "The app did not start — see app.log" }
  $procs += Start-Process -FilePath $py -ArgumentList "`"$(Join-Path $Home_ 'app\bridge\manuwave_bridge.py')`"" -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $Home_ "bridge.log")
  $token = (Get-Content (Join-Path $Home_ "bridge.json") | ConvertFrom-Json).token
  Start-Process "http://127.0.0.1:$AppPort/#bridge=$token"
  Write-Host "Running at http://127.0.0.1:$AppPort — close this window to stop."
  while ($true) { Start-Sleep -Seconds 2 }
} finally {
  Write-Host "Stopping …"
  foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
