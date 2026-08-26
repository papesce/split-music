"""
GET /files                     — list all uploaded files (for session resume)
GET /files/{file_id}/state     — full session state: file metadata + split points
DELETE /files/{file_id}        — remove a file and all its segments from the store
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store

router = APIRouter(prefix="/files", tags=["files"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class FileEntry(BaseModel):
    file_id: str
    original_name: str
    duration_ms: int
    title: str
    artist: str
    album: str
    has_art: bool


class FileStateResponse(BaseModel):
    file_id: str
    original_name: str
    duration_ms: int
    title: str
    artist: str
    album: str
    has_art: bool
    # Ordered list of boundary timestamps in ms (includes 0 and duration_ms).
    # Empty when no split has been applied yet.
    split_points_ms: list[int]
    # index → segment_id for tracks that have already been sliced
    segments: list[dict]


# ---------------------------------------------------------------------------
# GET /files
# ---------------------------------------------------------------------------

@router.get("", response_model=list[FileEntry])
def list_files() -> list[FileEntry]:
    """Return every uploaded file whose audio is still present on disk."""
    result: list[FileEntry] = []
    for _, meta in store.files.items():
        if not Path(meta["path"]).exists():
            continue
        result.append(FileEntry(
            file_id=meta["file_id"],
            original_name=meta["original_name"],
            duration_ms=meta["duration_ms"],
            title=meta["title"],
            artist=meta["artist"],
            album=meta["album"],
            has_art=bool(meta["art_path"] and Path(meta["art_path"]).exists()),
        ))
    return result


# ---------------------------------------------------------------------------
# GET /files/{file_id}/state
# ---------------------------------------------------------------------------

@router.get("/{file_id}/state", response_model=FileStateResponse)
def get_file_state(file_id: str) -> FileStateResponse:
    """Return file metadata plus the current set of split-point boundaries."""
    import json

    meta = store.files.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    if not Path(meta["path"]).exists():
        raise HTTPException(status_code=404, detail="Audio file no longer on disk.")

    # Use explicitly saved split points if available; fall back to reconstructing
    # from segments for sessions created before this field was added.
    saved = meta.get("split_points_ms", "")
    if saved:
        points = json.loads(saved)
    else:
        existing = store.segments.by_file(file_id)
        if existing:
            points = [seg["start_ms"] for seg in existing] + [existing[-1]["end_ms"]]
        else:
            points = []

    existing_segs = store.segments.by_file(file_id)
    seg_list = [
        {"index": seg["index"], "segment_id": seg["segment_id"]}
        for seg in existing_segs
        if Path(seg["path"]).exists()
    ]

    return FileStateResponse(
        file_id=meta["file_id"],
        original_name=meta["original_name"],
        duration_ms=meta["duration_ms"],
        title=meta["title"],
        artist=meta["artist"],
        album=meta["album"],
        has_art=bool(meta["art_path"] and Path(meta["art_path"]).exists()),
        split_points_ms=points,
        segments=seg_list,
    )


# ---------------------------------------------------------------------------
# PUT /files/{file_id}/split-points
# ---------------------------------------------------------------------------

class SaveSplitPointsRequest(BaseModel):
    split_points_ms: list[int]


@router.put("/{file_id}/split-points", status_code=204)
def save_split_points(file_id: str, req: SaveSplitPointsRequest) -> None:
    """Persist the current set of waveform split-point boundaries."""
    if file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    store.files.save_split_points(file_id, req.split_points_ms)


# ---------------------------------------------------------------------------
# DELETE /files/{file_id}
# ---------------------------------------------------------------------------

@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str) -> None:
    """Remove a file entry and all its segments from the store (not disk)."""
    if file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    store.segments.delete_by_file(file_id)
    store.files.delete(file_id)
