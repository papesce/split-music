"""ID3 metadata + cover art + lyrics embedding via mutagen."""

from pathlib import Path

from mutagen.id3 import (
    APIC,
    ID3,
    TALB,
    TCON,
    TIT2,
    TPE1,
    TRCK,
    TYER,
    USLT,
    ID3NoHeaderError,
)


def tag_mp3(
    path: str | Path,
    title: str = "",
    artist: str = "",
    album: str = "",
    track: str = "",
    year: str = "",
    genre: str = "",
    lyrics: str = "",
    art_path: str | Path | None = None,
) -> None:
    """Write ID3 tags to an MP3 file in-place."""
    path = Path(path)

    try:
        tags = ID3(str(path))
    except ID3NoHeaderError:
        tags = ID3()

    if title:
        tags["TIT2"] = TIT2(encoding=3, text=title)
    if artist:
        tags["TPE1"] = TPE1(encoding=3, text=artist)
    if album:
        tags["TALB"] = TALB(encoding=3, text=album)
    if track:
        tags["TRCK"] = TRCK(encoding=3, text=track)
    if year:
        tags["TYER"] = TYER(encoding=3, text=year)
    if genre:
        tags["TCON"] = TCON(encoding=3, text=genre)
    if lyrics:
        tags["USLT::eng"] = USLT(encoding=3, lang="eng", desc="", text=lyrics)

    if art_path:
        art_bytes = Path(art_path).read_bytes()
        mime = _mime_from_path(art_path)
        tags["APIC:"] = APIC(
            encoding=3,
            mime=mime,
            type=3,  # Cover (front)
            desc="Cover",
            data=art_bytes,
        )

    tags.save(str(path), v2_version=3)


def _mime_from_path(path: str | Path) -> str:
    suffix = Path(path).suffix.lower()
    return "image/png" if suffix == ".png" else "image/jpeg"
