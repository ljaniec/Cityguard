"""Inferencja lokalna. Trening jest w ml/train_road.ipynb i ml/train_litter.ipynb, tu tylko gotowe wagi YOLO12."""

from __future__ import annotations

import argparse
import base64
import json
import math
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path


Point = tuple[float, float, float]  # lat, lon, sekunda nagrania


def read_route(path: Path) -> list[Point]:
    """data/route.json: punkty {t, lat, lon} albo [lat, lon(, t)]. Bez czasu rozkładamy je równo."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw = payload["points"]
    points: list[Point] = []
    for index, item in enumerate(raw):
        if isinstance(item, dict):
            points.append((float(item["lat"]), float(item["lon"]), float(item.get("t", index))))
        else:
            t = float(item[2]) if len(item) > 2 else float(index)
            points.append((float(item[0]), float(item[1]), t))
    return points


def read_gpx(path: Path) -> list[Point]:
    root = ET.parse(path).getroot()
    points: list[Point] = []
    first: datetime | None = None
    for node in root.iter():
        if not (node.tag.endswith("trkpt") and node.get("lat") and node.get("lon")):
            continue
        stamp = None
        for child in node:
            if child.tag.endswith("time") and child.text:
                stamp = datetime.fromisoformat(child.text.replace("Z", "+00:00"))
        if stamp is not None and first is None:
            first = stamp
        t = (stamp - first).total_seconds() if stamp is not None and first is not None else float(len(points))
        points.append((float(node.get("lat", "0")), float(node.get("lon", "0")), t))
    if not points:
        raise SystemExit(f"Brak punktów w {path}")
    return points


def point_at_time(points: list[Point], t: float) -> tuple[float, float, float]:
    """Pozycja i azymut dla sekundy nagrania — ten sam zegar, którym backend steruje mapą i wideo."""
    if len(points) == 1:
        return points[0][0], points[0][1], 0.0
    if t <= points[0][2]:
        a, b = points[0], points[1]
        u = 0.0
    elif t >= points[-1][2]:
        a, b = points[-2], points[-1]
        u = 1.0
    else:
        a, b = points[0], points[1]
        for i in range(len(points) - 1):
            if points[i][2] <= t <= points[i + 1][2]:
                a, b = points[i], points[i + 1]
                break
        span = b[2] - a[2]
        u = 0.0 if span <= 0 else (t - a[2]) / span
    # Cięcie montażu: nie rysuj prostej przez zabudowę.
    dlat = math.radians(b[0] - a[0])
    dlon_m = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    if math.hypot(dlat, dlon_m) * 6_371_000 > 120:
        u = 0.0 if t < b[2] else 1.0
    lat = a[0] + (b[0] - a[0]) * u
    lon = a[1] + (b[1] - a[1]) * u
    dlon = math.radians(b[1] - a[1])
    y = math.sin(dlon) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - math.sin(math.radians(a[0])) * math.cos(
        math.radians(b[0])
    ) * math.cos(dlon)
    heading = (math.degrees(math.atan2(y, x)) + 360) % 360
    return lat, lon, heading


def severity_for(confidence: float, area: float) -> str:
    if confidence >= 0.75 or area >= 0.05:
        return "high"
    if confidence >= 0.5 or area >= 0.02:
        return "med"
    return "low"


def blur_privacy(frame, privacy_model):
    import cv2

    if privacy_model is None:
        return frame
    # COCO: 0 osoba, 2 auto, 3 motocykl, 5 autobus, 7 ciężarówka.
    # Rozmywamy górę osoby (twarz) i dół pojazdu (tablica), bez zapisu numerów.
    result = privacy_model.predict(frame, classes=[0, 2, 3, 5, 7], conf=0.25, verbose=False)[0]
    out = frame.copy()
    height, width = out.shape[:2]
    if result.boxes is None:
        return out
    for box in result.boxes:
        cls = int(box.cls[0])
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
        if cls == 0:
            y2 = y1 + max(1, int((y2 - y1) * 0.45))
        else:
            y1 = y2 - max(1, int((y2 - y1) * 0.28))
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        roi = out[y1:y2, x1:x2]
        out[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (31, 31), 0)
    return out


def post_event(api: str, payload: dict) -> None:
    data = json.dumps(payload).encode()
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/events",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    except urllib.error.URLError as exc:
        raise SystemExit(f"API nie przyjmuje zdarzeń ({api}): {exc}") from exc


def post_position(
    api: str, t: float, lat: float, lon: float, heading: float, running: bool | None = None, speed: float = 1.0
) -> None:
    """Pozycja auta dla dashboardu: mapa i podgląd wideo przesuwają się razem z inferencją."""
    body = {"t": t, "lat": lat, "lon": lon, "heading": heading}
    if running is not None:
        body.update(running=running, speed=speed)
    data = json.dumps(body).encode()
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/patrol/position",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            response.read()
    except urllib.error.URLError:
        pass  # pozycja jest tylko podglądem, zdarzenia i tak lecą dalej


def is_transition(frame) -> bool:
    """Przejście montażu: ciemna klatka z napisem HIGHLIGHTS. Model brał napis za śmieć."""
    import cv2

    return float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()) < 60


def offset_right(lat: float, lon: float, heading: float, meters: float) -> tuple[float, float]:
    az = math.radians(heading + 90)
    dlat = meters * math.cos(az) / 111_320
    dlon = meters * math.sin(az) / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def detections(model, frame, event_type: str, conf: float, ground_y: float) -> list[dict]:
    import cv2

    result = model.predict(frame, conf=conf, verbose=False)[0]
    found = []
    if result.boxes is None:
        return found
    for box in result.boxes:
        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])
        xywhn = box.xywhn[0]
        # Dziury i śmieci leżą na ziemi; ramka kończąca się w górnej części kadru to niebo, fasada albo napis.
        if float(xywhn[1] + xywhn[3] / 2) < ground_y:
            continue
        area = float(xywhn[2] * xywhn[3])
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
        snapshot = frame.copy()
        color = (2, 162, 240) if event_type == "road_damage" else (142, 207, 62)
        cv2.rectangle(snapshot, (x1, y1), (x2, y2), color, 2)
        ok, encoded = cv2.imencode(".jpg", snapshot, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            continue
        found.append(
            {
                "type": event_type,
                "confidence": round(confidence, 4),
                "severity": severity_for(confidence, area),
                "class_name": str(result.names[cls_id]),
                "image_base64": base64.b64encode(encoded.tobytes()).decode(),
            }
        )
    return found


def run(args: argparse.Namespace) -> None:
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit(
            "Brak OpenCV / Ultralytics w tym Pythonie.\n"
            "Zainstaluj w venv i odpal tak:\n"
            "  python3 -m venv ml/.venv\n"
            "  ml/.venv/bin/pip install -r ml/requirements.txt\n"
            "  ml/.venv/bin/python ml/infer.py --video data/demo.mp4"
        )

    road_path = Path(args.road)
    litter_path = Path(args.litter)
    models: list[tuple[str, object]] = []
    if road_path.exists():
        models.append(("road_damage", YOLO(str(road_path))))
    if litter_path.exists():
        models.append(("litter", YOLO(str(litter_path))))
    if not models:
        raise SystemExit(
            "Brak wag. Wrzuć best_road.pt i best_litter.pt do ml/weights/ "
            "(pobierzesz je z ml/train_road.ipynb i ml/train_litter.ipynb)."
        )

    privacy = None
    privacy_path = Path(args.privacy)
    if privacy_path.exists():
        privacy = YOLO(str(privacy_path))
        print(f"Anonimizacja: {privacy_path}")
    else:
        print("Brak ml/weights/yolo12n.pt — klatki idą bez rozmycia twarzy i tablic.")

    points = read_gpx(Path(args.gpx)) if args.gpx else read_route(Path(args.route))
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"Nie otwieram wideo: {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    started = datetime.now(timezone.utc)
    index = 0
    sent = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if args.max_frames and index >= args.max_frames:
            break
        if index % args.stride == 0:
            msec = cap.get(cv2.CAP_PROP_POS_MSEC) or index / fps * 1000
            video_t = msec / 1000
            lat, lon, heading = point_at_time(points, video_t)
            post_position(args.api, video_t, lat, lon, heading)
            if is_transition(frame):
                index += 1
                continue
            timestamp = (started + timedelta(milliseconds=msec)).isoformat()
            private = blur_privacy(frame, privacy)
            height, width = private.shape[:2]
            scale = 960 / width if width > 960 else 1
            if scale != 1:
                private = cv2.resize(private, (960, int(height * scale)))
            for event_type, model in models:
                for hit in detections(model, private, event_type, args.conf, args.ground_y):
                    post_event(
                        args.api,
                        {
                            "type": hit["type"],
                            "lat": lat,
                            "lon": lon,
                            "timestamp": timestamp,
                            "confidence": hit["confidence"],
                            "severity": hit["severity"],
                            "meta": {
                                "class_name": hit["class_name"],
                                "title": hit["class_name"],
                                "source": "camera",
                                "frame": index,
                                "video_t": round(video_t, 2),
                            },
                            "image_base64": hit["image_base64"],
                        },
                    )
                    sent += 1
        index += 1
    cap.release()
    print(f"Wysłano zdarzeń: {sent}")


def annotated_snapshot(cap, item: dict) -> str:
    """Klatka z nagrania w sekundzie zdarzenia, z ramką z data/annotations.json."""
    import cv2

    cap.set(cv2.CAP_PROP_POS_MSEC, item["t"] * 1000)
    ok, frame = cap.read()
    if not ok:
        raise SystemExit(f"Brak klatki dla {item['id']} ({item['t']} s)")
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = item["bbox"]
    p1 = (int(x1 * width), int(y1 * height))
    p2 = (int(x2 * width), int(y2 * height))
    color = (2, 162, 240) if item["type"] == "road_damage" else (142, 207, 62)
    cv2.rectangle(frame, p1, p2, color, 3)
    label = f"{item['class_name']} {item['confidence']:.2f}"
    cv2.putText(frame, label, (p1[0], max(24, p1[1] - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    frame = cv2.resize(frame, (960, int(height * 960 / width)))
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 84])
    return base64.b64encode(encoded.tobytes()).decode()


def run_mock(args: argparse.Namespace) -> None:
    """Przejazd demo: zegar nagrania w czasie rzeczywistym, zdarzenia z ręcznych etykiet zamiast z YOLO."""
    try:
        import cv2
    except ImportError:
        raise SystemExit("Brak OpenCV. Odpal przez ml/.venv/bin/python (ml/requirements.txt).")

    items = sorted(json.loads(Path(args.annotations).read_text(encoding="utf-8"))["items"], key=lambda i: i["t"])
    points = read_gpx(Path(args.gpx)) if args.gpx else read_route(Path(args.route))
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"Nie otwieram wideo: {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    duration = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps or points[-1][2]

    print(f"Przejazd demo: {duration:.1f} s nagrania, {len(items)} oznaczonych zdarzeń, tempo {args.speed}×")
    tick = 0.25
    started = time.monotonic()
    pending = list(items)
    t = 0.0
    sent = 0
    try:
        while True:
            lat, lon, heading = point_at_time(points, t)
            post_position(args.api, t, lat, lon, heading, running=True, speed=args.speed)
            while pending and pending[0]["t"] <= t:
                item = pending.pop(0)
                e_lat, e_lon, e_heading = point_at_time(points, item["t"])
                e_lat, e_lon = offset_right(e_lat, e_lon, e_heading, item.get("offset_m", 0))
                post_event(
                    args.api,
                    {
                        "type": item["type"],
                        "lat": e_lat,
                        "lon": e_lon,
                        "confidence": item["confidence"],
                        "severity": item["severity"],
                        "meta": {
                            "class_name": item["class_name"],
                            "title": item["title"],
                            "source": "camera",
                            "video_t": item["t"],
                            "bbox": item["bbox"],
                        },
                        "image_base64": annotated_snapshot(cap, item),
                    },
                )
                sent += 1
                print(f"  {item['t']:5.1f} s  {item['type']:<11} {item['title']}")
            if t >= duration:
                break
            t = min(duration, t + tick)
            wait = started + t / args.speed - time.monotonic()
            if wait > 0:
                time.sleep(wait)
    finally:
        lat, lon, heading = point_at_time(points, t)
        post_position(args.api, t, lat, lon, heading, running=False)
        cap.release()
    print(f"Wysłano zdarzeń: {sent}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CityGuard — inferencja YOLO12 na nagraniu z auta")
    parser.add_argument("--video", required=True)
    parser.add_argument("--route", default="data/route.json")
    parser.add_argument(
        "--gpx",
        default=None,
        help="Ślad GPS (czas z <time> liczony od pierwszego punktu). Bez tego pozycja idzie po czasie z data/route.json.",
    )
    parser.add_argument("--road", default="ml/weights/best_road.pt")
    parser.add_argument("--litter", default="ml/weights/best_litter.pt")
    parser.add_argument("--privacy", default="ml/weights/yolo12n.pt")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--stride", type=int, default=15)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--ground-y", type=float, default=0.55, help="Ramki kończące się wyżej (ułamek kadru) odpadają.")
    parser.add_argument("--mock", action="store_true", help="Zamiast YOLO: zdarzenia z --annotations, w tempie nagrania.")
    parser.add_argument("--annotations", default="data/annotations.json")
    parser.add_argument("--speed", type=float, default=1.0, help="Tempo przejazdu w trybie --mock (2 = dwa razy szybciej).")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        args = parse_args()
        run_mock(args) if args.mock else run(args)
    except KeyboardInterrupt:
        sys.exit(130)
