import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CameraFeed } from "./CameraFeed.tsx";
import {
  CameraIcon,
  CheckIcon,
  CloseIcon,
  FlameIcon,
  LitterIcon,
  PinIcon,
  PlayIcon,
  RoadIcon,
  ShieldLogo,
  StopIcon,
} from "./icons.tsx";
import { MapView } from "./MapView.tsx";
import type {
  CityEvent,
  EventType,
  RouteInfo,
  Stats,
  Status,
  Vehicle,
} from "./types.ts";

const typeLabel: Record<EventType, string> = {
  road_damage: "Nawierzchnia",
  litter: "Śmieci",
};

const serviceFor: Record<EventType, string> = {
  road_damage: "ZDM",
  litter: "ZOO",
};

const severityLabel = { low: "Niski", med: "Średni", high: "Wysoki" };
const severityTone = {
  low: "bg-mist/15 text-mist",
  med: "bg-road/15 text-road",
  high: "bg-alert/15 text-alert",
};

const statusLabel: Record<Status, string> = {
  new: "Nowe",
  assigned: "W toku",
  resolved: "Zamknięte",
};

const statusTone: Record<Status, string> = {
  new: "bg-accent/15 text-accent",
  assigned: "bg-road/15 text-road",
  resolved: "bg-litter/15 text-litter",
};

const TOAST_MS = 8000;
const FRESH_MS = 7000;

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function timeAgo(iso: string, now: number) {
  const seconds = Math.max(0, (now - +new Date(iso)) / 1000);
  if (seconds < 45) return "przed chwilą";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min temu`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} godz. temu`;
  return formatWhen(iso);
}

function upsert(list: CityEvent[], event: CityEvent) {
  const next = list.some((item) => item.id === event.id)
    ? list.map((item) => (item.id === event.id ? event : item))
    : [event, ...list];
  return next.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function useCountUp(value: number, ms = 1600) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / ms);
      current.current = from + (value - from) * (1 - (1 - k) ** 3);
      setShown(current.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function lerpAngle(from: number, to: number, amount: number) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * amount;
}

function useSmoothedPatrol(
  vehicle: Vehicle | null,
  clock: number,
  running: boolean,
) {
  const [smooth, setSmooth] = useState({ vehicle, clock });
  const targetVehicle = useRef(vehicle);
  const targetClock = useRef(clock);
  const currentVehicle = useRef(vehicle);
  const currentClock = useRef(clock);
  targetVehicle.current = vehicle;
  targetClock.current = clock;

  useEffect(() => {
    let frame = 0;
    const step = () => {
      const target = targetVehicle.current;
      const current = currentVehicle.current;
      if (!running || !target || !current) {
        currentVehicle.current = target;
        currentClock.current = targetClock.current;
        setSmooth({ vehicle: target, clock: targetClock.current });
        frame = window.requestAnimationFrame(step);
        return;
      }
      const jump = Math.hypot(target.lat - current.lat, target.lon - current.lon);
      const amount = jump > 0.002 ? 1 : 0.28;
      const nextVehicle = {
        ...target,
        lat: lerp(current.lat, target.lat, amount),
        lon: lerp(current.lon, target.lon, amount),
        heading: lerpAngle(current.heading, target.heading, amount),
      };
      const nextClock = lerp(currentClock.current, targetClock.current, amount);
      currentVehicle.current = nextVehicle;
      currentClock.current = nextClock;
      setSmooth({ vehicle: nextVehicle, clock: nextClock });
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [running]);

  return smooth;
}

export function App() {
  const [events, setEvents] = useState<CityEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | EventType>("all");
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeSpeed, setActiveSpeed] = useState(1);
  const [heat, setHeat] = useState(false);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [toasts, setToasts] = useState<CityEvent[]>([]);
  const announced = useRef(new Set<string>());
  const [progress, setProgress] = useState(0);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const now = useNow(1000);
  const display = useSmoothedPatrol(vehicle, clock, running);

  const reload = useCallback(async () => {
    const [nextEvents, nextStats, nextRoute, patrol] = await Promise.all([
      readJson<CityEvent[]>("/api/events"),
      readJson<Stats>("/api/stats"),
      readJson<RouteInfo>("/api/route"),
      readJson<Vehicle & { progress?: number }>("/api/patrol"),
    ]);
    setEvents(nextEvents);
    setStats(nextStats);
    setRoute(nextRoute);
    setVehicle(patrol);
    setClock(patrol.t ?? 0);
    setProgress(patrol.progress ?? 0);
    setError(null);
  }, []);

  const refreshStats = useCallback(async () => {
    setStats(await readJson<Stats>("/api/stats"));
  }, []);

  useEffect(() => {
    reload().catch(() =>
      setError("Brak połączenia z serwerem. Uruchom API na porcie 8000."),
    );
  }, [reload]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 0;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.onopen = () => {
        setOnline(true);
        reload().catch(() => undefined);
      };
      socket.onclose = () => {
        setOnline(false);
        if (!closed) retry = window.setTimeout(connect, 1200);
      };
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data) as {
          kind: string;
          lat?: number;
          lon?: number;
          heading?: number;
          progress?: number;
          t?: number;
          street?: string;
          running?: boolean;
          speed?: number;
          deduped?: boolean;
          event?: CityEvent;
        };
        if (
          payload.kind === "position" &&
          payload.lat !== undefined &&
          payload.lon !== undefined
        ) {
          setVehicle({
            lat: payload.lat,
            lon: payload.lon,
            heading: payload.heading ?? 0,
            t: payload.t,
            street: payload.street,
          });
          setProgress(payload.progress ?? 0);
          setClock(payload.t ?? 0);
        } else if (payload.kind === "event" && payload.event) {
          const event = payload.event;
          setEvents((prev) => upsert(prev, event));
          refreshStats().catch(() => undefined);
          // Ponowny przejazd tym samym miejscem tylko podbija potwierdzenia — bez drugiego powiadomienia.
          if (payload.deduped || announced.current.has(event.id)) return;
          announced.current.add(event.id);
          setFreshIds((prev) => [...prev, event.id]);
          window.setTimeout(
            () => setFreshIds((prev) => prev.filter((id) => id !== event.id)),
            FRESH_MS,
          );
          setToasts((prev) => [event, ...prev].slice(0, 3));
          window.setTimeout(
            () =>
              setToasts((prev) => prev.filter((item) => item.id !== event.id)),
            TOAST_MS,
          );
        } else if (payload.kind === "status") {
          setRunning(Boolean(payload.running));
          if (typeof payload.speed === "number") setActiveSpeed(payload.speed);
        } else if (payload.kind === "reset") {
          setProgress(0);
          setClock(0);
          setToasts([]);
          setSelectedId(null);
          reload().catch(() => undefined);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [refreshStats, reload]);

  const visible = useMemo(
    () =>
      events.filter(
        (event) => typeFilter === "all" || event.type === typeFilter,
      ),
    [events, typeFilter],
  );
  const selected = events.find((event) => event.id === selectedId) ?? null;
  const handed =
    (stats?.by_status.assigned ?? 0) + (stats?.by_status.resolved ?? 0);
  const routeKm = stats?.route_km ?? route?.length_km ?? 0;

  async function start() {
    setError(null);
    setActiveSpeed(speed);
    await readJson(`/api/simulate/start?speed=${speed}`, { method: "POST" });
  }

  async function stop() {
    await readJson("/api/simulate/stop", { method: "POST" });
  }

  async function setStatus(status: Status) {
    if (!selected) return;
    const updated = await readJson<CityEvent>(`/api/events/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, assigned_to: serviceFor[selected.type] }),
    });
    setEvents((prev) => upsert(prev, updated));
    refreshStats().catch(() => undefined);
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] text-paper">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ShieldLogo className="h-9 w-9 shrink-0 drop-shadow-[0_0_12px_rgba(56,189,248,0.45)]" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-gradient text-xl font-bold tracking-tight">
                CityGuard
              </span>
              <span className="text-sm font-medium text-mist">Kraków</span>
            </div>
            <div className="truncate text-xs text-mist">
              Auta kontroli parkowania wykrywają dziury i śmieci, zanim zgłoszą
              je mieszkańcy
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <span className="hidden font-mono text-xs tabular-nums text-mist md:inline">
            {new Date(now).toLocaleTimeString("pl-PL")}
          </span>
          <span
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${online ? "bg-litter/10 text-litter" : "bg-alert/10 text-alert"}`}
          >
            <span className="relative flex h-2 w-2">
              {online && (
                <span className="slow-ping absolute inset-0 rounded-full bg-litter/70" />
              )}
              <span
                className={`relative h-2 w-2 rounded-full ${online ? "bg-litter" : "bg-alert"}`}
              />
            </span>
            {online ? "Na żywo" : "Łączenie…"}
          </span>
          <div className="glass flex items-center gap-1 rounded-full p-1">
            {[1, 4].map((value) => (
              <button
                key={value}
                className={`rounded-full px-2.5 py-1 font-mono text-xs transition ${speed === value ? "bg-panel-2 text-paper" : "text-mist hover:text-paper"}`}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
            <button
              className={`ml-1 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${running ? "bg-alert/90 text-white hover:bg-alert" : "bg-gradient-to-r from-accent to-litter text-ink hover:brightness-110"}`}
              onClick={() =>
                (running ? stop() : start()).catch(() =>
                  setError("Nie udało się uruchomić przejazdu."),
                )
              }
            >
              {running ? (
                <StopIcon className="h-3.5 w-3.5" />
              ) : (
                <PlayIcon className="h-3.5 w-3.5" />
              )}
              {running ? "Zatrzymaj" : "Start przejazdu"}
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-auto px-3 pb-3 sm:px-4 lg:grid lg:grid-cols-[340px_minmax(0,1fr)_480px] lg:gap-3 lg:overflow-hidden">
        <section className="flex min-h-0 flex-col gap-3 lg:overflow-hidden">
          {error && (
            <p className="rounded-xl border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Kpi label="Wykrycia" value={stats?.total ?? 0} tone="text-paper" />
            <Kpi label="Przekazane służbom" value={handed} tone="text-accent" />
            <Kpi
              label="Nawierzchnia"
              value={stats?.by_type.road_damage ?? 0}
              tone="text-road"
              icon={<RoadIcon className="h-4 w-4" />}
            />
            <Kpi
              label="Śmieci"
              value={stats?.by_type.litter ?? 0}
              tone="text-litter"
              icon={<LitterIcon className="h-4 w-4" />}
            />
          </div>

          <div className="glass rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-mist">Przejazd patrolu CG-12</span>
              <span className="font-mono tabular-nums">
                {(progress * routeKm).toFixed(2)} / {routeKm.toFixed(2)} km
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-litter transition-[width] duration-700"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 truncate text-xs text-mist">
              {route?.name ?? "Wczytywanie trasy…"}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="glass flex gap-1 rounded-full p-1">
              {(
                [
                  ["all", "Wszystkie"],
                  ["road_damage", "Nawierzchnia"],
                  ["litter", "Śmieci"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${typeFilter === value ? "bg-paper text-ink" : "text-mist hover:text-paper"}`}
                  onClick={() => setTypeFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-mist">{visible.length}</span>
          </div>

          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1 pr-1">
            {visible.map((event) => (
              <li key={event.id} className="fade-up">
                <button
                  className={`glass flex w-full gap-3 rounded-xl p-2 text-left transition hover:border-accent/40 ${selectedId === event.id ? "!border-accent/70" : ""} ${freshIds.includes(event.id) ? "flash-new" : ""}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <Thumb event={event} />
                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wide ${event.type === "road_damage" ? "text-road" : "text-litter"}`}
                      >
                        {typeLabel[event.type]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone[event.status]}`}
                      >
                        {statusLabel[event.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium">
                      {event.meta.title || event.meta.class_name || "Zdarzenie"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-mist">
                      {event.meta.address ||
                        `${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`}{" "}
                      · {timeAgo(event.timestamp, now)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {visible.length === 0 && <Waiting running={running} />}
          </ul>
        </section>

        <section className="glass relative mt-3 h-[460px] min-h-0 overflow-hidden rounded-2xl lg:mt-0 lg:h-full">
          <MapView
            route={route?.points ?? []}
            segments={route?.segments ?? []}
            times={route?.times ?? []}
            clock={display.clock}
            events={visible}
            vehicle={display.vehicle}
            selectedId={selectedId}
            freshIds={freshIds}
            heat={heat}
            running={running}
            onSelect={setSelectedId}
          />
          <div className="map-vignette pointer-events-none absolute inset-0 z-[400]" />

          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-ink/80 px-3 py-1.5 text-xs backdrop-blur">
            <PinIcon className="h-3.5 w-3.5 text-accent" />
            <span className="font-medium">{vehicle?.street || "Kraków"}</span>
            {running && (
              <span className="font-mono text-accent">● w trasie</span>
            )}
          </div>

          <div className="absolute left-1/2 top-3 z-[600] flex w-[min(92%,380px)] -translate-x-1/2 flex-col gap-2">
            {toasts.map((event) => (
              <button
                key={event.id}
                className="toast-in glass flex items-center gap-3 rounded-2xl p-2 pr-3 text-left"
                onClick={() => setSelectedId(event.id)}
              >
                <Thumb event={event} large />
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[10px] font-bold uppercase tracking-[0.16em] ${event.type === "road_damage" ? "text-road" : "text-litter"}`}
                  >
                    Nowe wykrycie · {typeLabel[event.type]}
                  </div>
                  <div className="truncate text-sm font-semibold">
                    {event.meta.title}
                  </div>
                  <div className="truncate text-xs text-mist">
                    {event.meta.address} · pewność{" "}
                    {Math.round(event.confidence * 100)}%
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-2">
            <div className="pointer-events-none flex items-center gap-3 rounded-full bg-ink/80 px-3 py-1.5 text-xs backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-road" />{" "}
                Nawierzchnia
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-litter" /> Śmieci
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_#38bdf8]" />{" "}
                Patrol
              </span>
            </div>
            <button
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur transition ${heat ? "bg-road text-ink" : "bg-ink/80 text-mist hover:text-paper"}`}
              onClick={() => setHeat((value) => !value)}
            >
              <FlameIcon className="h-3.5 w-3.5" /> Mapa ciepła
            </button>
          </div>
        </section>

        <aside className="mt-3 flex min-h-0 flex-col gap-3 lg:mt-0 lg:overflow-y-auto lg:pr-1">
          <CameraFeed
            src={route?.video_url ?? null}
            t={display.clock}
            running={running}
            speed={activeSpeed}
            duration={route?.duration_s ?? 0}
            street={vehicle?.street}
            events={events}
            onSelect={setSelectedId}
          />
          {selected ? (
            <Detail
              key={selected.id}
              event={selected}
              onClose={() => setSelectedId(null)}
              onStatus={(status) =>
                setStatus(status).catch(() =>
                  setError("Nie udało się zmienić statusu."),
                )
              }
            />
          ) : (
            <Overview stats={stats} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon?: ReactNode;
}) {
  const shown = useCountUp(value);
  return (
    <div className="glass rounded-2xl px-3.5 py-3">
      <div className="flex items-center justify-between text-[11px] font-medium text-mist">
        {label}
        {icon && <span className={tone}>{icon}</span>}
      </div>
      <div
        className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${tone}`}
      >
        {Math.round(shown)}
      </div>
    </div>
  );
}

function Thumb({
  event,
  large = false,
}: {
  event: CityEvent;
  large?: boolean;
}) {
  const size = large ? "h-14 w-20" : "h-12 w-16";
  const road = event.type === "road_damage";
  return (
    <div
      className={`relative ${size} shrink-0 overflow-hidden rounded-lg bg-panel-2`}
    >
      {event.image_url ? (
        <img
          src={event.image_url}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={`grid h-full w-full place-items-center ${road ? "text-road" : "text-litter"}`}
        >
          {road ? (
            <RoadIcon className="h-5 w-5" />
          ) : (
            <LitterIcon className="h-5 w-5" />
          )}
        </div>
      )}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${road ? "bg-road" : "bg-litter"}`}
      />
    </div>
  );
}

function Waiting({ running }: { running: boolean }) {
  return (
    <li className="glass flex flex-col items-center gap-3 rounded-2xl px-4 py-8 text-center">
      <div className="relative grid h-16 w-16 place-items-center">
        <span className="slow-ping absolute inset-0 rounded-full bg-accent/15" />
        <span className="absolute inset-2 rounded-full border border-accent/40" />
        <CameraIcon className="relative h-6 w-6 text-accent" />
      </div>
      <div className="text-sm font-medium">
        {running ? "Kamera analizuje ulice…" : "Czekam na wykrycia z patrolu"}
      </div>
      <p className="max-w-[240px] text-xs text-mist">
        Gdy kamera w aucie zauważy dziurę albo śmieci, alert pojawi się tutaj i
        na mapie w ciągu sekundy.
      </p>
    </li>
  );
}

const steps: Status[] = ["new", "assigned", "resolved"];

function Detail({
  event,
  onClose,
  onStatus,
}: {
  event: CityEvent;
  onClose: () => void;
  onStatus: (status: Status) => void;
}) {
  const road = event.type === "road_damage";
  const service = serviceFor[event.type];
  const current = steps.indexOf(event.status);
  const confidence = Math.round(event.confidence * 100);

  return (
    <article className="glass fade-up flex flex-col gap-3.5 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${road ? "bg-road/15 text-road" : "bg-litter/15 text-litter"}`}
          >
            {road ? (
              <RoadIcon className="h-3.5 w-3.5" />
            ) : (
              <LitterIcon className="h-3.5 w-3.5" />
            )}
            {typeLabel[event.type]}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${severityTone[event.severity]}`}
          >
            Priorytet: {severityLabel[event.severity]}
          </span>
        </div>
        <button
          className="rounded-full p-1 text-mist transition hover:bg-panel-2 hover:text-paper"
          onClick={onClose}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div>
        <h2 className="text-lg font-semibold leading-snug">
          {event.meta.title || "Zdarzenie"}
        </h2>
        <p className="mt-0.5 text-sm text-mist">
          {event.meta.address || "—"}
          {event.meta.district ? ` · ${event.meta.district}` : ""}
        </p>
      </div>

      {event.image_url && (
        <div className="relative overflow-hidden rounded-xl border border-line">
          <img src={event.image_url} alt="" className="w-full object-cover" />
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-ink/80 px-2 py-0.5 font-mono text-[10px] text-paper/80">
            <CameraIcon className="h-3 w-3" /> CAM-CG12
            {event.meta.video_t !== undefined
              ? ` · ${event.meta.video_t.toFixed(1)} s`
              : ""}
          </span>
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs">
          <span className="text-mist">Pewność wykrycia</span>
          <span className="font-mono font-semibold">{confidence}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className={`h-full rounded-full ${road ? "bg-road" : "bg-litter"}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-1.5">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex flex-col items-center gap-1.5 text-center"
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition ${index < current ? "bg-litter text-ink" : index === current ? "bg-accent text-ink shadow-[0_0_14px_rgba(56,189,248,0.6)]" : "bg-panel-2 text-mist"}`}
            >
              {index < current ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={`text-[11px] ${index <= current ? "text-paper" : "text-mist"}`}
            >
              {step === "new"
                ? "Wykryte"
                : step === "assigned"
                  ? `W ${service}`
                  : "Naprawione"}
            </span>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Info label="Służba" value={event.assigned_to || service} />
        <Info
          label="Potwierdzenia"
          value={String(event.meta.confirmations || 1)}
        />
        <Info label="Zgłoszono" value={formatWhen(event.timestamp)} />
      </dl>

      {event.meta.priority_reason && (
        <p className="rounded-lg border border-road/40 bg-road/10 px-3 py-2 text-sm">
          {event.meta.priority_reason}
        </p>
      )}

      <div className="flex gap-2">
        {event.status === "new" && (
          <button
            className="flex-1 rounded-xl bg-gradient-to-r from-accent to-litter px-3 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110"
            onClick={() => onStatus("assigned")}
          >
            Przekaż do {service}
          </button>
        )}
        {event.status === "assigned" && (
          <button
            className="flex-1 rounded-xl bg-litter px-3 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110"
            onClick={() => onStatus("resolved")}
          >
            Oznacz jako naprawione
          </button>
        )}
        {event.status !== "new" && (
          <button
            className="rounded-xl border border-line px-3 py-2.5 text-sm text-mist transition hover:text-paper"
            onClick={() => onStatus("new")}
          >
            Cofnij
          </button>
        )}
      </div>

      <p className="font-mono text-[10px] text-mist">
        {event.lat.toFixed(5)}, {event.lon.toFixed(5)}
      </p>
    </article>
  );
}

function Overview({ stats }: { stats: Stats | null }) {
  const palette = ["#38bdf8", "#10b981", "#f59e0b", "#a78bfa", "#f43f5e"];
  return (
    <div className="flex flex-col gap-3">
      {stats && stats.by_district.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Wykrycia wg dzielnic</span>
            <span className="font-mono text-xs text-mist">
              {stats.per_100km} / 100 km
            </span>
          </div>
          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.by_district}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              >
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="district"
                  width={130}
                  tick={{ fill: "#8593a8", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  contentStyle={{
                    background: "#0d1420",
                    border: "1px solid #1f2b3d",
                    borderRadius: 10,
                    color: "#e8eef7",
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Wykrycia"
                  radius={[0, 6, 6, 0]}
                  barSize={14}
                >
                  {stats.by_district.map((row, index) => (
                    <Cell
                      key={row.district}
                      fill={palette[index % palette.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2/70 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-mist">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
