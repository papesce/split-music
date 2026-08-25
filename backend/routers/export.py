"""POST /export — tag all segments and return a zip archive."""

import io
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import store
from services.tagger import tag_mp3

router = APIRouter(prefix="/export", tags=["export"])


class SegmentExportMeta(BaseModel):
    segment_id: str
    title: str = ""
    artist: str = ""
    album: str = ""
    track: str = ""
    year: str = ""
    genre: str = ""
    lyrics: str = ""
    art_path: str = ""   # absolute path on server (already uploaded via /segment/{id}/art)


class ExportRequest(BaseModel):
    file_id: str
    segments: list[SegmentExportMeta]


@router.post("")
def export_segments(req: ExportRequest) -> StreamingResponse:
    if req.file_id not in store.files:
        raise HTTPException(status_code=404, detail=f"file_id '{req.file_id}' not found.")

    export_dir = store.file_dir(req.file_id) / "export"
    export_dir.mkdir(exist_ok=True)

    for seg_meta in req.segments:
        seg = store.segments.get(seg_meta.segment_id)
        if not seg:
            raise HTTPException(
                status_code=404,
                detail=f"segment_id '{seg_meta.segment_id}' not found.",
            )

        # Copy sliced MP3 to export dir so we don't modify the working copy
        export_path = export_dir / f"{seg['index']:03d}_{_safe(seg_meta.title or seg_meta.segment_id)}.mp3"
        shutil.copy2(seg["path"], export_path)

        art = seg_meta.art_path or seg["art_path"] or None

        tag_mp3(
            export_path,
            title=seg_meta.title or seg["title"],
            artist=seg_meta.artist or seg["artist"],
            album=seg_meta.album or seg["album"],
            track=seg_meta.track or seg["track"],
            year=seg_meta.year or seg["year"],
            genre=seg_meta.genre or seg["genre"],
            lyrics=seg_meta.lyrics or seg["lyrics"],
            art_path=art if art and Path(art).exists() else None,
        )

    # Build zip in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for mp3 in sorted(export_dir.glob("*.mp3")):
            zf.write(mp3, mp3.name)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="export_{req.file_id[:8]}.zip"'},
    )


def _safe(name: str) -> str:
    """Strip characters unsafe for filenames."""
    return "".join(c if c.isalnum() or c in " _-" else "_" for c in name).strip()
