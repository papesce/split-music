"""
POST /split/detect  — auto-detect silence-based split points
POST /split/apply   — apply a list of timestamps to create segments
"""

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
    split_points_ms: list[int]   # must include 0 and duration as boundaries


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

    # Remove stale segments for this file
    stale = [sid for sid, s in store.segments.items() if s["file_id"] == req.file_id]
    for sid in stale:
        del store.segments[sid]

    dest_dir = store.file_dir(req.file_id)
    result: list[SegmentInfo] = []

    for i, (start_ms, end_ms) in enumerate(zip(points, points[1:])):
        segment_id = store.new_id()
        out_path = dest_dir / f"segment_{i:03d}.mp3"

        try:
            slice_segment(meta["path"], start_ms, end_ms, out_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Slice {i} failed: {exc}") from exc

        seg: store.SegmentMeta = {
            "segment_id": segment_id,
            "file_id": req.file_id,
            "index": i,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "path": str(out_path),
            "title": "",
            "artist": meta["artist"],
            "album": meta["album"],
            "track": str(i + 1),
            "year": "",
            "genre": "",
            "lyrics": "",
            "art_path": meta["art_path"],
        }
        store.segments[segment_id] = seg
        result.append(SegmentInfo(segment_id=segment_id, index=i, start_ms=start_ms, end_ms=end_ms))

    return ApplyResponse(file_id=req.file_id, segments=result)


def _require_file(file_id: str) -> store.FileMeta:
    meta = store.files.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")
    return meta
