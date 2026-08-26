import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { DraftState } from '@/types'
import { patchDraft, transcribePreview } from '@/api'
import { TRACK_FIELDS } from '@/utils/trackUtils'

interface Props {
  fileId: string
  idx: number
  draft: DraftState | undefined
  startMs: number
  endMs: number
  onDraftChange?: (d: DraftState) => void
}

export function DraftMetadataEditor({ fileId, idx, draft, startMs, endMs }: Props) {
  const qc = useQueryClient()
  const [fields, setFields] = useState({
    title: draft?.title ?? '',
    artist: draft?.artist ?? '',
    album: draft?.album ?? '',
    track: draft?.track ?? String(idx + 1),
    year: draft?.year ?? '',
    genre: draft?.genre ?? '',
  })
  const [lyrics, setLyrics] = useState(draft?.lyrics ?? '')

  useEffect(() => {
    setFields({
      title: draft?.title ?? '',
      artist: draft?.artist ?? '',
      album: draft?.album ?? '',
      track: draft?.track ?? String(idx + 1),
      year: draft?.year ?? '',
      genre: draft?.genre ?? '',
    })
    setLyrics(draft?.lyrics ?? '')
  }, [draft])

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<DraftState>) => patchDraft(fileId, idx, { ...patch, start_ms: startMs, end_ms: endMs }),
    onSuccess: (updated) => qc.setQueryData(['draft', fileId, idx], updated),
  })

  const transcribeMutation = useMutation({
    mutationFn: () => transcribePreview(fileId, startMs, endMs, idx),
    onSuccess: (text) => {
      setLyrics(text)
      qc.setQueryData(['draft', fileId, idx], (old: DraftState | undefined) => ({ ...(old as DraftState), lyrics: text, idx, file_id: fileId }))
      // also persist via patchDraft already done server side, but update cache
      qc.invalidateQueries({ queryKey: ['draft', fileId, idx] })
      qc.invalidateQueries({ queryKey: ['drafts', fileId] })
    },
  })

  return (
    <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {TRACK_FIELDS.map(({ key, label, size }) => (
          <label key={key} className={`flex flex-col gap-0.5 ${size || 'sm:col-span-2'}`}>
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
            <input
              className="px-2 py-1.5 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={fields[key as keyof typeof fields]}
              onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              onBlur={(e) => saveMutation.mutate({ [key]: e.target.value } as Partial<DraftState>)}
            />
          </label>
        ))}
      </div>

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
        <p className="text-[11px] text-zinc-400">Lyrics are saved automatically and will be carried over when you Split this track.</p>
      </div>
    </div>
  )
}
