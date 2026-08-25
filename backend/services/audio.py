"""
Audio utilities: duration, silence detection, slicing.
Uses ffmpeg directly via subprocess — no pydub dependency.
"""

import json
import subprocess
from pathlib import Path


def _run(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check)


def get_duration_ms(path: str | Path) -> int:
    """Return duration in milliseconds using ffprobe."""
    result = _run([
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        str(path),
    ])
    data = json.loads(result.stdout)
    duration_s = float(data["format"]["duration"])
    return int(duration_s * 1000)


def detect_split_points(
    path: str | Path,
    min_silence_ms: int = 700,
    silence_thresh_db: int = -50,
) -> list[int]:
    """
    Detect silence gaps using ffmpeg silencedetect filter.
    Returns a sorted list of timestamps (ms) including 0 and total duration.
    """
    duration_ms = get_duration_ms(path)
    noise_db = f"{silence_thresh_db}dB"
    min_duration = min_silence_ms / 1000.0

    result = _run([
        "ffmpeg", "-i", str(path),
        "-af", f"silencedetect=noise={noise_db}:duration={min_duration}",
        "-f", "null", "-",
    ], check=False)

    # silencedetect writes to stderr
    output = result.stderr

    starts: list[float] = []
    ends: list[float] = []
    for line in output.splitlines():
        if "silence_start" in line:
            try:
                starts.append(float(line.split("silence_start:")[1].strip()))
            except (IndexError, ValueError):
                pass
        elif "silence_end" in line:
            try:
                ends.append(float(line.split("silence_end:")[1].split("|")[0].strip()))
            except (IndexError, ValueError):
                pass

    midpoints: list[int] = [0]
    for s, e in zip(starts, ends):
        midpoints.append(int((s + e) / 2 * 1000))
    midpoints.append(duration_ms)

    return sorted(set(midpoints))


def slice_segment(
    source_path: str | Path,
    start_ms: int,
    end_ms: int,
    out_path: str | Path,
) -> None:
    """Slice [start_ms, end_ms] from source and export as 320k MP3 via ffmpeg."""
    start_s = start_ms / 1000.0
    duration_s = (end_ms - start_ms) / 1000.0

    _run([
        "ffmpeg", "-y",
        "-ss", str(start_s),
        "-i", str(source_path),
        "-t", str(duration_s),
        "-acodec", "libmp3lame",
        "-b:a", "320k",
        str(out_path),
    ])


def extract_cover_art(mp3_path: str | Path, out_path: str | Path) -> bool:
    """
    Extract embedded cover art from an MP3 using ffmpeg.
    Returns True if art was found and written, False otherwise.
    """
    result = _run([
        "ffmpeg", "-y",
        "-i", str(mp3_path),
        "-an",                   # no audio
        "-vcodec", "copy",
        str(out_path),
    ], check=False)
    return Path(out_path).exists() and Path(out_path).stat().st_size > 0
