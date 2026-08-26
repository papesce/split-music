#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# ── helpers ──────────────────────────────────────────────────────────────────

start_backend() {
  if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
    echo "▶ Creating Python venv..."
    python3 -m venv "$BACKEND_DIR/.venv"
    echo "▶ Installing backend dependencies..."
    "$BACKEND_DIR/.venv/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"
  fi
  echo "▶ Starting backend on http://127.0.0.1:8087"
  source "$BACKEND_DIR/.venv/bin/activate"
  cd "$BACKEND_DIR"
  exec uvicorn main:app --reload --host 127.0.0.1 --port 8087
}

start_ui() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "▶ Installing frontend dependencies..."
    npm --prefix "$FRONTEND_DIR" install
  fi
  echo "▶ Starting frontend on http://localhost:5893"
  exec npm --prefix "$FRONTEND_DIR" run dev -- --open
}

# Open a new tab in the frontmost macOS Terminal window and run a command.
open_tab_macos() {
  local cmd="$1"
  osascript \
    -e 'tell application "Terminal"' \
    -e '  tell application "System Events" to keystroke "t" using command down' \
    -e "  do script \"$cmd\" in front window" \
    -e 'end tell'
}

# ── subcommands ───────────────────────────────────────────────────────────────

cmd_help() {
  cat <<EOF
Usage: ./dev.sh <command>

Commands:
  help      Show this help message
  backend   Start the FastAPI backend  (http://127.0.0.1:8087)
  ui        Start the Vite frontend    (http://localhost:5893) and open in browser
  open      Open the frontend URL in the default browser
  all       Start both — each in a new Terminal tab on macOS,
            or as background processes with log files elsewhere

Auto-install:
  backend   Creates backend/.venv and pip-installs if missing
  ui        Runs npm install inside frontend/ if node_modules is missing
EOF
}

cmd_backend() {
  if [[ "$OSTYPE" == "darwin"* ]] && command -v osascript &>/dev/null; then
    open_tab_macos "cd '$SCRIPT_DIR' && ./dev.sh _backend"
  else
    start_backend
  fi
}

cmd_ui() {
  if [[ "$OSTYPE" == "darwin"* ]] && command -v osascript &>/dev/null; then
    open_tab_macos "cd '$SCRIPT_DIR' && ./dev.sh _ui"
  else
    start_ui
  fi
}

cmd_all() {
  if [[ "$OSTYPE" == "darwin"* ]] && command -v osascript &>/dev/null; then
    echo "▶ Opening backend in new tab..."
    open_tab_macos "cd '$SCRIPT_DIR' && ./dev.sh backend"
    sleep 0.3
    echo "▶ Opening frontend in new tab..."
    open_tab_macos "cd '$SCRIPT_DIR' && ./dev.sh ui"
    echo "✓ Backend and frontend launched in new Terminal tabs."
  else
    # Fallback: background processes + combined tail
    BACKEND_LOG=/tmp/split-music-backend.log
    UI_LOG=/tmp/split-music-ui.log

    echo "▶ Starting backend (log: $BACKEND_LOG)"
    bash "$SCRIPT_DIR/dev.sh" backend >"$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!

    echo "▶ Starting frontend (log: $UI_LOG)"
    bash "$SCRIPT_DIR/dev.sh" ui >"$UI_LOG" 2>&1 &
    UI_PID=$!

    # shellcheck disable=SC2064
    trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $UI_PID 2>/dev/null; exit 0" INT TERM

    echo "▶ Tailing logs (Ctrl-C to stop both)"
    tail -f "$BACKEND_LOG" "$UI_LOG"
  fi
}

# ── dispatcher ────────────────────────────────────────────────────────────────

COMMAND="${1:-help}"

cmd_open() {
  open "http://localhost:5893"
}

case "$COMMAND" in
  help)     cmd_help ;;
  backend)  cmd_backend ;;
  ui)       cmd_ui ;;
  open)     cmd_open ;;
  all)      cmd_all ;;
  _backend) start_backend ;;
  _ui)      start_ui ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    cmd_help
    exit 1
    ;;
esac
