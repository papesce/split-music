"""Async job queue for heavy operations (detect, transcribe, identify)."""

import asyncio
import json
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

import store
from services.audio import detect_split_points, slice_segment
from services.identify import identify_segment
from services.whisper import transcribe

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobCreateResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    kind: str
    status: str  # pending|running|done|failed
    file_id: str | None = None
    segment_id: str | None = None
    idx: int | None = None
    result: dict | None = None
    error: str | None = None


def _job_to_response(j: dict) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=j["job_id"],
        kind=j["kind"],
        status=j["status"],
        file_id=j["file_id"],
        segment_id=j["segment_id"],
        idx=j["idx"],
        result=j["result"],
        error=j["error"],
    )


# ---------------------------------------------------------------------------
# Detect
# ---------------------------------------------------------------------------


class DetectJobRequest(BaseModel):
    file_id: str
    min_silence_ms: int = 700
    silence_thresh_db: int = -50


@router.post("/detect", response_model=JobCreateResponse, status_code=202)
def create_detect_job(req: DetectJobRequest, background_tasks: BackgroundTasks) -> JobCreateResponse:
    meta = store.files.get(req.file_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"file_id '{req.file_id}' not found.")
    job_id = store.jobs.create(
        kind="detect",
        file_id=req.file_id,
        params={"min_silence_ms": req.min_silence_ms, "silence_thresh_db": req.silence_thresh_db},
    )
    background_tasks.add_task(_run_detect, job_id, req.file_id, req.min_silence_ms, req.silence_thresh_db)
    return JobCreateResponse(job_id=job_id, status="pending")


def _run_detect(job_id: str, file_id: str, min_silence_ms: int, silence_thresh_db: int) -> None:
    store.jobs.set_running(job_id)
    meta = store.files.get(file_id)
    if not meta:
        store.jobs.set_failed(job_id, "file not found")
        return
    try:
        points = detect_split_points(meta["path"], min_silence_ms=min_silence_ms, silence_thresh_db=silence_thresh_db)
        store.jobs.set_done(job_id, {"file_id": file_id, "split_points_ms": points})
    except Exception as exc:
        store.jobs.set_failed(job_id, str(exc))


# ---------------------------------------------------------------------------
# Transcribe (segment or preview)
# ---------------------------------------------------------------------------


class TranscribeJobRequest(BaseModel):
    segment_id: str | None = None
    file_id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    idx: int | None = None
    model: str = "base"


@router.post("/transcribe", response_model=JobCreateResponse, status_code=202)
def create_transcribe_job(req: TranscribeJobRequest, background_tasks: BackgroundTasks) -> JobCreateResponse:
    if req.segment_id:
        seg = store.segments.get(req.segment_id)
        if not seg:
            # also check tracks directly (draft preview may be unsliced)
            t = store.tracks.get(req.segment_id)
            if not t:
                raise HTTPException(status_code=404, detail=f"segment_id '{req.segment_id}' not found.")
        job_id = store.jobs.create(kind="transcribe", segment_id=req.segment_id, params={"model": req.model})
        background_tasks.add_task(_run_transcribe_segment, job_id, req.segment_id, req.model)
        return JobCreateResponse(job_id=job_id, status="pending")
    elif req.file_id:
        meta = store.files.get(req.file_id)
        if not meta:
            raise HTTPException(status_code=404, detail=f"file_id '{req.file_id}' not found.")
        job_id = store.jobs.create(
            kind="transcribe",
            file_id=req.file_id,
            idx=req.idx,
            params={"start_ms": req.start_ms, "end_ms": req.end_ms, "model": req.model},
        )
        background_tasks.add_task(
            _run_transcribe_preview, job_id, req.file_id, req.start_ms, req.end_ms, req.idx, req.model
        )
        return JobCreateResponse(job_id=job_id, status="pending")
    else:
        raise HTTPException(status_code=400, detail="Either segment_id or file_id must be provided.")


def _run_transcribe_segment(job_id: str, segment_id: str, model: str) -> None:
    store.jobs.set_running(job_id)
    seg = store.tracks.get(segment_id)
    if not seg:
        store.jobs.set_failed(job_id, "segment not found")
        return
    path = seg["path"]
    # if track is draft (no path), need to slice on the fly from file
    if not path:
        # slice from file
        file_meta = store.files.get(seg["file_id"])
        if not file_meta:
            store.jobs.set_failed(job_id, "file not found")
            return
        tmp = Path(tempfile.gettempdir()) / f"split_preview_{seg['file_id']}_{uuid.uuid4().hex[:8]}.mp3"
        try:
            slice_segment(file_meta["path"], seg["start_ms"], seg["end_ms"], tmp)
            path = str(tmp)
            text = transcribe(path, model_name=model)
        except Exception as exc:
            store.jobs.set_failed(job_id, str(exc))
            return
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass
    else:
        try:
            text = transcribe(path, model_name=model)
        except Exception as exc:
            store.jobs.set_failed(job_id, str(exc))
            return
    # persist
    try:
        store.tracks.update_fields(segment_id, lyrics=text)
    except Exception:
        pass
    store.jobs.set_done(job_id, {"segment_id": segment_id, "lyrics": text})


def _run_transcribe_preview(job_id: str, file_id: str, start_ms: int | None, end_ms: int | None, idx: int | None, model: str) -> None:
    store.jobs.set_running(job_id)
    meta = store.files.get(file_id)
    if not meta:
        store.jobs.set_failed(job_id, "file not found")
        return
    tmp_path: Path | None = None
    try:
        if start_ms is not None and end_ms is not None:
            tmp_path = Path(tempfile.gettempdir()) / f"split_preview_{file_id}_{uuid.uuid4().hex[:8]}.mp3"
            slice_segment(meta["path"], start_ms, end_ms, tmp_path)
            audio_path = str(tmp_path)
        else:
            audio_path = meta["path"]
        text = transcribe(audio_path, model_name=model)
    except Exception as exc:
        store.jobs.set_failed(job_id, str(exc))
        return
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
    if idx is not None and start_ms is not None and end_ms is not None:
        try:
            store.drafts.update_fields(file_id, idx, lyrics=text, start_ms=start_ms, end_ms=end_ms)
        except Exception:
            pass
    store.jobs.set_done(job_id, {"file_id": file_id, "start_ms": start_ms, "end_ms": end_ms, "idx": idx, "lyrics": text})


# ---------------------------------------------------------------------------
# Identify
# ---------------------------------------------------------------------------


class IdentifyJobRequest(BaseModel):
    segment_id: str


@router.post("/identify", response_model=JobCreateResponse, status_code=202)
def create_identify_job(req: IdentifyJobRequest, background_tasks: BackgroundTasks) -> JobCreateResponse:
    seg = store.segments.get(req.segment_id)
    if not seg:
        # check tracks
        t = store.tracks.get(req.segment_id)
        if not t or not t["path"]:
            raise HTTPException(status_code=404, detail=f"segment_id '{req.segment_id}' not found or not sliced.")
    job_id = store.jobs.create(kind="identify", segment_id=req.segment_id)
    background_tasks.add_task(_run_identify, job_id, req.segment_id)
    return JobCreateResponse(job_id=job_id, status="pending")


def _run_identify(job_id: str, segment_id: str) -> None:
    store.jobs.set_running(job_id)
    seg = store.tracks.get(segment_id)
    if not seg or not seg["path"]:
        # try segments
        s = store.segments.get(segment_id)
        if not s:
            store.jobs.set_failed(job_id, "segment not found")
            return
        path = s["path"]
    else:
        path = seg["path"]
    try:
        result = identify_segment(path)
    except Exception as exc:
        store.jobs.set_failed(job_id, str(exc))
        return
    if result is None:
        store.jobs.set_done(job_id, {"segment_id": segment_id, "available": False})
        return
    # auto-fill
    try:
        updates: dict[str, str] = {}
        # seg for field check
        check_seg = seg if seg else s  # type: ignore
        for field in ("title", "artist", "album", "year"):
            if result.get(field) and not check_seg.get(field):  # type: ignore
                updates[field] = result[field]
        if updates:
            store.tracks.update_fields(segment_id, **updates)
    except Exception:
        pass
    store.jobs.set_done(
        job_id,
        {
            "segment_id": segment_id,
            "title": result.get("title", ""),
            "artist": result.get("artist", ""),
            "album": result.get("album", ""),
            "year": result.get("year", ""),
            "mbid": result.get("mbid", ""),
            "confidence": result.get("confidence", 0.0),
            "available": True,
        },
    )


# ---------------------------------------------------------------------------
# Poll
# ---------------------------------------------------------------------------


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    j = store.jobs.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail=f"job_id '{job_id}' not found.")
    return _job_to_response(j)
