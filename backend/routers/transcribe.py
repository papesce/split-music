"""POST /transcribe/... — run Whisper on a segment or ephemeral preview range."""

import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.audio import slice_segment
from services.whisper import transcribe

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


class TranscribeRequest(BaseModel):
    model: str = "base"


class TranscribeResponse(BaseModel):
    segment_id: str
    lyrics: str


class PreviewRequest(BaseModel):
    file_id: str
    start_ms: int | None = None
    end_ms: int | None = None
    idx: int | None = None
    model: str = "base"


class PreviewResponse(BaseModel):
    file_id: str
    start_ms: int | None = None
    end_ms: int | None = None
    idx: int | None = None
    lyrics: str


@router.post("/preview", response_model=PreviewResponse)
def transcribe_preview(req: PreviewRequest) -> PreviewResponse:
    meta = store.files.get(req.file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{req.file_id}' not found.")
    if not Path(meta["path"]).exists():
        raise HTTPException(status_code=404, detail="Audio file no longer on disk.")

    start_ms = req.start_ms
    end_ms = req.end_ms

    # Validate range if provided
    if start_ms is not None or end_ms is not None:
        if start_ms is None or end_ms is None:
            raise HTTPException(status_code=400, detail="Both start_ms and end_ms must be provided together.")
        if end_ms <= start_ms:
            raise HTTPException(status_code=400, detail="end_ms must be greater than start_ms.")
        dur = meta["duration_ms"]
        if start_ms < 0 or end_ms > dur:
            raise HTTPException(status_code=400, detail=f"Range must be within [0, {dur}].")

    tmp_path: Path | None = None
    try:
        if start_ms is not None and end_ms is not None:
            tmp_path = Path(tempfile.gettempdir()) / f"split_preview_{req.file_id}_{uuid.uuid4().hex[:8]}.mp3"
            slice_segment(meta["path"], start_ms, end_ms, tmp_path)
            audio_path = str(tmp_path)
        else:
            audio_path = meta["path"]
        text = transcribe(audio_path, model_name=req.model)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass

    # Persist lyrics to drafts if idx provided
    if req.idx is not None and start_ms is not None and end_ms is not None:
        store.drafts.update_fields(req.file_id, req.idx, lyrics=text, start_ms=start_ms, end_ms=end_ms)

    return PreviewResponse(file_id=req.file_id, start_ms=start_ms, end_ms=end_ms, idx=req.idx, lyrics=text)


@router.post("/{segment_id}", response_model=TranscribeResponse)
def transcribe_segment(
    segment_id: str, req: TranscribeRequest = TranscribeRequest()
) -> TranscribeResponse:
    seg = store.segments.get(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail=f"segment_id '{segment_id}' not found.")

    try:
        text = transcribe(seg["path"], model_name=req.model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    store.segments.update_fields(segment_id, lyrics=text)
    return TranscribeResponse(segment_id=segment_id, lyrics=text)
