"""
GET   /segment/{segment_id}/audio       — stream segment MP3 for preview
GET   /segment/{segment_id}             — return segment metadata
PATCH /segment/{segment_id}             — update metadata fields
PATCH /segment/{segment_id}/boundaries  — update start/end ms and re-slice
POST  /segment/{segment_id}/art         — upload cover art image for a segment
POST  /segment/{segment_id}/identify    — fingerprint and auto-fill metadata via AcoustID
"""

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import store
from services.audio import slice_segment
from services.identify import identify_segment

router = APIRouter(prefix="/segment", tags=["segment"])


# ---------------------------------------------------------------------------
# Shared response model
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


def _to_response(seg: store.SegmentMeta) -> SegmentResponse:
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
# GET /segment/{segment_id}
# ---------------------------------------------------------------------------

@router.get("/{segment_id}", response_model=SegmentResponse)
def get_segment(segment_id: str) -> SegmentResponse:
    return _to_response(_require_segment(segment_id))


# ---------------------------------------------------------------------------
# PATCH /segment/{segment_id}  — update metadata fields
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
    _require_segment(segment_id)
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    if fields:
        store.segments.update_fields(segment_id, **fields)
    return _to_response(_require_segment(segment_id))


# ---------------------------------------------------------------------------
# PATCH /segment/{segment_id}/boundaries  — re-slice with new start/end
# ---------------------------------------------------------------------------

class BoundariesUpdate(BaseModel):
    start_ms: int
    end_ms: int


@router.patch("/{segment_id}/boundaries", response_model=SegmentResponse)
def update_boundaries(segment_id: str, update: BoundariesUpdate) -> SegmentResponse:
    seg = _require_segment(segment_id)

    if update.end_ms <= update.start_ms:
        raise HTTPException(status_code=400, detail="end_ms must be greater than start_ms.")

    file_meta = store.files.get(seg["file_id"])
    if not file_meta:
        raise HTTPException(status_code=404, detail="Parent file not found.")

    # Re-slice the source file; overwrite the same output path
    out_path = Path(seg["path"])
    try:
        slice_segment(file_meta["path"], update.start_ms, update.end_ms, out_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Re-slice failed: {exc}") from exc

    store.segments.update_fields(
        segment_id,
        start_ms=update.start_ms,
        end_ms=update.end_ms,
    )
    return _to_response(_require_segment(segment_id))


# ---------------------------------------------------------------------------
# POST /segment/{segment_id}/identify  — AcoustID fingerprint lookup
# ---------------------------------------------------------------------------

class IdentifyResponse(BaseModel):
    segment_id: str
    title: str
    artist: str
    album: str
    year: str
    mbid: str
    confidence: float
    available: bool   # False when fpcalc / API key are missing


@router.post("/{segment_id}/identify", response_model=IdentifyResponse)
async def identify(segment_id: str, background_tasks: BackgroundTasks) -> IdentifyResponse:
    seg = _require_segment(segment_id)

    # Run fingerprinting in a thread so we don't block the event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, identify_segment, seg["path"])

    if result is None:
        return IdentifyResponse(
            segment_id=segment_id,
            title="", artist="", album="", year="", mbid="",
            confidence=0.0, available=False,
        )

    # Auto-fill any empty fields in the store (don't overwrite user edits)
    updates: dict = {}
    for field in ("title", "artist", "album", "year"):
        if result.get(field) and not seg[field]:  # type: ignore[literal-required]
            updates[field] = result[field]

    if updates:
        store.segments.update_fields(segment_id, **updates)

    # If we got a MusicBrainz release ID, queue art fetch in background
    if result.get("mbid"):
        background_tasks.add_task(_fetch_mbid_art, segment_id, result["mbid"], seg["file_id"])

    return IdentifyResponse(
        segment_id=segment_id,
        title=result.get("title", ""),
        artist=result.get("artist", ""),
        album=result.get("album", ""),
        year=result.get("year", ""),
        mbid=result.get("mbid", ""),
        confidence=result.get("confidence", 0.0),
        available=True,
    )


async def _fetch_mbid_art(segment_id: str, mbid: str, file_id: str) -> None:
    """Background task: download cover art from Cover Art Archive."""
    import httpx
    seg = store.segments.get(segment_id)
    if not seg or seg["art_path"]:
        return  # already has art
    url = f"https://coverartarchive.org/release/{mbid}/front"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                art_path = store.file_dir(file_id) / f"art_{segment_id}.jpg"
                art_path.write_bytes(resp.content)
                store.segments.update_fields(segment_id, art_path=str(art_path))
    except Exception:
        pass


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
    store.segments.update_fields(segment_id, art_path=str(art_path))

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
    meta = store.files.get(file_id)
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
