import math


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Odległość w metrach."""
    radius = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def route_length_m(points: list[tuple[float, float]]) -> float:
    return sum(haversine(*points[i], *points[i + 1]) for i in range(len(points) - 1))


def offset_east(lat: float, lon: float, meters: float) -> tuple[float, float]:
    dlon = meters / (111_320 * math.cos(math.radians(lat)))
    return lat, lon + dlon


def offset_right(lat: float, lon: float, heading_deg: float, meters: float) -> tuple[float, float]:
    """Przesunięcie w prawo od kursu (krawężnik), nie zawsze na wschód."""
    az = math.radians(heading_deg + 90)
    dlat = (meters * math.cos(az)) / 111_320
    dlon = (meters * math.sin(az)) / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def heading(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _is_cut(
    a: tuple[float, float],
    b: tuple[float, float],
    seg_a: int | None,
    seg_b: int | None,
) -> bool:
    """Cięcie montażu: inny segment albo skok > 120 m (linia przez zabudowę)."""
    if seg_a is not None and seg_b is not None and seg_a != seg_b:
        return True
    return haversine(a[0], a[1], b[0], b[1]) > 120


def point_at_time(
    points: list[tuple[float, float]],
    times: list[float],
    t: float,
    segments: list[int] | None = None,
) -> tuple[float, float, float, int]:
    """Pozycja, azymut i indeks odcinka. Po czasie, bez interpolacji przez cięcia montażu."""
    if not points:
        raise ValueError("Pusta trasa")
    if len(points) == 1:
        return points[0][0], points[0][1], 0.0, 0
    if t <= times[0]:
        return points[0][0], points[0][1], heading(points[0], points[1]), 0
    last = len(points) - 1
    for i in range(last):
        if times[i] <= t <= times[i + 1]:
            seg_a = segments[i] if segments is not None else None
            seg_b = segments[i + 1] if segments is not None else None
            if _is_cut(points[i], points[i + 1], seg_a, seg_b):
                if t < times[i + 1]:
                    az = heading(points[i - 1], points[i]) if i > 0 else heading(points[i], points[i + 1])
                    return points[i][0], points[i][1], az, i
                nxt = min(i + 2, last)
                return points[i + 1][0], points[i + 1][1], heading(points[i + 1], points[nxt]), i + 1
            span = times[i + 1] - times[i]
            u = 0.0 if span <= 0 else (t - times[i]) / span
            lat = points[i][0] + (points[i + 1][0] - points[i][0]) * u
            lon = points[i][1] + (points[i + 1][1] - points[i][1]) * u
            return lat, lon, heading(points[i], points[i + 1]), i
    return points[last][0], points[last][1], heading(points[last - 1], points[last]), last - 1


def point_along(points: list[tuple[float, float]], fraction: float) -> tuple[float, float, float]:
    """Punkt na trasie i azymut w stopniach. Ułamek 0..1 liczony po długości, nie po wierzchołkach."""
    if not points:
        raise ValueError("Pusta trasa")
    if len(points) == 1:
        return points[0][0], points[0][1], 0.0

    lengths = [haversine(*points[i], *points[i + 1]) for i in range(len(points) - 1)]
    total = sum(lengths) or 1.0
    target = min(1.0, max(0.0, fraction)) * total
    walked = 0.0
    for i, length in enumerate(lengths):
        if walked + length >= target or i == len(lengths) - 1:
            t = 0.0 if length == 0 else min(1.0, max(0.0, (target - walked) / length))
            lat = points[i][0] + (points[i + 1][0] - points[i][0]) * t
            lon = points[i][1] + (points[i + 1][1] - points[i][1]) * t
            aim = points[i + 1]
            if (lat, lon) == aim and i + 2 < len(points):
                aim = points[i + 2]
            az = heading((lat, lon), aim) if (lat, lon) != aim else heading(points[i], points[i + 1])
            return lat, lon, az
        walked += length
    last = points[-1]
    return last[0], last[1], heading(points[-2], last)
