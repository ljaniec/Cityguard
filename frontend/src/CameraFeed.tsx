import { useEffect, useRef } from 'react'

type Props = {
  src: string | null
  t: number
  running: boolean
  speed: number
  duration: number
  street?: string
}

const MAX_DRIFT_S = 0.6

/** Podgląd z kamery auta zsynchronizowany z zegarem symulacji (sekunda nagrania przychodzi po WebSocket). */
export function CameraFeed({ src, t, running, speed, duration, street }: Props) {
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

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[500] w-[min(46vw,340px)] overflow-hidden rounded-xl border border-line bg-ink/90 shadow-lg">
      <video ref={video} src={src} muted playsInline preload="auto" className="block aspect-video w-full bg-black object-cover" />
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? 'animate-pulse bg-road' : 'bg-mist'}`} />
          Kamera CG-12
        </span>
        <span className="truncate text-mist">{street || 'postój'}</span>
        <span className="tabular-nums text-mist">
          {t.toFixed(1)} / {duration.toFixed(0)} s
        </span>
      </div>
    </div>
  )
}
