import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'

export type WaveStateReason = 'play' | 'pause' | 'finish' | 'stopAt' | 'seek' | 'stop'

export interface WaveformHandle {
  playFrom: (startMs: number, endMs?: number) => Promise<boolean>
  pause: () => void
  stop: () => void
  zoomTo: (startMs: number, endMs: number) => void
  resetZoom: () => void
  getCursorMs: () => number | null
  isReady: () => boolean
  isPlaying: () => boolean
}

export function useWaveSurfer({
  audioUrl,
  containerRef,
  durationMs,
  ref,
  onStateChange,
}: {
  audioUrl: string
  containerRef: React.RefObject<HTMLDivElement | null>
  durationMs: number
  ref?: React.Ref<WaveformHandle>
  onStateChange?: ((playing: boolean, reason: WaveStateReason) => void) | undefined
}) {
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [cursorMs, setCursorMs] = useState<number | null>(null)
  const cursorMsRef = useRef<number | null>(null)
  cursorMsRef.current = cursorMs
  const stopAtRef = useRef<number | null>(null)
  const pendingPlayRef = useRef<{ startMs: number; endMs?: number } | null>(null)

  const onAudioProcess = useCallback(
    (currentTimeSec: number) => {
      if (stopAtRef.current !== null && currentTimeSec >= stopAtRef.current) {
        wsRef.current?.pause()
        stopAtRef.current = null
        onStateChange?.(false, 'stopAt')
      }
      if (cursorMsRef.current !== null || wsRef.current?.isPlaying()) {
        setCursorMs(Math.round(currentTimeSec * 1000))
      }
    },
    [onStateChange],
  )

  const applyZoom = useCallback((pxPerSec: number) => {
    const ws = wsRef.current
    if (!ws) return
    try {
      const clamped = Math.max(1, pxPerSec)
      ws.zoom(clamped)
      setZoom(clamped)
    } catch (err) {
      console.warn('[Waveform] zoom ignored (not ready)', err)
    }
  }, [])

  const computeZoomForWindow = useCallback(
    (startMs: number, endMs: number): number => {
      const containerWidth = containerRef.current?.clientWidth ?? 800
      const segDurSec = (endMs - startMs) / 1000
      if (segDurSec <= 0) return 1
      return Math.round(containerWidth / (segDurSec * 1.2))
    },
    [containerRef],
  )

  useImperativeHandle(
    ref,
    () => ({
      async playFrom(startMs: number, endMs?: number): Promise<boolean> {
        const ws = wsRef.current
        if (!ws) return false
        if (!ready) {
          pendingPlayRef.current = endMs !== undefined ? { startMs, endMs } : { startMs }
          return false
        }
        try {
          stopAtRef.current = endMs !== undefined ? endMs / 1000 : null
          ws.pause()
          ws.seekTo(startMs / (durationMs || 1))
          setCursorMs(startMs)
          const p = ws.play()
          if (p && typeof (p as Promise<void>).catch === 'function') {
            await (p as Promise<void>).catch((err) => {
              if (err instanceof Error && err.name === 'AbortError') return
              console.error('[Waveform] play failed', err)
              throw err
            })
          }
          return true
        } catch (err) {
          if (err instanceof Error && err.message.includes('No audio')) {
            pendingPlayRef.current = endMs !== undefined ? { startMs, endMs } : { startMs }
            return false
          }
          console.error('[Waveform] playFrom error', err)
          return false
        }
      },
      pause() {
        stopAtRef.current = null
        pendingPlayRef.current = null
        try {
          wsRef.current?.pause()
        } catch {
          /* ignore */
        }
      },
      stop() {
        stopAtRef.current = null
        pendingPlayRef.current = null
        try {
          wsRef.current?.pause()
          wsRef.current?.seekTo(0)
        } catch {
          /* ignore */
        }
        setCursorMs(0)
        onStateChange?.(false, 'stop')
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
        try {
          return Math.round((wsRef.current?.getCurrentTime() ?? 0) * 1000)
        } catch {
          return null
        }
      },
      isReady() {
        return ready
      },
      isPlaying() {
        try {
          return !!wsRef.current?.isPlaying()
        } catch {
          return false
        }
      },
    }),
    [durationMs, applyZoom, computeZoomForWindow, ready, onStateChange],
  )

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
      if (pendingPlayRef.current) {
        const { startMs, endMs } = pendingPlayRef.current
        pendingPlayRef.current = null
        try {
          stopAtRef.current = endMs !== undefined ? endMs / 1000 : null
          ws.seekTo(startMs / ((ws.getDuration() * 1000) || 1))
          setCursorMs(startMs)
          const p = ws.play()
          if (p && typeof (p as Promise<void>).catch === 'function') {
            ;(p as Promise<void>).catch((err) => {
              if (err instanceof Error && err.name === 'AbortError') return
              console.error('[Waveform] deferred play failed', err)
              onStateChange?.(false, 'pause')
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
    ws.on('play', () => { setPlaying(true); onStateChange?.(true, 'play') })
    ws.on('pause', () => { setPlaying(false); onStateChange?.(false, 'pause') })
    ws.on('finish', () => {
      setPlaying(false)
      stopAtRef.current = null
      onStateChange?.(false, 'finish')
    })
    ws.on('audioprocess', onAudioProcess)
    ws.on('timeupdate', onAudioProcess)

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
      if (target?.closest?.('[data-marker="true"]')) return
      const ms = Math.round(newTimeSec * 1000)
      try {
        ws.seekTo(newTimeSec / (ws.getDuration() || 1))
        ws.pause()
        stopAtRef.current = null
        pendingPlayRef.current = null
        setCursorMs(ms)
        onStateChange?.(false, 'seek')
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

  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return
    ws.un('audioprocess', onAudioProcess)
    ws.on('audioprocess', onAudioProcess)
  }, [onAudioProcess])

  return {
    wsRef,
    regionsRef,
    ready,
    error,
    playing,
    zoom,
    cursorMs,
    setCursorMs,
    cursorMsRef,
    stopAtRef,
    applyZoom,
    computeZoomForWindow,
    setReady,
  }
}
