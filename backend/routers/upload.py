"""POST /upload — accept an MP3, return file_id + metadata."""

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

import store
from services.audio import get_duration_ms, extract_cover_art

router = APIRouter(prefix="/upload", tags=["upload"])


class UploadResponse(BaseModel):
    file_id: str
    original_name: str
    duration_ms: int
    title: str
    artist: str
    album: str
    has_art: bool


@router.post("", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename or not file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files are accepted.")

    file_id = store.new_id()
    dest_dir = store.file_dir(file_id)
    dest_path = dest_dir / "original.mp3"

    content = await file.read()
    dest_path.write_bytes(content)

    # Extract duration
    try:
        duration_ms = get_duration_ms(dest_path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot read audio: {exc}") from exc

    # Extract existing ID3 tags
    title, artist, album, art_path = _read_basic_tags(dest_path, dest_dir)

    meta: store.FileMeta = {
        "file_id": file_id,
        "original_name": file.filename,
        "path": str(dest_path),
        "duration_ms": duration_ms,
        "title": title,
        "artist": artist,
        "album": album,
        "art_path": str(art_path) if art_path else "",
    }
    store.files[file_id] = meta

    return UploadResponse(
        file_id=file_id,
        original_name=file.filename,
        duration_ms=duration_ms,
        title=title,
        artist=artist,
        album=album,
        has_art=bool(art_path),
    )


def _read_basic_tags(mp3_path: Path, dest_dir: Path) -> tuple[str, str, str, Path | None]:
    """Return (title, artist, album, art_path|None) from existing ID3 tags."""
    try:
        from mutagen.id3 import ID3
        tags = ID3(str(mp3_path))
        title = str(tags.get("TIT2", ""))
        artist = str(tags.get("TPE1", ""))
        album = str(tags.get("TALB", ""))
    except Exception:
        title = artist = album = ""

    art_out = dest_dir / "cover.jpg"
    has_art = extract_cover_art(mp3_path, art_out)
    return title, artist, album, art_out if has_art else None
