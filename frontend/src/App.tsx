import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UploadResponse, SegmentMeta } from '@/types'
import { detectSplitPoints, exportAllZip } from '@/api'
import { FileUpload } from '@/components/FileUpload'
import { Waveform, type WaveformHandle } from '@/components/Waveform'
import { TrackList } from '@/components/TrackList'

type Stage = 'upload' | 'working'

export default function App() {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>('upload')
  const [upload, setUpload] = useState<UploadResponse | null>(null)
  const [splitPoints, setSplitPoints] = useState<number[]>([])
  const waveformRef = useRef<WaveformHandle>(null)
  // Dynamic waveform panel height — measured via ResizeObserver
  const waveformPanelRef = useRef<HTMLDivElement>(null)
  const [waveformPanelH, setWaveformPanelH] = useState(232)

  // Sensitivity sliders
  const [minSilenceMs, setMinSilenceMs] = useState(700)
  const [silenceThreshDb, setSilenceThreshDb] = useState(-50)
  const [showSensitivity, setShowSensitivity] = useState(false)

  // Segments produced by the bulk split — drives the export panel
  const [splitSegments, setSplitSegments] = useState<SegmentMeta[]>([])
  const [exporting, setExporting] = useState(false)

  // Measure the waveform panel height to correctly offset the scrollable list
  useEffect(() => {
    const el = waveformPanelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWaveformPanelH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage]) // re-attach when stage changes (panel mounts)

  const detectMutation = useMutation({
    mutationFn: (fileId: string) =>
      detectSplitPoints(fileId, minSilenceMs, silenceThreshDb),
    onSuccess: (result) => {
      setSplitPoints(result.split_points_ms)
    },
  })

  const handleUploaded = (result: UploadResponse) => {
    setUpload(result)
    setStage('working')
    detectMutation.mutate(result.file_id)
  }

  const handleReset = () => {
    setStage('upload')
    setUpload(null)
    setSplitPoints([])
    setSplitSegments([])
    qc.clear()
  }

  const handleSplitComplete = useCallback((segments: SegmentMeta[]) => {
    setSplitSegments(segments)
  }, [])

  // Shift+click on waveform → add split point
  const handleAddSplit = useCallback((positionMs: number) => {
    setSplitPoints((prev) => {
      if (prev.includes(positionMs)) return prev
      return [...prev, positionMs].sort((a, b) => a - b)
    })
  }, [])

  // Waveform region click → scroll the matching track row into view (within the scrollable pane)
  const handleRegionClick = useCallback((index: number) => {
    const el = document.getElementById(`track-row-${index}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  // Delete a split boundary: remove the split point at position `index` (0 = first interior marker)
  const handleDeleteTrack = useCallback((index: number) => {
    setSplitPoints((prev) => {
      // index maps to prev[index+1] — the right boundary of track `index`
      // but we actually want to remove the interior boundary between track[index] and track[index+1]
      // which is prev[index + 1] (skipping the 0 at prev[0])
      const next = [...prev]
      next.splice(index + 1, 1)
      return next
    })
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        document.getElementById('waveform-play-btn')?.click()
      }
      if (e.code === 'ArrowRight') document.getElementById('waveform-skip-fwd')?.click()
      if (e.code === 'ArrowLeft') document.getElementById('waveform-skip-bwd')?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleExportAll = async () => {
    if (!upload || splitSegments.length === 0) return
    setExporting(true)
    try {
      await exportAllZip(upload.file_id, splitSegments)
    } finally {
      setExporting(false)
    }
  }

  const splittableCount = splitPoints.length > 1 ? splitPoints.length - 1 : 0

  // ─── Upload stage ────────────────────────────────────────────────────────
  if (stage === 'upload') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-2">
          <AppIcon />
          <h1 className="text-lg font-semibold">Split Music</h1>
        </header>
        <FileUpload onUploaded={handleUploaded} />
      </div>
    )
  }

  // ─── Working stage — two-panel sticky layout ─────────────────────────────
  //
  //  ┌─────────────── header (fixed) ────────────────────┐
  //  ├─────── sticky waveform panel (fixed below header) ┤
  //  └──────────── scrollable track list below ──────────┘
  //
  const headerH = 65   // px — matches py-4 + text line height

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">

      {/* ── Fixed header ── */}
      <header
        className="fixed top-0 inset-x-0 z-40 border-b border-zinc-200 bg-white px-6 py-4 flex items-center justify-between"
        style={{ height: headerH }}
      >
        <div className="flex items-center gap-2">
          <AppIcon />
          <h1 className="text-lg font-semibold">Split Music</h1>
        </div>
        {upload && (
          <div className="flex items-center gap-4 min-w-0">
            {/* Inline collapsed FileInfo */}
            <div className="hidden sm:flex items-center gap-2 min-w-0">
              {upload.has_art && (
                <img
                  src={`/upload/${upload.file_id}/art`}
                  alt="cover"
                  className="w-7 h-7 rounded object-cover shrink-0"
                />
              )}
              <span className="text-sm text-zinc-700 font-medium truncate max-w-[200px]">
                {upload.title || upload.original_name}
              </span>
              {upload.artist && (
                <span className="text-sm text-zinc-400 truncate max-w-[140px]">{upload.artist}</span>
              )}
            </div>
            <button
              onClick={handleReset}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
            >
              New file
            </button>
          </div>
        )}
      </header>

      {/* ── Sticky waveform panel ── */}
      <div
        ref={waveformPanelRef}
        className="fixed inset-x-0 z-30 bg-zinc-900 border-b border-zinc-700 shadow-lg"
        style={{ top: headerH }}
      >
        <div className="max-w-5xl mx-auto px-4 py-2 flex flex-col gap-2">
          {/* Waveform controls bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white/70 text-xs">
              <span className="font-medium text-white">{splittableCount} track{splittableCount !== 1 ? 's' : ''}</span>
              {detectMutation.isPending && <span className="text-white/50">· detecting…</span>}
            </div>
            <div className="flex items-center gap-2 relative">
              {/* Sensitivity popover toggle */}
              <button
                onClick={() => setShowSensitivity((v) => !v)}
                className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Sensitivity
              </button>

              {/* Sensitivity popover — click outside to close */}
              {showSensitivity && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowSensitivity(false)}
                  />
                  <div className="absolute right-0 top-8 z-20 w-72 p-4 bg-white border border-zinc-200 rounded-xl shadow-xl flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs text-zinc-600">
                        <span>Min silence</span>
                        <span className="font-medium tabular-nums">{minSilenceMs} ms</span>
                      </div>
                      <input type="range" min={200} max={3000} step={50}
                        value={minSilenceMs}
                        onChange={(e) => setMinSilenceMs(Number(e.target.value))}
                        className="w-full accent-blue-600" />
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>200ms (dense)</span><span>3000ms (sparse)</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs text-zinc-600">
                        <span>Silence threshold</span>
                        <span className="font-medium tabular-nums">{silenceThreshDb} dB</span>
                      </div>
                      <input type="range" min={-70} max={-20} step={1}
                        value={silenceThreshDb}
                        onChange={(e) => setSilenceThreshDb(Number(e.target.value))}
                        className="w-full accent-blue-600" />
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>-70dB (sensitive)</span><span>-20dB (strict)</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setShowSensitivity(false); detectMutation.mutate(upload!.file_id) }}
                      disabled={detectMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      Re-detect with these settings
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={() => detectMutation.mutate(upload!.file_id)}
                disabled={detectMutation.isPending}
                className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-40 transition-colors"
              >
                Re-detect
              </button>
            </div>
          </div>

          {/* Waveform canvas */}
          <Waveform
            ref={waveformRef}
            audioUrl={`/segment/file/${upload!.file_id}/audio`}
            splitPoints={splitPoints}
            durationMs={upload!.duration_ms}
            onSplitPointsChange={setSplitPoints}
            onRegionClick={handleRegionClick}
            onAddSplit={handleAddSplit}
          />
        </div>
      </div>

      {/* ── Scrollable track list ── */}
      {/* top padding = header + waveform panel height, both measured dynamically */}
      <main
        className="max-w-5xl mx-auto px-4 flex flex-col gap-4"
        style={{ paddingTop: headerH + waveformPanelH + 16, paddingBottom: splitSegments.length > 0 ? 80 : 24 }}
      >
        {detectMutation.isPending && (
          <DetectSkeleton />
        )}
        {splittableCount >= 1 && !detectMutation.isPending && (
          <TrackList
            fileId={upload!.file_id}
            splitPoints={splitPoints}
            onSplitPointsChange={setSplitPoints}
            onPlay={(startMs, endMs) => {
              waveformRef.current?.zoomTo(startMs, endMs)
              waveformRef.current?.playFrom(startMs, endMs)
            }}
            onDeleteTrack={handleDeleteTrack}
            onSplitComplete={handleSplitComplete}
          />
        )}
      </main>

      {/* ── Sticky export footer ── */}
      {splitSegments.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-zinc-200 px-6 py-3 flex items-center justify-between gap-4 z-30">
          <span className="text-sm text-zinc-600">
            <span className="font-semibold text-zinc-800">{splitSegments.length}</span>
            {' '}track{splitSegments.length !== 1 ? 's' : ''} ready
          </span>
          <button
            onClick={handleExportAll}
            disabled={exporting}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {exporting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Exporting…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export all as ZIP
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

function AppIcon() {
  return (
    <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
    </svg>
  )
}

/** Skeleton shimmer shown while silence-detection is running */
function DetectSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border border-zinc-100 rounded-xl overflow-hidden bg-white">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-4 h-4 rounded bg-zinc-100 shrink-0" />
            <div className="w-10 h-10 rounded bg-zinc-100 shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-3 bg-zinc-100 rounded w-2/5" />
              <div className="h-2.5 bg-zinc-100 rounded w-1/4" />
            </div>
            <div className="w-7 h-7 rounded-full bg-zinc-100 shrink-0" />
            <div className="w-16 h-6 rounded-lg bg-zinc-100 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}
