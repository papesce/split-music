"""
Build a copy-paste prompt for LLM-based metadata suggestion from lyrics.

Instead of calling an LLM directly, we generate a prompt the user can paste
into any chat AI (ChatGPT, Claude, Gemini …) and get back a JSON block with
title, artist, year, genre.
"""

_PROMPT_TEMPLATE = """\
You are a music expert. Identify the song from the lyrics excerpt below.

Output ONLY a raw JSON object — no markdown fence, no explanation, \
just the JSON. Required keys:
  title   – song title (string, or "" if unknown)
  artist  – artist / band name (string, or "" if unknown)
  year    – 4-digit release year (string like "1994", or "" if unknown)
  genre   – common genre label e.g. "Rock", "Pop", "Hip-Hop" (string, or "")

Example response:
{{"title": "Billie Jean", "artist": "Michael Jackson", "year": "1982", "genre": "Pop"}}

Lyrics excerpt (may contain transcription errors — use only as a hint to identify the song):
---
{lyrics}
---"""


_LYRICS_SEARCH_TEMPLATE = "{title} - {artist} lyrics"

_ARTWORK_SEARCH_TEMPLATE = "{title} - {artist} artwork"


def build_suggest_prompt(lyrics: str) -> str:
    """Return the ready-to-paste prompt for the given lyrics."""
    return _PROMPT_TEMPLATE.format(lyrics=lyrics.strip())


def build_lyrics_search_prompt(title: str, artist: str, album: str = "") -> str:
    """Return a Google search query for lyrics: 'title - artist lyrics'."""
    # album is accepted for API compatibility but intentionally not included
    return _LYRICS_SEARCH_TEMPLATE.format(title=title.strip(), artist=artist.strip())


def build_artwork_search_prompt(title: str, artist: str, album: str = "") -> str:
    """Return a Google search query for artwork: 'title - artist artwork'."""
    # album is accepted for API compatibility but intentionally not included
    return _ARTWORK_SEARCH_TEMPLATE.format(title=title.strip(), artist=artist.strip())
