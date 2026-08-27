import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UploadResponse, SegmentMeta, FileEntry } from '@/types'
import { detectSplitPoints, exportAllZip, listFiles, getFileState, deleteFile, saveSplitPoints } from '@/api'
import { FileUpload } from '@/components/FileUpload'
import { type WaveformHandle } from '@/components/Waveform'
import { TrackList } from '@/components/TrackList'
import { AppHeader, AppIcon } from '@/components/AppHeader'
import { WaveformPanel } from '@/components/WaveformPanel'
import { ExportFooter } from '@/components/ExportFooter'
import { WaveformErrorBoundary } from '@/components/WaveformErrorBoundary'

type Stage = 'loading' | 'resume' | 'upload' | 'working'

// Header height in px — matches py-4 + text line height
const HEADER_H = 65

export default function App() {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>('loading')
  const [upload, setUpload] = useState<UploadResponse | null>(null)
  const [splitPoints, setSplitPoints] = useState<number[]>([])
  const [splitMap, setSplitMap] = useState<Map<number, string>>(new Map())
  const waveformRef = useRef<WaveformHandle>(null)
  // Debounce ref for auto-saving split points
  const saveSplitPointsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dynamic waveform panel height — measured via ResizeObserver
  const waveformPanelRef = useRef<HTMLDivElement>(null)
  const [waveformPanelH, setWaveformPanelH] = useState(232)

  const [artModalOpen, setArtModalOpen] = useState(false)
  const [playingTrack, setPlayingTrack] = useState<number | null>(null)

  // Sensitivity sliders
  const [minSilenceMs, setMinSilenceMs] = useState(700)
  const [silenceThreshDb, setSilenceThreshDb] = useState(-50)

  // Segments produced by the bulk split — drives the export footer
  const [splitSegments, setSplitSegments] = useState<SegmentMeta[]>([])
  const [exporting, setExporting] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // ── Fetch existing sessions on mount ──────────────────────────────────────
  const { data: existingFiles, isLoading: filesLoading } = useQuery({
    queryKey: ['files'],
    queryFn: listFiles,
    // Only run once on mount; no background refetching needed
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (filesLoading) return
    if (existingFiles && existingFiles.length > 0) {
      setStage('resume')
    } else {
      setStage('upload')
    }
  }, [existingFiles, filesLoading])

  // Measure the waveform panel height to correctly offset the scrollable list
  useEffect(() => {
    const el = waveformPanelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWaveformPanelH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage]) // re-attach when stage changes (panel mounts)

  const detectMutation = useMutation({
    mutationFn: (fileId: string) => detectSplitPoints(fileId, minSilenceMs, silenceThreshDb),
    onSuccess: (result) => {
      setSplitPoints(result.split_points_ms)
      saveSplitPoints(result.file_id, result.split_points_ms).catch((err) =>
        console.error('[save-split-points] Failed after detect:', err),
      )
    },
    onError: (err) => console.error('[detect] Split-point detection failed:', err),
  })

  const handleUploaded = (result: UploadResponse) => {
    setUpload(result)
    setStage('working')
    detectMutation.mutate(result.file_id)
  }

  /** Resume a previously uploaded file. Restores split points from saved segments. */
  const handleResume = async (entry: FileEntry) => {
    try {
      const state = await getFileState(entry.file_id)
      const uploadLike: UploadResponse = {
        file_id: state.file_id,
        original_name: state.original_name,
        duration_ms: state.duration_ms,
        title: state.title,
        artist: state.artist,
        album: state.album,
        has_art: state.has_art,
      }
      // Rebuild splitMap from already-sliced segments
      const restoredMap = new Map(state.segments.map((s) => [s.index, s.segment_id]))
      setUpload(uploadLike)
      setSplitPoints(state.split_points_ms)
      setSplitMap(restoredMap)
      setStage('working')
    } catch (err) {
      console.error('[resume] Failed to load session state:', err)
    }
  }

  /** Delete a saved session from the server then update the list. */
  const handleDeleteSession = async (fileId: string) => {
    await deleteFile(fileId)
    qc.invalidateQueries({ queryKey: ['files'] })
    // If the list is now empty, go to upload
    const remaining = (existingFiles ?? []).filter((f) => f.file_id !== fileId)
    if (remaining.length === 0) setStage('upload')
  }

  const handleReset = () => {
    setStage(existingFiles && existingFiles.length > 0 ? 'resume' : 'upload')
    setUpload(null)
    setSplitPoints([])
    setSplitSegments([])
    setSplitMap(new Map())
    setFocusedIndex(null)
    qc.clear()
    // Re-fetch the file list so the resume screen is up to date
    qc.invalidateQueries({ queryKey: ['files'] })
  }

  const handleSplitComplete = useCallback((segments: SegmentMeta[]) => {
    setSplitSegments(segments)
  }, [])

  const handleSplitPointsChange = useCallback(
    (points: number[]) => {
      setSplitPoints(points)
      if (!upload) return
      const fileId = upload.file_id
      if (saveSplitPointsDebounce.current) clearTimeout(saveSplitPointsDebounce.current)
      saveSplitPointsDebounce.current = setTimeout(() => {
        saveSplitPoints(fileId, points).catch((err) =>
          console.error('[save-split-points] Failed:', err),
        )
      }, 500)
    },
    [upload],
  )

  const handleAddSplit = useCallback((positionMs: number) => {
    setSplitPoints((prev) => {
      if (prev.includes(positionMs)) return prev
      const next = [...prev, positionMs].sort((a, b) => a - b)
      if (!upload) return next
      const fileId = upload.file_id
      if (saveSplitPointsDebounce.current) clearTimeout(saveSplitPointsDebounce.current)
      saveSplitPointsDebounce.current = setTimeout(() => {
        saveSplitPoints(fileId, next).catch((err) =>
          console.error('[save-split-points] Failed:', err),
        )
      }, 500)
      return next
    })
  }, [upload])

  const handleRegionClick = useCallback((index: number) => {
    document
      .getElementById(`track-row-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  type DeleteMode = 'mergePrev' | 'mergeNext' | 'discard'

  const handleDeleteTrack = useCallback((index: number, mode: DeleteMode = 'mergeNext') => {
    setFocusedIndex((prev) => {
      if (prev === null) return prev
      if (prev === index) return null
      if (prev > index) return prev - 1
      return prev
    })
    setSplitPoints((prev) => {
      const next = [...prev]
      if (mode === 'mergePrev') {
        // Merge with previous: remove boundary at index (start of this track)
        if (index === 0) return prev // cannot merge prev for first track
        next.splice(index, 1)
      } else if (mode === 'mergeNext') {
        // Merge with next: remove boundary at index+1 (end of this track)
        if (index >= prev.length - 2) return prev // cannot merge next for last track
        next.splice(index + 1, 1)
      } else {
        // Discard: drop the track's interval and close the gap (shift later points)
        if (prev.length <= 2) return prev // keep at least one track
        const gap = (prev[index + 1] as number) - (prev[index] as number)
        next.splice(index + 1, 1)
        // close gap by shifting subsequent points left
        for (let i = index + 1; i < next.length; i++) {
          next[i] = (next[i] as number) - gap
        }
        // also remove the start boundary of the discarded track so neighbors become adjacent
        // Actually after splicing index+1, the interval [prev[index], prev[index+1]) is gone;
        // shifting makes next[index] (original prev[index]) stay, next[index+1] becomes original prev[index+2]-gap
        // To fully discard we already removed prev[index+1]; gap closure is done.
        // But we need to keep adjacency: no extra splice.
      }
      if (upload) {
        const fileId = upload.file_id
        if (saveSplitPointsDebounce.current) clearTimeout(saveSplitPointsDebounce.current)
        saveSplitPointsDebounce.current = setTimeout(() => {
          saveSplitPoints(fileId, next).catch((err) =>
            console.error('[save-split-points] Failed after delete:', err),
          )
        }, 500)
      }
      return next
    })
  }, [upload])

  const handleExitFocus = useCallback(() => {
    setFocusedIndex(null)
    waveformRef.current?.resetZoom()
  }, [])

  // Keep focusedIndex valid when splitPoints change (e.g. Split in two inserts a point)
  useEffect(() => {
    if (focusedIndex !== null && focusedIndex >= splitPoints.length - 1) {
      setFocusedIndex(null)
    }
  }, [splitPoints, focusedIndex])



  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedIndex !== null) {
        e.preventDefault()
        handleExitFocus()
        return
      }
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
  }, [focusedIndex, handleExitFocus])

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

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Resume stage ─────────────────────────────────────────────────────────
  if (stage === 'resume') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-2">
          <AppIcon />
          <h1 className="text-lg font-semibold">Split Music</h1>
        </header>
        <div className="max-w-xl mx-auto px-4 py-10 flex flex-col gap-6">
          <div>
            <h2 className="text-base font-semibold text-zinc-800 mb-1">Resume a session</h2>
            <p className="text-sm text-zinc-500">
              Pick up where you left off, or start fresh with a new file.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {(existingFiles ?? []).map((entry) => (
              <SessionRow
                key={entry.file_id}
                entry={entry}
                onResume={() => handleResume(entry)}
                onDelete={() => handleDeleteSession(entry.file_id)}
              />
            ))}
          </ul>
          <button
            onClick={() => setStage('upload')}
            className="self-start text-sm font-medium text-zinc-600 hover:text-zinc-900 underline underline-offset-2 transition-colors"
          >
            Upload a new file instead
          </button>
        </div>
      </div>
    )
  }

  // ─── Upload stage ─────────────────────────────────────────────────────────
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

  // ─── Working stage — two-panel sticky layout ──────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Fixed header */}
      <div className="fixed top-0 inset-x-0 z-40" style={{ height: HEADER_H }}>
        <AppHeader upload={upload} onArtClick={() => setArtModalOpen(true)} onReset={handleReset} />
      </div>

      {/* Album art lightbox */}
      {artModalOpen && upload?.has_art && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
          onClick={() => setArtModalOpen(false)}
        >
          <img
            src={`/upload/${upload.file_id}/art`}
            alt="cover"
            className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Sticky waveform panel */}
      <div
        ref={waveformPanelRef}
        className="fixed inset-x-0 z-30 bg-zinc-900 border-b border-zinc-700 shadow-lg"
        style={{ top: HEADER_H }}
      >
        <WaveformErrorBoundary>
        <WaveformPanel
          fileId={upload!.file_id}
          durationMs={upload!.duration_ms}
          splitPoints={splitPoints}
          splittableCount={splittableCount}
          isDetecting={detectMutation.isPending}
          minSilenceMs={minSilenceMs}
          silenceThreshDb={silenceThreshDb}
          onSplitPointsChange={setSplitPoints}
          onRegionClick={handleRegionClick}
          onAddSplit={handleAddSplit}
          onMinSilenceChange={setMinSilenceMs}
          onSilenceThreshChange={setSilenceThreshDb}
          onRedetect={() => detectMutation.mutate(upload!.file_id)}
          waveformRef={waveformRef}
          focusedIndex={focusedIndex}
          focusedSegmentId={focusedIndex !== null ? (splitMap.get(focusedIndex) ?? null) : null}
          onExitFocus={handleExitFocus}
        />
        </WaveformErrorBoundary>
      </div>

      {/* Scrollable track list / focused view */}
      <main
        className="max-w-5xl mx-auto px-4 flex flex-col gap-4"
        style={{
          paddingTop: HEADER_H + waveformPanelH + 16,
          paddingBottom: splitSegments.length > 0 ? 80 : 24,
        }}
      >
        {detectMutation.isPending && <DetectSkeleton />}
        {splittableCount >= 1 && !detectMutation.isPending && (
          <TrackList
            fileId={upload!.file_id}
            splitPoints={splitPoints}
            initialSplitMap={splitMap}
            onSplitPointsChange={handleSplitPointsChange}
            playingTrack={playingTrack}
            onPlay={(index, startMs, endMs) => {
              if (focusedIndex !== null) {
                setPlayingTrack(index)
                waveformRef.current?.playFrom(0)
              } else {
                setPlayingTrack(index)
                waveformRef.current?.zoomTo(startMs, endMs)
                waveformRef.current?.playFrom(startMs, endMs)
              }
            }}
            onPause={() => {
              setPlayingTrack(null)
              waveformRef.current?.pause()
            }}
            onDeleteTrack={handleDeleteTrack}
            onSplitComplete={(segs) => {
              handleSplitComplete(segs)
              const m = new Map(segs.map((s) => [s.index, s.segment_id]))
              setSplitMap(m)
            }}
            onFocusTrack={(idx) => setFocusedIndex(idx)}
            focusedIndex={focusedIndex}
            onExitFocus={handleExitFocus}
          />
        )}
      </main>

      {/* Sticky export footer */}
      <ExportFooter segments={splitSegments} exporting={exporting} onExport={handleExportAll} />
    </div>
  )
}

// ─── SessionRow ───────────────────────────────────────────────────────────────

function SessionRow({
  entry,
  onResume,
  onDelete,
}: {
  entry: FileEntry
  onResume: () => void
  onDelete: () => void
}) {
  const mins = Math.floor(entry.duration_ms / 60000)
  const secs = Math.floor((entry.duration_ms % 60000) / 1000).toString().padStart(2, '0')
  const label = entry.title || entry.original_name

  return (
    <li className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3">
      {/* Thumbnail / icon */}
      {entry.has_art ? (
        <img
          src={`/upload/${entry.file_id}/art`}
          alt=""
          className="w-10 h-10 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded bg-zinc-100 shrink-0 flex items-center justify-center text-zinc-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800 truncate">{label}</p>
        <p className="text-xs text-zinc-400">
          {entry.artist || 'Unknown artist'} · {mins}:{secs}
        </p>
      </div>

      {/* Actions */}
      <button
        onClick={onResume}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors shrink-0"
      >
        Resume
      </button>
      <button
        onClick={onDelete}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-500 transition-colors shrink-0"
        title="Remove session"
      >
        Delete
      </button>
    </li>
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
