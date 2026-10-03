import { divIcon, type DivIcon, type Marker as LeafletMarker } from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import { LITTER_SVG, ROAD_SVG } from './icons.tsx'
import type { CityEvent, LatLon, Vehicle } from './types.ts'

type Props = {
  route: LatLon[]
  segments: LatLon[][]
  times: number[]
  clock: number
  events: CityEvent[]
  vehicle: Vehicle | null
  selectedId: string | null
  freshIds: string[]
  heat: boolean
  running: boolean
  onSelect: (id: string) => void
}

function FitRoute({ route }: { route: LatLon[] }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || route.length < 2) return
    map.fitBounds(route, { padding: [60, 60], maxZoom: 16 })
    fitted.current = true
  }, [map, route])
  return null
}

function FlyTo({ lat, lon }: { lat: number | null; lon: number | null }) {
  const map = useMap()
  useEffect(() => {
    if (lat === null || lon === null) return
    map.flyTo([lat, lon], Math.max(map.getZoom(), 17), { duration: 1.6 })
  }, [map, lat, lon])
  return null
}

function FollowVehicle({ vehicle, follow }: { vehicle: Vehicle | null; follow: boolean }) {
  const map = useMap()
  const flying = useRef(false)
  useEffect(() => {
    if (!vehicle || flying.current) return
    if (follow && map.getZoom() < 17) {
      flying.current = true
      map.once('moveend', () => {
        flying.current = false
      })
      map.flyTo([vehicle.lat, vehicle.lon], 17, { duration: 1.6 })
      return
    }
    if (map.getCenter().distanceTo([vehicle.lat, vehicle.lon]) > 400) {
      map.setView([vehicle.lat, vehicle.lon], map.getZoom(), { animate: false })
      return
    }
    if (!map.getBounds().pad(-0.25).contains([vehicle.lat, vehicle.lon])) {
      map.panTo([vehicle.lat, vehicle.lon], { animate: true, duration: 1.4 })
    }
  }, [map, vehicle, follow])
  return null
}

// Pozycja auta przerysowuje mapę co 0,25 s; nowy divIcon = nowy element DOM = animacja wejścia od nowa.
const pinIcons = new Map<string, DivIcon>()

function pinIcon(event: CityEvent, selected: boolean, fresh: boolean) {
  const key = [event.type, event.severity, event.status, selected, fresh].join('|')
  let icon = pinIcons.get(key)
  if (!icon) {
    icon = buildPinIcon(event, selected, fresh)
    pinIcons.set(key, icon)
  }
  return icon
}

function buildPinIcon(event: CityEvent, selected: boolean, fresh: boolean) {
  const classes = [
    'cg-pin',
    event.type === 'road_damage' ? 'road' : 'litter',
    event.severity === 'high' ? 'high' : '',
    event.status === 'resolved' ? 'done' : '',
    selected ? 'selected' : '',
    fresh ? 'fresh' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return divIcon({
    className: 'cg-icon',
    html: `<div class="${classes}">${event.type === 'road_damage' ? ROAD_SVG : LITTER_SVG}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

const carIcon = divIcon({
  className: 'cg-icon cg-car-icon',
  html: '<div class="cg-car"><div class="cg-car-cone"></div><div class="cg-car-ring"></div><div class="cg-car-dot"></div></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

/** Stała ikona auta (płynny ruch i puls); obracamy tylko stożek kamery. */
function CarMarker({ vehicle, segment }: { vehicle: Vehicle; segment: number }) {
  const marker = useRef<LeafletMarker>(null)
  useEffect(() => {
    const cone = marker.current?.getElement()?.querySelector<HTMLElement>('.cg-car-cone')
    if (cone) cone.style.transform = `rotate(${vehicle.heading}deg)`
  }, [vehicle.heading, segment])
  return (
    <Marker
      ref={marker}
      position={[vehicle.lat, vehicle.lon]}
      icon={carIcon}
      zIndexOffset={800}
    />
  )
}

/** Przejechana część trasy: punkty o czasie <= zegar nagrania + bieżąca pozycja auta. */
function traveledLines(segments: LatLon[][], times: number[], clock: number, vehicle: Vehicle | null) {
  const lines: LatLon[][] = []
  let offset = 0
  for (const segment of segments) {
    const done: LatLon[] = []
    segment.forEach((point, index) => {
      if ((times[offset + index] ?? Infinity) <= clock) done.push(point)
    })
    if (vehicle && done.length > 0 && done.length < segment.length) done.push([vehicle.lat, vehicle.lon])
    lines.push(done)
    offset += segment.length
  }
  return lines
}

function segmentAt(segments: LatLon[][], times: number[], clock: number) {
  let offset = 0
  for (let index = 0; index < segments.length; index++) {
    offset += segments[index].length
    if (clock < (times[offset] ?? Infinity)) return index
  }
  return segments.length - 1
}

export function MapView({ route, segments, times, clock, events, vehicle, selectedId, freshIds, heat, running, onSelect }: Props) {
  const selected = events.find((event) => event.id === selectedId) ?? null
  const center: LatLon = route[0] ?? [50.06, 19.94]
  const lines = useMemo(() => (segments.length > 0 ? segments : route.length > 1 ? [route] : []), [segments, route])
  const traveled = useMemo(() => traveledLines(lines, times, clock, vehicle), [lines, times, clock, vehicle])

  return (
    <MapContainer center={center} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FitRoute route={route} />
      <FollowVehicle vehicle={vehicle} follow={running} />
      <FlyTo lat={selected?.lat ?? null} lon={selected?.lon ?? null} />
      {lines.map(
        (line, index) =>
          line.length > 1 && (
            <Polyline
              key={`plan-${index}`}
              positions={line}
              pathOptions={{ color: '#a5b4cc', weight: 4, opacity: 0.7, dashArray: '1 9', lineCap: 'round' }}
            />
          ),
      )}
      {traveled.map(
        (line, index) =>
          line.length > 1 && (
            <Polyline
              key={`glow-${index}`}
              positions={line}
              pathOptions={{ color: '#38bdf8', weight: 14, opacity: 0.16, lineCap: 'round', lineJoin: 'round' }}
            />
          ),
      )}
      {traveled.map(
        (line, index) =>
          line.length > 1 && (
            <Polyline
              key={`done-${index}`}
              positions={line}
              pathOptions={{ color: '#7dd3fc', weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
            />
          ),
      )}
      {heat &&
        events.map((event) => (
          <Circle
            key={`heat-${event.id}`}
            center={[event.lat, event.lon]}
            radius={event.severity === 'high' ? 90 : 60}
            pathOptions={{
              color: event.type === 'road_damage' ? '#f59e0b' : '#10b981',
              fillColor: event.type === 'road_damage' ? '#f59e0b' : '#10b981',
              fillOpacity: 0.22,
              weight: 0,
            }}
          />
        ))}
      {events.map((event) => (
        <Marker
          key={event.id}
          position={[event.lat, event.lon]}
          icon={pinIcon(event, event.id === selectedId, freshIds.includes(event.id))}
          zIndexOffset={event.id === selectedId ? 600 : 0}
          eventHandlers={{ click: () => onSelect(event.id) }}
        />
      ))}
      {vehicle && (
        // Nowy klucz na cięciu montażu: marker skacze od razu, zamiast przesuwać się przez kamienice.
        <CarMarker
          key={`car-${segmentAt(lines, times, clock)}`}
          vehicle={vehicle}
          segment={segmentAt(lines, times, clock)}
        />
      )}
    </MapContainer>
  )
}
