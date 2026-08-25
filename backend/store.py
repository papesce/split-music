"""
Shared in-memory store for uploaded files and derived segments.
All data lives in TEMP_DIR which is cleaned up when the process exits.
"""

import tempfile
import uuid
from pathlib import Path
from typing import TypedDict

# Root temp directory for all session data
TEMP_DIR = Path(tempfile.mkdtemp(prefix="split_music_"))


class SegmentMeta(TypedDict):
    segment_id: str
    file_id: str
    index: int
    start_ms: int
    end_ms: int
    path: str          # absolute path to the sliced MP3
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    art_path: str      # absolute path to cover image (may be empty)


class FileMeta(TypedDict):
    file_id: str
    original_name: str
    path: str          # absolute path to the uploaded MP3
    duration_ms: int
    title: str
    artist: str
    album: str
    art_path: str      # embedded art extracted on upload (may be empty)


# In-process stores (single-worker assumption; fine for local tool)
files: dict[str, FileMeta] = {}
segments: dict[str, SegmentMeta] = {}


def new_id() -> str:
    return uuid.uuid4().hex


def file_dir(file_id: str) -> Path:
    d = TEMP_DIR / file_id
    d.mkdir(parents=True, exist_ok=True)
    return d
