import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { DraftState, SuggestPasteResult } from '@/types'
import { patchDraft, transcribePreview, suggestFromText, suggestLyricsFromText } from '@/api'
import { TRACK_FIELDS } from '@/utils/trackUtils'
import { formatLyrics } from '@/utils/lyrics'
import { SuggestModal } from '@/components/SuggestModal'
import { LyricsSearchModal } from '@/components/LyricsSearchModal'

function FormatLyricsModal({
  initialText,
  onApply,
  onClose,
}: {
  initialText: string
  onApply: (formatted: string) => void
  onClose: () => void
}) {
  const [raw, setRaw] = useState(initialText)
  const formatted = formatLyrics(raw)
  const isEmpty = !raw.trim()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Format lyrics</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Paste raw lyrics below (with or without surrounding quotes). Formatting will trim whitespace, strip outer quotes, and preserve line breaks / stanza spacing.
        </p>
        <label className="flex flex-col gap-1 flex-1 min-h-0">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Paste / edit raw text</span>
          <textarea
            className="w-full flex-1 min-h-[140px] px-3 py-2 rounded-lg border border-zinc-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono whitespace-pre resize-none"
            placeholder={`'Time, it needs time\nTo win back your love again\n...'`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoFocus
          />
        </label>
        {raw.trim() && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Preview (stored as plain text with line breaks)</span>
            <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-[30vh] overflow-y-auto">
              {formatted || '(empty after formatting)'}
            </pre>
            <span className="text-[11px] text-zinc-400">{formatted.split('\n').length} lines · {formatted.length} chars</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(formatted)}
            disabled={isEmpty || !formatted}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            Format &amp; Save
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  fileId: string
  idx: number
  draft: DraftState | undefined
  startMs: number
  endMs: number
  onDraftChange?: (d: DraftState) => void
  focused?: boolean
}

export function DraftMetadataEditor({ fileId, idx, draft, startMs, endMs, focused }: Props) {
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

  const [suggestPrompt, setSuggestPrompt] = useState<string | null>(null)
  const suggestMutation = useMutation({
    mutationFn: () => suggestFromText(lyrics),
    onSuccess: (prompt) => setSuggestPrompt(prompt),
  })

  const [lyricsSearchPrompt, setLyricsSearchPrompt] = useState<string | null>(null)
  const lyricsSearchMutation = useMutation({
    mutationFn: () => suggestLyricsFromText(fields.title, fields.artist, fields.album),
    onSuccess: (prompt) => setLyricsSearchPrompt(prompt),
  })

  const [formatOpen, setFormatOpen] = useState(false)

  function applyPasteResult(result: SuggestPasteResult) {
    const patch: Partial<DraftState> = {}
    if (result.title) { patch.title = result.title; setFields((f) => ({ ...f, title: result.title })) }
    if (result.artist) { patch.artist = result.artist; setFields((f) => ({ ...f, artist: result.artist })) }
    if (result.year) { patch.year = result.year; setFields((f) => ({ ...f, year: result.year })) }
    if (result.genre) { patch.genre = result.genre; setFields((f) => ({ ...f, genre: result.genre })) }
    if (result.lyrics?.trim()) {
      patch.lyrics = result.lyrics
      setLyrics(result.lyrics)
    }
    if (Object.keys(patch).length > 0) {
      saveMutation.mutate(patch)
      qc.invalidateQueries({ queryKey: ['drafts', fileId] })
      qc.invalidateQueries({ queryKey: ['draft', fileId, idx] })
    }
    setSuggestPrompt(null)
  }

  return (
    <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
      {suggestPrompt !== null && (
        <SuggestModal prompt={suggestPrompt} onApply={applyPasteResult} onClose={() => setSuggestPrompt(null)} />
      )}
      {lyricsSearchPrompt !== null && (
        <LyricsSearchModal
          prompt={lyricsSearchPrompt}
          onClose={() => setLyricsSearchPrompt(null)}
          onApply={(formatted) => {
            setLyrics(formatted)
            saveMutation.mutate({ lyrics: formatted })
            qc.invalidateQueries({ queryKey: ['drafts', fileId] })
            qc.invalidateQueries({ queryKey: ['draft', fileId, idx] })
            setLyricsSearchPrompt(null)
          }}
        />
      )}
      {formatOpen && (
        <FormatLyricsModal
          initialText={lyrics}
          onClose={() => setFormatOpen(false)}
          onApply={(formatted) => {
            setLyrics(formatted)
            saveMutation.mutate({ lyrics: formatted })
            qc.invalidateQueries({ queryKey: ['drafts', fileId] })
            qc.invalidateQueries({ queryKey: ['draft', fileId, idx] })
            setFormatOpen(false)
          }}
        />
      )}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => lyricsSearchMutation.mutate()}
              disabled={lyricsSearchMutation.isPending || !fields.title.trim() || !fields.artist.trim()}
              title={!fields.title.trim() || !fields.artist.trim() ? 'Enter title and artist first' : 'Copy prompt to search lyrics via ChatGPT'}
              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {lyricsSearchMutation.isPending ? 'Building…' : '✦ Search lyrics'}
            </button>
            <button
              onClick={() => setFormatOpen(true)}
              title="Paste raw lyrics and normalize formatting (preserves line breaks)"
              className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors"
            >
              Enter lyrics
            </button>
            <button
              onClick={() => transcribeMutation.mutate()}
              disabled={transcribeMutation.isPending}
              className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {transcribeMutation.isPending ? 'Transcribing…' : '✦ Whisper'}
            </button>
            <button
              onClick={() => suggestMutation.mutate()}
              disabled={suggestMutation.isPending || !lyrics.trim()}
              title={!lyrics.trim() ? 'Transcribe lyrics first' : 'Copy prompt for ChatGPT'}
              className="text-xs px-2.5 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {suggestMutation.isPending ? 'Building…' : '✦ Suggest'}
            </button>
          </div>
        </div>
        <textarea
          className={`w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${focused ? 'min-h-[40vh] lg:min-h-[50vh]' : 'h-24'}`}
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
