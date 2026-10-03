import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .db import DATA, MEDIA, event_dict, read_one, write
from .geo import offset_east, point_at_time

FONT_CANDIDATES = [
    "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf",
    "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# sekunda nagrania, typ, waga, pewność, tytuł, klasa, status, potwierdzenia, priorytet
WEEK = [
    (1.5, "road_damage", "high", 0.84, "Dziura na pasie prawym", "pothole", "resolved", 4, None),
    (4.0, "litter", "med", 0.71, "Worek przy zatoce", "trash_bag", "assigned", 1, None),
    (6.5, "road_damage", "med", 0.66, "Siatka spękań", "crack", "new", 2, None),
    (9.5, "litter", "low", 0.58, "Rozsypane opakowania", "litter", "resolved", 1, None),
    (14.0, "road_damage", "high", 0.9, "Ubytek przy torowisku", "pothole", "assigned", 3, None),
    (15.5, "litter", "high", 0.81, "Przepełniony kosz", "overflow_bin", "new", 1, "przystanek, duży ruch pieszy"),
    (16.8, "road_damage", "low", 0.55, "Drobne ubytki", "crack", "new", 1, None),
    (20.2, "litter", "med", 0.69, "Śmieci na poboczu", "litter", "new", 1, None),
]

# sekunda nagrania, typ, waga, pewność, tytuł, klasa, priorytet
LIVE = [
    (3.0, "road_damage", "med", 0.72, "Ubytek w jezdni", "pothole", None),
    (8.0, "litter", "med", 0.74, "Worek przy zaparkowanych autach", "trash_bag", None),
    (10.5, "road_damage", "high", 0.88, "Dziura przy torowisku", "pothole", "torowisko tramwajowe"),
    (13.5, "litter", "high", 0.83, "Przepełniony kosz przy przejściu", "overflow_bin", "przejście dla pieszych, duży ruch"),
    (17.5, "road_damage", "med", 0.69, "Pęknięcie na pasie", "crack", None),
    (19.5, "litter", "low", 0.6, "Śmieci przy krawężniku", "litter", None),
]


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
    lat, lon, az, _ = point_at_time(ROUTE_INFO["points"], ROUTE_INFO["times"], t)
    return lat, lon, az


def street_at(t: float) -> tuple[str, str]:
    _, _, _, index = point_at_time(ROUTE_INFO["points"], ROUTE_INFO["times"], t)
    street, district = ROUTE_INFO["streets"][index]
    return street or "trasa patrolu", district or "Nieprzypisane"


def _font(size: int):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def render_frame(path: Path, title: str, kind: str, t: float) -> None:
    """Klatka z nagrania (data/frames) z ramką podglądu. Bez klatki rysujemy planszę."""
    color = (240, 162, 2) if kind == "road_damage" else (62, 207, 142)
    source = DATA / "frames" / f"{path.stem}.jpg"
    if source.exists():
        image = Image.open(source).convert("RGB")
        image = image.resize((960, 540))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((380, 330, 620, 470), radius=8, outline=color, width=4)
        draw.rectangle((0, 0, 960, 44), fill=(10, 14, 12))
        draw.text((16, 10), f"{title}  ·  {t:04.1f} s nagrania  ·  podgląd demo", font=_font(20), fill=(232, 242, 230))
    else:
        image = Image.new("RGB", (960, 540), (22, 28, 24))
        draw = ImageDraw.Draw(image)
        draw.polygon([(0, 540), (960, 540), (640, 250), (320, 250)], fill=(48, 52, 49))
        draw.polygon([(470, 250), (490, 250), (500, 540), (460, 540)], fill=(210, 196, 92))
        draw.rounded_rectangle((360, 300, 600, 430), radius=8, outline=color, width=5)
        draw.text((36, 28), "CITYGUARD", font=_font(32), fill=(232, 242, 230))
        draw.text((36, 78), title, font=_font(26), fill=color)
        draw.text((36, 490), "Klatka demo trasy. Prawdziwe zdjęcie podmieni inferencja z wag YOLO12.", font=_font(18), fill=(170, 184, 172))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="JPEG", quality=86)


def seed_if_empty() -> None:
    if read_one("SELECT id FROM events LIMIT 1"):
        return

    now = datetime.now(timezone.utc)
    start_lat, start_lon, _ = position_at(0)
    write(
        "INSERT INTO patrols (id, name, lat, lon) VALUES (?, ?, ?, ?)",
        ("cg-12", "Patrol parkingowy CG-12", start_lat, start_lon),
    )

    for index, item in enumerate(WEEK, start=1):
        t, kind, severity, confidence, title, class_name, status, confirmations, priority = item
        lat, lon, _ = position_at(t)
        lat, lon = offset_east(lat, lon, 18)
        street, district = street_at(t)
        event_id = f"week-{index}"
        frame = MEDIA / f"{event_id}.jpg"
        render_frame(frame, title, kind, t)
        meta = {
            "class_name": class_name,
            "title": title,
            "address": street,
            "district": district,
            "confirmations": confirmations,
            "source": "seed",
            "video_t": t,
        }
        if priority:
            meta["priority_reason"] = priority
        service = "ZDM" if kind == "road_damage" else "ZOO"
        write(
            """
            INSERT INTO events (
                id, type, lat, lon, timestamp, confidence, image_url, severity,
                status, assigned_to, meta, revealed, t_offset
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
            """,
            (
                event_id,
                kind,
                lat,
                lon,
                (now - timedelta(days=len(WEEK) - index, hours=4)).isoformat(),
                confidence,
                f"/media/{event_id}.jpg",
                severity,
                status,
                service,
                json.dumps(meta, ensure_ascii=False),
            ),
        )

    for index, item in enumerate(LIVE, start=1):
        t, kind, severity, confidence, title, class_name, priority = item
        lat, lon, _ = position_at(t)
        lat, lon = offset_east(lat, lon, 6)
        street, district = street_at(t)
        event_id = f"live-{index}"
        frame = MEDIA / f"{event_id}.jpg"
        render_frame(frame, title, kind, t)
        meta = {
            "class_name": class_name,
            "title": title,
            "address": street,
            "district": district,
            "confirmations": 1,
            "source": "seed",
            "video_t": t,
        }
        if priority:
            meta["priority_reason"] = priority
        service = "ZDM" if kind == "road_damage" else "ZOO"
        write(
            """
            INSERT INTO events (
                id, type, lat, lon, timestamp, confidence, image_url, severity,
                status, assigned_to, meta, revealed, t_offset
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 0, ?)
            """,
            (
                event_id,
                kind,
                lat,
                lon,
                now.isoformat(),
                confidence,
                f"/media/{event_id}.jpg",
                severity,
                service,
                json.dumps(meta, ensure_ascii=False),
                t,
            ),
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
