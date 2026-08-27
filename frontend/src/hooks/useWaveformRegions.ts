import { useEffect, useRef } from 'react'
import type WaveSurfer from 'wavesurfer.js'
import type RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'

export function useWaveformRegions({
  wsRef,
  regionsRef,
  splitPoints,
  durationMs,
  ready,
  focusedIndex,
  onSplitPointsChange,
  onRegionClick,
}: {
  wsRef: React.RefObject<WaveSurfer | null>
  regionsRef: React.RefObject<ReturnType<typeof RegionsPlugin.create> | null>
  splitPoints: number[]
  durationMs: number
  ready: boolean
  focusedIndex: number | null | undefined
  onSplitPointsChange: (points: number[]) => void
  onRegionClick: ((index: number) => void) | undefined
}) {
  const bandRegionIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const regions = regionsRef.current
    const ws = wsRef.current
    if (!regions || !ws || durationMs === 0 || !ready) return

    regions.clearRegions()
    bandRegionIds.current.clear()

    const isFocused = focusedIndex !== null && focusedIndex !== undefined
    if (isFocused) return

    const colours: [string, string] = ['rgba(59,130,246,0.10)', 'rgba(16,185,129,0.10)']
    const boundaries = splitPoints.slice(1, -1)

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
        ;(ws as unknown as { _regionClickBlocked?: boolean })._regionClickBlocked = true
        onRegionClick?.(i)
      })
    })

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
        onSplitPointsChange([...updated].sort((a, b) => a - b))
      })
    })
  }, [splitPoints, durationMs, onSplitPointsChange, onRegionClick, focusedIndex, ready, regionsRef, wsRef])
}
