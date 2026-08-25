import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import { getSegment, updateSegment, uploadArt, transcribeSegment, exportSingle, segmentAudioUrl, segmentArtUrl } from '@/api'

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
      {/* ── Top row: art · title · chevron ── */}
      <div
        className="flex items-center gap-3 px-4 pt-3 pb-2 cursor-pointer hover:bg-zinc-50 transition-colors"
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

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* ── Action row: player · YouTube · download ── */}
      <div className="flex items-center gap-2 px-4 pb-3" onClick={(e) => e.stopPropagation()}>
        <audio
          src={segmentAudioUrl(segmentId)}
          controls
          className="h-8 flex-1 min-w-0"
        />

        {/* Search on YouTube */}
        <a
          href={youtubeSearchUrl(seg)}
          target="_blank"
          rel="noopener noreferrer"
          title="Search on YouTube"
          className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M23.498 6.186a2.994 2.994 0 0 0-2.107-2.117C19.545 3.6 12 3.6 12 3.6s-7.545 0-9.391.469A2.994 2.994 0 0 0 .502 6.186 31.33 31.33 0 0 0 0 12a31.33 31.33 0 0 0 .502 5.814 2.994 2.994 0 0 0 2.107 2.117C4.455 20.4 12 20.4 12 20.4s7.545 0 9.391-.469a2.994 2.994 0 0 0 2.107-2.117A31.33 31.33 0 0 0 24 12a31.33 31.33 0 0 0-.502-5.814zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z"/>
          </svg>
        </a>

        {/* Download single */}
        <button
          title="Download this track as MP3"
          onClick={() => exportSingle(seg)}
          className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
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

function youtubeSearchUrl(seg: SegmentMeta): string {
  const parts = [seg.artist, seg.title].filter(Boolean)
  const query = parts.length ? parts.join(' ') : `Track ${seg.index + 1}`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}
