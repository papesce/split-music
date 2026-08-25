import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import {
  applySliceOne,
  exportSingle,
  getSegment,
  updateSegment,
  updateBoundaries,
  uploadArt,
  transcribeSegment,
  identifySegment,
  segmentAudioUrl,
  segmentArtUrl,
} from '@/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function msDuration(startMs: number, endMs: number): string {
  const s = Math.round((endMs - startMs) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

const FIELDS = [
  { key: 'title',  label: 'Title',    size: 'col-span-2 sm:col-span-2' },
  { key: 'artist', label: 'Artist',   size: 'col-span-2 sm:col-span-2' },
  { key: 'album',  label: 'Album',    size: 'col-span-2 sm:col-span-2' },
  { key: 'track',  label: 'Track #',  size: '' },
  { key: 'year',   label: 'Year',     size: '' },
  { key: 'genre',  label: 'Genre',    size: '' },
] as const

// ---------------------------------------------------------------------------
// TrackList
// ---------------------------------------------------------------------------

interface TrackListProps {
  fileId: string
  splitPoints: number[]   // includes 0 and total duration as boundaries
  onSplitPointsChange: (points: number[]) => void
  onPlay: (startMs: number, endMs: number) => void
  onDeleteTrack: (index: number) => void
  onSplitComplete: (segments: SegmentMeta[]) => void
}

export function TrackList({
  fileId,
  splitPoints,
  onSplitPointsChange,
  onPlay,
  onDeleteTrack,
  onSplitComplete,
}: TrackListProps) {
  const qc = useQueryClient()
  const trackCount = splitPoints.length - 1

  // All indices selected by default; reset when splitPoints array length changes
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(Array.from({ length: trackCount }, (_, i) => i))
  )
  useEffect(() => {
    setSelected(new Set(Array.from({ length: trackCount }, (_, i) => i)))
  }, [trackCount])

  // index → segmentId for rows that have already been sliced
  const [splitMap, setSplitMap] = useState<Map<number, string>>(new Map())
  const [splitting, setSplitting] = useState(false)
  // tracks progress during bulk split — [currentIdx 1-based, total]
  const [splittingProgress, setSplittingProgress] = useState<[number, number]>([0, 0])
  // tracks "identify all" in-flight state
  const [identifyingAll, setIdentifyingAll] = useState(false)

  const selectedCount = selected.size
  const allSelected = selectedCount === trackCount
  const noneSelected = selectedCount === 0
  const pendingCount = Array.from(selected).filter((i) => !splitMap.has(i)).length
  const allDone = pendingCount === 0 && splitMap.size > 0

  const toggleIndex = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = () =>
    setSelected(
      allSelected
        ? new Set()
        : new Set(Array.from({ length: trackCount }, (_, i) => i))
    )

  // Collect all current SegmentMeta for the export footer
  const collectSegments = useCallback(
    (map: Map<number, string>): Promise<SegmentMeta[]> => {
      return Promise.all(
        Array.from(map.values()).map((sid) => getSegment(sid))
      )
    },
    []
  )

  const handleSplitAll = async () => {
    setSplitting(true)
    const nextMap = new Map(splitMap)
    const pending = Array.from({ length: trackCount }, (_, i) => i).filter(
      (i) => selected.has(i) && !nextMap.has(i)
    )
    setSplittingProgress([1, pending.length])
    for (let idx = 0; idx < pending.length; idx++) {
      const i = pending[idx]
      setSplittingProgress([idx + 1, pending.length])
      try {
        const info = await applySliceOne(fileId, splitPoints[i], splitPoints[i + 1])
        nextMap.set(i, info.segment_id)
        setSplitMap(new Map(nextMap))
      } catch {
        // individual failure — continue
      }
    }
    setSplitting(false)
    setSplittingProgress([0, 0])
    const segs = await collectSegments(nextMap)
    onSplitComplete(segs)
  }

  const handleIdentifyAll = async () => {
    setIdentifyingAll(true)
    const ids = Array.from(splitMap.values())
    for (const sid of ids) {
      try {
        await identifySegment(sid)
        qc.invalidateQueries({ queryKey: ['segment', sid] })
      } catch {
        // continue on failure
      }
    }
    setIdentifyingAll(false)
  }

  // Keep parent export list in sync whenever a row gets split individually
  const handleRowSplit = useCallback(
    async (index: number, segmentId: string) => {
      setSplitMap((prev) => {
        const next = new Map(prev).set(index, segmentId)
        collectSegments(next).then(onSplitComplete)
        return next
      })
    },
    [collectSegments, onSplitComplete]
  )

  return (
    <section className="flex flex-col gap-3 pb-20">
      {/* ── List header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-zinc-800">
            Tracks <span className="text-zinc-400 font-normal">({trackCount})</span>
          </h2>
          <button
            onClick={toggleAll}
            className="text-xs text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline transition-colors"
          >
            {allSelected ? 'Deselect all' : noneSelected ? 'Select all' : `${selectedCount}/${trackCount} selected`}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Identify all — only visible once at least one row has been split */}
          {splitMap.size > 0 && (
            <button
              onClick={handleIdentifyAll}
              disabled={identifyingAll}
              title="Auto-identify all split tracks via AcoustID"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 text-violet-600 text-sm font-medium hover:bg-violet-50 disabled:opacity-40 transition-colors"
            >
              {identifyingAll ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Identifying…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  Identify all
                </>
              )}
            </button>
          )}

          <button
          onClick={allDone ? undefined : handleSplitAll}
          disabled={splitting || (!allDone && pendingCount === 0)}
          className={[
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-sm font-medium transition-colors',
            allDone
              ? 'bg-green-600 cursor-default'
              : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-40',
          ].join(' ')}
        >
          {splitting ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {`Splitting ${splittingProgress[0]} of ${splittingProgress[1]}…`}
            </>
          ) : allDone ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              All split
            </>
          ) : (
            `Split selected (${pendingCount})`
          )}
        </button>
        </div>
      </div>

      {/* ── Rows ── */}
      <div className="flex flex-col gap-3">
        {splitPoints.slice(0, -1).map((startMs, i) => (
          <TrackRow
            key={`${fileId}-${i}`}
            id={`track-row-${i}`}
            fileId={fileId}
            index={i}
            startMs={startMs}
            endMs={splitPoints[i + 1]}
            selected={selected.has(i)}
            segmentId={splitMap.get(i) ?? null}
            onToggleSelect={() => toggleIndex(i)}
            onSplit={(sid) => handleRowSplit(i, sid)}
            onBoundariesChange={(newStart, newEnd) => {
              const updated = [...splitPoints]
              updated[i] = newStart
              updated[i + 1] = newEnd
              onSplitPointsChange(updated)
            }}
            onDelete={() => onDeleteTrack(i)}
            onPlay={onPlay}
          />
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// TrackRow
// ---------------------------------------------------------------------------

interface TrackRowProps {
  id: string
  fileId: string
  index: number
  startMs: number
  endMs: number
  selected: boolean
  segmentId: string | null
  onToggleSelect: () => void
  onSplit: (segmentId: string) => void
  onBoundariesChange: (startMs: number, endMs: number) => void
  onDelete: () => void
  onPlay: (startMs: number, endMs: number) => void
}

function TrackRow({
  id,
  fileId,
  index,
  startMs,
  endMs,
  selected,
  segmentId,
  onToggleSelect,
  onSplit,
  onBoundariesChange,
  onDelete,
  onPlay,
}: TrackRowProps) {
  const qc = useQueryClient()
  const isSplit = segmentId !== null

  // Collapsed when title+artist are both filled — user can re-expand manually
  const [expanded, setExpanded] = useState(true)

  const { data: seg } = useQuery<SegmentMeta>({
    queryKey: ['segment', segmentId],
    queryFn: () => getSegment(segmentId!),
    enabled: isSplit,
  })

  // Controlled field state — syncs from server on first load
  const [fields, setFields] = useState({
    title: '', artist: '', album: '', track: '', year: '', genre: '',
  })
  const [lyrics, setLyrics] = useState('')

  // Sync controlled state when server data arrives / changes
  useEffect(() => {
    if (!seg) return
    setFields({
      title: seg.title, artist: seg.artist, album: seg.album,
      track: seg.track, year: seg.year, genre: seg.genre,
    })
    setLyrics(seg.lyrics)
    // Auto-collapse when title + artist arrive filled
    if (seg.title && seg.artist) setExpanded(false)
  }, [seg])

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<SegmentMeta>) => updateSegment(segmentId!, patch),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
  })

  // Debounced boundary re-slice
  const boundaryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boundaryMutation = useMutation({
    mutationFn: ({ s, e }: { s: number; e: number }) => updateBoundaries(segmentId!, s, e),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
  })
  const handleBoundaryChange = useCallback(
    (newStart: number, newEnd: number) => {
      onBoundariesChange(newStart, newEnd)
      if (!isSplit) return
      if (boundaryDebounce.current) clearTimeout(boundaryDebounce.current)
      boundaryDebounce.current = setTimeout(() => {
        boundaryMutation.mutate({ s: newStart, e: newEnd })
      }, 400)
    },
    [isSplit, onBoundariesChange, boundaryMutation]
  )

  const artMutation = useMutation({
    mutationFn: (file: File) => uploadArt(segmentId!, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segment', segmentId] }),
  })

  const transcribeMutation = useMutation({
    mutationFn: () => transcribeSegment(segmentId!),
    onSuccess: (text) => {
      setLyrics(text)
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, lyrics: text }))
    },
  })

  const identifyMutation = useMutation({
    mutationFn: () => identifySegment(segmentId!),
    onSuccess: (result) => {
      if (!result.available) return
      // Merge identified fields into controlled state and cache
      const patch: Partial<SegmentMeta> = {}
      const updated = { ...fields }
      for (const k of ['title', 'artist', 'album', 'year'] as const) {
        if (result[k] && !fields[k]) {
          updated[k] = result[k]
          patch[k] = result[k]
        }
      }
      setFields(updated)
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, ...patch }))
      // If there's an MBID, the server starts a background art fetch.
      // Re-invalidate after a short delay so the thumbnail reflects it.
      if (result.mbid) {
        setTimeout(() => qc.invalidateQueries({ queryKey: ['segment', segmentId] }), 4000)
      }
    },
  })

  // Individual split (fallback for rows not covered by the bulk action)
  const splitMutation = useMutation({
    mutationFn: () => applySliceOne(fileId, startMs, endMs),
    onSuccess: (info) => onSplit(info.segment_id),
  })

  // Status badge
  const identifyResult = identifyMutation.data
  const confidence = identifyResult?.confidence ?? 0
  const identified = identifyResult?.available && confidence > 0.6

  const isDone = isSplit && !!fields.title && !!fields.artist

  return (
    <div
      id={id}
      className={[
        'border rounded-xl overflow-hidden bg-white transition-opacity',
        selected ? 'border-zinc-200' : 'border-zinc-100 opacity-40',
      ].join(' ')}
    >
      {/* ── Header row ── */}
      <div className="flex items-center gap-3 px-4 py-3 select-none">

        {/* Checkbox */}
        <div
          onClick={onToggleSelect}
          className="shrink-0 cursor-pointer"
          title={selected ? 'Deselect track' : 'Select track'}
        >
          <div className={[
            'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
            selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-zinc-300 hover:border-zinc-400',
          ].join(' ')}>
            {selected && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {/* Art thumbnail */}
        <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
          {isSplit && seg?.has_art ? (
            <img src={`${segmentArtUrl(segmentId!)}?t=${Date.now()}`} alt="cover" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-5 h-5 text-zinc-300" fill="currentColor" viewBox="0 0 20 20">
              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
            </svg>
          )}
        </div>

        {/* Title / time / status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-medium text-sm text-zinc-800 truncate">
              {(isSplit && fields.title) ? fields.title : `Track ${index + 1}`}
            </p>
            {isDone && !expanded && fields.artist && (
              <span className="text-xs text-zinc-400 truncate hidden sm:inline">{fields.artist}</span>
            )}
            {isSplit && identified && (
              <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">
                ✓ ID'd
              </span>
            )}
            {isSplit && identifyMutation.isPending && (
              <span className="shrink-0 text-[10px] text-zinc-400">identifying…</span>
            )}
            {isSplit && identifyResult && !identified && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                low confidence
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <TimeInput
              valueMs={startMs}
              onCommit={(ms) => handleBoundaryChange(ms, endMs)}
              title="Edit start time"
            />
            <span className="text-zinc-300 text-xs">→</span>
            <TimeInput
              valueMs={endMs}
              onCommit={(ms) => handleBoundaryChange(startMs, ms)}
              title="Edit end time"
            />
            <span className="ml-1 text-zinc-300 text-xs">{msDuration(startMs, endMs)}</span>
            {boundaryMutation.isPending && <span className="ml-1 text-blue-400 text-xs">re-slicing…</span>}
          </div>
        </div>

        {/* Play button */}
        <button
          onClick={() => onPlay(startMs, endMs)}
          title="Preview in waveform"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.34-5.89a1.5 1.5 0 000-2.54L6.3 2.84z" />
          </svg>
        </button>

        {/* Identify button (after split) */}
        {isSplit && (
          <button
            onClick={() => identifyMutation.mutate()}
            disabled={identifyMutation.isPending}
            title="Auto-identify with AcoustID"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 11 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </button>
        )}

        {/* Download button (after split) */}
        {isSplit && seg && (
          <button
            onClick={() => exportSingle(seg)}
            title="Download as MP3"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        )}

        {/* Split button (before split) */}
        {!isSplit && (
          <button
            onClick={() => splitMutation.mutate()}
            disabled={splitMutation.isPending || !selected}
            title={selected ? 'Split this track' : 'Select track first'}
            className="shrink-0 px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-500 text-xs hover:bg-zinc-50 disabled:opacity-40 transition-colors"
          >
            {splitMutation.isPending ? 'Splitting…' : 'Split'}
          </button>
        )}

        {/* Chevron expand/collapse (only when done) */}
        {isDone && (
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-zinc-300 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}

        {/* × Remove this track boundary */}
        <button
          onClick={onDelete}
          title="Remove this track (merges with next)"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Audio player (only after splitting) ── */}
      {isSplit && expanded && (
        <div className="px-4 pb-2">
          <audio src={segmentAudioUrl(segmentId!)} controls className="h-8 w-full" />
        </div>
      )}

      {/* ── Inline metadata editor (only after splitting, collapsible) ── */}
      {isSplit && expanded && (
        <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
          {/* Metadata fields grid — controlled inputs, save on blur */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {FIELDS.map(({ key, label, size }) => (
              <label key={key} className={`flex flex-col gap-0.5 ${size || 'sm:col-span-2'}`}>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
                <input
                  className="px-2 py-1.5 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={fields[key]}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                  onBlur={(e) => saveMutation.mutate({ [key]: e.target.value })}
                />
              </label>
            ))}
          </div>

          {/* Cover art row */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide w-14 shrink-0">Cover art</span>
            {seg?.has_art && (
              <img
                src={`${segmentArtUrl(segmentId!)}?t=${Date.now()}`}
                alt="cover"
                className="w-12 h-12 rounded object-cover border border-zinc-200"
              />
            )}
            <label className="cursor-pointer px-3 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors">
              {artMutation.isPending ? 'Uploading…' : 'Upload image'}
              <input
                type="file" accept="image/jpeg,image/png" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) artMutation.mutate(f) }}
              />
            </label>
          </div>

          {/* Lyrics */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">Lyrics</span>
              <button
                onClick={() => transcribeMutation.mutate()}
                disabled={transcribeMutation.isPending}
                className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {transcribeMutation.isPending ? 'Transcribing…' : '✦ Whisper'}
              </button>
            </div>
            <textarea
              className="w-full h-24 px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={lyrics}
              placeholder="No lyrics yet…"
              onChange={(e) => setLyrics(e.target.value)}
              onBlur={(e) => saveMutation.mutate({ lyrics: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimeInput — editable mm:ss / h:mm:ss field
// ---------------------------------------------------------------------------

interface TimeInputProps {
  valueMs: number
  onCommit: (ms: number) => void
  title?: string
}

function TimeInput({ valueMs, onCommit, title }: TimeInputProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')

  const display = msToTime(valueMs)

  const startEdit = () => {
    setRaw(display)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const ms = parseTimeInput(raw)
    if (ms !== null && ms !== valueMs) {
      onCommit(ms)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.currentTarget.blur(); return }
    if (e.key === 'Escape') { setEditing(false); return }
    // ↑/↓ nudge by 1 second
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      onCommit(valueMs + 1000)
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onCommit(Math.max(0, valueMs - 1000))
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="w-16 px-1 py-0 rounded border border-blue-400 text-xs text-zinc-800 tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder="m:ss"
        title={title}
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="px-1 py-0 rounded text-xs text-zinc-500 tabular-nums hover:bg-zinc-100 hover:text-zinc-800 transition-colors font-mono"
      title={`${title ?? 'Edit time'} — click to edit, ↑↓ to nudge ±1s`}
    >
      {display}
    </button>
  )
}

/** Parse "m:ss", "h:mm:ss", or plain seconds into milliseconds. Returns null on invalid input. */
function parseTimeInput(s: string): number | null {
  const trimmed = s.trim()
  // Plain seconds: "142"
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000
  // m:ss or h:mm:ss
  const parts = trimmed.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 2) {
    const [m, sec] = parts
    return (m * 60 + sec) * 1000
  }
  if (parts.length === 3) {
    const [h, m, sec] = parts
    return (h * 3600 + m * 60 + sec) * 1000
  }
  return null
}

