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


class DraftState(BaseModel):
    idx: int
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
    drafts: list[DraftState] = []


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
        result.append(
            FileEntry(
                file_id=meta["file_id"],
                original_name=meta["original_name"],
                duration_ms=meta["duration_ms"],
                title=meta["title"],
                artist=meta["artist"],
                album=meta["album"],
                has_art=bool(meta["art_path"] and Path(meta["art_path"]).exists()),
            )
        )
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

    drafts = store.drafts.by_file(file_id)
    draft_list = [
        DraftState(
            idx=d["idx"],
            start_ms=d["start_ms"],
            end_ms=d["end_ms"],
            title=d["title"],
            artist=d["artist"],
            album=d["album"],
            track=d["track"],
            year=d["year"],
            genre=d["genre"],
            lyrics=d["lyrics"],
            has_art=bool(d["art_path"] and Path(d["art_path"]).exists()),
        )
        for d in drafts
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
        drafts=draft_list,
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
# Drafts — pre-split metadata (persisted per track index)
# ---------------------------------------------------------------------------


class DraftPatch(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    track: str | None = None
    year: str | None = None
    genre: str | None = None
    lyrics: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None


@router.get("/{file_id}/drafts", response_model=list[DraftState])
def list_drafts(file_id: str) -> list[DraftState]:
    if file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    drafts = store.drafts.by_file(file_id)
    return [
        DraftState(
            idx=d["idx"], start_ms=d["start_ms"], end_ms=d["end_ms"],
            title=d["title"], artist=d["artist"], album=d["album"],
            track=d["track"], year=d["year"], genre=d["genre"],
            lyrics=d["lyrics"], has_art=bool(d["art_path"] and Path(d["art_path"]).exists()),
        )
        for d in drafts
    ]


@router.patch("/{file_id}/drafts/{idx}", response_model=DraftState)
def patch_draft(file_id: str, idx: int, req: DraftPatch) -> DraftState:
    if file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if patch:
        store.drafts.update_fields(file_id, idx, **patch)
    d = store.drafts.get(file_id, idx)
    if not d:
        raise HTTPException(status_code=404, detail="Draft not found after update.")
    return DraftState(
        idx=d["idx"], start_ms=d["start_ms"], end_ms=d["end_ms"],
        title=d["title"], artist=d["artist"], album=d["album"],
        track=d["track"], year=d["year"], genre=d["genre"],
        lyrics=d["lyrics"], has_art=bool(d["art_path"] and Path(d["art_path"]).exists()),
    )


# ---------------------------------------------------------------------------
# DELETE /files/{file_id}
# ---------------------------------------------------------------------------


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str) -> None:
    """Remove a file entry and all its segments from the store (not disk)."""
    if file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    store.segments.delete_by_file(file_id)
    store.drafts.delete_by_file(file_id)
    store.files.delete(file_id)
