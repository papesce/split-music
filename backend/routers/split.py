"""
POST /split/detect  — auto-detect silence-based split points
POST /split/apply   — apply a list of timestamps to create segments
"""

import itertools
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.audio import detect_split_points, slice_segment

router = APIRouter(prefix="/split", tags=["split"])


# ---------------------------------------------------------------------------
# /split/detect
# ---------------------------------------------------------------------------


class DetectRequest(BaseModel):
    file_id: str
    min_silence_ms: int = 700
    silence_thresh_db: int = -50


class DetectResponse(BaseModel):
    file_id: str
    split_points_ms: list[int]


@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest) -> DetectResponse:
    meta = _require_file(req.file_id)

    try:
        points = detect_split_points(
            meta["path"],
            min_silence_ms=req.min_silence_ms,
            silence_thresh_db=req.silence_thresh_db,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return DetectResponse(file_id=req.file_id, split_points_ms=points)


# ---------------------------------------------------------------------------
# /split/apply
# ---------------------------------------------------------------------------


class ApplyRequest(BaseModel):
    file_id: str
    split_points_ms: list[int]  # must include 0 and duration as boundaries


class SegmentInfo(BaseModel):
    segment_id: str
    index: int
    start_ms: int
    end_ms: int


class ApplyResponse(BaseModel):
    file_id: str
    segments: list[SegmentInfo]


@router.post("/apply", response_model=ApplyResponse)
def apply_split(req: ApplyRequest) -> ApplyResponse:
    meta = _require_file(req.file_id)

    points = sorted(set(req.split_points_ms))
    if len(points) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 split points (start + end).")

    # Unified: clear all existing tracks for this file (both sliced and drafts)
    store.tracks.delete_by_file(req.file_id)

    dest_dir = store.file_dir(req.file_id)
    result: list[SegmentInfo] = []

    for i, (start_ms, end_ms) in enumerate(itertools.pairwise(points)):
        segment_id = store.new_id()
        out_path = dest_dir / f"segment_{i:03d}.mp3"

        try:
            slice_segment(meta["path"], start_ms, end_ms, out_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Slice {i} failed: {exc}") from exc

        # No separate draft table anymore, but check if a track existed before (preserve metadata)
        # Since we just deleted all, draft will be None — we still check for file art fallback
        draft = None  # all drafts cleared together; metadata starts from file tags
        art_path_val = meta["art_path"]
        # If we had per-track drafts before bulk delete, they'd be gone — this is intentional for bulk re-split
        seg: store.SegmentMeta = {
            "segment_id": segment_id,
            "file_id": req.file_id,
            "index": i,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "path": str(out_path),
            "title": draft["title"] if draft and draft["title"] else "",
            "artist": draft["artist"] if draft and draft["artist"] else meta["artist"],
            "album": draft["album"] if draft and draft["album"] else meta["album"],
            "track": draft["track"] if draft and draft["track"] else str(i + 1),
            "year": draft["year"] if draft else "",
            "genre": draft["genre"] if draft else "",
            "lyrics": draft["lyrics"] if draft else "",
            "art_path": art_path_val,
        }
        store.segments[segment_id] = seg
        result.append(SegmentInfo(segment_id=segment_id, index=i, start_ms=start_ms, end_ms=end_ms))

    return ApplyResponse(file_id=req.file_id, segments=result)


# ---------------------------------------------------------------------------
# /split/apply-one
# ---------------------------------------------------------------------------


class ApplyOneRequest(BaseModel):
    file_id: str
    index: int
    start_ms: int
    end_ms: int


@router.post("/apply-one", response_model=SegmentInfo)
def apply_one(req: ApplyOneRequest) -> SegmentInfo:
    meta = _require_file(req.file_id)

    if req.end_ms <= req.start_ms:
        raise HTTPException(status_code=400, detail="end_ms must be greater than start_ms.")

    index = req.index

    segment_id = store.new_id()
    out_path = store.file_dir(req.file_id) / f"segment_{segment_id[:8]}.mp3"

    try:
        slice_segment(meta["path"], req.start_ms, req.end_ms, out_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Slice failed: {exc}") from exc

    # If a unified track already exists for this idx, preserve its metadata
    existing = store.tracks.get_by_file_idx(req.file_id, index)
    draft = store.drafts.get(req.file_id, index) if not existing else None
    # Prefer existing track metadata over draft
    src_meta = existing if existing else draft
    art_path_val = meta["art_path"]
    art_src = src_meta.get("art_path") if src_meta and src_meta.get("art_path") and Path(src_meta["art_path"]).exists() else None
    if art_src:
        src = Path(art_src)
        dst = store.file_dir(req.file_id) / f"art_{segment_id}.jpg"
        try:
            shutil.copyfile(src, dst)
            art_path_val = str(dst)
        except Exception:
            art_path_val = art_src
    seg: store.SegmentMeta = {
        "segment_id": segment_id,
        "file_id": req.file_id,
        "index": index,
        "start_ms": req.start_ms,
        "end_ms": req.end_ms,
        "path": str(out_path),
        "title": src_meta["title"] if src_meta and src_meta["title"] else "",
        "artist": src_meta["artist"] if src_meta and src_meta["artist"] else meta["artist"],
        "album": src_meta["album"] if src_meta and src_meta["album"] else meta["album"],
        "track": src_meta["track"] if src_meta and src_meta["track"] else str(index + 1),
        "year": src_meta["year"] if src_meta else "",
        "genre": src_meta["genre"] if src_meta else "",
        "lyrics": src_meta["lyrics"] if src_meta else "",
        "art_path": art_path_val,
    }
    # If a track existed for this idx, delete it first (unique constraint on file_id+idx)
    if existing:
        store.tracks.delete(existing["track_id"])
    store.segments[segment_id] = seg

    return SegmentInfo(
        segment_id=segment_id,
        index=index,
        start_ms=req.start_ms,
        end_ms=req.end_ms,
    )


def _require_file(file_id: str) -> store.FileMeta:
    meta = store.files.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    return meta
