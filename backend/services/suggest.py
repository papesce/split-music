"""
Build a copy-paste prompt for LLM-based metadata suggestion from lyrics.

Instead of calling an LLM directly, we generate a prompt the user can paste
into any chat AI (ChatGPT, Claude, Gemini …) and get back a JSON block with
title, artist, year, genre plus rendered artwork images.
"""

_PROMPT_TEMPLATE = """\
You are a music expert. Identify the song from the lyrics below.

Respond in TWO parts:

1) First, output ONLY a raw JSON object — no markdown fence, no explanation, \
just the JSON. Required keys:
  title   – song title (string, or "" if unknown)
  artist  – artist / band name (string, or "" if unknown)
  year    – 4-digit release year (string like "1994", or "" if unknown)
  genre   – common genre label e.g. "Rock", "Pop", "Hip-Hop" (string, or "")
  lyrics  – corrected / full lyrics for the song (string, or "" if unknown). \
Fix transcription errors, restore correct spelling/punctuation and include the complete lyrics.

2) Then, on new lines AFTER the JSON, show 2-3 artwork options as rendered \
markdown images so the user can see and manually download one to upload to \
the app. Use this exact format for each image:
  ![Album cover - <title> by <artist>](https://direct-image-url.jpg)
Each URL must be a direct image file (.jpg/.png/.webp) from sources like \
iTunes/Apple Music, Discogs, Wikipedia, or Cover Art Archive. If you cannot \
find artwork, skip part 2 entirely.

Example response:
{{"title": "Billie Jean", "artist": "Michael Jackson", "year": "1982", "genre": "Pop", "lyrics": "She was more like a beauty queen from a movie scene\\n..."}}
![Album cover - Billie Jean by Michael Jackson](https://example.com/thriller-cover-600.jpg)
![Album cover - Billie Jean by Michael Jackson](https://example.com/thriller-cover-1200.jpg)

Lyrics (may contain transcription errors — use them only to identify the song):
---
{lyrics}
---"""


def build_suggest_prompt(lyrics: str) -> str:
    """Return the ready-to-paste prompt for the given lyrics."""
    return _PROMPT_TEMPLATE.format(lyrics=lyrics.strip())
