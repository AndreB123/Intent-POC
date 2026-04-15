#!/bin/bash

# Intent POC Studio Launcher
# This script spins up the Intent Studio in a new terminal window.
# Closing the window will kill the process, preventing ghost apps.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

COMMAND="npm run demo:serve"

echo "Starting Intent Studio in a new terminal..."

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
