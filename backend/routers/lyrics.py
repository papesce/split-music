"""Lyrics lookup via LRClib.

GET  /lyrics/{segment_id}          — lookup using stored title/artist (query overrides allowed)
POST /lyrics/search                — lookup with explicit artist/title
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import store
from services.lyrics import fetch_lyrics

router = APIRouter(prefix="/lyrics", tags=["lyrics"])


class LyricsSearchRequest(BaseModel):
    artist: str
    title: str
    album: str | None = None
    duration: int | None = None


class LyricsResponse(BaseModel):
    trackName: str
    artistName: str
    albumName: str
    duration: int
    instrumental: bool
    plainLyrics: str
    syncedLyrics: str
    source: str = "lrclib"


@router.post("/search", response_model=LyricsResponse)
async def search_lyrics(body: LyricsSearchRequest) -> LyricsResponse:
    if not body.artist.strip() or not body.title.strip():
        raise HTTPException(status_code=422, detail="Both artist and title are required.")
    result = await fetch_lyrics(body.artist, body.title, body.album, body.duration)
    if not result or not (result.get("plainLyrics") or result.get("syncedLyrics")):
        raise HTTPException(status_code=404, detail="No lyrics found on LRClib for this artist/title.")
    if result.get("instrumental"):
        raise HTTPException(status_code=404, detail="Track is marked as instrumental (no lyrics).")
    return LyricsResponse(**result)


@router.get("/{segment_id}", response_model=LyricsResponse)
async def get_lyrics_for_segment(
    segment_id: str,
    artist: str | None = Query(None, description="Override artist (uses segment value if omitted)"),
    title: str | None = Query(None, description="Override title"),
    album: str | None = Query(None),
) -> LyricsResponse:
    seg = store.segments.get(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail=f"segment_id '{segment_id}' not found.")

    eff_artist = (artist if artist is not None else seg.get("artist") or "").strip()
    eff_title = (title if title is not None else seg.get("title") or "").strip()
    eff_album = (album if album is not None else seg.get("album") or "").strip() or None

    if not eff_artist or not eff_title:
        raise HTTPException(status_code=422, detail="Both artist and title are required (set them on the track first).")

    # Use segment duration for better exact match
    try:
        duration_sec = max(1, round((seg["end_ms"] - seg["start_ms"]) / 1000))
    except Exception:
        duration_sec = None

    result = await fetch_lyrics(eff_artist, eff_title, eff_album, duration_sec)
    if not result or not (result.get("plainLyrics") or result.get("syncedLyrics")):
        raise HTTPException(status_code=404, detail="No lyrics found on LRClib for this artist/title.")
    if result.get("instrumental"):
        raise HTTPException(status_code=404, detail="Track is marked as instrumental (no lyrics).")
    return LyricsResponse(**result)
