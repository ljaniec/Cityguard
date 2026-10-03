export type EventType = 'road_damage' | 'litter'
export type Severity = 'low' | 'med' | 'high'
export type Status = 'new' | 'assigned' | 'resolved'

export type CityEvent = {
  id: string
  type: EventType
  lat: number
  lon: number
  timestamp: string
  confidence: number
  image_url: string | null
  severity: Severity
  status: Status
  assigned_to: string | null
  meta: {
    class_name?: string
    title?: string
    address?: string
    district?: string
    priority_reason?: string
    confirmations?: number
    source?: string
    video_t?: number
    bbox?: [number, number, number, number]
  }
}

export type Stats = {
  total: number
  by_type: Record<string, number>
  by_status: Record<string, number>
  by_district: { district: string; count: number }[]
  route_km: number
  per_100km: number
}

export type Vehicle = {
  lat: number
  lon: number
  heading: number
  t?: number
  street?: string
}

export type LatLon = [number, number]

export type RouteInfo = {
  name: string
  points: LatLon[]
  segments: LatLon[][]
  times: number[]
  duration_s: number
  length_km: number
  video_url: string | null
}
