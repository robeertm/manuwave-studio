#!/usr/bin/env bash
# Manuwave Studio — installer for Linux with an NVIDIA GPU (Debian/Ubuntu and derivatives).
#
#   ./install.sh [--yes] [--lm 0.6B|1.7B|4B] [--xl] [--models-from DIR] [--no-start]
#                [--skip-writer] [--skip-image] [--skip-qa] [--skip-midi] [--home DIR]
#
# Safe to run again. Everything lands in ~/ManuwaveStudio (or --home / $MWS_HOME); system packages
# come from your distribution (apt asks for your password once).
#
# Engine: prebuilt acestep.cpp from this project's GitHub release (CUDA + Vulkan, built by CI from the
# pinned upstream revision). Covers: stable-diffusion.cpp (Vulkan build from its release) + Z-Image Turbo.
# ⚠ Status: experimental — built and checked in CI, not yet run on real NVIDIA hardware by the maintainer.
set -u
MWS_HOME="${MWS_HOME:-$HOME/ManuwaveStudio}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
YES=0; LM=""; XL=0; MODELS_FROM=""; START=1; WRITER=1; IMAGE=1; QA=1; MIDI=1
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;; --lm) LM="$2"; shift ;; --xl) XL=1 ;; --models-from) MODELS_FROM="$2"; shift ;;
    --no-start) START=0 ;; --skip-writer) WRITER=0 ;; --skip-image) IMAGE=0 ;; --skip-qa) QA=0 ;; --skip-midi) MIDI=0 ;; --home) MWS_HOME="$2"; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;; *) echo "Unknown option: $1"; exit 2 ;;
  esac; shift
done

GH_REPO="robeertm/manuwave-studio"
ENGINE_TAG="engine-b7ba6d9"                 # release that carries the prebuilt engine
HF="https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main"
SD_TAG="master-967-e47426c"                 # stable-diffusion.cpp release used for covers (Vulkan, Ubuntu)
WRITER_PORT=11440; APP_PORT=8104
ENGINE="$MWS_HOME/engine/acestep.cpp"; TOOLS="$MWS_HOME/tools"; LOGF="$MWS_HOME/install.log"
mkdir -p "$MWS_HOME" "$TOOLS/bin" "$MWS_HOME/renders"
exec > >(tee -a "$LOGF") 2>&1

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die() { printf "\n  \033[31m✗ %s\033[0m\n  Log: %s\n" "$*" "$LOGF"; exit 1; }
ask() { [ "$YES" = 1 ] && return 0; read -r -p "  $1 [Y/n] " a; [ -z "$a" ] || [[ "$a" =~ ^[YyJj] ]]; }
fetch() { local url="$1" dst="$2"; [ -s "$dst" ] && return 0; mkdir -p "$(dirname "$dst")"
  curl -L --fail -C - --progress-bar -o "$dst.part" "$url" && mv "$dst.part" "$dst"; }

bold "Manuwave Studio — installing into $MWS_HOME"
bold "1/9  Checking this computer"
[ "$(uname -m)" = "x86_64" ] || die "Only x86_64 is supported on Linux."
command -v nvidia-smi >/dev/null || die "No NVIDIA driver found (nvidia-smi). Install the proprietary driver (≥ 550) first."
GPU=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)
VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1048576 ))
FREE_GB=$(df -BG --output=avail "$MWS_HOME" | tail -1 | tr -dc 0-9)
ok "GPU: $GPU · RAM ${RAM_GB} GB · ${FREE_GB} GB free"
[ "${VRAM_MB:-0}" -ge 7500 ] || warn "Less than 8 GB VRAM — rendering may fail or be slow."
if [ -z "$LM" ]; then if [ "$RAM_GB" -lt 12 ]; then LM="0.6B"; elif [ "$RAM_GB" -lt 24 ]; then LM="1.7B"; else LM="4B"; fi; fi
[ "$FREE_GB" -ge 25 ] || [ -n "$MODELS_FROM" ] || die "About 25 GB of free space are needed."

bold "2/9  System packages"
NEED=""; for p in curl ffmpeg python3 zstd audiowmark libvulkan1; do dpkg -s "$p" >/dev/null 2>&1 || NEED="$NEED $p"; done
if [ -n "$NEED" ]; then
  ask "Install with apt:$NEED ?" || die "These packages are required."
  sudo apt-get update -q && sudo apt-get install -y $NEED || warn "Some packages could not be installed:$NEED"
fi
command -v ffmpeg >/dev/null || die "ffmpeg is missing."
command -v audiowmark >/dev/null && ln -sf "$(command -v audiowmark)" "$TOOLS/bin/audiowmark" || warn "audiowmark not available — tracks get no watermark."
ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

bold "3/9  Music engine (prebuilt acestep.cpp)"
if [ -x "$ENGINE/build/bin/ace-server" ]; then ok "already installed"; else
  fetch "https://github.com/$GH_REPO/releases/download/$ENGINE_TAG/acestep-linux-x64.tar.gz" "$TOOLS/src/acestep-linux-x64.tar.gz" \
    || die "Engine download failed."
  mkdir -p "$ENGINE/build" && tar -xzf "$TOOLS/src/acestep-linux-x64.tar.gz" -C "$ENGINE/build" || die "unpack failed"
  [ -x "$ENGINE/build/bin/ace-server" ] || die "ace-server missing in the engine package."
  ok "ace-server installed"
fi

bold "4/9  Music models"
M="$ENGINE/models"; mkdir -p "$M"
DIT="acestep-v15-sft-Q8_0.gguf"; [ "$XL" = 1 ] && DIT="acestep-v15-xl-sft-Q8_0.gguf"
for f in vae-BF16.gguf Qwen3-Embedding-0.6B-Q8_0.gguf "acestep-5Hz-lm-${LM}-Q8_0.gguf" "$DIT"; do
  [ -s "$M/$f" ] && { ok "$f"; continue; }
  if [ -n "$MODELS_FROM" ] && [ -s "$MODELS_FROM/$f" ]; then ln -sf "$MODELS_FROM/$f" "$M/$f"; ok "$f (linked)"; continue; fi
  echo "  ↓ $f"; fetch "$HF/$f" "$M/$f" || die "download failed: $f (run again to resume)"; ok "$f"
done
printf "MODE=single\nLM_FILE=acestep-5Hz-lm-%s-Q8_0.gguf\nTESTED_REV=b7ba6d9\n" "$LM" > "$MWS_HOME/engine.conf"

bold "5/9  Language model for briefs and lyrics (Ollama)"
OL="$TOOLS/ollama"
if [ ! -x "$OL/bin/ollama" ]; then
  fetch "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tgz" "$TOOLS/src/ollama-linux-amd64.tgz" || die "Ollama download failed."
  mkdir -p "$OL" && tar -xzf "$TOOLS/src/ollama-linux-amd64.tgz" -C "$OL" || die "unpack failed"
fi
WMODEL="qwen2.5:7b-instruct"; [ "$RAM_GB" -lt 16 ] && WMODEL="qwen2.5:3b-instruct"
if [ "$WRITER" = 1 ]; then
  OLLAMA_MODELS="$MWS_HOME/models/ollama" OLLAMA_HOST="127.0.0.1:$WRITER_PORT" "$OL/bin/ollama" serve >>"$LOGF" 2>&1 & OP=$!
  for i in $(seq 1 60); do curl -s "http://127.0.0.1:$WRITER_PORT/api/tags" >/dev/null && break; sleep 0.5; done
  OLLAMA_HOST="127.0.0.1:$WRITER_PORT" "$OL/bin/ollama" pull "$WMODEL" || warn "pull failed"
  kill $OP 2>/dev/null; wait $OP 2>/dev/null; ok "$WMODEL"
fi

bold "6/9  Cover art (stable-diffusion.cpp + Z-Image Turbo)"
if [ "$IMAGE" = 1 ]; then
  SD="$TOOLS/sd"; SM="$MWS_HOME/models/sd"; mkdir -p "$SD" "$SM"
  if [ ! -x "$SD/sd-server" ]; then
    URL=$(python3 "$REPO_DIR/install/common/gh_asset.py" leejet/stable-diffusion.cpp "$SD_TAG" '(?i)linux.*vulkan.*\.zip$') || die "stable-diffusion.cpp release not found."
    fetch "$URL" "$TOOLS/src/sd-linux-vulkan.zip" || die "stable-diffusion.cpp download failed."
    (cd "$SD" && python3 -m zipfile -e "$TOOLS/src/sd-linux-vulkan.zip" . ) || die "unpack failed"
    f=$(find "$SD" -name sd-server -type f | head -1); [ -n "$f" ] && [ "$f" != "$SD/sd-server" ] && mv "$(dirname "$f")"/* "$SD/" 2>/dev/null
    chmod +x "$SD"/sd-server "$SD"/sd* 2>/dev/null
  fi
  fetch "https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf" "$SM/z_image_turbo-Q4_K.gguf" || die "download failed"
  fetch "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" "$SM/ae.safetensors" || die "download failed (VAE)"
  fetch "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" "$SM/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" || die "download failed"
  ok "cover model ready"
fi

bold "7/9  Quality check (optional, about 1 GB)"
# Meta Audiobox Aesthetics (CC-BY 4.0) rates every take on the CPU; weak takes are rendered again automatically.
if [ "$QA" = 1 ]; then
  UV="$TOOLS/bin/uv"
  if [ ! -x "$UV" ]; then
    fetch "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz" "$TOOLS/src/uv.tar.gz" \
      && tar -xzf "$TOOLS/src/uv.tar.gz" -C "$TOOLS/src" && cp "$TOOLS/src/uv-x86_64-unknown-linux-gnu/uv" "$UV"
  fi
  QP="$MWS_HOME/qa/bin/python"
  if [ -x "$UV" ] && { [ -x "$QP" ] || "$UV" venv -q --python 3.12 "$MWS_HOME/qa"; } \
     && "$UV" pip install -q --python "$QP" --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match torch torchaudio \
     && "$UV" pip install -q --python "$QP" audiobox_aesthetics requests numpy \
     && HF_HOME="$MWS_HOME/qa/hf" "$QP" -c "from audiobox_aesthetics.infer import initialize_predictor as i; i()" >/dev/null 2>&1; then
    ok "quality check ready"
  else warn "quality check not available — tracks are kept without a rating"; fi
else warn "skipped (--skip-qa): every take is kept without a rating"; fi

bold "8/9  MIDI image (optional, about 1.5 GB)"
# Demucs (MIT) + Basic Pitch (Apache-2.0, ONNX): every AI song becomes notes — playable on the instruments, MIDI download.
if [ "$MIDI" = 1 ]; then
  UV="$TOOLS/bin/uv"; MP="$MWS_HOME/midi/bin/python"
  if [ ! -x "$UV" ]; then
    fetch "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz" "$TOOLS/src/uv.tar.gz" \
      && tar -xzf "$TOOLS/src/uv.tar.gz" -C "$TOOLS/src" && cp "$TOOLS/src/uv-x86_64-unknown-linux-gnu/uv" "$UV"
  fi
  if [ -x "$UV" ] && { [ -x "$MP" ] || "$UV" venv -q --python 3.12 "$MWS_HOME/midi"; } \
     && "$UV" pip install -q --python "$MP" --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match torch torchaudio \
     && "$UV" pip install -q --python "$MP" demucs==4.1.0 onnxruntime librosa mir_eval pretty_midi scipy resampy soundfile \
     && "$UV" pip install -q --python "$MP" --no-deps basic-pitch==0.4.0 \
     && TORCH_HOME="$MWS_HOME/midi/torch" "$MP" -c "from demucs.pretrained import get_model as g; g('htdemucs'); import basic_pitch.inference" >/dev/null 2>&1; then
    ok "MIDI image ready"
  else warn "MIDI image not available — songs stay audio only"; fi
else warn "skipped (--skip-midi): songs stay audio only"; fi

bold "9/9  App and launcher"
mkdir -p "$MWS_HOME/app" && cp -a "$REPO_DIR/app/." "$MWS_HOME/app/" || die "copy failed"
python3 "$REPO_DIR/install/common/write_config.py" "$MWS_HOME" "$APP_PORT" "$WRITER_PORT" "$WMODEL" || die "config failed"
install -m 755 "$REPO_DIR/install/linux/manuwave-studio.sh" "$MWS_HOME/manuwave-studio.sh"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/manuwave-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Manuwave Studio
Exec=$MWS_HOME/manuwave-studio.sh
Terminal=true
Categories=AudioVideo;Audio;
EOF
ok "Start with “Manuwave Studio” from your app menu or $MWS_HOME/manuwave-studio.sh"
bold "Done."
[ "$START" = 1 ] && exec "$MWS_HOME/manuwave-studio.sh"
exit 0
