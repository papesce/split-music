import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import type { SegmentMeta } from '@/types'
import type { SuggestPasteResult, LyricsResult } from '@/types'
import { updateSegment, uploadArt, transcribeSegment, suggestFromLyrics, fetchLyricsForSegment, suggestLyricsFromSegment } from '@/api'
import { segmentArtUrl } from '@/api'
import { TRACK_FIELDS } from '@/utils/trackUtils'
import { formatLyrics } from '@/utils/lyrics'
import { SuggestModal } from '@/components/SuggestModal'
import { LyricsSearchModal } from '@/components/LyricsSearchModal'

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
  focused?: boolean
}

// PasteModal moved to shared SuggestModal component

// ---------------------------------------------------------------------------
// Lyrics fetch preview modal (LRClib)
// ---------------------------------------------------------------------------

function LyricsPreviewModal({
  result,
  currentLyrics,
  onInsert,
  onClose,
}: {
  result: LyricsResult
  currentLyrics: string
  onInsert: (mode: 'replace' | 'append') => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const lyrics = result.plainLyrics || ''
  function handleCopy() {
    navigator.clipboard.writeText(lyrics).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">
            Lyrics from LRClib
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {result.artistName} — {result.trackName}
              {result.albumName ? ` · ${result.albumName}` : ''}
            </span>
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>
        {currentLyrics.trim() && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Track already has lyrics — Replace will overwrite, Append will add below.
          </p>
        )}
        <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 overflow-y-auto flex-1 min-h-[200px] max-h-[50vh]">
          {lyrics}
        </pre>
        <div className="flex items-center justify-between">
          <button
            onClick={handleCopy}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Cancel
            </button>
            {currentLyrics.trim() && (
              <button
                onClick={() => onInsert('append')}
                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors"
              >
                Append
              </button>
            )}
            <button
              onClick={() => onInsert('replace')}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              {currentLyrics.trim() ? 'Replace' : 'Insert into track'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Format lyrics modal
// ---------------------------------------------------------------------------

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
  const isUnchanged = formatted === initialText.trim()

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
            title={isUnchanged ? 'Already formatted' : 'Apply formatted lyrics'}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            Format &amp; Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TrackMetadataEditor({
  segmentId,
  seg,
  fields,
  lyrics,
  onFieldsChange,
  onLyricsChange,
  focused,
}: Props) {
  const qc = useQueryClient()
  const [suggestPrompt, setSuggestPrompt] = useState<string | null>(null)
  const [lyricsSearchPrompt, setLyricsSearchPrompt] = useState<string | null>(null)
  const [lyricsResult, setLyricsResult] = useState<LyricsResult | null>(null)
  const [lyricsError, setLyricsError] = useState('')
  const [lyricsErrorDetails, setLyricsErrorDetails] = useState<{
    status?: number | undefined
    detail: string
    query: string
  } | null>(null)

  const [formatOpen, setFormatOpen] = useState(false)

  // Reset transient lyrics UI when switching tracks
  useEffect(() => {
    setLyricsResult(null)
    setLyricsError('')
    setLyricsErrorDetails(null)
    setFormatOpen(false)
  }, [segmentId])

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<SegmentMeta>) => updateSegment(segmentId, patch),
    onSuccess: (updated) => qc.setQueryData(['segment', segmentId], updated),
  })

  const [artError, setArtError] = useState('')

  const artMutation = useMutation({
    mutationFn: (file: File) => uploadArt(segmentId, file),
    onSuccess: () => {
      setArtError('')
      qc.invalidateQueries({ queryKey: ['segment', segmentId] })
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
            ? // axios error
              ((err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? 'Upload failed')
            : 'Upload failed'
      setArtError(String(msg))
    },
  })

  const transcribeMutation = useMutation({
    mutationFn: () => transcribeSegment(segmentId),
    onSuccess: (text) => {
      onLyricsChange(text)
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, lyrics: text }))
    },
  })

  const suggestMutation = useMutation({
    mutationFn: () => suggestFromLyrics(segmentId),
    onSuccess: (result) => setSuggestPrompt(result.prompt),
  })

  const lyricsSearchMutation = useMutation({
    mutationFn: () => suggestLyricsFromSegment(segmentId),
    onSuccess: (prompt) => setLyricsSearchPrompt(prompt),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      // fallback: surface via lyricsError if available
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setLyricsError(axiosErr?.response?.data?.detail ?? msg)
    },
  })

  const lyricsFetchMutation = useMutation({
    mutationFn: () => fetchLyricsForSegment(segmentId, fields.artist, fields.title, fields.album),
    onSuccess: (result) => {
      // Guard: backend should 404 on empty, but prevent empty dialog if it ever returns 200 with no lyrics
      const hasLyrics = Boolean((result.plainLyrics || '').trim() || (result.syncedLyrics || '').trim())
      if (!hasLyrics) {
        const query = [fields.artist.trim(), fields.title.trim(), fields.album.trim()].filter(Boolean).join(' — ')
        const msg = `LRClib returned no lyrics for “${query}”.`
        setLyricsError(msg)
        setLyricsErrorDetails({ status: 200, detail: 'Empty plainLyrics/syncedLyrics', query })
        setLyricsResult(null)
        return
      }
      setLyricsError('')
      setLyricsErrorDetails(null)
      setLyricsResult(result)
    },
    onError: (err: unknown) => {
      const axiosErr = err as {
        message?: string
        response?: { status?: number; data?: { detail?: string } }
      }
      const status = axiosErr?.response?.status
      const detail = axiosErr?.response?.data?.detail ?? axiosErr?.message ?? 'Lyrics fetch failed'
      const query = [fields.artist.trim(), fields.title.trim(), fields.album.trim()]
        .filter(Boolean)
        .join(' — ') || `${fields.artist} / ${fields.title}`
      // Enrich 404 with actionable hint
      let enriched = detail
      if (status === 404 && detail.toLowerCase().includes('no lyrics found')) {
        const hasMedley = fields.title.includes('/') || fields.artist.includes('/')
        enriched = `${detail} — no LRClib match for “${query}”.${hasMedley ? ' Title/artist contains “/” (medley); try searching each song separately.' : ''} Try fixing spelling, removing album, or checking https://lrclib.net`
      } else if (status === 404 && detail.toLowerCase().includes('instrumental')) {
        enriched = `${detail} — LRClib marks this track as instrumental.`
      } else if (status) {
        enriched = `[${status}] ${detail}`
      }
      setLyricsError(enriched)
      setLyricsErrorDetails({ status, detail, query })
    },
  })

  function handleInsertLyrics(mode: 'replace' | 'append') {
    if (!lyricsResult) return
    const fetched = (lyricsResult.plainLyrics || '').trim()
    if (!fetched) return
    const next = mode === 'replace' || !lyrics.trim() ? fetched : `${lyrics.trim()}\n\n${fetched}`
    onLyricsChange(next)
    qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...(old as SegmentMeta), lyrics: next }))
    saveMutation.mutate({ lyrics: next })
    setLyricsResult(null)
  }

  function applyPasteResult(result: SuggestPasteResult) {
    const patch: Partial<SegmentMeta> = {
      title: result.title || fields.title,
      artist: result.artist || fields.artist,
      year: result.year || fields.year,
      genre: result.genre || fields.genre,
    }
    // Apply corrected lyrics if LLM provided them
    const correctedLyrics = result.lyrics?.trim() ? result.lyrics : ''
    if (correctedLyrics) {
      onLyricsChange(correctedLyrics)
      ;(patch as SegmentMeta)['lyrics'] = correctedLyrics
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, ...patch, lyrics: correctedLyrics }))
    } else {
      qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...old, ...patch }))
    }
    onFieldsChange({ ...fields, title: String(patch.title), artist: String(patch.artist), year: String(patch.year), genre: String(patch.genre) })
    saveMutation.mutate(patch)
    // Artwork is now shown as rendered images in ChatGPT (part 2 of the prompt).
    // User manually downloads one and uploads via "Cover art" — no auto-fetch here.
    // We keep artwork URLs from paste (markdown images / legacy fields) only for preview.
    setSuggestPrompt(null)
  }

  const canFetchLyrics = Boolean(fields.title.trim() && fields.artist.trim())

  return (
    <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
      {suggestPrompt !== null && (
        <SuggestModal
          prompt={suggestPrompt}
          onApply={applyPasteResult}
          onClose={() => setSuggestPrompt(null)}
        />
      )}
      {lyricsSearchPrompt !== null && (
        <LyricsSearchModal
          prompt={lyricsSearchPrompt}
          onClose={() => setLyricsSearchPrompt(null)}
          onApply={(formatted) => {
            onLyricsChange(formatted)
            qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...(old as SegmentMeta), lyrics: formatted }))
            saveMutation.mutate({ lyrics: formatted })
            setLyricsSearchPrompt(null)
          }}
        />
      )}
      {lyricsResult && (
        <LyricsPreviewModal
          result={lyricsResult}
          currentLyrics={lyrics}
          onInsert={handleInsertLyrics}
          onClose={() => setLyricsResult(null)}
        />
      )}
      {formatOpen && (
        <FormatLyricsModal
          initialText={lyrics}
          onClose={() => setFormatOpen(false)}
          onApply={(formatted) => {
            onLyricsChange(formatted)
            qc.setQueryData(['segment', segmentId], (old: SegmentMeta) => ({ ...(old as SegmentMeta), lyrics: formatted }))
            saveMutation.mutate({ lyrics: formatted })
            setFormatOpen(false)
          }}
        />
      )}

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

      {/* Title/Artist quick action: Fetch lyrics */}
      <div className="flex flex-col gap-1.5 -mt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setLyricsError('')
              setLyricsErrorDetails(null)
              setLyricsResult(null)
              lyricsFetchMutation.reset()
              lyricsFetchMutation.mutate()
            }}
            disabled={!canFetchLyrics || lyricsFetchMutation.isPending}
            title={!canFetchLyrics ? 'Enter title and artist first' : 'Fetch lyrics from LRClib'}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {lyricsFetchMutation.isPending ? 'Searching…' : '♪ Fetch lyrics'}
          </button>
          <span className="text-[11px] text-zinc-500">
            via LRClib
            {!lyricsError && lyricsResult && lyricsFetchMutation.isSuccess && (
              <span className="text-emerald-600 ml-2">found — preview opened</span>
            )}
          </span>
        </div>
        {lyricsError && lyricsErrorDetails && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-red-700 leading-relaxed break-words">{lyricsError}</p>
              <button
                onClick={() => {
                  setLyricsError('')
                  setLyricsErrorDetails(null)
                }}
                className="text-red-400 hover:text-red-600 text-xs shrink-0"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Searched: <span className="font-medium text-zinc-800">{lyricsErrorDetails.query}</span>
              {lyricsErrorDetails.status && (
                <span className="text-zinc-500"> · HTTP {lyricsErrorDetails.status}</span>
              )}
            </p>
            {lyricsErrorDetails.status === 404 && (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Tip: verify spelling on{' '}
                <a
                  href={`https://lrclib.net/search?q=${encodeURIComponent(lyricsErrorDetails.query)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-600 hover:text-violet-700 underline"
                >
                  LRClib search
                </a>
                . For medleys, fetch each track individually.
              </p>
            )}
            <p className="text-[11px] text-zinc-400">
              Request: <span className="font-mono break-all">GET /lyrics/{segmentId}?artist={encodeURIComponent(fields.artist)}&amp;title={encodeURIComponent(fields.title)}{fields.album ? `&album=${encodeURIComponent(fields.album)}` : ''}</span>
            </p>
          </div>
        )}
        {lyricsError && !lyricsErrorDetails && (
          <p className="text-xs text-red-500">{lyricsError}</p>
        )}
      </div>

      {/* Cover art row */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide w-14 shrink-0">
          Cover art
        </span>
        {seg?.has_art && (
          <img
            src={segmentArtUrl(segmentId)}
            alt="cover"
            className="w-12 h-12 rounded object-cover border border-zinc-200"
          />
        )}
        <label className="cursor-pointer px-3 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors">
          {artMutation.isPending ? 'Uploading…' : 'Upload image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) artMutation.mutate(f)
              // reset value so the same file can be re-selected after a failure
              e.target.value = ''
            }}
          />
        </label>
        {artMutation.isError && artError && (
          <span className="text-xs text-red-500 max-w-[200px] truncate" title={artError}>
            {artError}
          </span>
        )}
        {artMutation.isSuccess && !artError && (
          <span className="text-xs text-green-600">✓ Saved (converted to JPEG 800px)</span>
        )}
      </div>

      {/* Lyrics */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">
            Lyrics
          </span>
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
              Format lyrics
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
          onChange={(e) => onLyricsChange(e.target.value)}
          onBlur={(e) => saveMutation.mutate({ lyrics: e.target.value })}
        />
      </div>
    </div>
  )
}
