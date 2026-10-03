import json

from .db import DATA, event_dict, read_one, write
from .geo import point_at_time


def load_route_info() -> dict:
    payload = json.loads((DATA / "route.json").read_text(encoding="utf-8"))
    raw_points = payload["points"]
    points: list[tuple[float, float]] = []
    times: list[float] = []
    segments: list[int] = []
    streets: list[tuple[str, str]] = []
    for index, item in enumerate(raw_points):
        if isinstance(item, dict):
            points.append((float(item["lat"]), float(item["lon"])))
            times.append(float(item.get("t", index)))
            segments.append(int(item.get("segment", 1)))
            streets.append((str(item.get("street", "")), str(item.get("district", ""))))
        else:
            lat, lon = item[0], item[1]
            points.append((float(lat), float(lon)))
            times.append(float(item[2]) if len(item) > 2 else float(index))
            segments.append(1)
            streets.append(("", ""))
    duration = float(payload.get("duration_s") or (times[-1] if times else 0) or 1)
    return {
        "name": payload.get("name", "Trasa"),
        "video": payload.get("video"),
        "duration_s": duration,
        "points": points,
        "times": times,
        "segments": segments,
        "streets": streets,
    }


ROUTE_INFO = load_route_info()
PATROL_DURATION_S = ROUTE_INFO["duration_s"]


def load_route() -> list[tuple[float, float]]:
    return list(ROUTE_INFO["points"])


def route_segments() -> list[list[tuple[float, float]]]:
    """Ujęcia nagrania jako osobne łamane. Między nimi auto przeskakuje, więc nie rysujemy linii."""
    out: list[list[tuple[float, float]]] = []
    current_id = None
    for point, segment in zip(ROUTE_INFO["points"], ROUTE_INFO["segments"]):
        if segment != current_id:
            out.append([])
            current_id = segment
        out[-1].append(point)
    return out


def position_at(t: float) -> tuple[float, float, float]:
    lat, lon, az, _ = point_at_time(
        ROUTE_INFO["points"], ROUTE_INFO["times"], t, ROUTE_INFO["segments"]
    )
    return lat, lon, az


def street_at(t: float) -> tuple[str, str]:
    _, _, _, index = point_at_time(
        ROUTE_INFO["points"], ROUTE_INFO["times"], t, ROUTE_INFO["segments"]
    )
    street, district = ROUTE_INFO["streets"][index]
    return street or "trasa patrolu", district or "Nieprzypisane"


def ensure_patrol() -> None:
    """Sam wiersz patrolu na mapie. Alerty nie są seedowane — wchodzą z ml/infer.py."""
    if read_one("SELECT id FROM patrols WHERE id = ?", ("cg-12",)):
        return
    lat, lon, _ = position_at(0)
    write(
        "INSERT INTO patrols (id, name, lat, lon) VALUES (?, ?, ?, ?)",
        ("cg-12", "Patrol parkingowy CG-12", lat, lon),
    )


def list_revealed(event_type: str | None = None, status: str | None = None) -> list[dict]:
    sql = "SELECT * FROM events WHERE revealed = 1"
    args: list[str] = []
    if event_type:
        sql += " AND type = ?"
        args.append(event_type)
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY timestamp DESC"
    from .db import read_all

    return [event_dict(row) for row in read_all(sql, tuple(args))]
