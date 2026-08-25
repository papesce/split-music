from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import upload, split, transcribe, export, segment

app = FastAPI(title="Split Music API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(split.router)
app.include_router(transcribe.router)
app.include_router(export.router)
app.include_router(segment.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
