import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import { getSegment, updateSegment, uploadArt, transcribeSegment, segmentAudioUrl, segmentArtUrl } from '@/api'

interface Props {
  segmentId: string
  index: number
}

const FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'track', label: 'Track #' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
] as const

export function SegmentCard({ segmentId, index }: Props) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const { data: seg } = useQuery<SegmentMeta>({
    queryKey: ['segment', segmentId],
    queryFn: () => getSegment(segmentId),
  })

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<SegmentMeta>) => updateSegment(segmentId, patch),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
  })

  const artMutation = useMutation({
    mutationFn: (file: File) => uploadArt(segmentId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segment', segmentId] }),
  })

  const transcribeMutation = useMutation({
    mutationFn: () => transcribeSegment(segmentId),
    onSuccess: (lyrics) => {
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, lyrics }))
    },
  })

  if (!seg) return <div className="h-16 bg-zinc-100 rounded-xl animate-pulse" />

  const duration = msToTime(seg.end_ms - seg.start_ms)

  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Art thumbnail */}
        <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0">
          {seg.has_art ? (
            <img
              src={`${segmentArtUrl(segmentId)}?t=${Date.now()}`}
              alt="cover"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-300">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
              </svg>
            </div>
          )}
        </div>

        {/* Title / meta */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-zinc-800 text-sm truncate">
            {seg.title || `Track ${index + 1}`}
          </p>
          <p className="text-xs text-zinc-400">{seg.artist || '—'} · {duration}</p>
        </div>

        {/* Preview player */}
        <audio
          src={segmentAudioUrl(segmentId)}
          controls
          className="h-8 w-40 shrink-0"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-4 flex flex-col gap-4 bg-zinc-50">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FIELDS.map(({ key, label }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">{label}</span>
                <input
                  className="px-2 py-1.5 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue={seg[key]}
                  onBlur={(e) => saveMutation.mutate({ [key]: e.target.value })}
                />
              </label>
            ))}
          </div>

          {/* Cover art */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500 w-16 shrink-0">Cover art</span>
            {seg.has_art && (
              <img
                src={`${segmentArtUrl(segmentId)}?t=${Date.now()}`}
                alt="cover"
                className="w-14 h-14 rounded object-cover border border-zinc-200"
              />
            )}
            <label className="cursor-pointer px-3 py-1.5 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors">
              {artMutation.isPending ? 'Uploading…' : 'Upload image'}
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) artMutation.mutate(file)
                }}
              />
            </label>
          </div>

          {/* Lyrics */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Lyrics</span>
              <button
                onClick={() => transcribeMutation.mutate()}
                disabled={transcribeMutation.isPending}
                className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {transcribeMutation.isPending ? 'Transcribing…' : '✦ Transcribe with Whisper'}
              </button>
            </div>
            <textarea
              className="w-full h-28 px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              defaultValue={seg.lyrics}
              placeholder="No lyrics yet…"
              onBlur={(e) => saveMutation.mutate({ lyrics: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}
