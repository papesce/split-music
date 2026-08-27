"""
Unified persistent store.

- Files live in DATA_DIR (XDG_DATA_HOME or ~/.local/share/split-music)
  DB at DATA_DIR/split_music.db so it survives reboots and tmp cleanups.
  Legacy TEMP_DIR pointer file is migrated automatically.

- Two tables only: files, tracks.
  tracks unifies the old drafts + segments tables.  A track with path == ""
  is a draft (not yet sliced); with path != "" is sliced.
  split_points are derived from tracks but also cached in files.split_points_ms
  for fast resume.

- SQLAlchemy 2.0 + sqlite, with thin dict-like proxies for backward compat.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import uuid
from pathlib import Path
from typing import TypedDict

from sqlalchemy import (
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    select,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

# ---------------------------------------------------------------------------
# Data / temp directory
# ---------------------------------------------------------------------------


def _get_data_dir() -> Path:
    """Prefer XDG_DATA_HOME, then ~/.local/share, then stable temp dir."""
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        d = Path(xdg) / "split-music"
        d.mkdir(parents=True, exist_ok=True)
        return d
    # ~/.local/share/split-music
    try:
        d = Path.home() / ".local" / "share" / "split-music"
        d.mkdir(parents=True, exist_ok=True)
        # sanity: writable
        if os.access(d, os.W_OK):
            return d
    except Exception:
        pass
    # fallback: legacy stable temp dir (with pointer file for continuity)
    legacy_state = Path(tempfile.gettempdir()) / "split_music_dir.txt"
    if legacy_state.exists():
        try:
            p = Path(legacy_state.read_text().strip())
            if p.exists() and os.access(p, os.W_OK):
                return p
        except Exception:
            pass
    d = Path(tempfile.mkdtemp(prefix="split_music_"))
    try:
        legacy_state.write_text(str(d))
    except Exception:
        pass
    return d


DATA_DIR: Path = _get_data_dir()
# Keep alias for existing code that uses TEMP_DIR as file storage root
TEMP_DIR: Path = DATA_DIR
DB_PATH: Path = DATA_DIR / "split_music.db"

# Migrate legacy DB file if new DB doesn't exist yet
try:
    _legacy_state_file = Path(tempfile.gettempdir()) / "split_music_dir.txt"
    if not DB_PATH.exists() and _legacy_state_file.exists():
        _legacy_dir = Path(_legacy_state_file.read_text().strip())
        _legacy_db = _legacy_dir / "split_music.db"
        if _legacy_db.exists():
            import shutil

            shutil.copy2(_legacy_db, DB_PATH)
except Exception:
    pass

# ---------------------------------------------------------------------------
# TypedDicts (public interface — unchanged)
# ---------------------------------------------------------------------------


class SegmentMeta(TypedDict):
    segment_id: str
    file_id: str
    index: int
    start_ms: int
    end_ms: int
    path: str
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    art_path: str


class FileMeta(TypedDict):
    file_id: str
    original_name: str
    path: str
    duration_ms: int
    title: str
    artist: str
    album: str
    art_path: str
    split_points_ms: str


class DraftMeta(TypedDict):
    file_id: str
    idx: int
    start_ms: int
    end_ms: int
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    art_path: str
    expanded: int


# TrackMeta mirrors SegmentMeta + expanded, unified
class TrackMeta(TypedDict):
    track_id: str
    file_id: str
    idx: int
    start_ms: int
    end_ms: int
    path: str
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    art_path: str
    expanded: int


# ---------------------------------------------------------------------------
# SQLAlchemy models
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


class FileRow(Base):
    __tablename__ = "files"
    file_id: Mapped[str] = mapped_column(String, primary_key=True)
    original_name: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, default="")
    artist: Mapped[str] = mapped_column(String, default="")
    album: Mapped[str] = mapped_column(String, default="")
    art_path: Mapped[str] = mapped_column(String, default="")
    split_points_ms: Mapped[str] = mapped_column(Text, default="")


class TrackRow(Base):
    __tablename__ = "tracks"
    __table_args__ = (UniqueConstraint("file_id", "idx", name="uq_tracks_file_idx"),)
    track_id: Mapped[str] = mapped_column(String, primary_key=True)
    file_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ms: Mapped[int] = mapped_column(Integer, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str] = mapped_column(Text, default="")  # "" = draft / unsliced
    title: Mapped[str] = mapped_column(String, default="")
    artist: Mapped[str] = mapped_column(String, default="")
    album: Mapped[str] = mapped_column(String, default="")
    track: Mapped[str] = mapped_column(String, default="")
    year: Mapped[str] = mapped_column(String, default="")
    genre: Mapped[str] = mapped_column(String, default="")
    lyrics: Mapped[str] = mapped_column(Text, default="")
    art_path: Mapped[str] = mapped_column(String, default="")
    expanded: Mapped[int] = mapped_column(Integer, default=1)


class JobRow(Base):
    __tablename__ = "jobs"
    job_id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # detect|transcribe|identify
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|running|done|failed
    file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    segment_id: Mapped[str | None] = mapped_column(String, nullable=True)
    idx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[int] = mapped_column(Integer, default=0)


engine = create_engine(f"sqlite:///{DB_PATH}", future=True, echo=False, connect_args={"check_same_thread": False})
SessionLocal: sessionmaker[Session] = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _migrate_legacy_sqlite() -> None:
    """Migrate old segments/drafts tables into tracks if they exist."""
    # Use raw sqlite connection to inspect and migrate before ORM create_all
    conn = sqlite3.connect(str(DB_PATH))
    try:
        cur = conn.cursor()
        tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        # Files table column migration (split_points_ms) handled by ORM create_all + alter
        if "segments" in tables or "drafts" in tables:
            # Ensure tracks table exists first (create if missing)
            # We'll create via raw SQL then ORM will see it
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tracks (
                    track_id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    start_ms INTEGER NOT NULL DEFAULT 0,
                    end_ms INTEGER NOT NULL DEFAULT 0,
                    path TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    artist TEXT NOT NULL DEFAULT '',
                    album TEXT NOT NULL DEFAULT '',
                    track TEXT NOT NULL DEFAULT '',
                    year TEXT NOT NULL DEFAULT '',
                    genre TEXT NOT NULL DEFAULT '',
                    lyrics TEXT NOT NULL DEFAULT '',
                    art_path TEXT NOT NULL DEFAULT '',
                    expanded INTEGER NOT NULL DEFAULT 1,
                    UNIQUE(file_id, idx)
                )
            """)
            conn.commit()
            # Migrate segments -> tracks (path != "")
            if "segments" in tables:
                for row in cur.execute("SELECT segment_id, file_id, idx, start_ms, end_ms, path, title, artist, album, track, year, genre, lyrics, art_path FROM segments"):
                    seg_id, file_id, idx, s, e, path, title, artist, album, track, year, genre, lyrics, art_path = row
                    # insert or ignore if already exists (by file_id, idx)
                    cur.execute("""
                        INSERT OR IGNORE INTO tracks (track_id, file_id, idx, start_ms, end_ms, path, title, artist, album, track, year, genre, lyrics, art_path, expanded)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, (seg_id, file_id, idx, s, e, path, title, artist, album, track, year, genre, lyrics, art_path))
                conn.commit()
            # Migrate drafts -> tracks where not already present
            if "drafts" in tables:
                # drafts schema may vary, get columns dynamically
                cols = [r[1] for r in cur.execute("PRAGMA table_info(drafts)").fetchall()]
                has_start = "start_ms" in cols
                has_end = "end_ms" in cols
                has_expanded = "expanded" in cols
                for row in cur.execute("SELECT * FROM drafts"):
                    # Build dict from row
                    row_dict = dict(zip(cols, row))
                    fid = row_dict["file_id"]
                    idx = row_dict["idx"]
                    # skip if track already exists for this file/idx (segment took precedence)
                    exists = cur.execute("SELECT 1 FROM tracks WHERE file_id=? AND idx=?", (fid, idx)).fetchone()
                    if exists:
                        continue
                    new_id = uuid.uuid4().hex
                    cur.execute("""
                        INSERT INTO tracks (track_id, file_id, idx, start_ms, end_ms, path, title, artist, album, track, year, genre, lyrics, art_path, expanded)
                        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        new_id, fid, idx,
                        row_dict.get("start_ms", 0) if has_start else 0,
                        row_dict.get("end_ms", 0) if has_end else 0,
                        row_dict.get("title", ""),
                        row_dict.get("artist", ""),
                        row_dict.get("album", ""),
                        row_dict.get("track", str(idx + 1)),
                        row_dict.get("year", ""),
                        row_dict.get("genre", ""),
                        row_dict.get("lyrics", ""),
                        row_dict.get("art_path", ""),
                        row_dict.get("expanded", 1) if has_expanded else 1,
                    ))
                conn.commit()
            # Optionally drop old tables after migration (keep for safety, but we can leave)
            # cur.execute("DROP TABLE IF EXISTS segments")
            # cur.execute("DROP TABLE IF EXISTS drafts")
            # conn.commit()
    finally:
        conn.close()


# Bootstrap
_migrate_legacy_sqlite()
Base.metadata.create_all(bind=engine)
# Ensure files.split_points_ms column exists if DB was created before that field
try:
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if "split_points_ms" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN split_points_ms TEXT NOT NULL DEFAULT ''"))
            conn.commit()
        # tracks expanded column check
        cols_t = [r[1] for r in conn.execute(text("PRAGMA table_info(tracks)")).fetchall()]
        if "expanded" not in cols_t:
            conn.execute(text("ALTER TABLE tracks ADD COLUMN expanded INTEGER NOT NULL DEFAULT 1"))
            conn.commit()
except Exception:
    pass

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_file(r: FileRow) -> FileMeta:
    return FileMeta(
        file_id=r.file_id,
        original_name=r.original_name,
        path=r.path,
        duration_ms=r.duration_ms,
        title=r.title or "",
        artist=r.artist or "",
        album=r.album or "",
        art_path=r.art_path or "",
        split_points_ms=r.split_points_ms or "",
    )


def _row_to_track(r: TrackRow) -> TrackMeta:
    return TrackMeta(
        track_id=r.track_id,
        file_id=r.file_id,
        idx=r.idx,
        start_ms=r.start_ms,
        end_ms=r.end_ms,
        path=r.path or "",
        title=r.title or "",
        artist=r.artist or "",
        album=r.album or "",
        track=r.track or "",
        year=r.year or "",
        genre=r.genre or "",
        lyrics=r.lyrics or "",
        art_path=r.art_path or "",
        expanded=int(r.expanded) if r.expanded is not None else 1,
    )


def _track_to_seg(t: TrackMeta) -> SegmentMeta:
    return SegmentMeta(
        segment_id=t["track_id"],
        file_id=t["file_id"],
        index=t["idx"],
        start_ms=t["start_ms"],
        end_ms=t["end_ms"],
        path=t["path"],
        title=t["title"],
        artist=t["artist"],
        album=t["album"],
        track=t["track"],
        year=t["year"],
        genre=t["genre"],
        lyrics=t["lyrics"],
        art_path=t["art_path"],
    )


def _track_to_draft(t: TrackMeta) -> DraftMeta:
    return DraftMeta(
        file_id=t["file_id"],
        idx=t["idx"],
        start_ms=t["start_ms"],
        end_ms=t["end_ms"],
        title=t["title"],
        artist=t["artist"],
        album=t["album"],
        track=t["track"],
        year=t["year"],
        genre=t["genre"],
        lyrics=t["lyrics"],
        art_path=t["art_path"],
        expanded=int(t["expanded"]),
    )


# ---------------------------------------------------------------------------
# Proxies
# ---------------------------------------------------------------------------


class _FilesProxy:
    def get(self, file_id: str) -> FileMeta | None:
        with SessionLocal() as s:
            row = s.get(FileRow, file_id)
            return _row_to_file(row) if row else None

    def __getitem__(self, file_id: str) -> FileMeta:
        v = self.get(file_id)
        if v is None:
            raise KeyError(file_id)
        return v

    def __setitem__(self, file_id: str, meta: FileMeta) -> None:
        with SessionLocal() as s:
            row = s.get(FileRow, file_id)
            if row:
                row.original_name = meta["original_name"]
                row.path = meta["path"]
                row.duration_ms = meta["duration_ms"]
                row.title = meta["title"]
                row.artist = meta["artist"]
                row.album = meta["album"]
                row.art_path = meta["art_path"]
                row.split_points_ms = meta.get("split_points_ms", "") or ""
            else:
                row = FileRow(
                    file_id=meta["file_id"],
                    original_name=meta["original_name"],
                    path=meta["path"],
                    duration_ms=meta["duration_ms"],
                    title=meta["title"],
                    artist=meta["artist"],
                    album=meta["album"],
                    art_path=meta["art_path"],
                    split_points_ms=meta.get("split_points_ms", "") or "",
                )
                s.add(row)
            s.commit()

    def __contains__(self, file_id: object) -> bool:
        return self.get(str(file_id)) is not None

    def save_split_points(self, file_id: str, points: list[int]) -> None:
        import json

        with SessionLocal() as s:
            row = s.get(FileRow, file_id)
            if row:
                row.split_points_ms = json.dumps(points)
                s.commit()

    def delete(self, file_id: str) -> None:
        with SessionLocal() as s:
            row = s.get(FileRow, file_id)
            if row:
                s.delete(row)
                s.commit()

    def items(self) -> list[tuple[str, FileMeta]]:
        with SessionLocal() as s:
            rows = s.execute(select(FileRow)).scalars().all()
            return [(r.file_id, _row_to_file(r)) for r in rows]


class _TracksProxy:
    """Unified tracks table."""

    def get(self, track_id: str) -> TrackMeta | None:
        with SessionLocal() as s:
            row = s.get(TrackRow, track_id)
            return _row_to_track(row) if row else None

    def get_by_file_idx(self, file_id: str, idx: int) -> TrackMeta | None:
        with SessionLocal() as s:
            row = s.execute(select(TrackRow).where(TrackRow.file_id == file_id, TrackRow.idx == idx)).scalar_one_or_none()
            return _row_to_track(row) if row else None

    def by_file(self, file_id: str) -> list[TrackMeta]:
        with SessionLocal() as s:
            rows = s.execute(select(TrackRow).where(TrackRow.file_id == file_id).order_by(TrackRow.idx)).scalars().all()
            return [_row_to_track(r) for r in rows]

    def upsert(self, meta: TrackMeta) -> None:
        with SessionLocal() as s:
            row = s.get(TrackRow, meta["track_id"])
            if row:
                row.file_id = meta["file_id"]
                row.idx = meta["idx"]
                row.start_ms = meta["start_ms"]
                row.end_ms = meta["end_ms"]
                row.path = meta["path"]
                row.title = meta["title"]
                row.artist = meta["artist"]
                row.album = meta["album"]
                row.track = meta["track"]
                row.year = meta["year"]
                row.genre = meta["genre"]
                row.lyrics = meta["lyrics"]
                row.art_path = meta["art_path"]
                row.expanded = meta["expanded"]
            else:
                # also handle unique (file_id, idx) conflict - update that row
                existing = s.execute(select(TrackRow).where(TrackRow.file_id == meta["file_id"], TrackRow.idx == meta["idx"])).scalar_one_or_none()
                if existing:
                    existing.track_id = meta["track_id"]  # keep new id? or keep old? we update in place
                    # Actually keep existing track_id to preserve FK; use meta's id only if no conflict
                    # Prefer existing id - update fields
                    existing.start_ms = meta["start_ms"]
                    existing.end_ms = meta["end_ms"]
                    existing.path = meta["path"]
                    existing.title = meta["title"]
                    existing.artist = meta["artist"]
                    existing.album = meta["album"]
                    existing.track = meta["track"]
                    existing.year = meta["year"]
                    existing.genre = meta["genre"]
                    existing.lyrics = meta["lyrics"]
                    existing.art_path = meta["art_path"]
                    existing.expanded = meta["expanded"]
                else:
                    row = TrackRow(
                        track_id=meta["track_id"],
                        file_id=meta["file_id"],
                        idx=meta["idx"],
                        start_ms=meta["start_ms"],
                        end_ms=meta["end_ms"],
                        path=meta["path"],
                        title=meta["title"],
                        artist=meta["artist"],
                        album=meta["album"],
                        track=meta["track"],
                        year=meta["year"],
                        genre=meta["genre"],
                        lyrics=meta["lyrics"],
                        art_path=meta["art_path"],
                        expanded=meta["expanded"],
                    )
                    s.add(row)
            s.commit()

    def update_fields(self, track_id: str, **kwargs: str | int) -> None:
        if not kwargs:
            return
        with SessionLocal() as s:
            row = s.get(TrackRow, track_id)
            if not row:
                return
            for k, v in kwargs.items():
                # map index alias
                if k == "index":
                    k = "idx"
                if hasattr(row, k):
                    setattr(row, k, v)
            s.commit()

    def delete(self, track_id: str) -> None:
        with SessionLocal() as s:
            row = s.get(TrackRow, track_id)
            if row:
                s.delete(row)
                s.commit()

    def delete_by_file(self, file_id: str) -> None:
        with SessionLocal() as s:
            rows = s.execute(select(TrackRow).where(TrackRow.file_id == file_id)).scalars().all()
            for r in rows:
                s.delete(r)
            s.commit()


class _SegmentsProxy:
    """Compatibility shim: segments are tracks where path != ''."""

    def get(self, segment_id: str) -> SegmentMeta | None:
        t = tracks.get(segment_id)
        if t and t["path"]:
            return _track_to_seg(t)
        # also allow fetching draft tracks as segments for compat? No
        # If track exists but not sliced, return None to signal not found
        if t and not t["path"]:
            return None
        return None

    def __getitem__(self, segment_id: str) -> SegmentMeta:
        v = self.get(segment_id)
        if v is None:
            raise KeyError(segment_id)
        return v

    def __setitem__(self, segment_id: str, seg: SegmentMeta) -> None:
        # Upsert as track with path
        meta: TrackMeta = {
            "track_id": seg["segment_id"],
            "file_id": seg["file_id"],
            "idx": seg["index"],
            "start_ms": seg["start_ms"],
            "end_ms": seg["end_ms"],
            "path": seg["path"],
            "title": seg["title"],
            "artist": seg["artist"],
            "album": seg["album"],
            "track": seg["track"],
            "year": seg["year"],
            "genre": seg["genre"],
            "lyrics": seg["lyrics"],
            "art_path": seg["art_path"],
            "expanded": 1,
        }
        tracks.upsert(meta)

    def __delitem__(self, segment_id: str) -> None:
        tracks.delete(segment_id)

    def __contains__(self, segment_id: object) -> bool:
        return self.get(str(segment_id)) is not None

    def items(self) -> list[tuple[str, SegmentMeta]]:
        return [(t["track_id"], _track_to_seg(t)) for t in tracks.by_file_sliced_all()]

    def values(self) -> list[SegmentMeta]:
        return [_track_to_seg(t) for t in tracks.by_file_sliced_all()]

    def by_file(self, file_id: str) -> list[SegmentMeta]:
        return [_track_to_seg(t) for t in tracks.by_file(file_id) if t["path"]]

    def delete_by_file(self, file_id: str) -> None:
        # Only delete sliced tracks; drafts remain unless explicitly cleared
        # For legacy behavior, delete all tracks (both sliced and unsliced) is handled by drafts proxy separately
        # Here we delete sliced ones
        with SessionLocal() as s:
            rows = s.execute(select(TrackRow).where(TrackRow.file_id == file_id, TrackRow.path != "")).scalars().all()
            for r in rows:
                s.delete(r)
            s.commit()

    def update_fields(self, segment_id: str, **kwargs: str | int) -> None:
        # Map index -> idx
        if "index" in kwargs:
            kwargs["idx"] = kwargs.pop("index")  # type: ignore
        tracks.update_fields(segment_id, **kwargs)


# Extend _TracksProxy with helpers used by segments shim
def _tracks_by_file_sliced_all(self: _TracksProxy) -> list[TrackMeta]:
    with SessionLocal() as s:
        rows = s.execute(select(TrackRow).where(TrackRow.path != "")).scalars().all()
        return [_row_to_track(r) for r in rows]

_TracksProxy.by_file_sliced_all = _tracks_by_file_sliced_all  # type: ignore


class _DraftsProxy:
    """Compatibility shim: drafts are tracks where idx matches or unsliced."""

    def get(self, file_id: str, idx: int) -> DraftMeta | None:
        t = tracks.get_by_file_idx(file_id, idx)
        if t:
            return _track_to_draft(t)
        return None

    def by_file(self, file_id: str) -> list[DraftMeta]:
        return [_track_to_draft(t) for t in tracks.by_file(file_id)]

    def upsert(self, draft: DraftMeta) -> None:
        # If a track exists for this idx, update it; else create new track with empty path
        existing = tracks.get_by_file_idx(draft["file_id"], draft["idx"])
        track_id = existing["track_id"] if existing else uuid.uuid4().hex
        meta: TrackMeta = {
            "track_id": track_id,
            "file_id": draft["file_id"],
            "idx": draft["idx"],
            "start_ms": draft["start_ms"],
            "end_ms": draft["end_ms"],
            "path": existing["path"] if existing else "",
            "title": draft["title"],
            "artist": draft["artist"],
            "album": draft["album"],
            "track": draft["track"],
            "year": draft["year"],
            "genre": draft["genre"],
            "lyrics": draft["lyrics"],
            "art_path": draft["art_path"],
            "expanded": draft["expanded"],
        }
        tracks.upsert(meta)

    def update_fields(self, file_id: str, idx: int, **kwargs: str | int) -> None:
        existing = tracks.get_by_file_idx(file_id, idx)
        if not existing:
            base: DraftMeta = {
                "file_id": file_id,
                "idx": idx,
                "start_ms": 0,
                "end_ms": 0,
                "title": "",
                "artist": "",
                "album": "",
                "track": str(idx + 1),
                "year": "",
                "genre": "",
                "lyrics": "",
                "art_path": "",
                "expanded": 1,
            }
            base.update(kwargs)  # type: ignore
            self.upsert(base)
            return
        # Map to track update
        # expanded bool -> int handled by caller; ensure int
        track_kwargs: dict[str, str | int] = {}
        for k, v in kwargs.items():
            track_kwargs[k] = v
        tracks.update_fields(existing["track_id"], **track_kwargs)

    def delete_by_file(self, file_id: str) -> None:
        # For legacy split.apply flow that cleared drafts after slicing,
        # we should NOT delete sliced tracks.  Only delete unsliced ones
        # To preserve legacy semantics (delete all drafts), we delete tracks where path == ""
        with SessionLocal() as s:
            rows = s.execute(select(TrackRow).where(TrackRow.file_id == file_id, TrackRow.path == "")).scalars().all()
            for r in rows:
                s.delete(r)
            s.commit()

    def delete_one(self, file_id: str, idx: int) -> None:
        t = tracks.get_by_file_idx(file_id, idx)
        if t:
            # Only delete if unsliced; if sliced, this is a draft leftover - delete it
            # For sliced tracks, deletion is handled by segment delete
            if not t["path"]:
                tracks.delete(t["track_id"])


class _JobsProxy:
    def create(self, kind: str, file_id: str | None = None, segment_id: str | None = None, idx: int | None = None, params: dict | None = None) -> str:
        import json as _json
        import time as _time

        job_id = new_id()
        now = int(_time.time())
        with SessionLocal() as s:
            row = JobRow(
                job_id=job_id,
                kind=kind,
                status="pending",
                file_id=file_id,
                segment_id=segment_id,
                idx=idx,
                params_json=_json.dumps(params or {}),
                created_at=now,
                updated_at=now,
            )
            s.add(row)
            s.commit()
        return job_id

    def get(self, job_id: str) -> dict | None:
        with SessionLocal() as s:
            row = s.get(JobRow, job_id)
            if not row:
                return None
            import json as _json

            return {
                "job_id": row.job_id,
                "kind": row.kind,
                "status": row.status,
                "file_id": row.file_id,
                "segment_id": row.segment_id,
                "idx": row.idx,
                "params": _json.loads(row.params_json or "{}"),
                "result": _json.loads(row.result_json) if row.result_json else None,
                "error": row.error,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }

    def update(self, job_id: str, **fields: str | int | None) -> None:
        import time as _time

        with SessionLocal() as s:
            row = s.get(JobRow, job_id)
            if not row:
                return
            for k, v in fields.items():
                if hasattr(row, k):
                    setattr(row, k, v)
            row.updated_at = int(_time.time())
            s.commit()

    def set_running(self, job_id: str) -> None:
        self.update(job_id, status="running")

    def set_done(self, job_id: str, result: dict) -> None:
        import json as _json

        self.update(job_id, status="done", result_json=_json.dumps(result))

    def set_failed(self, job_id: str, error: str) -> None:
        self.update(job_id, status="failed", error=error)


# ---------------------------------------------------------------------------
# Public singletons
# ---------------------------------------------------------------------------

files: _FilesProxy = _FilesProxy()
tracks: _TracksProxy = _TracksProxy()
segments: _SegmentsProxy = _SegmentsProxy()
drafts: _DraftsProxy = _DraftsProxy()
jobs: _JobsProxy = _JobsProxy()


def new_id() -> str:
    return uuid.uuid4().hex


def file_dir(file_id: str) -> Path:
    d = DATA_DIR / file_id
    # Migrate legacy audio dir if needed
    if not d.exists():
        try:
            _legacy_state_file = Path(tempfile.gettempdir()) / "split_music_dir.txt"
            if _legacy_state_file.exists():
                _legacy_dir = Path(_legacy_state_file.read_text().strip())
                _legacy_file_dir = _legacy_dir / file_id
                if _legacy_file_dir.exists():
                    import shutil

                    shutil.copytree(_legacy_file_dir, d, dirs_exist_ok=True)
                    # keep legacy for fallback
                    return d
        except Exception:
            pass
    d.mkdir(parents=True, exist_ok=True)
    return d
