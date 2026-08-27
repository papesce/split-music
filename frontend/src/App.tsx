import { useCallback, useEffect, useRef, useState } from 'react'
import { exportAllZip, saveSplitPoints } from '@/api'
import { FileUpload } from '@/components/FileUpload'
import { type WaveformHandle } from '@/components/Waveform'
import { TrackList } from '@/components/TrackList'
import { AppHeader, AppIcon } from '@/components/AppHeader'
import { WaveformPanel } from '@/components/WaveformPanel'
import { ExportFooter } from '@/components/ExportFooter'
import { WaveformErrorBoundary } from '@/components/WaveformErrorBoundary'
import { useFileSessionState } from '@/hooks/useFileSessionState'
import type { FileEntry } from '@/types'

const HEADER_H = 65

export default function App() {
  const session = useFileSessionState()
  const waveformRef = useRef<WaveformHandle>(null)
  const waveformPanelRef = useRef<HTMLDivElement>(null)
  const [waveformPanelH, setWaveformPanelH] = useState(232)
  const [artModalOpen, setArtModalOpen] = useState(false)
  const [playingTrack, setPlayingTrack] = useState<number | null>(null)
  const pendingPlayRef = useRef<{ index: number; startMs: number; endMs?: number } | null>(null)
  const playingTrackRef = useRef<number | null>(null)
  playingTrackRef.current = playingTrack
  const [exporting, setExporting] = useState(false)

  const handleWaveStateChange = useCallback((playing: boolean, reason: string) => {
    if (!playing) {
      if (reason === 'pause' || reason === 'finish' || reason === 'stopAt' || reason === 'stop') {
        pendingPlayRef.current = null
        setPlayingTrack(null)
      } else if (reason === 'seek') {
        setPlayingTrack(null)
      }
    } else {
      // deferred play succeeded – if we had a pending track play, commit it
      if (pendingPlayRef.current) {
        const p = pendingPlayRef.current
        pendingPlayRef.current = null
        setPlayingTrack(p.index)
      }
    }
  }, [])

  const handleTogglePlay = useCallback(async () => {
    const ws = waveformRef.current
    if (!ws) return
    if (ws.isPlaying()) {
      ws.pause()
      setPlayingTrack(null)
      pendingPlayRef.current = null
    } else {
      // global play from cursor – not track-bounded
      const cur = ws.getCursorMs() ?? 0
      const ok = await ws.playFrom(cur)
      if (ok) setPlayingTrack(null)
      // if not ready, we deliberately keep playingTrack null (global play pending, no row highlight)
    }
  }, [])

  const handleSeekPause = useCallback(() => {
    setPlayingTrack(null)
    pendingPlayRef.current = null
  }, [])

  // measure waveform panel height
  useEffect(() => {
    const el = waveformPanelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWaveformPanelH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [session.stage])

  const handleExitFocus = useCallback(() => {
    session.setFocusedIndex(null)
    waveformRef.current?.resetZoom()
  }, [session])

  const handleDeleteTrack = useCallback(
    (index: number, mode: 'mergePrev' | 'mergeNext' | 'discard' = 'mergeNext') => {
      // clear/stale playingTrack
      if (playingTrackRef.current !== null) {
        if (playingTrackRef.current === index) { setPlayingTrack(null); pendingPlayRef.current = null; waveformRef.current?.pause() }
        else if (playingTrackRef.current > index) setPlayingTrack((v) => (v !== null ? v - 1 : v))
      }
      // adjust focused index
      if (session.focusedIndex !== null) {
        if (session.focusedIndex === index) session.setFocusedIndex(null)
        else if (session.focusedIndex > index) session.setFocusedIndex(session.focusedIndex - 1)
      }
      const prev = session.splitPoints
      const next = [...prev]
      if (mode === 'mergePrev') {
        if (index === 0) return
        next.splice(index, 1)
      } else if (mode === 'mergeNext') {
        if (index >= prev.length - 2) return
        next.splice(index + 1, 1)
      } else {
        if (prev.length <= 2) return
        const gap = (prev[index + 1] as number) - (prev[index] as number)
        next.splice(index + 1, 1)
        for (let i = index + 1; i < next.length; i++) next[i] = (next[i] as number) - gap
      }
      session.setSplitPoints(next)
      if (session.upload) {
        saveSplitPoints(session.upload.file_id, next).catch((err) =>
          console.error('[save-split-points] Failed after delete:', err),
        )
      }
    },
    [session],
  )

  const splittableCount = session.splitPoints.length > 1 ? session.splitPoints.length - 1 : 0
  const waveformReady = !!waveformRef.current?.isReady?.()

  // clear playing on stage/file change and stale index
  useEffect(() => { setPlayingTrack(null); pendingPlayRef.current = null }, [session.upload?.file_id, session.stage])
  useEffect(() => {
    if (playingTrack !== null && playingTrack >= splittableCount) { setPlayingTrack(null); pendingPlayRef.current = null }
  }, [splittableCount, playingTrack])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && session.focusedIndex !== null) {
        e.preventDefault()
        handleExitFocus()
        return
      }
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        handleTogglePlay()
        return
      }
      if (e.code === 'ArrowRight') document.getElementById('waveform-skip-fwd')?.click()
      if (e.code === 'ArrowLeft') document.getElementById('waveform-skip-bwd')?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session.focusedIndex, handleExitFocus, handleTogglePlay])

  const handleExportAll = async () => {
    if (!session.upload || session.splitSegments.length === 0) return
    setExporting(true)
    try {
      await exportAllZip(session.upload.file_id, session.splitSegments)
    } finally {
      setExporting(false)
    }
  }

  if (session.stage === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
      </div>
    )
  }

  if (session.stage === 'resume') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-2">
          <AppIcon />
          <h1 className="text-lg font-semibold">Split Music</h1>
        </header>
        <div className="max-w-xl mx-auto px-4 py-10 flex flex-col gap-6">
          <div>
            <h2 className="text-base font-semibold text-zinc-800 mb-1">Resume a session</h2>
            <p className="text-sm text-zinc-500">Pick up where you left off, or start fresh with a new file.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {(session.existingFiles ?? []).map((entry) => (
              <SessionRow
                key={entry.file_id}
                entry={entry}
                onResume={() => session.handleResume(entry)}
                onDelete={() => session.handleDeleteSession(entry.file_id)}
              />
            ))}
          </ul>
          <button
            onClick={() => session.setStage('upload')}
            className="self-start text-sm font-medium text-zinc-600 hover:text-zinc-900 underline underline-offset-2 transition-colors"
          >
            Upload a new file instead
          </button>
        </div>
      </div>
    )
  }

  if (session.stage === 'upload') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-2">
          <AppIcon />
          <h1 className="text-lg font-semibold">Split Music</h1>
        </header>
        <FileUpload onUploaded={session.handleUploaded} />
      </div>
    )
  }

  // working stage
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="fixed top-0 inset-x-0 z-40" style={{ height: HEADER_H }}>
        <AppHeader
          upload={session.upload}
          onArtClick={() => setArtModalOpen(true)}
          onReset={session.handleReset}
        />
      </div>

      {artModalOpen && session.upload?.has_art && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setArtModalOpen(false)}>
          <img
            src={`/upload/${session.upload.file_id}/art`}
            alt="cover"
            className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div
        ref={waveformPanelRef}
        className="fixed inset-x-0 z-30 bg-zinc-900 border-b border-zinc-700 shadow-lg"
        style={{ top: HEADER_H }}
      >
        <WaveformErrorBoundary>
          <WaveformPanel
            fileId={session.upload!.file_id}
            durationMs={session.upload!.duration_ms}
            splitPoints={session.splitPoints}
            splittableCount={splittableCount}
            isDetecting={session.detectMutation.isPending}
            minSilenceMs={session.minSilenceMs}
            silenceThreshDb={session.silenceThreshDb}
            onSplitPointsChange={session.setSplitPoints}
            onRegionClick={(idx) => document.getElementById(`track-row-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            onAddSplit={session.handleAddSplit}
            onMinSilenceChange={session.setMinSilenceMs}
            onSilenceThreshChange={session.setSilenceThreshDb}
            onRedetect={() => session.detectMutation.mutate(session.upload!.file_id)}
            waveformRef={waveformRef}
            focusedIndex={session.focusedIndex}
            focusedSegmentId={session.focusedIndex !== null ? (session.splitMap.get(session.focusedIndex) ?? null) : null}
            onExitFocus={handleExitFocus}
            onWaveStateChange={handleWaveStateChange}
            onTogglePlay={handleTogglePlay}
            onSeekPause={handleSeekPause}
          />
        </WaveformErrorBoundary>
      </div>

      <main
        className="max-w-5xl mx-auto px-4 flex flex-col gap-4"
        style={{
          paddingTop: HEADER_H + waveformPanelH + 16,
          paddingBottom: session.splitSegments.length > 0 ? 80 : 24,
        }}
      >
        {session.detectMutation.isPending && <DetectSkeleton />}
        {splittableCount >= 1 && !session.detectMutation.isPending && (
          <TrackList
            fileId={session.upload!.file_id}
            splitPoints={session.splitPoints}
            initialSplitMap={session.splitMap}
            onSplitPointsChange={session.handleSplitPointsChange}
            playingTrack={playingTrack}
            waveformReady={waveformReady}
            onPlay={async (index, startMs, endMs) => {
              const ws = waveformRef.current
              if (!ws) return
              if (!ws.isReady()) {
                pendingPlayRef.current = session.focusedIndex !== null ? { index, startMs: 0 } : { index, startMs, endMs }
                // don't set playing yet – will be committed on ready/play callback
                ws.playFrom(session.focusedIndex !== null ? 0 : startMs, session.focusedIndex !== null ? undefined : endMs)
                return
              }
              if (session.focusedIndex !== null) {
                const ok = await ws.playFrom(0)
                if (ok) { setPlayingTrack(index); pendingPlayRef.current = null } else { pendingPlayRef.current = { index, startMs: 0 } }
              } else {
                ws.zoomTo(startMs, endMs)
                const ok = await ws.playFrom(startMs, endMs)
                if (ok) { setPlayingTrack(index); pendingPlayRef.current = null } else { pendingPlayRef.current = { index, startMs, endMs } }
              }
            }}
            onPause={() => {
              pendingPlayRef.current = null
              setPlayingTrack(null)
              waveformRef.current?.pause()
            }}
            onStop={() => {
              pendingPlayRef.current = null
              setPlayingTrack(null)
              waveformRef.current?.stop()
            }}
            onDeleteTrack={handleDeleteTrack}
            onSplitComplete={(segs) => {
              session.setSplitSegments(segs)
              const m = new Map(segs.map((s) => [s.index, s.segment_id]))
              session.setSplitMap(m)
            }}
            onFocusTrack={(idx) => session.setFocusedIndex(idx)}
            focusedIndex={session.focusedIndex}
            onExitFocus={handleExitFocus}
          />
        )}
      </main>

      <ExportFooter segments={session.splitSegments} exporting={exporting} onExport={handleExportAll} />
    </div>
  )
}

function SessionRow({ entry, onResume, onDelete }: { entry: FileEntry; onResume: () => void; onDelete: () => void }) {
  const mins = Math.floor(entry.duration_ms / 60000)
  const secs = Math.floor((entry.duration_ms % 60000) / 1000).toString().padStart(2, '0')
  const label = entry.title || entry.original_name
  return (
    <li className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3">
      {entry.has_art ? (
        <img src={`/upload/${entry.file_id}/art`} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-zinc-100 shrink-0 flex items-center justify-center text-zinc-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800 truncate">{label}</p>
        <p className="text-xs text-zinc-400">
          {entry.artist || 'Unknown artist'} · {mins}:{secs}
        </p>
      </div>
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
