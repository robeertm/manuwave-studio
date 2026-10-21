#!/usr/bin/env bash
# Manuwave Studio — start. Keep the terminal open while you work; Ctrl+C or closing it stops everything.
MWS_HOME="${MWS_HOME:-$(cd "$(dirname "$0")" && pwd)}"
[ -f "$MWS_HOME/bridge.json" ] || MWS_HOME="$HOME/ManuwaveStudio"
export MWS_HOME PATH="$MWS_HOME/tools/bin:$PATH"
APP_PORT=8104; WRITER_PORT=11440
pids=(); stop() { echo; echo "Stopping …"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; exit 0; }
trap stop INT TERM HUP
up() { for i in $(seq 1 80); do curl -s -o /dev/null "$1" && return 0; sleep 0.25; done; return 1; }
start_app() { (cd "$MWS_HOME/app" && HOST=127.0.0.1 PORT=$APP_PORT exec python3 server.py) >>"$MWS_HOME/app.log" 2>&1 & APP_PID=$!; pids+=($APP_PID); }
start_bridge() { python3 "$MWS_HOME/app/bridge/manuwave_bridge.py" >>"$MWS_HOME/bridge.log" 2>&1 & BRIDGE_PID=$!; pids+=($BRIDGE_PID); }
APP_PID=""
curl -s -o /dev/null "http://127.0.0.1:$WRITER_PORT/api/tags" || { OLLAMA_MODELS="$MWS_HOME/models/ollama" OLLAMA_HOST="127.0.0.1:$WRITER_PORT" \
  "$MWS_HOME/tools/ollama/bin/ollama" serve >>"$MWS_HOME/writer.log" 2>&1 & pids+=($!); }
curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/version" || start_app
up "http://127.0.0.1:$APP_PORT/version" || { echo "The app did not start — see $MWS_HOME/app.log"; stop; }
start_bridge
TOKEN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$MWS_HOME/bridge.json")
[ -n "$MWS_NO_BROWSER" ] || xdg-open "http://127.0.0.1:$APP_PORT/#bridge=$TOKEN" >/dev/null 2>&1 || echo "Open http://127.0.0.1:$APP_PORT/#bridge=$TOKEN"
echo "Running at http://127.0.0.1:$APP_PORT — Ctrl+C to stop."
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
