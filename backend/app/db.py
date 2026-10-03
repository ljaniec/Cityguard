import json
import os
import sqlite3
import threading
from pathlib import Path

ROOT = Path(os.environ.get("CITYGUARD_ROOT", Path(__file__).resolve().parents[2]))
STORAGE = Path(os.environ.get("CITYGUARD_STORAGE", ROOT / "backend" / "storage"))
DATA = ROOT / "data"
MEDIA = STORAGE / "media"
DB_PATH = STORAGE / "cityguard.db"

_lock = threading.Lock()


def connect() -> sqlite3.Connection:
    STORAGE.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock:
        conn = connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    timestamp TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    image_url TEXT,
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL,
                    assigned_to TEXT,
                    meta TEXT NOT NULL,
                    revealed INTEGER NOT NULL DEFAULT 1,
                    t_offset REAL
                );
                CREATE TABLE IF NOT EXISTS patrols (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    lat REAL,
                    lon REAL
                );
                """
            )
            conn.commit()
        finally:
            conn.close()


def write(sql: str, args: tuple = ()) -> None:
    with _lock:
        conn = connect()
        try:
            conn.execute(sql, args)
            conn.commit()
        finally:
            conn.close()


def read_all(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        conn = connect()
        try:
            return list(conn.execute(sql, args).fetchall())
        finally:
            conn.close()


def read_one(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    rows = read_all(sql, args)
    return rows[0] if rows else None


def event_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "lat": row["lat"],
        "lon": row["lon"],
        "timestamp": row["timestamp"],
        "confidence": row["confidence"],
        "image_url": row["image_url"],
        "severity": row["severity"],
        "status": row["status"],
        "assigned_to": row["assigned_to"],
        "meta": json.loads(row["meta"] or "{}"),
    }
