#!/bin/bash

# Intent POC Studio Launcher
# This script spins up the Intent Studio in a new terminal window.
# Closing the window will kill the process, preventing ghost apps.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

DEFAULT_CONFIG="./intent-poc.yaml"
LIVE_CONFIG="./intent-poc.local-no-linear.yaml"
CONFIG_PATH="${INTENT_STUDIO_CONFIG:-}"

if [[ -z "$CONFIG_PATH" ]]; then
  if [[ -f "$LIVE_CONFIG" ]] && [[ -n "${GEMINI_KEY:-}" || -n "${GEMINI_API_KEY:-}" || -n "${GOOGLE_API_KEY:-}" ]]; then
    CONFIG_PATH="$LIVE_CONFIG"
  else
    CONFIG_PATH="$DEFAULT_CONFIG"
  fi
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: Studio config not found: $CONFIG_PATH"
  exit 1
fi

printf -v COMMAND 'npm run demo:serve -- --config %q' "$CONFIG_PATH"

echo "Starting Intent Studio in a new terminal..."
echo "Using config: $CONFIG_PATH"

if [[ "${INTENT_STUDIO_PRINT_ONLY:-0}" == "1" ]]; then
  echo "$COMMAND"
  exit 0
fi

if command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal --title="Intent Studio" -- bash -c "$COMMAND; echo; echo 'Process exited. Press any key to close window...'; read -n 1"
elif command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator -e bash -c "$COMMAND; echo; echo 'Process exited. Press any key to close window...'; read -n 1"
elif command -v konsole >/dev/null 2>&1; then
  konsole --title "Intent Studio" -e bash -c "$COMMAND; echo; echo 'Process exited. Press any key to close window...'; read -n 1"
elif command -v xterm >/dev/null 2>&1; then
  xterm -T "Intent Studio" -e bash -c "$COMMAND; echo; echo 'Process exited. Press any key to close window...'; read -n 1"
else
  echo "Error: No compatible terminal emulator found (gnome-terminal, x-terminal-emulator, konsole, xterm)."
  echo "Falling back to current terminal..."
  $COMMAND
fi
