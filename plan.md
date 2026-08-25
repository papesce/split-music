# Split Music App — Project Plan

## Overview

A web application to split long MP3 compilations (e.g. YouTube music mixes) into individual
tagged songs, with waveform preview, auto-split detection, lyrics transcription, poster art,
and one-click export.

---

## Target Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React + TypeScript |
| Waveform | Wavesurfer.js |
| UI Components | shadcn/ui + Tailwind CSS |
| State / Data fetching | TanStack Query |
| Backend | Python + FastAPI |
| Audio splitting | pydub + ffmpeg |
| Onset / silence detection | librosa |
| Lyrics transcription | OpenAI Whisper (local) |
| Metadata tagging | mutagen |
| Image handling | Pillow |

---

## Feature Set

### 1. Upload & Preview
- Drag-and-drop or file picker for MP3
- Display waveform via Wavesurfer.js
- Show embedded metadata (title, artist, album, cover art) if present

### 2. Auto-Split Detection
- Detect split points using:
  - **Silence detection** (ffmpeg / pydub) — fast, works on mixes with gaps
  - **Onset / energy detection** (librosa) — smarter, works without silence
- Render split markers on the waveform as draggable handles
- Allow user to add, remove, or drag markers to adjust boundaries

### 3. Per-Segment Editor Panel
- Play/pause preview for each segment
- Editable fields: title, artist, album, track number, year, genre
- Upload or URL-paste poster/album art per segment
- Transcribe lyrics button (runs Whisper on that segment)
- Show transcription result, editable before saving

### 4. Generate & Export
- "Generate All" button
- For each segment:
  - Slice the audio with ffmpeg
  - Embed metadata tags (ID3 via mutagen)
  - Embed album art
  - Embed lyrics
- Download all segments as a zip, or individually

---

## Architecture

```
split-music/
├── frontend/               # Vite + React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileUpload.tsx
│   │   │   ├── Waveform.tsx
│   │   │   ├── SplitMarker.tsx
│   │   │   ├── SegmentCard.tsx
│   │   │   └── ExportPanel.tsx
│   │   ├── hooks/
│   │   │   └── useAudioPipeline.ts
│   │   ├── api/            # TanStack Query + axios calls
│   │   └── App.tsx
│   └── vite.config.ts
│
├── backend/                # FastAPI app
│   ├── main.py
│   ├── routers/
│   │   ├── upload.py       # POST /upload
│   │   ├── split.py        # POST /split (detect or custom timestamps)
│   │   ├── transcribe.py   # POST /transcribe/{segment_id}
│   │   └── export.py       # POST /export (returns zip)
│   ├── services/
│   │   ├── audio.py        # pydub + librosa splitting logic
│   │   ├── whisper.py      # Whisper transcription
│   │   └── tagger.py       # mutagen metadata + art embedding
│   └── requirements.txt
│
├── samples/                # Test audio files
└── plan.md
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/upload` | Upload MP3, returns file ID + metadata + duration |
| `POST` | `/split/detect` | Auto-detect split points, returns timestamp list |
| `POST` | `/split/apply` | Apply timestamps, returns segment list |
| `POST` | `/transcribe/{segment_id}` | Run Whisper on a segment, returns lyrics text |
| `POST` | `/export` | Export all segments as tagged MP3s in a zip |
| `GET`  | `/segment/{segment_id}/audio` | Stream audio for preview |

---

## Build Phases

### Phase 1 — Backend Core (2 days)
- [ ] FastAPI project setup
- [ ] File upload + temp storage
- [ ] Silence-based split detection (pydub / ffmpeg)
- [ ] Segment audio streaming endpoint
- [ ] Export endpoint (mutagen tagging + zip)

### Phase 2 — Frontend Shell (1 day)
- [ ] Vite + React + Tailwind + shadcn/ui scaffold
- [ ] File upload component
- [ ] Waveform display (Wavesurfer.js)
- [ ] Split markers on waveform (draggable)

### Phase 3 — Segment Editor (1 day)
- [ ] Segment list with per-card metadata editor
- [ ] Poster/art upload per segment
- [ ] Play preview per segment

### Phase 4 — Whisper Integration (1 day)
- [ ] Transcribe button per segment
- [ ] Progress indicator (transcription can be slow)
- [ ] Display + edit lyrics

### Phase 5 — Polish & Export (1 day)
- [ ] "Generate All" flow with progress bar
- [ ] Zip download
- [ ] Error handling and edge cases

---

## Python Dependencies

```
fastapi
uvicorn
pydub
librosa
openai-whisper
mutagen
Pillow
python-multipart
```

## Node Dependencies

```
wavesurfer.js
@tanstack/react-query
axios
shadcn/ui
tailwindcss
```

---

## Notes

- Whisper `base` model is a good default (fast, ~140MB). `small` or `medium` for better accuracy.
- ffmpeg must be installed on the system (`brew install ffmpeg` / `apt install ffmpeg`).
- All processing is local — no data leaves the machine.
- For song identification (Shazam-like), `AudD API` (free tier) or `dejavu` can be added later.
