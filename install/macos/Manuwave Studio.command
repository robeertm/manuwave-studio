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
start_app() { ( cd "$MWS_HOME/app" && HOST=127.0.0.1 PORT=$APP_PORT exec "$PY" server.py ) >>"$MWS_HOME/app.log" 2>&1 & APP_PID=$!; pids+=($APP_PID); }
start_bridge() { "$PY" "$MWS_HOME/app/bridge/manuwave_bridge.py" >>"$MWS_HOME/bridge.log" 2>&1 & BRIDGE_PID=$!; pids+=($BRIDGE_PID); }
APP_PID=""

echo "Manuwave Studio — $MWS_HOME"
if ! curl -s -o /dev/null "http://127.0.0.1:$WRITER_PORT/api/tags"; then
  OLLAMA_MODELS="$MWS_HOME/models/ollama" OLLAMA_HOST="127.0.0.1:$WRITER_PORT" ollama serve >>"$MWS_HOME/writer.log" 2>&1 & pids+=($!)
fi
curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/version" || start_app
up "http://127.0.0.1:$APP_PORT/version" || { echo "The app did not start — see $MWS_HOME/app.log"; stop; }
start_bridge
TOKEN=$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$MWS_HOME/bridge.json")
[ -n "$MWS_NO_BROWSER" ] || open "http://127.0.0.1:$APP_PORT/#bridge=$TOKEN"
echo "Running at http://127.0.0.1:$APP_PORT — close this window to stop."
# Restart whatever ended (crash, killed) - at most every 10 s, so a fault cannot spin. An update keeps the process.
app_next=0; bridge_next=0
while sleep 2; do
  now=$(date +%s)
  if [ "$now" -ge "$app_next" ] && { [ -z "$APP_PID" ] || ! kill -0 "$APP_PID" 2>/dev/null; } \
     && ! curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/version"; then
    echo "The app stopped - starting it again ..."; start_app; app_next=$((now + 10))
  fi
  if [ "$now" -ge "$bridge_next" ] && ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "The bridge stopped - starting it again ..."; start_bridge; bridge_next=$((now + 10))
  fi
done
