import asyncio
import base64
import json
import os
import signal
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import DATA, MEDIA, event_dict, init_db, read_all, read_one, write
from .geo import haversine, route_length_m
from .seed import (
    PATROL_DURATION_S,
    ROUTE_INFO,
    ensure_patrol,
    list_revealed,
    load_route,
    position_at,
    route_segments,
    street_at,
)

ROUTE = load_route()
SEGMENTS = route_segments()
ROUTE_KM = sum(route_length_m(segment) for segment in SEGMENTS if len(segment) > 1) / 1000
_start_lat, _start_lon, _start_heading = position_at(0)
patrol_state = {
    "id": "cg-12",
    "name": "Patrol parkingowy CG-12",
    "lat": _start_lat,
    "lon": _start_lon,
    "heading": _start_heading,
    "progress": 0.0,
    "t": 0.0,
    "street": street_at(0)[0],
}

ROOT = DATA.parent
WORKER_PYTHON = ROOT / "ml" / ".venv" / "bin" / "python"
WORKER_API = os.environ.get("CITYGUARD_API", "http://127.0.0.1:8000")
worker: asyncio.subprocess.Process | None = None


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        message = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


class EventIn(BaseModel):
    type: str = Field(pattern="^(road_damage|litter)$")
    lat: float
    lon: float
    timestamp: str | None = None
    confidence: float = Field(ge=0, le=1)
    severity: str = Field(default="med", pattern="^(low|med|high)$")
    assigned_to: str | None = None
    meta: dict = Field(default_factory=dict)
    image_base64: str | None = None


class EventPatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(new|assigned|resolved)$")
    assigned_to: str | None = None


class PositionIn(BaseModel):
    """Pozycja z workera inferencji (ml/infer.py). Gdy brak lat/lon, liczymy ją z sekundy nagrania."""

    t: float = Field(ge=0)
    lat: float | None = None
    lon: float | None = None
    heading: float | None = None
    running: bool | None = None
    speed: float | None = None


async def _set_position(t: float, lat: float | None = None, lon: float | None = None, heading: float | None = None) -> dict:
    t = max(0.0, min(PATROL_DURATION_S, t))
    r_lat, r_lon, r_az = position_at(t)
    lat = r_lat if lat is None else lat
    lon = r_lon if lon is None else lon
    az = r_az if heading is None else heading
    fraction = t / PATROL_DURATION_S if PATROL_DURATION_S else 0
    street = street_at(t)[0]
    patrol_state.update(lat=lat, lon=lon, heading=az, progress=fraction, t=t, street=street)
    write("UPDATE patrols SET lat = ?, lon = ? WHERE id = ?", (lat, lon, "cg-12"))
    payload = {
        "kind": "position",
        "lat": lat,
        "lon": lon,
        "heading": az,
        "progress": fraction,
        "t": t,
        "street": street,
    }
    await hub.broadcast(payload)
    return payload


def _stats() -> dict:
    rows = read_all("SELECT type, status, meta FROM events WHERE revealed = 1")
    by_type = {"road_damage": 0, "litter": 0}
    by_status = {"new": 0, "assigned": 0, "resolved": 0}
    districts: dict[str, int] = {}
    for row in rows:
        by_type[row["type"]] = by_type.get(row["type"], 0) + 1
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
        district = json.loads(row["meta"] or "{}").get("district") or "Nieprzypisane"
        districts[district] = districts.get(district, 0) + 1
    total = len(rows)
    per_100 = round(total / ROUTE_KM * 100, 1) if ROUTE_KM else 0
    return {
        "total": total,
        "by_type": by_type,
        "by_status": by_status,
        "by_district": [{"district": name, "count": count} for name, count in districts.items()],
        "route_km": round(ROUTE_KM, 2),
        "per_100km": per_100,
    }


def _get_event(event_id: str) -> dict:
    row = read_one("SELECT * FROM events WHERE id = ?", (event_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Nie ma takiego zdarzenia")
    return event_dict(row)


def _nearest(event_type: str, lat: float, lon: float, class_name: str | None = None, meters: float = 30):
    rows = read_all("SELECT * FROM events WHERE type = ?", (event_type,))
    best = None
    best_d = meters
    for row in rows:
        other = json.loads(row["meta"] or "{}").get("class_name")
        if class_name and other and other != class_name:
            continue
        dist = haversine(lat, lon, row["lat"], row["lon"])
        if dist <= best_d:
            best = row
            best_d = dist
    return best


def _save_image(event_id: str, encoded: str) -> str:
    raw = base64.b64decode(encoded)
    MEDIA.mkdir(parents=True, exist_ok=True)
    (MEDIA / f"{event_id}.jpg").write_bytes(raw)
    return f"/media/{event_id}.jpg"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_patrol()
    row = read_one("SELECT lat, lon FROM patrols WHERE id = ?", ("cg-12",))
    if row is not None:
        patrol_state["lat"] = row["lat"]
        patrol_state["lon"] = row["lon"]
    yield
    await _stop_worker()


app = FastAPI(title="CityGuard", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/route")
def route() -> dict:
    return {
        "name": ROUTE_INFO["name"],
        "points": ROUTE,
        "segments": SEGMENTS,
        "times": ROUTE_INFO["times"],
        "duration_s": PATROL_DURATION_S,
        "length_km": round(ROUTE_KM, 2),
        "video_url": ROUTE_INFO["video"],
    }


@app.post("/api/patrol/position")
async def patrol_position(body: PositionIn) -> dict:
    """Pozycja na żywo z workera inferencji (ml/infer.py)."""
    if body.running is not None and body.running != patrol_state.get("worker_running"):
        patrol_state["worker_running"] = body.running
        await hub.broadcast({"kind": "status", "running": body.running, "speed": body.speed or 1})
    return await _set_position(body.t, body.lat, body.lon, body.heading)


@app.get("/api/patrol")
def patrol() -> dict:
    return patrol_state


@app.get("/api/events")
def events(type: str | None = None, status: str | None = None) -> list[dict]:
    return list_revealed(type, status)


@app.get("/api/events/{event_id}")
def event_detail(event_id: str) -> dict:
    return _get_event(event_id)


@app.post("/api/events")
async def create_event(body: EventIn) -> dict:
    if "video_t" in body.meta and not body.meta.get("address"):
        street, district = street_at(float(body.meta["video_t"]))
        body.meta.setdefault("address", street)
        body.meta.setdefault("district", district)
    existing = _nearest(body.type, body.lat, body.lon, body.meta.get("class_name"))
    now = body.timestamp or datetime.now(timezone.utc).isoformat()
    service = body.assigned_to or ("ZDM" if body.type == "road_damage" else "ZOO")
    if existing is not None:
        meta = json.loads(existing["meta"] or "{}")
        meta["confirmations"] = int(meta.get("confirmations") or 1) + 1
        meta.update({k: v for k, v in body.meta.items() if k not in meta or k == "source"})
        meta["source"] = body.meta.get("source", meta.get("source"))
        image_url = existing["image_url"]
        if body.image_base64:
            image_url = _save_image(existing["id"], body.image_base64)
        confidence = max(existing["confidence"], body.confidence)
        write(
            """
            UPDATE events
            SET confidence = ?, image_url = ?, severity = ?, meta = ?, revealed = 1, timestamp = ?
            WHERE id = ?
            """,
            (confidence, image_url, body.severity, json.dumps(meta, ensure_ascii=False), now, existing["id"]),
        )
        payload = _get_event(existing["id"])
        await hub.broadcast({"kind": "event", "event": payload, "deduped": True})
        return payload

    event_id = uuid.uuid4().hex[:12]
    image_url = _save_image(event_id, body.image_base64) if body.image_base64 else None
    meta = {"confirmations": 1, **body.meta}
    write(
        """
        INSERT INTO events (
            id, type, lat, lon, timestamp, confidence, image_url, severity,
            status, assigned_to, meta, revealed, t_offset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 1, NULL)
        """,
        (
            event_id,
            body.type,
            body.lat,
            body.lon,
            now,
            body.confidence,
            image_url,
            body.severity,
            service,
            json.dumps(meta, ensure_ascii=False),
        ),
    )
    payload = _get_event(event_id)
    await hub.broadcast({"kind": "event", "event": payload})
    return payload


@app.patch("/api/events/{event_id}")
async def patch_event(event_id: str, body: EventPatch) -> dict:
    current = _get_event(event_id)
    status = body.status or current["status"]
    assigned = body.assigned_to if body.assigned_to is not None else current["assigned_to"]
    write("UPDATE events SET status = ?, assigned_to = ? WHERE id = ?", (status, assigned, event_id))
    payload = _get_event(event_id)
    await hub.broadcast({"kind": "event", "event": payload})
    return payload


@app.get("/api/stats")
def stats() -> dict:
    return _stats()


def _worker_running() -> bool:
    return worker is not None and worker.returncode is None


def _clear_demo_events() -> None:
    """Każdy przejazd demo zaczyna się od pustej listy — inaczej dedup łyka wszystkie wykrycia."""
    write("DELETE FROM events")
    for path in MEDIA.glob("*"):
        if path.is_file():
            path.unlink()


async def _watch_worker(proc: asyncio.subprocess.Process) -> None:
    await proc.wait()
    patrol_state["worker_running"] = False
    await hub.broadcast({"kind": "status", "running": False})


async def _stop_worker() -> None:
    if not _worker_running():
        return
    assert worker is not None
    worker.send_signal(signal.SIGINT)
    try:
        await asyncio.wait_for(worker.wait(), timeout=3)
    except asyncio.TimeoutError:
        worker.kill()


@app.post("/api/simulate/start")
async def start_sim(speed: float = 1) -> dict:
    """Przycisk „Start przejazdu”: odpala ml/infer.py --mock, czyli te same wykrycia co z terminala."""
    global worker
    if speed <= 0 or speed > 12:
        raise HTTPException(status_code=400, detail="Prędkość poza zakresem")
    if _worker_running():
        return {"running": True}
    python = WORKER_PYTHON if WORKER_PYTHON.exists() else Path(sys.executable)
    _clear_demo_events()
    await hub.broadcast({"kind": "reset"})
    await _set_position(0)
    worker = await asyncio.create_subprocess_exec(
        str(python),
        str(ROOT / "ml" / "infer.py"),
        "--video",
        str(DATA / "demo.mp4"),
        "--route",
        str(DATA / "route.json"),
        "--annotations",
        str(DATA / "annotations.json"),
        "--mock",
        "--speed",
        str(speed),
        "--api",
        WORKER_API,
        cwd=str(ROOT),
        stdout=asyncio.subprocess.DEVNULL,
    )
    asyncio.create_task(_watch_worker(worker))
    return {"running": True, "speed": speed}


@app.post("/api/simulate/stop")
async def halt_sim() -> dict:
    await _stop_worker()
    return {"running": False}


@app.post("/api/simulate/reset")
async def reset_sim() -> dict:
    await _stop_worker()
    await hub.broadcast({"kind": "reset"})
    await _set_position(0)
    return {"ok": True}


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await hub.connect(socket)
    try:
        await socket.send_text(json.dumps({"kind": "position", **patrol_state}, ensure_ascii=False))
        while True:
            await socket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(socket)
    except Exception:
        hub.disconnect(socket)


MEDIA.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA), name="media")
app.mount("/data", StaticFiles(directory=DATA), name="data")
