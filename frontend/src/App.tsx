import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CameraFeed } from './CameraFeed.tsx'
import { MapView } from './MapView.tsx'
import type { CityEvent, EventType, RouteInfo, Stats, Status, Vehicle } from './types.ts'

const typeLabel: Record<EventType, string> = {
  road_damage: 'Nawierzchnia',
  litter: 'Śmieci',
}

const severityLabel = { low: 'Niski', med: 'Średni', high: 'Wysoki' }
const statusLabel: Record<Status, string> = {
  new: 'Nowe',
  assigned: 'W toku',
  resolved: 'Zamknięte',
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

function upsert(list: CityEvent[], event: CityEvent) {
  const next = list.some((item) => item.id === event.id)
    ? list.map((item) => (item.id === event.id ? event : item))
    : [event, ...list]
  return next.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export function App() {
  const [events, setEvents] = useState<CityEvent[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [route, setRoute] = useState<RouteInfo | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | EventType>('all')
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [activeSpeed, setActiveSpeed] = useState(1)
  const [heat, setHeat] = useState(false)
  const [freshIds, setFreshIds] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [clock, setClock] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(false)

  const reload = useCallback(async () => {
    const [nextEvents, nextStats, nextRoute, patrol] = await Promise.all([
      readJson<CityEvent[]>('/api/events'),
      readJson<Stats>('/api/stats'),
      readJson<RouteInfo>('/api/route'),
      readJson<Vehicle>('/api/patrol'),
    ])
    setEvents(nextEvents)
    setStats(nextStats)
    setRoute(nextRoute)
    setVehicle(patrol)
    setClock(patrol.t ?? 0)
    setError(null)
  }, [])

  const refreshStats = useCallback(async () => {
    setStats(await readJson<Stats>('/api/stats'))
  }, [])

  useEffect(() => {
    reload().catch(() => setError('Backend nie odpowiada. Uruchom API na porcie 8000.'))
  }, [reload])

  useEffect(() => {
    let socket: WebSocket | null = null
    let closed = false
    let retry = 0

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${location.host}/ws`)
      socket.onopen = () => setOnline(true)
      socket.onclose = () => {
        setOnline(false)
        if (!closed) retry = window.setTimeout(connect, 1200)
      }
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data) as {
          kind: string
          lat?: number
          lon?: number
          heading?: number
          progress?: number
          t?: number
          street?: string
          running?: boolean
          event?: CityEvent
        }
        if (payload.kind === 'position' && payload.lat !== undefined && payload.lon !== undefined) {
          setVehicle({ lat: payload.lat, lon: payload.lon, heading: payload.heading ?? 0, t: payload.t, street: payload.street })
          setProgress(payload.progress ?? 0)
          setClock(payload.t ?? 0)
        } else if (payload.kind === 'event' && payload.event) {
          const event = payload.event
          setEvents((prev) => upsert(prev, event))
          setFreshIds((prev) => [...prev, event.id])
          window.setTimeout(() => setFreshIds((prev) => prev.filter((id) => id !== event.id)), 4500)
          refreshStats().catch(() => undefined)
        } else if (payload.kind === 'status') {
          setRunning(Boolean(payload.running))
        } else if (payload.kind === 'reset') {
          setProgress(0)
          setClock(0)
          reload().catch(() => undefined)
        }
      }
    }

    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [refreshStats, reload])

  const visible = useMemo(
    () => events.filter((event) => typeFilter === 'all' || event.type === typeFilter),
    [events, typeFilter],
  )
  const selected = events.find((event) => event.id === selectedId) ?? null

  async function start() {
    setError(null)
    setActiveSpeed(speed)
    await readJson(`/api/simulate/start?speed=${speed}`, { method: 'POST' })
  }

  async function stop() {
    await readJson('/api/simulate/stop', { method: 'POST' })
  }

  async function setStatus(status: Status) {
    if (!selected) return
    const service = selected.type === 'road_damage' ? 'ZDM' : 'ZOO'
    const updated = await readJson<CityEvent>(`/api/events/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, assigned_to: service }),
    })
    setEvents((prev) => upsert(prev, updated))
    refreshStats().catch(() => undefined)
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-ink text-paper">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-tight">Cityguard</div>
          <div className="text-sm text-mist">Auta kontroli parkowania jako sensor dróg i czystości</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-litter' : 'bg-road'}`} />
          <span className="whitespace-nowrap text-mist">{online ? 'Połączenie na żywo' : 'Łączenie…'}</span>
          <span className="whitespace-nowrap rounded-full border border-line px-3 py-1">Patrol CG-12</span>
        </div>
      </header>

      <div className="min-h-0 overflow-auto lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:overflow-hidden">
        <section className="flex flex-col gap-4 border-line p-4 lg:overflow-y-auto lg:border-r">
          {error && <p className="rounded-lg border border-road/40 bg-road/10 px-3 py-2 text-sm">{error}</p>}
          <div className="rounded-xl border border-line bg-panel p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                className="rounded-lg bg-paper px-3 py-2 text-sm font-semibold text-ink"
                onClick={() => (running ? stop() : start()).catch(() => setError('Nie udało się wystartować przejazdu.'))}
              >
                {running ? 'Zatrzymaj' : 'Start przejazdu'}
              </button>
              <label className="text-xs text-mist">
                tempo
                <select
                  className="ml-2 rounded-md border border-line bg-panel-2 px-2 py-1 text-paper"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  <option value={1}>1×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-road" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-mist">
              Trasa: {route?.name ?? '…'}. Mapa, kamera i alerty idą po jednym zegarze nagrania
              {route ? ` (${route.duration_s.toFixed(0)} s)` : ''}; alert wchodzi w sekundzie, w której auto mija to miejsce.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Zdarzenia" value={stats ? String(stats.total) : '—'} />
            <Stat label="Dziury" value={stats ? String(stats.by_type.road_damage ?? 0) : '—'} />
            <Stat label="Śmieci" value={stats ? String(stats.by_type.litter ?? 0) : '—'} />
          </div>
          <p className="text-xs text-mist">
            {stats ? `${stats.per_100km} zdarzeń / 100 km tej trasy · ${stats.route_km} km` : 'Liczenie trasy…'}
          </p>

          <div className="h-36">
            {stats && stats.by_district.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.by_district} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                  <XAxis dataKey="district" tick={{ fill: '#93a399', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#93a399', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{ background: '#18201b', border: '1px solid #314038', borderRadius: 8, color: '#e7f2e4' }}
                  />
                  <Bar dataKey="count" name="Zdarzenia" radius={4} fill="#f0a202" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'Wszystkie'],
                ['road_damage', 'Nawierzchnia'],
                ['litter', 'Śmieci'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full border px-3 py-1 text-sm ${typeFilter === value ? 'border-paper bg-paper text-ink' : 'border-line text-mist'}`}
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </button>
            ))}
            <button
              className={`rounded-full border px-3 py-1 text-sm ${heat ? 'border-paper bg-paper text-ink' : 'border-line text-mist'}`}
              onClick={() => setHeat((value) => !value)}
            >
              Ciepło
            </button>
          </div>

          <ul className="flex flex-col gap-2">
            {visible.map((event) => (
              <li key={event.id}>
                <button
                  className={`w-full rounded-xl border px-3 py-2 text-left ${selectedId === event.id ? 'border-paper bg-panel-2' : 'border-line bg-panel'}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={event.type === 'road_damage' ? 'text-road' : 'text-litter'}>{typeLabel[event.type]}</span>
                    <span className="text-xs text-mist">{statusLabel[event.status]}</span>
                  </div>
                  <div className="mt-1 text-sm">{event.meta.title || event.meta.class_name || 'Zdarzenie'}</div>
                  <div className="mt-1 text-xs text-mist">
                    {event.meta.address || `${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`} · {formatWhen(event.timestamp)}
                  </div>
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="text-sm text-mist">Brak alertów w tym filtrze.</li>}
          </ul>
        </section>

        <section className="relative h-[420px] min-h-0 lg:h-full">
          <MapView
            route={route?.points ?? []}
            segments={route?.segments ?? []}
            events={visible}
            vehicle={vehicle}
            selectedId={selectedId}
            freshIds={freshIds}
            heat={heat}
            onSelect={setSelectedId}
          />
          <CameraFeed
            src={route?.video_url ?? null}
            t={clock}
            running={running}
            speed={activeSpeed}
            duration={route?.duration_s ?? 0}
            street={vehicle?.street}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-line bg-ink/90 px-3 py-2 text-xs">
            <div className="mb-1 text-mist">Legenda</div>
            <div className="flex items-center gap-2"><span className="cg-pin road" /> Nawierzchnia</div>
            <div className="mt-1 flex items-center gap-2"><span className="cg-pin litter" /> Śmieci</div>
          </div>
        </section>

        <aside className="border-line p-4 lg:overflow-y-auto lg:border-l">
          {selected ? (
            <article className="flex flex-col gap-3">
              <p className={`text-sm font-medium ${selected.type === 'road_damage' ? 'text-road' : 'text-litter'}`}>
                {typeLabel[selected.type]} · {severityLabel[selected.severity]}
              </p>
              <h2 className="text-xl font-semibold">{selected.meta.title || 'Zdarzenie'}</h2>
              {selected.image_url && (
                <img src={selected.image_url} alt="" className="w-full rounded-xl border border-line object-cover" />
              )}
              {selected.meta.source === 'seed' && (
                <p className="text-xs text-mist">Podgląd demo. Po inferencji w to miejsce wchodzi klatka z kamery.</p>
              )}
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Info label="Pewność" value={`${Math.round(selected.confidence * 100)}%`} />
                <Info label="Status" value={statusLabel[selected.status]} />
                <Info label={selected.status === 'new' ? 'Sugestia' : 'Służba'} value={selected.assigned_to || '—'} />
                <Info label="Dzielnica" value={selected.meta.district || '—'} />
                <Info label="Adres" value={selected.meta.address || '—'} />
                <Info label="Potwierdzenia" value={String(selected.meta.confirmations || 1)} />
              </dl>
              {selected.meta.priority_reason && (
                <p className="rounded-lg border border-road/40 bg-road/10 px-3 py-2 text-sm">Priorytet: {selected.meta.priority_reason}</p>
              )}
              <p className="text-xs text-mist">
                {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)} · {formatWhen(selected.timestamp)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg bg-paper px-3 py-2 text-sm font-semibold text-ink" onClick={() => setStatus('assigned')}>
                  Przypisz do {selected.type === 'road_damage' ? 'ZDM' : 'ZOO'}
                </button>
                <button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setStatus('resolved')}>
                  Zamknij
                </button>
                <button className="rounded-lg border border-line px-3 py-2 text-sm text-mist" onClick={() => setStatus('new')}>
                  Cofnij
                </button>
              </div>
            </article>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm text-mist">
              Wybierz alert z listy albo pinezkę na mapie. Pomarańczowe to nawierzchnia (ZDM), zielone to śmieci (ZOO).
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="text-xs text-mist">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel px-2 py-1.5">
      <dt className="text-xs text-mist">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
