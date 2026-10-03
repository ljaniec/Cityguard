import { useEffect, useRef } from 'react'
import type { CityEvent } from './types.ts'

type Props = {
  src: string | null
  t: number
  running: boolean
  speed: number
  duration: number
  street?: string
  events: CityEvent[]
  onSelect: (id: string) => void
}

const MAX_DRIFT_S = 0.6

function timecode(seconds: number) {
  const s = Math.max(0, seconds)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  const ff = String(Math.floor((s % 1) * 15)).padStart(2, '0')
  return `${mm}:${ss}:${ff}`
}

/** Podgląd z kamery auta zsynchronizowany z zegarem przejazdu (sekunda nagrania przychodzi po WebSocket). */
export function CameraFeed({ src, t, running, speed, duration, street, events, onSelect }: Props) {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.playbackRate = speed
    if (running) {
      element.play().catch(() => undefined)
    } else {
      element.pause()
    }
  }, [running, speed])

  useEffect(() => {
    const element = video.current
    if (!element || !Number.isFinite(t)) return
    const drift = Math.abs(element.currentTime - t)
    if (drift > MAX_DRIFT_S || !running) {
      element.currentTime = t
    }
  }, [t, running])

  if (!src) return null

  const tagged = events.filter((event) => event.meta.video_t !== undefined)
  // Nagranie kończy się planszą przejścia montażu — po przejeździe zasłaniamy ją podsumowaniem.
  const finished = !running && duration > 0 && t >= duration - 0.6
  const roadCount = tagged.filter((event) => event.type === 'road_damage').length
  const progress = duration > 0 ? Math.min(1, t / duration) : 0

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-sm font-semibold">Kamera z auta</span>
        <span className="text-xs text-mist">Patrol CG-12</span>
      </div>
      <div className="relative aspect-video bg-black">
        <video ref={video} src={src} muted playsInline preload="auto" className="block h-full w-full object-cover" />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/55" />

        <span className="hud-corner left-2.5 top-2.5 border-l-2 border-t-2" />
        <span className="hud-corner right-2.5 top-2.5 border-r-2 border-t-2" />
        <span className="hud-corner bottom-2.5 left-2.5 border-b-2 border-l-2" />
        <span className="hud-corner bottom-2.5 right-2.5 border-b-2 border-r-2" />

        <div className="absolute left-4 top-3.5 min-w-0 max-w-[65%]">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-wider">
            <span className={`h-2 w-2 rounded-full ${running ? 'bg-alert' : 'bg-mist'}`} />
            <span className={running ? 'text-paper' : 'text-mist'}>{running ? 'REC' : 'PAUZA'}</span>
            <span className="text-paper/60">CAM-CG12</span>
          </div>
          <div className="mt-1 truncate text-sm font-semibold drop-shadow">{street || 'Postój'}</div>
        </div>
        <div className="absolute right-4 top-3.5 text-right font-mono text-[11px] tabular-nums text-paper/80">
          <div>{timecode(t)}</div>
          <div className="mt-1 text-[10px] text-accent/90">AI · {speed}×</div>
        </div>

        {finished && (
          <div className="fade-up absolute inset-0 grid place-items-center bg-ink/85 backdrop-blur-sm">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Przejazd zakończony</div>
              <div className="mt-1 text-2xl font-semibold">
                {tagged.length} {tagged.length === 1 ? 'wykrycie' : tagged.length < 5 && tagged.length > 1 ? 'wykrycia' : 'wykryć'}
              </div>
              <div className="mt-1 text-xs text-mist">
                {roadCount} nawierzchnia · {tagged.length - roadCount} śmieci · {duration.toFixed(0)} s nagrania
              </div>
            </div>
          </div>
        )}

      </div>

      <div className="px-4 pb-3.5 pt-3">
        <div className="relative h-2 rounded-full bg-panel-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-litter"
            style={{ width: `${progress * 100}%` }}
          />
          {tagged.map((event) => (
            <button
              key={event.id}
              type="button"
              title={event.meta.title}
              onClick={() => onSelect(event.id)}
              className={`absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink ${event.type === 'road_damage' ? 'bg-road' : 'bg-litter'}`}
              style={{ left: `${Math.min(1, (event.meta.video_t ?? 0) / (duration || 1)) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-mist">
          <span>{t.toFixed(1)} s</span>
          <span>{tagged.length} wykryć na nagraniu</span>
          <span>{duration.toFixed(0)} s</span>
        </div>
      </div>
    </div>
  )
}
