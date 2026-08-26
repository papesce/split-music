"""POST /suggest/{segment_id} — return a copy-paste LLM prompt built from stored lyrics."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.suggest import build_suggest_prompt

router = APIRouter(prefix="/suggest", tags=["suggest"])


class SuggestPromptResponse(BaseModel):
    segment_id: str
    prompt: str


@router.post("/{segment_id}", response_model=SuggestPromptResponse)
def suggest_segment(segment_id: str) -> SuggestPromptResponse:
    seg = store.segments.get(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail=f"segment_id '{segment_id}' not found.")

    lyrics: str = seg.get("lyrics", "") or ""
    if not lyrics.strip():
        raise HTTPException(
            status_code=422,
            detail="No lyrics available for this segment. Transcribe first.",
        )

    return SuggestPromptResponse(
        segment_id=segment_id,
        prompt=build_suggest_prompt(lyrics),
    )
