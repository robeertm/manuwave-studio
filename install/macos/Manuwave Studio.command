#!/bin/bash
# Manuwave Studio — start. Keep this window open while you work; closing it (or Ctrl+C) stops everything.
MWS_HOME="${MWS_HOME:-$(cd "$(dirname "$0")" && pwd)}"
[ -f "$MWS_HOME/bridge.json" ] || MWS_HOME="$HOME/ManuwaveStudio"
export MWS_HOME
APP_PORT=8104; WRITER_PORT=11440
for b in /opt/homebrew/bin /usr/local/bin; do [ -d "$b" ] && PATH="$b:$PATH"; done
export PATH="$MWS_HOME/tools/bin:$PATH"
PY=/usr/bin/python3
pids=()
stop() { echo; echo "Stopping Manuwave Studio …"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; exit 0; }
trap stop INT TERM HUP
up() { for i in $(seq 1 80); do curl -s -o /dev/null "$1" && return 0; sleep 0.25; done; return 1; }

echo "Manuwave Studio — $MWS_HOME"
if ! curl -s -o /dev/null "http://127.0.0.1:$WRITER_PORT/api/tags"; then
  OLLAMA_MODELS="$MWS_HOME/models/ollama" OLLAMA_HOST="127.0.0.1:$WRITER_PORT" ollama serve >>"$MWS_HOME/writer.log" 2>&1 & pids+=($!)
fi
if ! curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/version"; then
  ( cd "$MWS_HOME/app" && HOST=127.0.0.1 PORT=$APP_PORT exec "$PY" server.py ) >>"$MWS_HOME/app.log" 2>&1 & pids+=($!)
fi
up "http://127.0.0.1:$APP_PORT/version" || { echo "The app did not start — see $MWS_HOME/app.log"; stop; }
"$PY" "$MWS_HOME/app/bridge/manuwave_bridge.py" >>"$MWS_HOME/bridge.log" 2>&1 & pids+=($!)
TOKEN=$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$MWS_HOME/bridge.json")
open "http://127.0.0.1:$APP_PORT/#bridge=$TOKEN"
echo "Running at http://127.0.0.1:$APP_PORT — close this window to stop."
wait
