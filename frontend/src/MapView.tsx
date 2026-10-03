import { divIcon } from 'leaflet'
import { useEffect, useRef } from 'react'
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { CityEvent, Vehicle } from './types.ts'

type Props = {
  route: [number, number][]
  segments: [number, number][][]
  events: CityEvent[]
  vehicle: Vehicle | null
  selectedId: string | null
  freshIds: string[]
  heat: boolean
  onSelect: (id: string) => void
}

function FitRoute({ route }: { route: [number, number][] }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || route.length < 2) return
    map.fitBounds(route, { padding: [48, 48], maxZoom: 16 })
    fitted.current = true
  }, [map, route])
  return null
}

function FlyTo({ lat, lon }: { lat: number | null; lon: number | null }) {
  const map = useMap()
  useEffect(() => {
    if (lat === null || lon === null) return
    map.flyTo([lat, lon], Math.max(map.getZoom(), 15), { duration: 0.55 })
  }, [map, lat, lon])
  return null
}

function pinIcon(kind: string, selected: boolean, fresh: boolean) {
  const classes = ['cg-pin', kind === 'road_damage' ? 'road' : 'litter', selected ? 'selected' : '', fresh ? 'fresh' : '']
    .filter(Boolean)
    .join(' ')
  return divIcon({
    className: 'cg-icon',
    html: `<div class="${classes}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function carIcon(heading: number) {
  return divIcon({
    className: 'cg-icon',
    html: `<div style="transform: rotate(${heading}deg)"><div class="cg-arrow"></div></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

export function MapView({ route, segments, events, vehicle, selectedId, freshIds, heat, onSelect }: Props) {
  const selected = events.find((event) => event.id === selectedId) ?? null
  const center: [number, number] = route[0] ?? [50.06, 19.94]
  const lines = segments.length > 0 ? segments : route.length > 1 ? [route] : []

  return (
    <MapContainer center={center} zoom={14} zoomControl={false} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitRoute route={route} />
      <FlyTo lat={selected?.lat ?? null} lon={selected?.lon ?? null} />
      {lines.map(
        (line, index) =>
          line.length > 1 && (
            <Polyline key={`seg-${index}`} positions={line} pathOptions={{ color: '#d5e4cf', weight: 4, opacity: 0.55 }} />
          ),
      )}
      {heat &&
        events.map((event) => (
          <Circle
            key={`heat-${event.id}`}
            center={[event.lat, event.lon]}
            radius={event.severity === 'high' ? 180 : 110}
            pathOptions={{
              color: event.type === 'road_damage' ? '#f0a202' : '#3ecf8e',
              fillColor: event.type === 'road_damage' ? '#f0a202' : '#3ecf8e',
              fillOpacity: 0.28,
              weight: 0,
            }}
          />
        ))}
      {events.map((event) => (
        <Marker
          key={event.id}
          position={[event.lat, event.lon]}
          icon={pinIcon(event.type, event.id === selectedId, freshIds.includes(event.id))}
          eventHandlers={{ click: () => onSelect(event.id) }}
        />
      ))}
      {vehicle && (
        <Marker position={[vehicle.lat, vehicle.lon]} icon={carIcon(vehicle.heading)} zIndexOffset={800} />
      )}
    </MapContainer>
  )
}
