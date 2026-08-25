import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import type { SegmentInfo } from '@/types'

interface Props {
  fileId: string
  audioUrl: string            // URL to the full uploaded MP3
  splitPoints: number[]       // ms timestamps (incl. 0 and duration)
  durationMs: number
  onSplitPointsChange: (points: number[]) => void
  segments: SegmentInfo[]
  onSegmentClick: (index: number) => void
}

export function Waveform({
  audioUrl,
  splitPoints,
  durationMs,
  onSplitPointsChange,
  segments,
  onSegmentClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)

  // Initialise WaveSurfer once
  useEffect(() => {
    if (!containerRef.current) return

    const regions = RegionsPlugin.create()
    regionsRef.current = regions

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#a1a1aa',
      progressColor: '#3b82f6',
      height: 96,
      normalize: true,
      plugins: [regions],
    })

    ws.load(audioUrl)

    ws.on('ready', () => setReady(true))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))

    wsRef.current = ws
    return () => ws.destroy()
  }, [audioUrl])

  // Draw / update split-point markers whenever splitPoints changes
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions || durationMs === 0) return

    regions.clearRegions()

    // Draw coloured bands between consecutive split points
    const colours = ['rgba(59,130,246,0.08)', 'rgba(16,185,129,0.08)']
    const boundaries = splitPoints.slice(1, -1) // exclude 0 and total duration

    splitPoints.forEach((pt, i) => {
      const next = splitPoints[i + 1]
      if (next === undefined) return
      regions.addRegion({
        start: pt / 1000,
        end: next / 1000,
        color: colours[i % 2],
        drag: false,
        resize: false,
      })
    })

    // Draw draggable markers at each interior boundary
    boundaries.forEach((ptMs) => {
      const region = regions.addRegion({
        start: ptMs / 1000,
        end: ptMs / 1000 + 0.01,
        color: 'rgba(239,68,68,0.85)',
        drag: true,
        resize: false,
      })

      region.on('update-end', () => {
        const newPtMs = Math.round(region.start * 1000)
        const updated = splitPoints
          .map((p) => (p === ptMs ? newPtMs : p))
        onSplitPointsChange(sorted(updated))
      })
    })
  }, [splitPoints, durationMs, onSplitPointsChange])

  const togglePlay = () => wsRef.current?.playPause()

  return (
    <div className="flex flex-col gap-2">
      {/* Waveform canvas */}
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden bg-zinc-900 cursor-crosshair"
      />

      {/* Transport bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!ready}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          {playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.34-5.89a1.5 1.5 0 000-2.54L6.3 2.84z" />
            </svg>
          )}
          {playing ? 'Pause' : 'Play'}
        </button>

        {!ready && (
          <span className="text-xs text-zinc-400">Loading waveform…</span>
        )}

        {ready && (
          <span className="text-xs text-zinc-500">
            {splitPoints.length - 1} segment{splitPoints.length - 1 !== 1 ? 's' : ''} · drag red markers to adjust
          </span>
        )}
      </div>

      {/* Segment strip */}
      {segments.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1">
          {segments.map((seg, i) => (
            <button
              key={seg.segment_id}
              onClick={() => onSegmentClick(i)}
              className="px-2 py-0.5 rounded text-xs bg-zinc-100 hover:bg-blue-100 hover:text-blue-700 text-zinc-600 transition-colors"
            >
              #{i + 1} {msToTime(seg.start_ms)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b)
}

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
