"""
GET  /segment/{segment_id}/audio  — stream segment MP3 for preview
GET  /segment/{segment_id}        — return segment metadata
PATCH /segment/{segment_id}       — update metadata fields
POST /segment/{segment_id}/art    — upload cover art image for a segment
"""

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import store

router = APIRouter(prefix="/segment", tags=["segment"])


# ---------------------------------------------------------------------------
# GET /segment/{segment_id}
# ---------------------------------------------------------------------------

class SegmentResponse(BaseModel):
    segment_id: str
    file_id: str
    index: int
    start_ms: int
    end_ms: int
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    has_art: bool


@router.get("/{segment_id}", response_model=SegmentResponse)
def get_segment(segment_id: str) -> SegmentResponse:
    seg = _require_segment(segment_id)
    return SegmentResponse(
        segment_id=seg["segment_id"],
        file_id=seg["file_id"],
        index=seg["index"],
        start_ms=seg["start_ms"],
        end_ms=seg["end_ms"],
        title=seg["title"],
        artist=seg["artist"],
        album=seg["album"],
        track=seg["track"],
        year=seg["year"],
        genre=seg["genre"],
        lyrics=seg["lyrics"],
        has_art=bool(seg["art_path"] and Path(seg["art_path"]).exists()),
    )


# ---------------------------------------------------------------------------
# PATCH /segment/{segment_id}
# ---------------------------------------------------------------------------

class SegmentUpdate(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    track: str | None = None
    year: str | None = None
    genre: str | None = None
    lyrics: str | None = None


@router.patch("/{segment_id}", response_model=SegmentResponse)
def update_segment(segment_id: str, update: SegmentUpdate) -> SegmentResponse:
    seg = _require_segment(segment_id)

    for field in ("title", "artist", "album", "track", "year", "genre", "lyrics"):
        val = getattr(update, field)
        if val is not None:
            seg[field] = val  # type: ignore[literal-required]

    return get_segment(segment_id)


# ---------------------------------------------------------------------------
# POST /segment/{segment_id}/art
# ---------------------------------------------------------------------------

@router.post("/{segment_id}/art")
async def upload_art(segment_id: str, file: UploadFile = File(...)) -> dict:
    seg = _require_segment(segment_id)

    suffix = Path(file.filename or "art.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        raise HTTPException(status_code=400, detail="Only JPG/PNG images are accepted.")

    art_path = store.file_dir(seg["file_id"]) / f"art_{segment_id}{suffix}"
    art_path.write_bytes(await file.read())
    seg["art_path"] = str(art_path)

    return {"segment_id": segment_id, "art_path": str(art_path)}


# ---------------------------------------------------------------------------
# GET /segment/{segment_id}/audio
# ---------------------------------------------------------------------------

@router.get("/{segment_id}/audio")
def stream_audio(segment_id: str) -> FileResponse:
    seg = _require_segment(segment_id)
    path = Path(seg["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk.")
    return FileResponse(str(path), media_type="audio/mpeg", filename=path.name)


# ---------------------------------------------------------------------------
# GET /segment/{segment_id}/art
# ---------------------------------------------------------------------------

@router.get("/{segment_id}/art")
def get_art(segment_id: str) -> FileResponse:
    seg = _require_segment(segment_id)
    art = seg.get("art_path", "")
    if not art or not Path(art).exists():
        raise HTTPException(status_code=404, detail="No art for this segment.")
    suffix = Path(art).suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    return FileResponse(art, media_type=mime)


# ---------------------------------------------------------------------------
# GET /segment/file/{file_id}/audio  — stream the original uploaded MP3
# ---------------------------------------------------------------------------

@router.get("/file/{file_id}/audio")
def stream_original(file_id: str) -> FileResponse:
    from store import files
    meta = files.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    path = Path(meta["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk.")
    return FileResponse(str(path), media_type="audio/mpeg", filename=path.name)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_segment(segment_id: str) -> store.SegmentMeta:
    seg = store.segments.get(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail=f"segment_id '{segment_id}' not found.")
    return seg
