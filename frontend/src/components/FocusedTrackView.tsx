import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta, DraftState } from '@/types'
import { getSegment, updateBoundaries, identifySegment, segmentAudioUrl, segmentArtUrl, applySliceOne } from '@/api'
import { msDuration } from '@/utils/trackUtils'
import { TimeInput } from '@/components/TimeInput'
import { TrackMetadataEditor } from '@/components/TrackMetadataEditor'
import { DraftMetadataEditor } from '@/components/DraftMetadataEditor'

interface Props {
  fileId: string
  index: number
  startMs: number
  endMs: number
  segmentId: string | null
  draft?: DraftState | undefined
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onBoundariesChange: (startMs: number, endMs: number) => void
  onExit: () => void
  onSplit: (segmentId: string) => void
}

export function FocusedTrackView({
  fileId,
  index,
  startMs,
  endMs,
  segmentId,
  draft,
  isPlaying,
  onPlay,
  onPause,
  onBoundariesChange,
  onExit,
  onSplit,
}: Props) {
  const qc = useQueryClient()
  const isSplit = segmentId !== null

  const { data: seg } = useQuery<SegmentMeta>({
    queryKey: ['segment', segmentId],
    queryFn: () => getSegment(segmentId as string),
    enabled: isSplit,
  })

  const [fields, setFields] = useState({ title: '', artist: '', album: '', track: '', year: '', genre: '' })
  const [lyrics, setLyrics] = useState('')
  useEffect(() => {
    if (!seg) return
    setFields({ title: seg.title, artist: seg.artist, album: seg.album, track: seg.track, year: seg.year, genre: seg.genre })
    setLyrics(seg.lyrics)
  }, [seg])

  const boundaryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boundaryMutation = useMutation({
    mutationFn: ({ s, e }: { s: number; e: number }) => updateBoundaries(segmentId as string, s, e),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
  })
  const handleBoundaryChange = useCallback(
    (newStart: number, newEnd: number) => {
      onBoundariesChange(newStart, newEnd)
      if (!isSplit) return
      if (boundaryDebounce.current) clearTimeout(boundaryDebounce.current)
      boundaryDebounce.current = setTimeout(() => boundaryMutation.mutate({ s: newStart, e: newEnd }), 400)
    },
    [isSplit, onBoundariesChange, boundaryMutation],
  )

  const identifyMutation = useMutation({
    mutationFn: () => identifySegment(segmentId as string),
    onSuccess: (result) => {
      if (!result.available) return
      const patch: Partial<SegmentMeta> = {}
      const updated = { ...fields }
      for (const k of ['title', 'artist', 'album', 'year'] as const) {
        if (result[k] && !fields[k]) { updated[k] = result[k]; patch[k] = result[k] }
      }
      setFields(updated)
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, ...patch }))
    },
  })

  const splitMutation = useMutation({
    mutationFn: () => applySliceOne(fileId, index, startMs, endMs),
    onSuccess: (info) => onSplit(info.segment_id),
  })

  return (
    <section className="flex flex-col gap-3 pb-20">

      <div className="border rounded-xl overflow-hidden bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
            {isSplit && seg?.has_art ? (
              <img src={segmentArtUrl(segmentId as string)} alt="cover" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-5 h-5 text-zinc-300" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-zinc-800 truncate">{isSplit ? (fields.title || seg?.title || `Track ${index + 1}`) : (draft?.title || `Track ${index + 1}`)}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <TimeInput valueMs={startMs} onCommit={(ms) => handleBoundaryChange(ms, endMs)} title="Edit start time" />
              <span className="text-zinc-300 text-xs">→</span>
              <TimeInput valueMs={endMs} onCommit={(ms) => handleBoundaryChange(startMs, ms)} title="Edit end time" />
              <span className="ml-1 text-zinc-300 text-xs">{msDuration(startMs, endMs)}</span>
              {boundaryMutation.isPending && <span className="ml-1 text-blue-400 text-xs">re-slicing…</span>}
            </div>
          </div>
          <button onClick={isPlaying ? onPause : onPlay} title={isPlaying ? 'Pause' : 'Preview'} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.34-5.89a1.5 1.5 0 000-2.54L6.3 2.84z" /></svg>
            )}
          </button>
          {isSplit && (
            <button onClick={() => identifyMutation.mutate()} disabled={identifyMutation.isPending} title="Auto-identify" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-40">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 11 5 11a6 6 0 0 1 12 0z" /></svg>
            </button>
          )}
          {!isSplit && (
            <button onClick={() => splitMutation.mutate()} disabled={splitMutation.isPending} className="shrink-0 px-3 py-1.5 rounded-lg border border-zinc-200 text-xs hover:bg-zinc-50 disabled:opacity-40">
              {splitMutation.isPending ? 'Splitting…' : 'Split'}
            </button>
          )}
          <button onClick={onExit} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Exit focus">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {isSplit && seg && (
          <div className="px-4 pb-2">
            <audio key={`${segmentId}-${seg.start_ms}-${seg.end_ms}`} src={segmentAudioUrl(segmentId as string)} controls className="h-8 w-full" />
          </div>
        )}

        {isSplit && segmentId ? (
          <TrackMetadataEditor segmentId={segmentId} seg={seg} fields={fields} lyrics={lyrics} onFieldsChange={setFields} onLyricsChange={setLyrics} focused />
        ) : (
          <DraftMetadataEditor fileId={fileId} idx={index} draft={draft} startMs={startMs} endMs={endMs} focused />
        )}
      </div>
    </section>
  )
}
