#!/bin/bash
# Manuwave Studio — installer for macOS on Apple Silicon.
#
#   ./install.sh [--yes] [--lm 0.6B|1.7B|4B] [--xl] [--models-from DIR] [--no-start]
#                [--skip-writer] [--skip-image] [--skip-qa] [--skip-midi] [--home DIR]
#
# Safe to run again: finished steps are skipped, interrupted downloads resume.
# Everything lands in ~/ManuwaveStudio (or --home / $MWS_HOME). Nothing outside it is changed,
# except Homebrew (installed if missing — macOS asks for your password once) and its packages.
#
# Credits: the engine build and model layout follow acestep.cpp's own scripts and the approach of
# the MIT-licensed "music-generator" installer (Apple CLT, uv/cmake, resumable curl, pinned revision).
set -u
MWS_HOME="${MWS_HOME:-$HOME/ManuwaveStudio}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
YES=0; LM=""; XL=0; MODELS_FROM=""; START=1; WRITER=1; IMAGE=1; QA=1; MIDI=1
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --lm) LM="$2"; shift ;;
    --xl) XL=1 ;;
    --models-from) MODELS_FROM="$2"; shift ;;
    --no-start) START=0 ;;
    --skip-writer) WRITER=0 ;;
    --skip-image) IMAGE=0 ;;
    --skip-qa) QA=0 ;;
    --skip-midi) MIDI=0 ;;
    --home) MWS_HOME="$2"; shift ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done

ACESTEP_REPO="https://github.com/ServeurpersoCom/acestep.cpp"
ACESTEP_REV="b7ba6d9"
HF="https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main"
OLLAMA_IMG_VER="0.32.5"            # the last Ollama release with image generation (removed in 0.32.6)
OLLAMA_TEAM="3MU9H2V9Y9"           # Ollama Inc. code-signing team
ZITA_URL="https://kokkinizita.linuxaudio.org/linuxaudio/downloads/zita-resampler-1.11.2.tar.xz"
ZITA_SHA="aa5c54e696069af26f3f1fed4a963113cc1237cddfd57ae5842abcb1acd5492c"
AWM_URL="https://uplex.de/audiowmark/releases/audiowmark-0.6.5.tar.zst"
AWM_SHA="12dd0232e47f29521c91d9d642183b3ca4145be61d353c4dc6d1c6cd7c388a4b"
WRITER_PORT=11440                  # our own Ollama for lyrics/briefs — never touches yours on 11434
IMAGE_PORT=11439
APP_PORT=8104

ENGINE="$MWS_HOME/engine/acestep.cpp"
TOOLS="$MWS_HOME/tools"
LOGF="$MWS_HOME/install.log"
mkdir -p "$MWS_HOME" "$TOOLS/bin" "$MWS_HOME/renders"
exec > >(tee -a "$LOGF") 2>&1

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die() { printf "\n  \033[31m✗ %s\033[0m\n  Log: %s\n" "$*" "$LOGF"; exit 1; }
ask() { [ "$YES" = 1 ] && return 0; read -r -p "  $1 [Y/n] " a; [ -z "$a" ] || [[ "$a" =~ ^[YyJj] ]]; }
fetch() { # url dest — resumable, atomic
  local url="$1" dst="$2"
  [ -s "$dst" ] && return 0
  mkdir -p "$(dirname "$dst")"
  curl -L --fail -C - --progress-bar -o "$dst.part" "$url" && mv "$dst.part" "$dst"
}
sha_ok() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ]; }

bold "Manuwave Studio — installing into $MWS_HOME"

# ---- 1. This Mac ----------------------------------------------------------------
bold "1/11 Checking this Mac"
[ "$(uname -m)" = "arm64" ] || die "Manuwave Studio needs a Mac with Apple silicon (M1 or newer)."
MAJ=$(sw_vers -productVersion | cut -d. -f1); [ "$MAJ" -ge 14 ] || die "macOS 14 or newer is required."
RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
FREE_GB=$(df -g "$MWS_HOME" | awk 'NR==2{print $4}')
ok "Apple silicon, macOS $(sw_vers -productVersion), ${RAM_GB} GB RAM, ${FREE_GB} GB free"
if [ -z "$LM" ]; then
  if [ "$RAM_GB" -lt 12 ]; then LM="0.6B"; elif [ "$RAM_GB" -lt 24 ]; then LM="1.7B"; else LM="4B"; fi
fi
NEED=8; [ "$LM" = "4B" ] && NEED=$((NEED+5)); [ "$XL" = 1 ] && NEED=$((NEED+6)); [ "$WRITER" = 1 ] && NEED=$((NEED+5)); [ "$IMAGE" = 1 ] && NEED=$((NEED+7))
[ -n "$MODELS_FROM" ] && NEED=6
[ "$FREE_GB" -ge "$NEED" ] || die "About ${NEED} GB of free space are needed (${FREE_GB} GB free)."
ok "Language model for the music AI: $LM · sound model: $([ $XL = 1 ] && echo 'XL (best)' || echo 'standard')"

# ---- 2. Apple command line tools ---------------------------------------------------
bold "2/11 Apple command line tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1
  warn "A macOS window asks to install the command line tools — please click “Install”."
  for i in $(seq 1 180); do xcode-select -p >/dev/null 2>&1 && break; sleep 10; done
  xcode-select -p >/dev/null 2>&1 || die "The command line tools are not installed yet. Run this installer again afterwards."
fi
ok "Command line tools: $(xcode-select -p)"

# ---- 3. Homebrew and packages ------------------------------------------------------
bold "3/11 Homebrew packages (ffmpeg, cmake, Ollama, audio libraries)"
BREW=""; for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && BREW="$b" && break; done
if [ -z "$BREW" ]; then
  ask "Homebrew is missing. Install it now? (macOS will ask for your password once)" || die "Homebrew is required."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || die "Homebrew installation failed."
  BREW=/opt/homebrew/bin/brew
fi
eval "$("$BREW" shellenv)"
PKGS="ffmpeg fftw libsndfile libgcrypt mpg123 pkg-config libtool zstd"
MISSING=$(for p in $PKGS; do brew list --formula "$p" >/dev/null 2>&1 || printf "%s " "$p"; done)
# Ollama: ein vorhandenes (z. B. die Ollama-App) wird benutzt — ein zweites würde ändern, welches „ollama"
# andere Programme auf diesem Mac aufrufen. Nur wenn gar keins da ist, kommt es aus Homebrew.
command -v ollama >/dev/null 2>&1 || MISSING="$MISSING ollama"
# cmake: ein vorhandenes genügt (auch das von uv unter ~/.local/bin)
export PATH="$HOME/.local/bin:$PATH"
command -v cmake >/dev/null 2>&1 || MISSING="$MISSING cmake"
[ -n "$MISSING" ] && { brew install $MISSING || die "brew install failed: $MISSING"; }
ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}') · cmake $(cmake --version | head -1 | awk '{print $3}') · ollama $(ollama --version 2>/dev/null | awk '{print $NF}')"

# ---- 4. Watermark tool (audiowmark, GPL-3, built from the official sources) -------------
bold "4/11 Watermark tool (audiowmark)"
if [ -x "$TOOLS/bin/audiowmark" ]; then ok "already built"; else
  SRC="$TOOLS/src"; mkdir -p "$SRC"
  fetch "$ZITA_URL" "$SRC/zita-resampler-1.11.2.tar.xz" && sha_ok "$SRC/zita-resampler-1.11.2.tar.xz" "$ZITA_SHA" || die "zita-resampler download/checksum failed."
  fetch "$AWM_URL" "$SRC/audiowmark-0.6.5.tar.zst" && sha_ok "$SRC/audiowmark-0.6.5.tar.zst" "$AWM_SHA" || die "audiowmark download/checksum failed."
  ( cd "$SRC" && rm -rf zita-resampler-1.11.2 && tar -xf zita-resampler-1.11.2.tar.xz && cd zita-resampler-1.11.2/source \
    && c++ -O2 -fPIC -I. -c resampler.cc resampler-table.cc vresampler.cc cresampler.cc \
    && ar rcs libzita-resampler.a resampler.o resampler-table.o vresampler.o cresampler.o \
    && mkdir -p "$TOOLS/zita/include/zita-resampler" "$TOOLS/zita/lib" && cp zita-resampler/*.h "$TOOLS/zita/include/zita-resampler/" \
    && cp libzita-resampler.a "$TOOLS/zita/lib/" ) >>"$LOGF" 2>&1 || die "zita-resampler build failed."
  ( cd "$SRC" && rm -rf audiowmark-0.6.5 && zstd -dc audiowmark-0.6.5.tar.zst | tar -x && cd audiowmark-0.6.5 \
    && CPPFLAGS="-I$TOOLS/zita/include" LDFLAGS="-L$TOOLS/zita/lib" ./configure --prefix="$TOOLS" --disable-dependency-tracking \
    && make -j"$(sysctl -n hw.ncpu)" && make install ) >>"$LOGF" 2>&1 || die "audiowmark build failed (see log)."
  ok "audiowmark $("$TOOLS/bin/audiowmark" --version 2>&1 | awk '{print $2}')"
fi

# ---- 5. Music engine (acestep.cpp, MIT) -------------------------------------------
bold "5/11 Music engine (ACE-Step 1.5 via acestep.cpp @ $ACESTEP_REV, Metal)"
if [ -x "$ENGINE/build/ace-server" ] && [ -f "$ENGINE/.mws-rev" ] && [ "$(cat "$ENGINE/.mws-rev")" = "$ACESTEP_REV" ]; then ok "already built"; else
  if [ ! -d "$ENGINE/.git" ]; then git clone --quiet "$ACESTEP_REPO" "$ENGINE" || die "git clone failed."; fi
  ( cd "$ENGINE" && git fetch --quiet origin && git checkout --quiet "$ACESTEP_REV" && git submodule update --init --recursive --quiet ) || die "checkout failed."
  ( cd "$ENGINE" && rm -rf build && cmake -S . -B build -DGGML_BLAS=ON -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j "$(sysctl -n hw.ncpu)" ) >>"$LOGF" 2>&1 || die "engine build failed (see log)."
  echo "$ACESTEP_REV" > "$ENGINE/.mws-rev"
  ok "ace-server built"
fi

# ---- 6. Models for the music AI (MIT, from Hugging Face) ------------------------------
bold "6/11 Music models"
M="$ENGINE/models"; mkdir -p "$M"
DIT="acestep-v15-sft-Q8_0.gguf"; [ "$XL" = 1 ] && DIT="acestep-v15-xl-sft-Q8_0.gguf"
FILES="vae-BF16.gguf Qwen3-Embedding-0.6B-Q8_0.gguf acestep-5Hz-lm-${LM}-Q8_0.gguf $DIT"
for f in $FILES; do
  if [ -s "$M/$f" ]; then ok "$f"; continue; fi
  if [ -n "$MODELS_FROM" ] && [ -s "$MODELS_FROM/$f" ]; then ln -f "$MODELS_FROM/$f" "$M/$f" 2>/dev/null || ln -s "$MODELS_FROM/$f" "$M/$f"; ok "$f (linked)"; continue; fi
  echo "  ↓ $f"; fetch "$HF/$f" "$M/$f" || die "download failed: $f (run the installer again to resume)"
  ok "$f"
done
cat > "$MWS_HOME/engine.conf" <<EOF
MODE=single
LM_FILE=acestep-5Hz-lm-${LM}-Q8_0.gguf
TESTED_REV=$ACESTEP_REV
EOF

# ---- 7. Writer: lyrics and production briefs (Ollama, qwen2.5) ---------------------------
bold "7/11 Language model for briefs and lyrics"
WMODEL="qwen2.5:7b-instruct"; [ "$RAM_GB" -lt 16 ] && WMODEL="qwen2.5:3b-instruct"
if [ "$WRITER" = 1 ]; then
  export OLLAMA_MODELS="$MWS_HOME/models/ollama"; mkdir -p "$OLLAMA_MODELS"
  OLLAMA_HOST="127.0.0.1:$WRITER_PORT" ollama serve >>"$LOGF" 2>&1 & OP=$!
  for i in $(seq 1 60); do curl -s "http://127.0.0.1:$WRITER_PORT/api/tags" >/dev/null && break; sleep 0.5; done
  OLLAMA_HOST="127.0.0.1:$WRITER_PORT" ollama pull "$WMODEL" || warn "pull failed — briefs fall back to your own words"
  kill $OP 2>/dev/null; wait $OP 2>/dev/null
  ok "$WMODEL"
else warn "skipped (--skip-writer): songs with sung lyrics need a language model"; fi
unset OLLAMA_MODELS

# ---- 8. Cover art (Ollama $OLLAMA_IMG_VER + FLUX.2 klein 4B, Apache-2.0) --------------
bold "8/11 Cover art"
IMG="$TOOLS/ollama-bild"
if [ "$IMAGE" = 1 ]; then
  if [ ! -x "$IMG/ollama" ]; then
    fetch "https://github.com/ollama/ollama/releases/download/v$OLLAMA_IMG_VER/ollama-darwin.tgz" "$TOOLS/src/ollama-$OLLAMA_IMG_VER-darwin.tgz" || die "Ollama $OLLAMA_IMG_VER download failed."
    mkdir -p "$IMG" && tar -xzf "$TOOLS/src/ollama-$OLLAMA_IMG_VER-darwin.tgz" -C "$IMG" || die "unpack failed"
    codesign -dv "$IMG/ollama" 2>&1 | grep -q "TeamIdentifier=$OLLAMA_TEAM" || die "Ollama $OLLAMA_IMG_VER is not signed by Ollama Inc. — stopped."
  fi
  export OLLAMA_MODELS="$IMG/models"; mkdir -p "$OLLAMA_MODELS"
  OLLAMA_HOST="127.0.0.1:$IMAGE_PORT" "$IMG/ollama" serve >>"$LOGF" 2>&1 & IP=$!
  for i in $(seq 1 60); do curl -s "http://127.0.0.1:$IMAGE_PORT/api/tags" >/dev/null && break; sleep 0.5; done
  OLLAMA_HOST="127.0.0.1:$IMAGE_PORT" "$IMG/ollama" pull x/flux2-klein:4b || warn "image model download failed — tracks get no cover until you run the installer again"
  kill $IP 2>/dev/null; wait $IP 2>/dev/null
  unset OLLAMA_MODELS
  ok "x/flux2-klein:4b"
else warn "skipped (--skip-image): tracks get no cover"; fi

# ---- 9. Quality check (optional): a listening-judgement model rates every take ----------
# Meta Audiobox Aesthetics (CC-BY 4.0) in its own environment ($MWS_HOME/qa, PyTorch, about 1 GB). Runs on the CPU
# after each render; weak takes are rendered again automatically. Without it the app works as before.
bold "9/11 Quality check (optional, about 1 GB)"
if [ "$QA" = 1 ]; then
  command -v uv >/dev/null 2>&1 || brew install uv >/dev/null 2>&1 || true
  if command -v uv >/dev/null 2>&1 \
     && { [ -x "$MWS_HOME/qa/bin/python" ] || uv venv -q --python 3.12 "$MWS_HOME/qa"; } \
     && uv pip install -q --python "$MWS_HOME/qa/bin/python" audiobox_aesthetics requests numpy \
     && HF_HOME="$MWS_HOME/qa/hf" "$MWS_HOME/qa/bin/python" -c "from audiobox_aesthetics.infer import initialize_predictor as i; i()" >/dev/null 2>&1; then
    ok "quality check ready"
  else warn "quality check not available — tracks are kept without a rating"; fi
else warn "skipped (--skip-qa): every take is kept without a rating"; fi

# ---- 10. MIDI image (optional): every AI song becomes notes you can play ----------------
# Demucs (MIT) separates drums, bass, vocals and the rest; Basic Pitch (Apache-2.0, ONNX) finds the notes. The bridge
# does this in the background whenever the computer is idle — the song then opens on the instruments ("Make your own")
# and downloads as a MIDI file. Own environment ($MWS_HOME/midi, PyTorch, about 1.5 GB). Without it nothing changes.
bold "10/11 MIDI image (optional, about 1.5 GB)"
if [ "$MIDI" = 1 ]; then
  command -v uv >/dev/null 2>&1 || brew install uv >/dev/null 2>&1 || true
  MP="$MWS_HOME/midi/bin/python"
  if command -v uv >/dev/null 2>&1 \
     && { [ -x "$MP" ] || uv venv -q --python 3.12 "$MWS_HOME/midi"; } \
     && uv pip install -q --python "$MP" torch torchaudio demucs==4.1.0 onnxruntime librosa mir_eval pretty_midi scipy resampy soundfile \
     && uv pip install -q --python "$MP" --no-deps basic-pitch==0.4.0 \
     && HF_HOME="$MWS_HOME/midi/hf" TORCH_HOME="$MWS_HOME/midi/torch" "$MP" -c "from demucs.pretrained import get_model as g; g('htdemucs'); import basic_pitch.inference" >/dev/null 2>&1; then
    ok "MIDI image ready"
  else warn "MIDI image not available — songs stay audio only"; fi
else warn "skipped (--skip-midi): songs stay audio only"; fi

# ---- 11. App + launcher -------------------------------------------------------------
bold "11/11 App and launcher"
rsync -a --delete --exclude "__pycache__" "$REPO_DIR/app/" "$MWS_HOME/app/" || die "copy failed"
/usr/bin/python3 "$REPO_DIR/install/common/write_config.py" "$MWS_HOME" "$APP_PORT" "$WRITER_PORT" "$WMODEL" "$IMAGE_PORT" || die "config failed"
cp "$REPO_DIR/install/macos/Manuwave Studio.command" "$MWS_HOME/Manuwave Studio.command" && chmod +x "$MWS_HOME/Manuwave Studio.command"
ln -sf "$MWS_HOME/Manuwave Studio.command" "$HOME/Desktop/Manuwave Studio.command" 2>/dev/null || true
ok "Start any time with “Manuwave Studio” on your Desktop."

bold "Done."
[ "$START" = 1 ] && open "$MWS_HOME/Manuwave Studio.command"
exit 0
