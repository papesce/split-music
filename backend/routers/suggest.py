"""POST /suggest/{segment_id} — return a copy-paste LLM prompt built from stored lyrics."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.suggest import build_lyrics_search_prompt, build_suggest_prompt

router = APIRouter(prefix="/suggest", tags=["suggest"])


class SuggestPromptResponse(BaseModel):
    segment_id: str
    prompt: str


class PreviewSuggestRequest(BaseModel):
    lyrics: str


class PreviewSuggestResponse(BaseModel):
    prompt: str


class LyricsSearchPreviewRequest(BaseModel):
    title: str
    artist: str
    album: str = ""


class LyricsSearchPreviewResponse(BaseModel):
    prompt: str


@router.post("/preview", response_model=PreviewSuggestResponse)
def suggest_preview(req: PreviewSuggestRequest) -> PreviewSuggestResponse:
    if not req.lyrics.strip():
        raise HTTPException(
            status_code=422,
            detail="No lyrics provided. Transcribe first.",
        )
    return PreviewSuggestResponse(prompt=build_suggest_prompt(req.lyrics))


@router.post("/lyrics/preview", response_model=LyricsSearchPreviewResponse)
def lyrics_search_preview(req: LyricsSearchPreviewRequest) -> LyricsSearchPreviewResponse:
    if not req.title.strip() or not req.artist.strip():
        raise HTTPException(status_code=422, detail="Title and artist are required to search for lyrics.")
    return LyricsSearchPreviewResponse(
        prompt=build_lyrics_search_prompt(req.title, req.artist, req.album),
    )


@router.post("/lyrics/{segment_id}", response_model=SuggestPromptResponse)
def lyrics_search_segment(segment_id: str) -> SuggestPromptResponse:
    seg = store.segments.get(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail=f"segment_id '{segment_id}' not found.")
    title = (seg.get("title") or "").strip()
    artist = (seg.get("artist") or "").strip()
    album = (seg.get("album") or "").strip()
    if not title or not artist:
        raise HTTPException(status_code=422, detail="Title and artist are required to search for lyrics.")
    return SuggestPromptResponse(
        segment_id=segment_id,
        prompt=build_lyrics_search_prompt(title, artist, album),
    )


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
