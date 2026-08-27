import { useEffect, useImperativeHandle, useRef, useState, useCallback, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'

export interface WaveformHandle {
  /** Seek to startMs and play; stop automatically at endMs if provided */
  playFrom: (startMs: number, endMs?: number) => void
  pause: () => void
  /** Zoom in on a time window and seek to its start */
  zoomTo: (startMs: number, endMs: number) => void
  /** Reset to full-file zoom */
  resetZoom: () => void
  /** Current cursor position in ms (last click / playhead) */
  getCursorMs: () => number | null
}

interface Props {
  audioUrl: string // URL to the full uploaded MP3
  splitPoints: number[] // ms timestamps (incl. 0 and duration)
  durationMs: number
  onSplitPointsChange: (points: number[]) => void
  /** Called when the user clicks a waveform region — provides the region index (0-based) */
  onRegionClick?: (index: number) => void
  /** Called when the user clicks a blank spot on the waveform to insert a split */
  onAddSplit?: (positionMs: number) => void
  /** Ref handle for external seek+play control */
  ref?: React.Ref<WaveformHandle>
  /** Sensitivity controls */
  minSilenceMs?: number
  silenceThreshDb?: number
  /** When set, waveform zooms to and shows only this track */
  focusedIndex?: number | null | undefined
}

export function Waveform({
  audioUrl,
  splitPoints,
  durationMs,
  onSplitPointsChange,
  onRegionClick,
  onAddSplit,
  ref,
  focusedIndex,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopAtRef = useRef<number | null>(null)
  const bandRegionIds = useRef<Set<string>>(new Set())
  // zoom level: pixels-per-second (1 = full file fits container)
  const [zoom, setZoom] = useState(1)
  const [hintOpen, setHintOpen] = useState(false)
  // Cursor position (ms) — where next split will be inserted; updated on click / seek
  const [cursorMs, setCursorMs] = useState<number | null>(null)
  const cursorMsRef = useRef<number | null>(null)
  cursorMsRef.current = cursorMs

  const onAudioProcess = useCallback((currentTimeSec: number) => {
    if (stopAtRef.current !== null && currentTimeSec >= stopAtRef.current) {
      wsRef.current?.pause()
      stopAtRef.current = null
    }
    // Keep cursor in sync with playhead while playing
    if (cursorMsRef.current !== null || wsRef.current?.isPlaying()) {
      // update cursor to live playhead for accurate "Split at cursor" while playing
      setCursorMs(Math.round(currentTimeSec * 1000))
    }
  }, [])

  const pendingPlayRef = useRef<{ startMs: number; endMs?: number | undefined } | null>(null)

  const applyZoom = useCallback((pxPerSec: number) => {
    const ws = wsRef.current
    if (!ws) return
    try {
      const clamped = Math.max(1, pxPerSec)
      ws.zoom(clamped)
      setZoom(clamped)
    } catch (err) {
      // zoom before audio decoded throws "No audio loaded" in wavesurfer
      console.warn('[Waveform] zoom ignored (not ready)', err)
    }
  }, [])

  const computeZoomForWindow = useCallback((startMs: number, endMs: number): number => {
    const containerWidth = containerRef.current?.clientWidth ?? 800
    const segDurSec = (endMs - startMs) / 1000
    if (segDurSec <= 0) return 1
    // Fill the container with this segment + small 10% padding on each side
    return Math.round(containerWidth / (segDurSec * 1.2))
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      playFrom(startMs: number, endMs?: number) {
        const ws = wsRef.current
        if (!ws) return
        // If audio not yet decoded, queue play for when ready
        if (!ready) {
          pendingPlayRef.current = { startMs, endMs }
          return
        }
        try {
          stopAtRef.current = endMs !== undefined ? endMs / 1000 : null
          ws.pause()
          ws.seekTo(startMs / (durationMs || 1))
          setCursorMs(startMs)
          const p = ws.play()
          if (p && typeof (p as Promise<void>).catch === 'function') {
            ;(p as Promise<void>).catch((err) => {
              if (err instanceof Error && err.name === 'AbortError') return
              console.error('[Waveform] play failed', err)
            })
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('No audio')) {
            pendingPlayRef.current = { startMs, endMs }
            return
          }
          console.error('[Waveform] playFrom error', err)
        }
      },
      pause() {
        stopAtRef.current = null
        pendingPlayRef.current = null
        try { wsRef.current?.pause() } catch { /* ignore */ }
      },
      zoomTo(startMs: number, endMs: number) {
        const ws = wsRef.current
        if (!ws || !ready) return
        try {
          const pxPerSec = computeZoomForWindow(startMs, endMs)
          applyZoom(pxPerSec)
          ws.seekTo(startMs / (durationMs || 1))
          setCursorMs(startMs)
        } catch (err) {
          console.warn('[Waveform] zoomTo ignored', err)
        }
      },
      resetZoom() {
        if (!ready) return
        applyZoom(1)
      },
      getCursorMs() {
        if (cursorMsRef.current !== null) return cursorMsRef.current
        try { return Math.round((wsRef.current?.getCurrentTime() ?? 0) * 1000) } catch { return null }
      },
    }),
    [durationMs, applyZoom, computeZoomForWindow, ready],
  )

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

    setError(null)
    setReady(false)
    ws.load(audioUrl).catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[Waveform] load failed', audioUrl, err)
      setError(err instanceof Error ? err.message : String(err))
    })

    ws.on('ready', () => {
      setReady(true)
      setError(null)
      // Flush any play that was queued before audio was ready (focus -> play race)
      if (pendingPlayRef.current) {
        const { startMs, endMs } = pendingPlayRef.current
        pendingPlayRef.current = null
        try {
          stopAtRef.current = endMs !== undefined ? endMs / 1000 : null
          ws.seekTo(startMs / ((ws.getDuration() * 1000) || 1))
          const p = ws.play()
          if (p && typeof (p as Promise<void>).catch === 'function') {
            ;(p as Promise<void>).catch((err) => {
              if (err instanceof Error && err.name === 'AbortError') return
              console.error('[Waveform] deferred play failed', err)
            })
          }
        } catch (err) {
          console.error('[Waveform] deferred play error', err)
        }
      }
    })
    ws.on('error', (err: unknown) => {
      console.error('[Waveform] error event', err)
      setError(err instanceof Error ? err.message : String(err))
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => {
      setPlaying(false)
      stopAtRef.current = null
    })
    ws.on('audioprocess', onAudioProcess)
    ws.on('timeupdate', onAudioProcess)

    // Click → position cursor (seek, no auto-play). Splitting is via button.
    // Keep marker / band guards so drag/click on regions doesn't move cursor.
    const containerEl = containerRef.current as HTMLElement | null
    const onPointerDown = (e: PointerEvent) => {
      ;(ws as unknown as { _pointerDownTarget?: EventTarget | null })._pointerDownTarget = e.target
    }
    containerEl?.addEventListener('pointerdown', onPointerDown)

    ws.on('interaction', (newTimeSec: number) => {
      if ((ws as unknown as { _regionClickBlocked?: boolean })._regionClickBlocked) {
        ;(ws as unknown as { _regionClickBlocked?: boolean })._regionClickBlocked = false
        return
      }
      const target = (ws as unknown as { _pointerDownTarget?: EventTarget | null })._pointerDownTarget as HTMLElement | null
      if (target?.closest?.('[data-marker="true"]')) {
        return
      }
      const ms = Math.round(newTimeSec * 1000)
      try {
        ws.seekTo(newTimeSec / (ws.getDuration() || 1))
        ws.pause()
        stopAtRef.current = null
        setCursorMs(ms)
      } catch (err) {
        console.error('[Waveform] seek error', err)
      }
    })

    wsRef.current = ws
    return () => {
      containerEl?.removeEventListener('pointerdown', onPointerDown)
      ws.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl])

  // Sync focused flag onto ws instance for interaction handler
  useEffect(() => {
    if (wsRef.current) {
      ;(wsRef.current as unknown as { _focused?: boolean })._focused = focusedIndex !== null && focusedIndex !== undefined
    }
  }, [focusedIndex])

  // Re-register audioprocess when callback identity changes
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return
    ws.un('audioprocess', onAudioProcess)
    ws.on('audioprocess', onAudioProcess)
  }, [onAudioProcess])

  // S → split at cursor (when not typing, not focused)
  useEffect(() => {
    if (!onAddSplit) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code !== 'KeyS' || e.metaKey || e.ctrlKey || e.altKey) return
      if (focusedIndex !== null && focusedIndex !== undefined) return
      if (cursorMs === null || !ready) return
      const minGap = 350
      if (cursorMs <= minGap || cursorMs >= durationMs - minGap) return
      if (splitPoints.some((p) => Math.abs(p - (cursorMs as number)) <= minGap)) return
      e.preventDefault()
      onAddSplit(cursorMs as number)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAddSplit, cursorMs, ready, focusedIndex, durationMs, splitPoints])

  // When focused we load isolated audio — no auto-zoom to window needed.
  // Just ensure zoom is reset for the isolated waveform.
  useEffect(() => {
    if (focusedIndex !== null && focusedIndex !== undefined) {
      if (ready) applyZoom(1)
    } else {
      if (ready) applyZoom(1)
    }
  }, [focusedIndex, ready, applyZoom])

  // Draw / update split-point markers and band regions
  useEffect(() => {
    const regions = regionsRef.current
    const ws = wsRef.current
    if (!regions || !ws || durationMs === 0 || !ready) return

    regions.clearRegions()
    bandRegionIds.current.clear()

    const isFocused = focusedIndex !== null && focusedIndex !== undefined

    if (isFocused) {
      // Isolated audio — no bands/markers; the whole waveform is the track
      return
    }

    const colours: [string, string] = ['rgba(59,130,246,0.10)', 'rgba(16,185,129,0.10)']
    const boundaries = splitPoints.slice(1, -1) // interior markers only

    // Coloured band regions — clickable to preview
    splitPoints.forEach((pt, i) => {
      const next = splitPoints[i + 1]
      if (next === undefined) return
      const r = regions.addRegion({
        start: pt / 1000,
        end: next / 1000,
        color: colours[i % 2 as 0 | 1],
        drag: false,
        resize: false,
      })
      bandRegionIds.current.add(r.id)

      r.on('click', () => {
        // Prevent the 'interaction' handler from also seeking/playing
        ;(ws as unknown as { _regionClickBlocked?: boolean })._regionClickBlocked = true
        onRegionClick?.(i)
      })
    })

    // Draggable red marker regions for each interior boundary
    // 0.01s is <1px at full-file zoom (invisible) — force a visible width via CSS
    boundaries.forEach((ptMs, idx) => {
      const markerRegion = regions.addRegion({
        start: ptMs / 1000,
        end: ptMs / 1000 + 0.02,
        color: 'rgba(239,68,68,0.95)',
        drag: true,
        resize: false,
      })

      const el = markerRegion.element as HTMLElement | null
      if (el) {
        el.dataset['marker'] = 'true'
        el.style.minWidth = '4px'
        el.style.width = '4px'
        el.style.marginLeft = '-2px'
        el.style.zIndex = '5'
        el.style.cursor = 'ew-resize'
        el.style.borderRadius = '1px'
        el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)'
        el.style.overflow = 'visible'

        // Track number badge anchored to the marker — shows the track that starts at this boundary (idx+2)
        const trackNumber = idx + 2
        const badge = document.createElement('span')
        badge.textContent = String(trackNumber)
        badge.title = `Track ${trackNumber} starts here`
        badge.setAttribute('aria-label', `Track ${trackNumber}`)
        Object.assign(badge.style, {
          position: 'absolute',
          top: '2px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgb(239,68,68)',
          color: 'white',
          fontSize: '10px',
          fontWeight: '700',
          lineHeight: '1',
          padding: '2px 5px',
          borderRadius: '9999px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          zIndex: '10',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        } as CSSStyleDeclaration)
        el.appendChild(badge)
      }

      markerRegion.on('update-end', () => {
        const newPtMs = Math.round(markerRegion.start * 1000)
        const updated = splitPoints.map((p) => (p === ptMs ? newPtMs : p))
        onSplitPointsChange(sorted(updated))
      })
    })
  }, [splitPoints, durationMs, onSplitPointsChange, onRegionClick, focusedIndex, ready])

  const togglePlay = () => {
    try { wsRef.current?.playPause() } catch (err) { console.error('[Waveform] togglePlay error', err) }
  }
  const isZoomed = zoom > 1

  // Log-scale zoom: slider value 0–100 maps to pxPerSec 1–500 logarithmically
  const LOG_MIN = Math.log(1)
  const LOG_MAX = Math.log(500)
  const zoomToSlider = (pxPerSec: number) =>
    Math.round(((Math.log(Math.max(1, pxPerSec)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100)
  const sliderToZoom = (v: number) =>
    Math.round(Math.exp(LOG_MIN + (v / 100) * (LOG_MAX - LOG_MIN)))
  const sliderValue = zoomToSlider(zoom)

  // Human-readable "≈ Xs visible" label
  const visibleLabel = useMemo(() => {
    const containerWidth = containerRef.current?.clientWidth ?? 800
    const visibleSec = containerWidth / Math.max(1, zoom)
    if (visibleSec < 60) return `≈ ${Math.round(visibleSec)}s`
    return `≈ ${Math.round(visibleSec / 60)}m`
  }, [zoom])

  const isFocused = focusedIndex !== null && focusedIndex !== undefined
  const MIN_GAP_MS = 350
  const canSplitAtCursor = useMemo(() => {
    if (!ready || isFocused || cursorMs === null || !onAddSplit) return false
    if (cursorMs <= MIN_GAP_MS || cursorMs >= durationMs - MIN_GAP_MS) return false
    return splitPoints.every((p) => Math.abs(p - cursorMs) > MIN_GAP_MS)
  }, [ready, isFocused, cursorMs, onAddSplit, splitPoints, durationMs])

  const splitDisabledReason = useMemo(() => {
    if (!ready) return 'Waveform not ready'
    if (isFocused) return 'Unavailable when focused'
    if (cursorMs === null) return 'Click waveform to position cursor'
    if (cursorMs <= MIN_GAP_MS || cursorMs >= durationMs - MIN_GAP_MS) return 'Too close to start/end'
    if (splitPoints.some((p) => Math.abs(p - (cursorMs as number)) <= MIN_GAP_MS)) return 'Too close to existing split'
    return null
  }, [ready, isFocused, cursorMs, durationMs, splitPoints])

  function fmtMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = String(totalSec % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Waveform canvas */}
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden bg-zinc-900 cursor-pointer"
        title="Click to position cursor · Drag red markers to adjust"
      />
      {error && <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Waveform failed to load: {error}</div>}

      {/* Transport bar — grouped: [transport] | [zoom] [hint] */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* ── Transport group ── */}
        <button
          id="waveform-skip-bwd"
          onClick={() => {
            const ws = wsRef.current
            if (!ws) return
            const cur = ws.getCurrentTime()
            const next = Math.max(0, cur - 5)
            ws.seekTo(next / ((durationMs || 1) / 1000))
            try { ws.pause() } catch {}
            setCursorMs(Math.round(next * 1000))
          }}
          disabled={!ready}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 transition-colors"
          title="Back 5s (←)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
            />
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
            try { ws.pause() } catch {}
            setCursorMs(Math.round(next * 1000))
          }}
          disabled={!ready}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 transition-colors"
          title="Forward 5s (→)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
            />
          </svg>
        </button>

        {/* Divider */}
        {ready && <span className="mx-1 h-5 w-px bg-zinc-200 shrink-0" />}

        {/* ── Split at cursor ── */}
        {ready && !isFocused && onAddSplit && (
          <button
            id="waveform-split-at-cursor"
            onClick={() => { if (cursorMs !== null && canSplitAtCursor) onAddSplit(cursorMs) }}
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

        {/* ── Zoom group ── */}
        {ready && (
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 text-zinc-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"
              />
            </svg>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sliderValue}
              onChange={(e) => applyZoom(sliderToZoom(Number(e.target.value)))}
              className="w-24 accent-blue-600"
              title={`Zoom: ${visibleLabel}`}
            />
            <span className="text-xs text-zinc-400 tabular-nums w-14">{visibleLabel}</span>
            {isZoomed && (
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

        {/* Segment count + ⓘ hint popover */}
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
                      <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">
                        Space
                      </kbd>{' '}
                      Play / Pause
                    </p>
                    <p>
                      <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">
                        ← →
                      </kbd>{' '}
                      Skip 5s back / forward
                    </p>
                    <p>
                      <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">
                        Click
                      </kbd>{' '}
                      Position cursor
                    </p>
                    {onAddSplit && (
                      <p>
                        <kbd className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">
                          S
                        </kbd>{' '}
                        Split at cursor
                      </p>
                    )}
                    <p>
                      Drag{' '}
                      <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 align-middle" />{' '}
                      red markers to adjust boundaries
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b)
}
