import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import { updateSegment, uploadArt, transcribeSegment } from '@/api'
import { segmentArtUrl } from '@/api'
import { TRACK_FIELDS } from '@/utils/trackUtils'

interface Props {
  segmentId: string
  seg: SegmentMeta | undefined
  fields: {
    title: string
    artist: string
    album: string
    track: string
    year: string
    genre: string
  }
  lyrics: string
  onFieldsChange: (fields: Props['fields']) => void
  onLyricsChange: (lyrics: string) => void
}

export function TrackMetadataEditor({
  segmentId,
  seg,
  fields,
  lyrics,
  onFieldsChange,
  onLyricsChange,
}: Props) {
  const qc = useQueryClient()

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
    onSuccess: (text) => {
      onLyricsChange(text)
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, lyrics: text }))
    },
  })

  return (
    <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
      {/* Metadata fields grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {TRACK_FIELDS.map(({ key, label, size }) => (
          <label key={key} className={`flex flex-col gap-0.5 ${size || 'sm:col-span-2'}`}>
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">
              {label}
            </span>
            <input
              className="px-2 py-1.5 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={fields[key]}
              onChange={(e) => onFieldsChange({ ...fields, [key]: e.target.value })}
              onBlur={(e) => saveMutation.mutate({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      {/* Cover art row */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide w-14 shrink-0">
          Cover art
        </span>
        {seg?.has_art && (
          <img
            src={`${segmentArtUrl(segmentId)}?t=${Date.now()}`}
            alt="cover"
            className="w-12 h-12 rounded object-cover border border-zinc-200"
          />
        )}
        <label className="cursor-pointer px-3 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors">
          {artMutation.isPending ? 'Uploading…' : 'Upload image'}
          <input
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) artMutation.mutate(f)
            }}
          />
        </label>
      </div>

      {/* Lyrics */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">
            Lyrics
          </span>
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
          onChange={(e) => onLyricsChange(e.target.value)}
          onBlur={(e) => saveMutation.mutate({ lyrics: e.target.value })}
        />
      </div>
    </div>
  )
}
