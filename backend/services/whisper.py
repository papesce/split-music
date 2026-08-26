"""Whisper-based lyrics transcription."""

import re
from pathlib import Path


def _split_sentences(text: str) -> list[str]:
    """
    Split a block of text into shorter sentences.
    Splits on sentence-ending punctuation (. ! ?) followed by whitespace,
    or on commas/semicolons that join long clauses.
    Returns one sentence per item, stripping empty strings.
    """
    # Split on . ! ? followed by a space or end-of-string
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences: list[str] = []
    for part in parts:
        part = part.strip()
        if part:
            sentences.append(part)
    return sentences


def transcribe(audio_path: str | Path, model_name: str = "base") -> str:
    """
    Run OpenAI Whisper on audio_path and return the transcript as
    one sentence per line.  Downloads the model on first use (~140 MB for 'base').
    """
    import whisper  # imported lazily — heavy dependency

    model = whisper.load_model(model_name)
    result = model.transcribe(str(audio_path))

    # Prefer per-segment texts so we respect Whisper's own phrase boundaries,
    # then further split each segment on sentence-ending punctuation.
    segments = result.get("segments") or []
    if segments:
        lines: list[str] = []
        for seg in segments:
            seg_text = str(seg.get("text", "")).strip()
            if seg_text:
                lines.extend(_split_sentences(seg_text))
    else:
        # Fallback: no segment info, split the full text
        lines = _split_sentences(str(result["text"]))

    return "\n".join(lines)
