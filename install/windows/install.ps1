# Manuwave Studio — installer for Windows 10/11 with an NVIDIA GPU.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Yes] [-Lm 0.6B|1.7B|4B] [-Xl] [-NoStart] [-SkipWriter] [-SkipImage] [-SkipQa]
#
# Safe to run again; everything lands in %USERPROFILE%\ManuwaveStudio. No administrator rights needed.
# Engine: prebuilt acestep.cpp from this project's GitHub release (CUDA + Vulkan). Covers: stable-diffusion.cpp
# (CUDA 12 build from its release) + Z-Image Turbo. Watermarks are not available on Windows (no audiowmark build).
# ⚠ Status: experimental — built and checked in CI, not yet run on real NVIDIA hardware by the maintainer.
param([switch]$Yes, [string]$Lm = "", [switch]$Xl, [switch]$NoStart, [switch]$SkipWriter, [switch]$SkipImage, [switch]$SkipQa)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Home_ = if ($env:MWS_HOME) { $env:MWS_HOME } else { Join-Path $env:USERPROFILE "ManuwaveStudio" }
$Repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$GhRepo = "robeertm/manuwave-studio"; $EngineTag = "engine-b7ba6d9"; $SdTag = "master-967-e47426c"
$Hf = "https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main"
$WriterPort = 11440; $AppPort = 8104
$Engine = Join-Path $Home_ "engine\acestep.cpp"; $Tools = Join-Path $Home_ "tools"; $Src = Join-Path $Tools "src"
New-Item -ItemType Directory -Force -Path $Home_, $Tools, $Src, (Join-Path $Home_ "renders"), (Join-Path $Tools "bin") | Out-Null
Start-Transcript -Append -Path (Join-Path $Home_ "install.log") | Out-Null

function Step($t) { Write-Host "`n$t" -ForegroundColor White }
function Ok($t) { Write-Host "  ✓ $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Die($t) { Write-Host "`n  ✗ $t" -ForegroundColor Red; Stop-Transcript | Out-Null; exit 1 }
function Fetch($url, $dst) {
  if ((Test-Path $dst) -and (Get-Item $dst).Length -gt 0) { return }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  # curl.exe ships with Windows 10+ and resumes interrupted downloads (-C -)
  & curl.exe -L --fail -C - --progress-bar -o "$dst.part" $url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $url" }
  Move-Item -Force "$dst.part" $dst
}
function Asset($repo, $tag, $pattern) {
  $api = if ($tag -eq "latest") { "https://api.github.com/repos/$repo/releases/latest" } else { "https://api.github.com/repos/$repo/releases/tags/$tag" }
  $rel = Invoke-RestMethod -Uri $api -Headers @{ Accept = "application/vnd.github+json" }
  $a = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $a) { throw "no asset matching $pattern in $repo $tag" }
  return $a.browser_download_url
}
function Unzip($zip, $dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null; Expand-Archive -Force -Path $zip -DestinationPath $dir }

Step "Manuwave Studio — installing into $Home_"

Step "1/8  Checking this PC"
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) { Die "No NVIDIA driver found. Install the current GeForce/Studio driver first." }
$gpu = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | Select-Object -First 1)
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$freeGb = [math]::Round((Get-PSDrive (Split-Path $Home_ -Qualifier).TrimEnd(":")).Free / 1GB)
Ok "GPU: $gpu · RAM $ramGb GB · $freeGb GB free"
if (-not $Lm) { $Lm = if ($ramGb -lt 12) { "0.6B" } elseif ($ramGb -lt 24) { "1.7B" } else { "4B" } }
if ($freeGb -lt 25) { Die "About 25 GB of free space are needed." }

Step "2/8  Python (via uv) and ffmpeg"
$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
  powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
& uv python install 3.12 | Out-Null
$py = (& uv python find 3.12).Trim()
if (-not (Test-Path $py)) { Die "Python 3.12 could not be installed." }
Set-Content -Path (Join-Path $Home_ "python.txt") -Value $py
Ok "Python: $py"
$ff = Join-Path $Tools "ffmpeg\bin\ffmpeg.exe"
if (-not (Test-Path $ff)) {
  Fetch (Asset "BtbN/FFmpeg-Builds" "latest" "^ffmpeg-master-latest-win64-gpl\.zip$") (Join-Path $Src "ffmpeg.zip")
  Unzip (Join-Path $Src "ffmpeg.zip") (Join-Path $Src "ffmpeg")
  $inner = Get-ChildItem (Join-Path $Src "ffmpeg") -Directory | Select-Object -First 1
  Copy-Item -Recurse -Force $inner.FullName (Join-Path $Tools "ffmpeg")
}
Copy-Item -Force (Join-Path $Tools "ffmpeg\bin\ffmpeg.exe"), (Join-Path $Tools "ffmpeg\bin\ffprobe.exe") (Join-Path $Tools "bin")
Ok "ffmpeg ready"
Warn "Watermarks are not available on Windows (audiowmark has no Windows build)."

Step "3/8  Music engine (prebuilt acestep.cpp)"
$ace = Join-Path $Engine "build\bin\ace-server.exe"
if (-not (Test-Path $ace)) {
  Fetch "https://github.com/$GhRepo/releases/download/$EngineTag/acestep-windows-x64.zip" (Join-Path $Src "acestep-windows-x64.zip")
  Unzip (Join-Path $Src "acestep-windows-x64.zip") (Join-Path $Engine "build")
}
if (-not (Test-Path $ace)) { Die "ace-server.exe missing in the engine package." }
Ok "ace-server installed"

Step "4/8  Music models"
$M = Join-Path $Engine "models"; New-Item -ItemType Directory -Force -Path $M | Out-Null
$dit = if ($Xl) { "acestep-v15-xl-sft-Q8_0.gguf" } else { "acestep-v15-sft-Q8_0.gguf" }
foreach ($f in @("vae-BF16.gguf", "Qwen3-Embedding-0.6B-Q8_0.gguf", "acestep-5Hz-lm-$Lm-Q8_0.gguf", $dit)) {
  Write-Host "  ↓ $f"; Fetch "$Hf/$f" (Join-Path $M $f); Ok $f
}
Set-Content -Path (Join-Path $Home_ "engine.conf") -Value "MODE=single`nLM_FILE=acestep-5Hz-lm-$Lm-Q8_0.gguf`nTESTED_REV=b7ba6d9"

Step "5/8  Language model for briefs and lyrics (Ollama)"
$ol = Join-Path $Tools "ollama\ollama.exe"
if (-not (Test-Path $ol)) {
  Fetch (Asset "ollama/ollama" "latest" "^ollama-windows-amd64\.zip$") (Join-Path $Src "ollama.zip")
  Unzip (Join-Path $Src "ollama.zip") (Join-Path $Tools "ollama")
}
$wmodel = if ($ramGb -lt 16) { "qwen2.5:3b-instruct" } else { "qwen2.5:7b-instruct" }
if (-not $SkipWriter) {
  $env:OLLAMA_MODELS = Join-Path $Home_ "models\ollama"; $env:OLLAMA_HOST = "127.0.0.1:$WriterPort"
  $p = Start-Process -FilePath $ol -ArgumentList "serve" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 4
  & $ol pull $wmodel
  Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
  Remove-Item Env:OLLAMA_MODELS, Env:OLLAMA_HOST
  Ok $wmodel
}

Step "6/8  Cover art (stable-diffusion.cpp + Z-Image Turbo)"
if (-not $SkipImage) {
  $sd = Join-Path $Tools "sd"; $sm = Join-Path $Home_ "models\sd"
  if (-not (Test-Path (Join-Path $sd "sd-server.exe"))) {
    Fetch (Asset "leejet/stable-diffusion.cpp" $SdTag "win-cuda12-x64\.zip$") (Join-Path $Src "sd-cuda.zip")
    Fetch (Asset "leejet/stable-diffusion.cpp" $SdTag "^cudart-.*win-cu12-x64\.zip$") (Join-Path $Src "sd-cudart.zip")
    Unzip (Join-Path $Src "sd-cuda.zip") $sd; Unzip (Join-Path $Src "sd-cudart.zip") $sd
    $exe = Get-ChildItem $sd -Recurse -Filter "sd-server.exe" | Select-Object -First 1
    if ($exe -and $exe.DirectoryName -ne $sd) { Get-ChildItem $exe.DirectoryName | Move-Item -Destination $sd -Force }
  }
  Fetch "https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf" (Join-Path $sm "z_image_turbo-Q4_K.gguf")
  Fetch "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" (Join-Path $sm "ae.safetensors")
  Fetch "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" (Join-Path $sm "Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
  Ok "cover model ready"
}

Step "7/8  Quality check (optional, about 1 GB)"
# Meta Audiobox Aesthetics (CC-BY 4.0) rates every take on the CPU; weak takes are rendered again automatically.
if (-not $SkipQa) {
  try {
    $qa = Join-Path $Home_ "qa"; $qp = Join-Path $qa "Scripts\python.exe"
    if (-not (Test-Path $qp)) { & uv venv -q --python 3.12 $qa | Out-Null }
    & uv pip install -q --python $qp --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match torch torchaudio
    & uv pip install -q --python $qp audiobox_aesthetics requests numpy
    $env:HF_HOME = Join-Path $qa "hf"
    & $qp -c "from audiobox_aesthetics.infer import initialize_predictor as i; i()" | Out-Null
    $code = $LASTEXITCODE
    Remove-Item Env:HF_HOME
    if ($code -eq 0) { Ok "quality check ready" } else { Warn "quality check not available - tracks are kept without a rating" }
  } catch { Warn "quality check not available - tracks are kept without a rating" }
} else { Warn "skipped (-SkipQa): every take is kept without a rating" }

Step "8/8  App and launcher"
Copy-Item -Recurse -Force (Join-Path $Repo "app\*") (New-Item -ItemType Directory -Force -Path (Join-Path $Home_ "app"))
& $py (Join-Path $Repo "install\common\write_config.py") $Home_ $AppPort $WriterPort $wmodel
Copy-Item -Force (Join-Path $Repo "install\windows\Manuwave Studio.ps1"), (Join-Path $Repo "install\windows\Manuwave Studio.bat") $Home_
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Manuwave Studio.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $sh.TargetPath = Join-Path $Home_ "Manuwave Studio.bat"; $sh.WorkingDirectory = $Home_; $sh.Save()
Ok "Start with “Manuwave Studio” on your desktop."
Step "Done."
Stop-Transcript | Out-Null
if (-not $NoStart) { Start-Process (Join-Path $Home_ "Manuwave Studio.bat") }
