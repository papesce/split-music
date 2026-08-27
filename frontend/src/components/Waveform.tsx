import { useEffect, useRef } from 'react'
import { useWaveSurfer, type WaveformHandle } from '@/hooks/useWaveSurfer'
import { useWaveformRegions } from '@/hooks/useWaveformRegions'
import { WaveformToolbar } from '@/components/waveform/WaveformToolbar'

export type { WaveformHandle }

interface Props {
  audioUrl: string
  splitPoints: number[]
  durationMs: number
  onSplitPointsChange: (points: number[]) => void
  onRegionClick?: (index: number) => void
  onAddSplit?: (positionMs: number) => void
  ref?: React.Ref<WaveformHandle>
  focusedIndex?: number | null | undefined
  onWaveStateChange?: ((playing: boolean, reason: import('@/hooks/useWaveSurfer').WaveStateReason) => void) | undefined
  onTogglePlay?: (() => void) | undefined
  onSeekPause?: (() => void) | undefined
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
  onWaveStateChange,
  onTogglePlay,
  onSeekPause,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    wsRef,
    regionsRef,
    ready,
    error,
    playing,
    zoom,
    cursorMs,
    setCursorMs,
    applyZoom,
  } = useWaveSurfer({ audioUrl, containerRef, durationMs, ref: ref as React.Ref<import("@/hooks/useWaveSurfer").WaveformHandle>, onStateChange: onWaveStateChange })

  useWaveformRegions({
    wsRef,
    regionsRef,
    splitPoints,
    durationMs,
    ready,
    focusedIndex: focusedIndex ?? null,
    onSplitPointsChange,
    onRegionClick,
  })

  // S → split at cursor (when not typing)
  useEffect(() => {
    if (!onAddSplit) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code !== 'KeyS' || e.metaKey || e.ctrlKey || e.altKey) return
      if (cursorMs === null || !ready) return
      const minGap = 350
      if (cursorMs <= minGap || cursorMs >= durationMs - minGap) return
      const isFocused = focusedIndex !== null && focusedIndex !== undefined
      const s = isFocused ? (splitPoints[focusedIndex as number] ?? 0) : 0
      const globalCursor = isFocused ? s + (cursorMs as number) : (cursorMs as number)
      if (splitPoints.some((p) => Math.abs(p - globalCursor) <= minGap)) return
      e.preventDefault()
      onAddSplit(globalCursor)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAddSplit, cursorMs, ready, focusedIndex, durationMs, splitPoints])

  // Ensure zoom reset on focus change (isolated waveform just needs 1x)
  useEffect(() => {
    if (ready) applyZoom(1)
  }, [focusedIndex, ready, applyZoom])

  // Sync focused flag for interaction handler (used by hook)
  useEffect(() => {
    if (wsRef.current) {
      ;(wsRef.current as unknown as { _focused?: boolean })._focused =
        focusedIndex !== null && focusedIndex !== undefined
    }
  }, [focusedIndex, wsRef])

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden bg-zinc-900 cursor-pointer"
        title="Click to position cursor · Drag red markers to adjust"
      />
      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Waveform failed to load: {error}
        </div>
      )}
      <WaveformToolbar
        wsRef={wsRef}
        ready={ready}
        playing={playing}
        zoom={zoom}
        cursorMs={cursorMs}
        splitPoints={splitPoints}
        durationMs={durationMs}
        focusedIndex={focusedIndex ?? null}
        onAddSplit={onAddSplit}
        applyZoom={applyZoom}
        setCursorMs={setCursorMs}
        onTogglePlay={onTogglePlay}
        onSeekPause={onSeekPause}
      />
    </div>
  )
}
