# Split Music

A local web app to split long MP3 compilations (e.g. YouTube mixes) into individual tagged songs — with waveform preview, auto-split detection, lyrics transcription, cover art, and one-click export.

> All processing runs **entirely on your machine**. No data leaves the device.

---

## Quick Start

```bash
./dev.sh all       # open backend (tab 2) + frontend (tab 3) in new Terminal tabs
./dev.sh backend   # backend only  →  http://127.0.0.1:8000
./dev.sh ui        # frontend only →  http://localhost:5173
./dev.sh help      # show all options
```

> Dependencies are installed automatically on first run (`backend/.venv`, `frontend/node_modules`).

---

## Features

- **Upload & preview** — drag-and-drop MP3 with waveform display
- **Auto-split detection** — silence-based detection via ffmpeg; draggable markers to adjust boundaries
- **Per-segment editor** — title, artist, album, track, year, genre, lyrics, cover art per track
- **Lyrics transcription** — local OpenAI Whisper (no API key needed)
- **Export** — slices audio, embeds ID3 tags + art + lyrics, downloads as zip

---

## Requirements

| Dependency | Install |
|---|---|
| Python 3.11+ | [python.org](https://www.python.org) |
| Node 18+ | [nodejs.org](https://nodejs.org) |
| ffmpeg | `brew install ffmpeg` / `apt install ffmpeg` |

---

## Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

API docs available at `http://127.0.0.1:8000/docs`.

### Frontend _(Phase 2 — coming soon)_

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`.

---

## API Overview

| Method | Path | Description |
|---|---|---|
| `POST` | `/upload` | Upload MP3 → returns `file_id`, duration, existing tags |
| `POST` | `/split/detect` | Auto-detect silence-based split points |
| `POST` | `/split/apply` | Apply timestamps → creates segments |
| `GET` | `/segment/{id}` | Get segment metadata |
| `PATCH` | `/segment/{id}` | Update title, artist, lyrics, etc. |
| `POST` | `/segment/{id}/art` | Upload cover art image for a segment |
| `GET` | `/segment/{id}/art` | Retrieve segment cover art |
| `GET` | `/segment/{id}/audio` | Stream segment audio for preview |
| `POST` | `/transcribe/{id}` | Run Whisper on segment → returns lyrics |
| `POST` | `/export` | Tag all segments and return zip archive |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React + TypeScript |
| Waveform | Wavesurfer.js |
| UI components | shadcn/ui + Tailwind CSS |
| State / data fetching | TanStack Query |
| Backend | Python + FastAPI |
| Audio splitting | ffmpeg (subprocess) |
| Silence detection | ffmpeg `silencedetect` filter |
| Lyrics transcription | OpenAI Whisper (local, `base` model) |
| Metadata tagging | mutagen (ID3v2) |
| Image handling | Pillow |

---

## Project Structure

```
split-music/
├── backend/
│   ├── main.py               # FastAPI app entry point
│   ├── store.py              # In-memory session store
│   ├── requirements.txt
│   ├── routers/
│   │   ├── upload.py         # POST /upload
│   │   ├── split.py          # POST /split/detect|apply
│   │   ├── segment.py        # GET|PATCH /segment, /audio, /art
│   │   ├── transcribe.py     # POST /transcribe/{id}
│   │   └── export.py         # POST /export
│   └── services/
│       ├── audio.py          # ffmpeg wrappers
│       ├── tagger.py         # mutagen ID3 tagging
│       └── whisper.py        # Whisper transcription
├── frontend/                 # (Phase 2)
├── samples/                  # Local test files (git-ignored)
└── plan.md
```

---

## Build Phases

- [x] **Phase 1** — Backend core (upload, split, tag, export, stream)
- [ ] **Phase 2** — Frontend shell (Vite + React, waveform, split markers)
- [ ] **Phase 3** — Segment editor (per-card metadata, art upload, preview)
- [ ] **Phase 4** — Whisper integration (transcribe button, progress, editable lyrics)
- [ ] **Phase 5** — Polish & export (generate-all flow, zip download, error handling)

---

## Notes

- Whisper `base` model (~140 MB) is downloaded on first transcription. Use `small` or `medium` for better accuracy at the cost of speed.
- Session data (uploaded files, segments) lives in a system temp directory and is cleared when the server process exits.
- For song identification (Shazam-style), `AudD API` or `dejavu` can be added in a later phase.
