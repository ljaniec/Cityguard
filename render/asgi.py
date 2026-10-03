"""ASGI na Render: to samo API + zbudowany frontend pod jednym originem."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from app.main import app

STATIC = Path(os.environ.get("CITYGUARD_STATIC", "/app/frontend/dist"))
API_PREFIXES = ("api/", "media/", "data/", "ws")


def _index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/")
def spa_root():
    if not (STATIC / "index.html").is_file():
        raise HTTPException(status_code=503, detail="Brak zbudowanego frontendu.")
    return _index()


@app.get("/{path:path}")
def spa_fallback(path: str):
    if path.startswith(API_PREFIXES):
        raise HTTPException(status_code=404)
    file = STATIC / path
    if file.is_file():
        return FileResponse(file)
    if (STATIC / "index.html").is_file():
        return _index()
    raise HTTPException(status_code=404)
