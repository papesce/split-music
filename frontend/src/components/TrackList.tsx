import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import {
  applySliceOne,
  exportSingle,
  getSegment,
  updateBoundaries,
  identifySegment,
  segmentAudioUrl,
  segmentArtUrl,
} from '@/api'
import { msDuration } from '@/utils/trackUtils'
import { TimeInput } from '@/components/TimeInput'
import { TrackListHeader } from '@/components/TrackListHeader'
import { TrackMetadataEditor } from '@/components/TrackMetadataEditor'

// ---------------------------------------------------------------------------
// TrackList
// ---------------------------------------------------------------------------

interface TrackListProps {
  fileId: string
  splitPoints: number[] // includes 0 and total duration as boundaries
  /** Pre-populated index→segmentId map restored from a resumed session */
  initialSplitMap?: Map<number, string>
  onSplitPointsChange: (points: number[]) => void
  onPlay: (index: number, startMs: number, endMs: number) => void
  onPause: () => void
  playingTrack: number | null
  onDeleteTrack: (index: number) => void
  onSplitComplete: (segments: SegmentMeta[]) => void
}

export function TrackList({
  fileId,
  splitPoints,
  initialSplitMap,
  onSplitPointsChange,
  onPlay,
  onPause,
  playingTrack,
  onDeleteTrack,
  onSplitComplete,
}: TrackListProps) {
  const qc = useQueryClient()
  const trackCount = splitPoints.length - 1

  // All indices selected by default; reset when splitPoints array length changes
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(Array.from({ length: trackCount }, (_, i) => i)),
  )
  useEffect(() => {
    setSelected(new Set(Array.from({ length: trackCount }, (_, i) => i)))
  }, [trackCount])

  // index → segmentId for rows that have already been sliced
  const [splitMap, setSplitMap] = useState<Map<number, string>>(
    () => initialSplitMap ?? new Map(),
  )
  const [splitting, setSplitting] = useState(false)
  // tracks progress during bulk split — [currentIdx 1-based, total]
  const [splittingProgress, setSplittingProgress] = useState<[number, number]>([0, 0])
  const [identifyingAll, setIdentifyingAll] = useState(false)
  const [splitErrors, setSplitErrors] = useState<string[]>([])

  // On resume: if we have a pre-populated splitMap, load their metadata and
  // notify the parent so the export footer is ready immediately.
  useEffect(() => {
    if (!initialSplitMap || initialSplitMap.size === 0) return
    collectSegments(initialSplitMap).then(onSplitComplete).catch(() => {/* ignore */})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount

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
    setSelected(allSelected ? new Set() : new Set(Array.from({ length: trackCount }, (_, i) => i)))

  const collectSegments = useCallback(
    (map: Map<number, string>): Promise<SegmentMeta[]> =>
      Promise.all(Array.from(map.values()).map((sid) => getSegment(sid))),
    [],
  )

  const handleSplitAll = async () => {
    setSplitting(true)
    setSplitErrors([])
    const nextMap = new Map(splitMap)
    const pending = Array.from({ length: trackCount }, (_, i) => i).filter(
      (i) => selected.has(i) && !nextMap.has(i),
    )
    setSplittingProgress([1, pending.length])
    const errors: string[] = []
    for (let idx = 0; idx < pending.length; idx++) {
      const i = pending[idx] as number
      setSplittingProgress([idx + 1, pending.length])
      try {
        const startMs = splitPoints[i] as number
        const endMs = splitPoints[i + 1] as number
        const info = await applySliceOne(fileId, i, startMs, endMs)
        nextMap.set(i, info.segment_id)
        setSplitMap(new Map(nextMap))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[split] Track ${i + 1} failed:`, err)
        errors.push(`Track ${i + 1}: ${msg}`)
      }
    }
    setSplitting(false)
    setSplittingProgress([0, 0])
    if (errors.length > 0) setSplitErrors(errors)
    const segs = await collectSegments(nextMap)
    onSplitComplete(segs)
  }

  const handleIdentifyAll = async () => {
    setIdentifyingAll(true)
    for (const sid of splitMap.values()) {
      try {
        await identifySegment(sid)
        qc.invalidateQueries({ queryKey: ['segment', sid] })
      } catch (err) {
        console.error(`[identify] Segment ${sid} failed:`, err)
        // continue on failure
      }
    }
    setIdentifyingAll(false)
  }

  const handleRowSplit = useCallback(
    async (index: number, segmentId: string) => {
      setSplitMap((prev) => {
        const next = new Map(prev).set(index, segmentId)
        collectSegments(next).then(onSplitComplete)
        return next
      })
    },
    [collectSegments, onSplitComplete],
  )

  return (
    <section className="flex flex-col gap-3 pb-20">
      {splitErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold mb-1">Some tracks failed to split:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {splitErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <TrackListHeader
        trackCount={trackCount}
        selectedCount={selectedCount}
        allSelected={allSelected}
        noneSelected={noneSelected}
        splitMapSize={splitMap.size}
        identifyingAll={identifyingAll}
        splitting={splitting}
        allDone={allDone}
        pendingCount={pendingCount}
        splittingProgress={splittingProgress}
        onToggleAll={toggleAll}
        onIdentifyAll={handleIdentifyAll}
        onSplitAll={handleSplitAll}
      />

      <div className="flex flex-col gap-3">
        {splitPoints.slice(0, -1).map((startMs, i) => {
          const endMs = splitPoints[i + 1] ?? startMs
          return (
            <TrackRow
              key={`${fileId}-${i}`}
              id={`track-row-${i}`}
              fileId={fileId}
              index={i}
              startMs={startMs}
              endMs={endMs}
              selected={selected.has(i)}
              segmentId={splitMap.get(i) ?? null}
              isPlaying={playingTrack === i}
              onToggleSelect={() => toggleIndex(i)}
              onSplit={(sid) => handleRowSplit(i, sid)}
              onBoundariesChange={(newStart, newEnd) => {
                const updated = [...splitPoints]
                updated[i] = newStart
                updated[i + 1] = newEnd
                onSplitPointsChange(updated)
              }}
              onDelete={() => onDeleteTrack(i)}
              onPlay={() => onPlay(i, startMs, endMs)}
              onPause={onPause}
            />
          )
        })}
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
  isPlaying: boolean
  onToggleSelect: () => void
  onSplit: (segmentId: string) => void
  onBoundariesChange: (startMs: number, endMs: number) => void
  onDelete: () => void
  onPlay: () => void
  onPause: () => void
}

function TrackRow({
  id,
  fileId,
  index,
  startMs,
  endMs,
  selected,
  segmentId,
  isPlaying,
  onToggleSelect,
  onSplit,
  onBoundariesChange,
  onDelete,
  onPlay,
  onPause,
}: TrackRowProps) {
  const qc = useQueryClient()
  const isSplit = segmentId !== null

  const [expanded, setExpanded] = useState(true)

  const { data: seg } = useQuery<SegmentMeta>({
    queryKey: ['segment', segmentId],
    queryFn: () => getSegment(segmentId as string),
    enabled: isSplit,
  })

  const [fields, setFields] = useState({
    title: '',
    artist: '',
    album: '',
    track: '',
    year: '',
    genre: '',
  })
  const [lyrics, setLyrics] = useState('')

  useEffect(() => {
    if (!seg) return
    setFields({
      title: seg.title,
      artist: seg.artist,
      album: seg.album,
      track: seg.track,
      year: seg.year,
      genre: seg.genre,
    })
    setLyrics(seg.lyrics)
    if (seg.title && seg.artist) setExpanded(false)
  }, [seg])

  // Debounced boundary re-slice
  const boundaryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boundaryMutation = useMutation({
    mutationFn: ({ s, e }: { s: number; e: number }) => updateBoundaries(segmentId as string, s, e),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
    onError: (err) => console.error(`[boundaries] Segment ${segmentId} re-slice failed:`, err),
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
    [isSplit, onBoundariesChange, boundaryMutation],
  )

  const identifyMutation = useMutation({
    mutationFn: () => identifySegment(segmentId as string),
    onError: (err) => console.error(`[identify] Segment ${segmentId} failed:`, err),
    onSuccess: (result) => {
      if (!result.available) return
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
      if (result.mbid) {
        setTimeout(() => qc.invalidateQueries({ queryKey: ['segment', segmentId] }), 4000)
      }
    },
  })

  const splitMutation = useMutation({
    mutationFn: () => applySliceOne(fileId, index, startMs, endMs),
    onSuccess: (info) => onSplit(info.segment_id),
    onError: (err) => console.error(`[split] Track ${index + 1} (${startMs}–${endMs}ms) failed:`, err),
  })

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
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 select-none">
        {/* Checkbox */}
        <div
          onClick={onToggleSelect}
          className="shrink-0 cursor-pointer"
          title={selected ? 'Deselect track' : 'Select track'}
        >
          <div
            className={[
              'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
              selected
                ? 'bg-blue-600 border-blue-600'
                : 'bg-white border-zinc-300 hover:border-zinc-400',
            ].join(' ')}
          >
            {selected && (
              <svg
                className="w-2.5 h-2.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Art thumbnail */}
        <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
          {isSplit && seg?.has_art ? (
            <img
              src={segmentArtUrl(segmentId as string)}
              alt="cover"
              className="w-full h-full object-cover"
            />
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
              {isSplit && fields.title ? fields.title : `Track ${index + 1}`}
            </p>
            {isDone && !expanded && fields.artist && (
              <span className="text-xs text-zinc-400 truncate hidden sm:inline">
                {fields.artist}
              </span>
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
            {boundaryMutation.isPending && (
              <span className="ml-1 text-blue-400 text-xs">re-slicing…</span>
            )}
          </div>
        </div>

        {/* Play/Pause button */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          title={isPlaying ? 'Pause' : 'Preview in waveform'}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
        >
          {isPlaying ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.34-5.89a1.5 1.5 0 000-2.54L6.3 2.84z" />
            </svg>
          )}
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 11 5 11a6 6 0 0 1 12 0z"
              />
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
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
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Audio player (only after splitting and once segment metadata is loaded,
          so the audio file is fully written before the browser tries to read it) */}
      {isSplit && expanded && seg && (
        <div className="px-4 pb-2">
          <audio
            key={`${segmentId}-${seg.start_ms}-${seg.end_ms}`}
            src={segmentAudioUrl(segmentId as string)}
            controls
            className="h-8 w-full"
          />
        </div>
      )}

      {/* Inline metadata editor (only after splitting, collapsible) */}
      {isSplit && expanded && segmentId && (
        <TrackMetadataEditor
          segmentId={segmentId}
          seg={seg}
          fields={fields}
          lyrics={lyrics}
          onFieldsChange={setFields}
          onLyricsChange={setLyrics}
        />
      )}
    </div>
  )
}
