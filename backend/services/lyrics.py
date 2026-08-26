"""LRClib lyrics lookup — https://lrclib.net/docs

Free, no API key. Tries exact match via /api/get then falls back to /api/search.
"""

from __future__ import annotations

import re

import httpx

LRCLIB_BASE = "https://lrclib.net"
TIMEOUT = 12

# Matches LRC timestamps like [00:12.34] or [01:02.345]
_LRC_TS = re.compile(r"\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]")

HEADERS = {"User-Agent": "split-music/1.0 (https://github.com/split-music)"}


def _strip_synced(synced: str) -> str:
    """Remove LRC timestamps leaving plain lines."""
    lines: list[str] = []
    for line in synced.splitlines():
        stripped = _LRC_TS.sub("", line).strip()
        # keep empty lines as-is to preserve verse breaks? collapse consecutive empties
        lines.append(stripped)
    # trim leading/trailing blank lines
    text = "\n".join(lines).strip()
    # collapse 3+ newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


async def fetch_lyrics(
    artist: str,
    title: str,
    album: str | None = None,
    duration: int | None = None,
) -> dict | None:
    """
    Return dict with plainLyrics/syncedLyrics/trackName/artistName/albumName/instrumental
    or None if not found.
    """
    artist = artist.strip()
    title = title.strip()
    if not artist or not title:
        return None

    params: dict[str, str | int] = {"artist_name": artist, "track_name": title}
    if album:
        album = album.strip()
        if album:
            params["album_name"] = album
    if duration and duration > 0:
        params["duration"] = duration

    async with httpx.AsyncClient(timeout=TIMEOUT, headers=HEADERS) as client:
        # 1) Try exact match — returns single object or 404
        try:
            resp = await client.get(f"{LRCLIB_BASE}/api/get", params=params)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("plainLyrics") or data.get("syncedLyrics"):
                    return _normalize(data)
        except Exception:
            pass

        # 2) Fallback: search — returns array, pick best
        try:
            q = f"{artist} {title}"
            resp = await client.get(f"{LRCLIB_BASE}/api/search", params={"q": q})
            if resp.status_code == 200:
                arr = resp.json()
                if isinstance(arr, list) and arr:
                    # Prefer exact artist+track case-insensitive match
                    best = _pick_best(arr, artist, title)
                    if best and (best.get("plainLyrics") or best.get("syncedLyrics")):
                        return _normalize(best)
        except Exception:
            pass

    return None


def _pick_best(candidates: list[dict], artist: str, title: str) -> dict | None:
    al = artist.lower()
    tl = title.lower()
    # score by exact match + duration presence
    def score(c: dict) -> int:
        s = 0
        if (c.get("artistName") or "").lower() == al:
            s += 10
        elif al in (c.get("artistName") or "").lower():
            s += 5
        if (c.get("trackName") or "").lower() == tl:
            s += 10
        elif tl in (c.get("trackName") or "").lower():
            s += 5
        if c.get("plainLyrics"):
            s += 3
        if not c.get("instrumental"):
            s += 1
        return s

    candidates.sort(key=score, reverse=True)
    return candidates[0] if candidates else None


def _normalize(data: dict) -> dict:
    plain = (data.get("plainLyrics") or "").strip()
    synced = (data.get("syncedLyrics") or "").strip()
    # If plain missing but synced present, derive plain
    if not plain and synced:
        plain = _strip_synced(synced)
    return {
        "trackName": data.get("trackName") or "",
        "artistName": data.get("artistName") or "",
        "albumName": data.get("albumName") or "",
        "duration": data.get("duration") or 0,
        "instrumental": bool(data.get("instrumental")),
        "plainLyrics": plain,
        "syncedLyrics": synced,
    }
