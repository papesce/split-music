"""
Persistent store backed by SQLite (stdlib sqlite3).
All audio files live in TEMP_DIR; metadata survives server restarts
as long as TEMP_DIR still exists on the same machine.
"""

import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import TypedDict

# ---------------------------------------------------------------------------
# Temp directory — shared home for all uploaded / sliced audio
# ---------------------------------------------------------------------------

_STATE_FILE = Path(tempfile.gettempdir()) / "split_music_dir.txt"

def _get_temp_dir() -> Path:
    """Return a stable temp dir that persists across server restarts."""
    if _STATE_FILE.exists():
        d = Path(_STATE_FILE.read_text().strip())
        if d.exists():
            return d
    d = Path(tempfile.mkdtemp(prefix="split_music_"))
    _STATE_FILE.write_text(str(d))
    return d

TEMP_DIR = _get_temp_dir()
DB_PATH = TEMP_DIR / "split_music.db"


# ---------------------------------------------------------------------------
# TypedDicts (unchanged interface for the rest of the codebase)
# ---------------------------------------------------------------------------

class SegmentMeta(TypedDict):
    segment_id: str
    file_id: str
    index: int
    start_ms: int
    end_ms: int
    path: str          # absolute path to the sliced MP3
    title: str
    artist: str
    album: str
    track: str
    year: str
    genre: str
    lyrics: str
    art_path: str      # absolute path to cover image (may be empty)


class FileMeta(TypedDict):
    file_id: str
    original_name: str
    path: str          # absolute path to the uploaded MP3
    duration_ms: int
    title: str
    artist: str
    album: str
    art_path: str
    split_points_ms: str   # JSON-encoded list of ints; "" when not yet set


# ---------------------------------------------------------------------------
# DB bootstrap
# ---------------------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init_db() -> None:
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS files (
                file_id          TEXT PRIMARY KEY,
                original_name    TEXT NOT NULL,
                path             TEXT NOT NULL,
                duration_ms      INTEGER NOT NULL,
                title            TEXT NOT NULL DEFAULT '',
                artist           TEXT NOT NULL DEFAULT '',
                album            TEXT NOT NULL DEFAULT '',
                art_path         TEXT NOT NULL DEFAULT '',
                split_points_ms  TEXT NOT NULL DEFAULT ''
            );
        """)
        # Migrate: add split_points_ms to existing DBs that predate this column
        cols = {row[1] for row in conn.execute("PRAGMA table_info(files)")}
        if "split_points_ms" not in cols:
            conn.execute(
                "ALTER TABLE files ADD COLUMN split_points_ms TEXT NOT NULL DEFAULT ''"
            )
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS segments (
                segment_id  TEXT PRIMARY KEY,
                file_id     TEXT NOT NULL,
                idx         INTEGER NOT NULL,
                start_ms    INTEGER NOT NULL,
                end_ms      INTEGER NOT NULL,
                path        TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                artist      TEXT NOT NULL DEFAULT '',
                album       TEXT NOT NULL DEFAULT '',
                track       TEXT NOT NULL DEFAULT '',
                year        TEXT NOT NULL DEFAULT '',
                genre       TEXT NOT NULL DEFAULT '',
                lyrics      TEXT NOT NULL DEFAULT '',
                art_path    TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (file_id) REFERENCES files(file_id)
            );
        """)

_init_db()


# ---------------------------------------------------------------------------
# Dict-like proxies — drop-in replacement for the old plain dicts
# ---------------------------------------------------------------------------

class _FilesProxy:
    """Behaves like dict[str, FileMeta] but reads/writes SQLite."""

    def get(self, file_id: str) -> FileMeta | None:
        with _db() as conn:
            row = conn.execute(
                "SELECT * FROM files WHERE file_id = ?", (file_id,)
            ).fetchone()
        return _row_to_file(row) if row else None

    def __getitem__(self, file_id: str) -> FileMeta:
        result = self.get(file_id)
        if result is None:
            raise KeyError(file_id)
        return result

    def __setitem__(self, file_id: str, meta: FileMeta) -> None:
        with _db() as conn:
            conn.execute("""
                INSERT INTO files (file_id, original_name, path, duration_ms,
                                   title, artist, album, art_path, split_points_ms)
                VALUES (:file_id, :original_name, :path, :duration_ms,
                        :title, :artist, :album, :art_path, :split_points_ms)
                ON CONFLICT(file_id) DO UPDATE SET
                    original_name    = excluded.original_name,
                    path             = excluded.path,
                    duration_ms      = excluded.duration_ms,
                    title            = excluded.title,
                    artist           = excluded.artist,
                    album            = excluded.album,
                    art_path         = excluded.art_path,
                    split_points_ms  = excluded.split_points_ms
            """, meta)

    def __contains__(self, file_id: object) -> bool:
        return self.get(str(file_id)) is not None

    def save_split_points(self, file_id: str, points: list[int]) -> None:
        import json
        with _db() as conn:
            conn.execute(
                "UPDATE files SET split_points_ms = ? WHERE file_id = ?",
                (json.dumps(points), file_id),
            )

    def delete(self, file_id: str) -> None:
        with _db() as conn:
            conn.execute("DELETE FROM files WHERE file_id = ?", (file_id,))

    def items(self):
        with _db() as conn:
            rows = conn.execute("SELECT * FROM files").fetchall()
        return [(_row_to_file(r)["file_id"], _row_to_file(r)) for r in rows]


class _SegmentsProxy:
    """Behaves like dict[str, SegmentMeta] but reads/writes SQLite."""

    def get(self, segment_id: str) -> SegmentMeta | None:
        with _db() as conn:
            row = conn.execute(
                "SELECT * FROM segments WHERE segment_id = ?", (segment_id,)
            ).fetchone()
        return _row_to_seg(row) if row else None

    def __getitem__(self, segment_id: str) -> SegmentMeta:
        result = self.get(segment_id)
        if result is None:
            raise KeyError(segment_id)
        return result

    def __setitem__(self, segment_id: str, seg: SegmentMeta) -> None:
        with _db() as conn:
            conn.execute("""
                INSERT INTO segments
                    (segment_id, file_id, idx, start_ms, end_ms, path,
                     title, artist, album, track, year, genre, lyrics, art_path)
                VALUES
                    (:segment_id, :file_id, :index, :start_ms, :end_ms, :path,
                     :title, :artist, :album, :track, :year, :genre, :lyrics, :art_path)
                ON CONFLICT(segment_id) DO UPDATE SET
                    file_id   = excluded.file_id,
                    idx       = excluded.idx,
                    start_ms  = excluded.start_ms,
                    end_ms    = excluded.end_ms,
                    path      = excluded.path,
                    title     = excluded.title,
                    artist    = excluded.artist,
                    album     = excluded.album,
                    track     = excluded.track,
                    year      = excluded.year,
                    genre     = excluded.genre,
                    lyrics    = excluded.lyrics,
                    art_path  = excluded.art_path
            """, seg)

    def __delitem__(self, segment_id: str) -> None:
        with _db() as conn:
            conn.execute("DELETE FROM segments WHERE segment_id = ?", (segment_id,))

    def __contains__(self, segment_id: object) -> bool:
        return self.get(str(segment_id)) is not None

    def items(self):
        with _db() as conn:
            rows = conn.execute("SELECT * FROM segments").fetchall()
        return [(r["segment_id"], _row_to_seg(r)) for r in rows]

    def values(self):
        with _db() as conn:
            rows = conn.execute("SELECT * FROM segments").fetchall()
        return [_row_to_seg(r) for r in rows]

    def by_file(self, file_id: str) -> list[SegmentMeta]:
        with _db() as conn:
            rows = conn.execute(
                "SELECT * FROM segments WHERE file_id = ? ORDER BY idx", (file_id,)
            ).fetchall()
        return [_row_to_seg(r) for r in rows]

    def delete_by_file(self, file_id: str) -> None:
        with _db() as conn:
            conn.execute("DELETE FROM segments WHERE file_id = ?", (file_id,))

    def update_fields(self, segment_id: str, **kwargs) -> None:
        """Patch arbitrary fields in-place without a full round-trip."""
        if not kwargs:
            return
        cols = ", ".join(f"{k} = :{k}" for k in kwargs)
        kwargs["segment_id"] = segment_id
        with _db() as conn:
            conn.execute(
                f"UPDATE segments SET {cols} WHERE segment_id = :segment_id",
                kwargs,
            )


def _row_to_file(row: sqlite3.Row) -> FileMeta:
    return FileMeta(
        file_id=row["file_id"],
        original_name=row["original_name"],
        path=row["path"],
        duration_ms=row["duration_ms"],
        title=row["title"],
        artist=row["artist"],
        album=row["album"],
        art_path=row["art_path"],
        split_points_ms=row["split_points_ms"] if row["split_points_ms"] else "",
    )


def _row_to_seg(row: sqlite3.Row) -> SegmentMeta:
    return SegmentMeta(
        segment_id=row["segment_id"],
        file_id=row["file_id"],
        index=row["idx"],
        start_ms=row["start_ms"],
        end_ms=row["end_ms"],
        path=row["path"],
        title=row["title"],
        artist=row["artist"],
        album=row["album"],
        track=row["track"],
        year=row["year"],
        genre=row["genre"],
        lyrics=row["lyrics"],
        art_path=row["art_path"],
    )


# ---------------------------------------------------------------------------
# Public singletons
# ---------------------------------------------------------------------------

files: _FilesProxy = _FilesProxy()
segments: _SegmentsProxy = _SegmentsProxy()


def new_id() -> str:
    return uuid.uuid4().hex


def file_dir(file_id: str) -> Path:
    d = TEMP_DIR / file_id
    d.mkdir(parents=True, exist_ok=True)
    return d
