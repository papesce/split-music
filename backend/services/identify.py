"""
Audio fingerprinting via AcoustID + Chromaprint (fpcalc).

Requires:
  - fpcalc binary on PATH  (brew install chromaprint / apt install libchromaprint-tools)
  - pyacoustid Python package
  - An AcoustID API key set in ACOUSTID_API_KEY env var
    (free key at https://acoustid.org/login)

If fpcalc or the env var are absent the function returns None gracefully —
the caller should show "identification unavailable" rather than erroring.
"""

import json
import os
import subprocess
from pathlib import Path

_API_KEY = os.environ.get("ACOUSTID_API_KEY", "")


def _fpcalc(path: str | Path) -> tuple[int, str] | None:
    """Run fpcalc and return (duration_sec, fingerprint) or None."""
    try:
        result = subprocess.run(
            ["fpcalc", "-json", str(path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        return int(data["duration"]), data["fingerprint"]
    except (FileNotFoundError, subprocess.TimeoutExpired, KeyError, json.JSONDecodeError):
        return None


def identify_segment(path: str | Path) -> dict | None:
    """
    Fingerprint the audio and look it up on AcoustID.

    Returns a dict with keys:
        title, artist, album, year, mbid (MusicBrainz release ID), confidence
    or None if identification failed or tools are unavailable.
    """
    if not _API_KEY:
        return None

    fp = _fpcalc(path)
    if fp is None:
        return None

    duration, fingerprint = fp

    try:
        import acoustid

        results = list(
            acoustid.lookup(
                _API_KEY,
                fingerprint,
                duration,
                meta="recordings releases",
            )
        )
    except Exception:
        return None

    best_score = 0.0
    best: dict = {}

    for score, _recording_id, title, artist in results:
        if score > best_score:
            best_score = score
            best = {
                "title": title or "",
                "artist": artist or "",
                "album": "",
                "year": "",
                "mbid": "",
                "confidence": round(score, 3),
            }

    if not best:
        return None

    # Try to enrich with release info (album + year) via MusicBrainz
    try:
        import acoustid

        raw = acoustid.lookup(
            _API_KEY,
            fingerprint,
            duration,
            meta="recordings releases",
            response_type=acoustid.RESPONSE_RAW,
        )
        results_raw = raw.get("results", [])
        if results_raw:
            top = max(results_raw, key=lambda r: r.get("score", 0))
            recordings = top.get("recordings", [])
            if recordings:
                rec = recordings[0]
                releases = rec.get("releases", [])
                if releases:
                    rel = releases[0]
                    best["album"] = rel.get("title", "")
                    best["year"] = str(rel.get("date", {}).get("year", ""))
                    best["mbid"] = rel.get("id", "")
    except Exception:
        pass

    return best
