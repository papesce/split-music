"""Whisper-based lyrics transcription."""

from pathlib import Path


def transcribe(audio_path: str | Path, model_name: str = "base") -> str:
    """
    Run OpenAI Whisper on audio_path and return the full transcript text.
    Downloads the model on first use (~140 MB for 'base').
    """
    import whisper  # imported lazily — heavy dependency

    model = whisper.load_model(model_name)
    result = model.transcribe(str(audio_path))
    return str(result["text"]).strip()
