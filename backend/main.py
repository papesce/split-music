from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from routers import export, files, jobs, lyrics, segment, split, suggest, transcribe, upload  # noqa: E402

app = FastAPI(title="Split Music API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5893"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(split.router)
app.include_router(jobs.router)
app.include_router(transcribe.router)
app.include_router(suggest.router)
app.include_router(lyrics.router)
app.include_router(export.router)
app.include_router(segment.router)
app.include_router(files.router)


import shutil  # noqa: E402


@app.on_event("startup")
def check_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        import warnings

        warnings.warn("ffmpeg/ffprobe not found on PATH — audio features will fail. Install via `brew install ffmpeg`.")


@app.get("/health")
def health() -> dict:
    ffmpeg_ok = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    return {"status": "ok", "ffmpeg": ffmpeg_ok}
