# Plan: Dev Environment Start Script

## Overview

Create a single `dev.sh` shell script at the project root that starts the
development environment. It accepts one subcommand: `help`, `backend`, `ui`,
or `all`.

- `help` — prints usage information
- `backend` — auto-installs Python venv/deps if missing, then starts uvicorn
- `ui` — auto-installs npm deps if missing, then runs `npm run dev`
- `all` — on macOS opens backend in tab 2 and frontend in tab 3 of the
  current Terminal window; original window keeps focus; falls back to
  background processes + log files on non-macOS

---

## Sub-Tasks

### Sub-Task 1 — Create `dev.sh`

**Intent**
Write the script with all four subcommands. It must be idempotent (safe to
run multiple times), auto-install missing dependencies, and open new Terminal
tabs on macOS for the `all` command.

**Expected Outcomes**
- `./dev.sh help` prints usage and exits 0
- `./dev.sh backend` starts uvicorn at `http://127.0.0.1:8000`
- `./dev.sh ui` starts Vite at `http://localhost:5173`
- `./dev.sh all` (macOS) opens backend in Terminal tab 2 and frontend in
  tab 3; the original tab keeps focus
- `./dev.sh all` (non-macOS) starts both in background; tails combined
  output; Ctrl-C kills both

**Todo List**
1. Create `dev.sh` at the project root
2. Add shebang `#!/usr/bin/env bash` and `set -euo pipefail`
3. Define `SCRIPT_DIR` so the script works regardless of where it is called from
4. Implement `start_backend` function:
   - If `backend/.venv` is missing, create venv and `pip install -r requirements.txt`
   - Activate venv
   - Run `uvicorn main:app --reload --host 127.0.0.1 --port 8000` inside `backend/`
5. Implement `start_ui` function:
   - If `frontend/node_modules` is missing, run `npm install` inside `frontend/`
   - Run `npm run dev` inside `frontend/`
6. Implement `open_tab_macos` helper that uses `osascript` to open a new tab
   in the frontmost Terminal window and run a given command string
7. Implement `all` subcommand:
   - Detect macOS via `[[ "$OSTYPE" == "darwin"* ]]`
   - On macOS: call `open_tab_macos` twice (backend, then ui); stay in original tab
   - Fallback: start backend and ui in background with log files
     (`/tmp/split-music-backend.log`, `/tmp/split-music-ui.log`); trap
     EXIT to kill both; `tail -f` both logs
8. Implement `help` subcommand with clear usage block
9. Add a `case` dispatcher at the bottom; default to `help` if no arg given
10. Make the file executable (`chmod +x dev.sh`)

**Relevant Context**
- Backend entry point: `backend/main.py` (FastAPI / uvicorn)
- Backend venv path: `backend/.venv`
- Backend env file: `backend/.env` (must exist; not created by this script)
- Frontend root: `frontend/`
- Frontend dev command: `npm run dev`
- CORS allows `http://localhost:5173` — no port changes needed

**Status:** [ ] pending

---

### Sub-Task 2 — Update README

**Intent**
Add a short "Quick Start" section at the top of `README.md` referencing `dev.sh`.

**Expected Outcomes**
- README mentions `./dev.sh all` as the one-liner to start everything
- Existing README content is unchanged

**Todo List**
1. Read the current README to find the right insertion point
2. Insert a "Quick Start" section before the existing setup instructions
   that shows: `./dev.sh all` and links to the four subcommands

**Relevant Context**
- `README.md` at project root

**Status:** [ ] pending
