#!/bin/bash
# Starts a whole jam: YouTube Music, the tunnel, nimbrung, then the host page.
# Settings come from ~/.config/nimbrung/jam.env (see README). Ctrl-C or
# closing the window stops everything. --local (first) skips the tunnel, so
# only guests on this Wi-Fi can join. Other arguments go to nimbrung.
set -euo pipefail
cd "$(dirname "$0")/.."

LOCAL=0
if [ "${1:-}" = "--local" ]; then LOCAL=1; shift; fi

ENV_FILE="$HOME/.config/nimbrung/jam.env"
YTM_CONFIG="$HOME/Library/Application Support/YouTube Music/config.json"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. The README's launcher section says what goes in it."; exit 1; }
[ -x ./nimbrung ] || { echo "No ./nimbrung yet. Run make build in $PWD first."; exit 1; }
. "$ENV_FILE" # NAME, CODE, HOST_KEY, TUNNEL, PUBLIC_URL
# TUNNEL=ngrok runs ngrok on PUBLIC_URL, any other name is a cloudflared tunnel,
# and a file with no TUNNEL or PUBLIC_URL is Wi-Fi only.
if [ -z "${TUNNEL:-}" ] || [ -z "${PUBLIC_URL:-}" ]; then LOCAL=1; TUNNEL=""; fi
if [ "$LOCAL" = 0 ]; then
  TOOL=cloudflared; [ "$TUNNEL" = ngrok ] && TOOL=ngrok
  command -v "$TOOL" >/dev/null || { echo "$TOOL isn't installed. Run brew install $TOOL, then start again."; exit 1; }
fi

if ! pgrep -xq "YouTube Music"; then
  # The app sometimes switches its API Server off, and only reads the
  # setting at start, so turn it back on before opening it.
  # Only this Mac talks to the plugin, as the setup window sets it up; a
  # hostname you set yourself stays.
  [ -f "$YTM_CONFIG" ] && python3 -I - "$YTM_CONFIG" <<'PY'
import json, os, sys, tempfile
path = sys.argv[1]
with open(path) as f:
    config = json.load(f)
server = config.setdefault("plugins", {}).setdefault("api-server", {})
if not server.get("enabled") or "hostname" not in server:
    server["enabled"] = True
    server.setdefault("hostname", "127.0.0.1")
    # A new file renamed over the old one, so a crash can't leave it cut short.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".config.json.")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, os.stat(path).st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
PY
  open -a "YouTube Music"
fi

echo "Waiting for YouTube Music…"
for _ in $(seq 30); do
  curl -s -o /dev/null http://127.0.0.1:26538/ && break
  sleep 1
done
curl -s -o /dev/null http://127.0.0.1:26538/ || {
  echo "YouTube Music isn't answering. In its menu bar: Plugins → API Server [Beta] → Enabled, then start again."
  exit 1
}

# Background jobs die with the script, however it ends.
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

if [ "$LOCAL" = 1 ]; then
  # Wi-Fi only: no tunnel, and the server's own LAN link goes in the QR.
  (
    until curl -sf -o /dev/null http://localhost:8080/api/room; do sleep 1; done
    echo "Live on Wi-Fi. Guests: $(curl -s http://localhost:8080/api/room | python3 -c 'import json,sys; print(json.load(sys.stdin)["joinUrl"])')"
    open "http://localhost:8080/host?key=$HOST_KEY"
  ) &
  ./nimbrung -name "$NAME" -code "$CODE" -host-key "$HOST_KEY" "$@"
  exit
fi

if [ "$TUNNEL" = ngrok ]; then
  ngrok http 8080 --url "$PUBLIC_URL" --log stdout --log-level warn &
else
  cloudflared tunnel --loglevel warn run --url http://localhost:8080 "$TUNNEL" &
fi

# Opens the host page once guests could reach it. On localhost, so the host
# key never goes through the tunnel; its QR still shows the public link,
# which the server hands this computer because of -public-url.
(
  until curl -sf -o /dev/null "$PUBLIC_URL/api/room"; do sleep 1; done
  echo "Live. Guests: $PUBLIC_URL/join/$CODE"
  open "http://localhost:8080/host?key=$HOST_KEY"
) &

./nimbrung -name "$NAME" -code "$CODE" -host-key "$HOST_KEY" -public-url "$PUBLIC_URL" "$@"
