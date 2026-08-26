"""POST /transcribe/{segment_id} — run Whisper on a segment."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.whisper import transcribe

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


class TranscribeRequest(BaseModel):
    model: str = "base"


class TranscribeResponse(BaseModel):
    segment_id: str
    lyrics: str


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
