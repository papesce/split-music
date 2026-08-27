import { useMemo, useState } from 'react'
import type WaveSurfer from 'wavesurfer.js'

interface Props {
  wsRef: React.RefObject<WaveSurfer | null>
  ready: boolean
  playing: boolean
  zoom: number
  cursorMs: number | null
  splitPoints: number[]
  durationMs: number
  focusedIndex: number | null | undefined
  onAddSplit: ((positionMs: number) => void) | undefined
  applyZoom: (pxPerSec: number) => void
  setCursorMs: (ms: number | null) => void
}

export function WaveformToolbar({
  wsRef,
  ready,
  playing,
  zoom,
  cursorMs,
  splitPoints,
  durationMs,
  focusedIndex,
  onAddSplit,
  applyZoom,
  setCursorMs,
}: Props) {
  const [hintOpen, setHintOpen] = useState(false)

  const togglePlay = () => {
    try {
      wsRef.current?.playPause()
    } catch (err) {
      console.error('[Waveform] togglePlay error', err)
    }
  }



  const visibleLabel = useMemo(() => {
    const containerWidth = 800 // fallback; actual width measured via css, not critical
    const visibleSec = containerWidth / Math.max(1, zoom)
    if (visibleSec < 60) return `≈ ${Math.round(visibleSec)}s`
    return `≈ ${Math.round(visibleSec / 60)}m`
  }, [zoom])

  const isFocused = focusedIndex !== null && focusedIndex !== undefined
  const MIN_GAP_MS = 350
  const canSplitAtCursor = useMemo(() => {
    if (!ready || cursorMs === null || !onAddSplit) return false
    if (cursorMs <= MIN_GAP_MS || cursorMs >= durationMs - MIN_GAP_MS) return false
    const s = isFocused ? (splitPoints[focusedIndex as number] ?? 0) : 0
    const globalCursor = isFocused ? s + (cursorMs as number) : (cursorMs as number)
    return splitPoints.every((p) => Math.abs(p - globalCursor) > MIN_GAP_MS)
  }, [ready, cursorMs, onAddSplit, splitPoints, durationMs, focusedIndex, isFocused])

  const splitDisabledReason = useMemo(() => {
    if (!ready) return 'Waveform not ready'
    if (cursorMs === null) return 'Click waveform to position cursor'
    if (cursorMs <= MIN_GAP_MS || cursorMs >= durationMs - MIN_GAP_MS) return 'Too close to start/end'
    const s = isFocused ? (splitPoints[focusedIndex as number] ?? 0) : 0
    const globalCursor = isFocused ? s + (cursorMs as number) : (cursorMs as number)
    if (splitPoints.some((p) => Math.abs(p - globalCursor) <= MIN_GAP_MS)) return 'Too close to existing split'
    return null
  }, [ready, cursorMs, durationMs, splitPoints, focusedIndex, isFocused])

  function fmtMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = String(totalSec % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        id="waveform-skip-bwd"
        onClick={() => {
          const ws = wsRef.current
          if (!ws) return
          const cur = ws.getCurrentTime()
          const next = Math.max(0, cur - 5)
          ws.seekTo(next / ((durationMs || 1) / 1000))
          try {
            ws.pause()
          } catch {}
          setCursorMs(Math.round(next * 1000))
        }}
        disabled={!ready}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 transition-colors"
        title="Back 5s (←)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
        </svg>
      </button>

      <button
        id="waveform-play-btn"
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

      {!ready && <span className="text-xs text-zinc-400 ml-1">Loading waveform…</span>}

      <button
        id="waveform-skip-fwd"
        onClick={() => {
          const ws = wsRef.current
          if (!ws) return
          const dur = (durationMs || 1) / 1000
          const cur = ws.getCurrentTime()
          const next = Math.min(dur, cur + 5)
          ws.seekTo(Math.min(1, next / dur))
          try {
            ws.pause()
          } catch {}
          setCursorMs(Math.round(next * 1000))
        }}
        disabled={!ready}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 transition-colors"
        title="Forward 5s (→)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
        </svg>
      </button>

      {ready && <span className="mx-1 h-5 w-px bg-zinc-200 shrink-0" />}

      {ready && onAddSplit && (
        <button
          id="waveform-split-at-cursor"
          onClick={() => {
            if (cursorMs !== null && canSplitAtCursor) {
              const s = isFocused ? (splitPoints[focusedIndex as number] ?? 0) : 0
              const globalCursor = isFocused ? s + (cursorMs as number) : (cursorMs as number)
              onAddSplit(globalCursor)
            }
          }}
          disabled={!canSplitAtCursor}
          title={splitDisabledReason ?? `Split at ${cursorMs !== null ? fmtMs(cursorMs) : 'cursor'} (S)`}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-red-700 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zM9.879 9.879L4 4m5.879 5.879a3 3 0 104.243-4.243 3 3 0 00-4.243 4.243z" />
          </svg>
          Split at {cursorMs !== null ? fmtMs(cursorMs) : '—:--'}
        </button>
      )}

      {ready && (
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(((Math.log(Math.max(1, zoom)) - Math.log(1)) / (Math.log(500) - Math.log(1))) * 100)}
            onChange={(e) => {
              const v = Number(e.target.value)
              const px = Math.round(Math.exp(Math.log(1) + (v / 100) * (Math.log(500) - Math.log(1))))
              applyZoom(px)
            }}
            className="w-24 accent-blue-600"
            title={`Zoom: ${visibleLabel}`}
          />
          <span className="text-xs text-zinc-400 tabular-nums w-14">{visibleLabel}</span>
          {zoom > 1 && (
            <button
              onClick={() => applyZoom(1)}
              className="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 transition-colors whitespace-nowrap"
              title="Reset zoom"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {ready && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-zinc-400">
            {splitPoints.length - 1} segment{splitPoints.length - 1 !== 1 ? 's' : ''}
          </span>
          <div className="relative">
            <button
              onClick={() => setHintOpen((v) => !v)}
              className="w-5 h-5 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors text-xs font-semibold"
              title="Keyboard shortcuts & hints"
            >
              ⓘ
            </button>
            {hintOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setHintOpen(false)} />
                <div className="absolute right-0 top-7 z-20 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-3 text-xs text-zinc-600 flex flex-col gap-1.5">
                  <p className="font-semibold text-zinc-700 mb-1">Tips &amp; shortcuts</p>
                  <p>
                    <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">Space</kbd> Play / Pause
                  </p>
                  <p>
                    <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">← →</kbd> Skip 5s back / forward
                  </p>
                  <p>
                    <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">Click</kbd> Position cursor
                  </p>
                  {onAddSplit && (
                    <p>
                      <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">S</kbd> Split at cursor
                    </p>
                  )}
                  <p>
                    Drag <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 align-middle" /> red markers to adjust boundaries
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
