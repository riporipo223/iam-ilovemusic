#!/bin/bash
# Prints the currently-active Cloudflare Quick Tunnel URL — the one thing
# that's inherently awkward about quick tunnels: cloudflared only ever
# prints the URL to its own log, and a new one is assigned on every
# (re)connect. This reads it back out instead of you scrolling the log by
# hand each time.
#
# Usage: apps/api/scripts/get-tunnel-url.sh
#
# Reads the SAME log file the cloudflared LaunchAgent writes to
# (see ../launchd/com.ilovemusic.cloudflared.plist). launchd appends across
# restarts rather than truncating, so old URLs from earlier sessions stay
# in the file — this always takes the LAST match, i.e. the current one.

set -euo pipefail

LOG_FILE="$HOME/Library/Logs/ilovemusic-cloudflared.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log file not found: $LOG_FILE" >&2
  echo "Is the cloudflared LaunchAgent loaded? Check: launchctl list | grep ilovemusic" >&2
  exit 1
fi

URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)

if [ -z "$URL" ]; then
  echo "No tunnel URL found yet in $LOG_FILE" >&2
  echo "The tunnel may still be starting, or hasn't connected — check the log directly:" >&2
  echo "  tail -f $LOG_FILE" >&2
  exit 1
fi

echo "$URL"
