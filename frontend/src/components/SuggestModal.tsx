import { useState, useRef } from 'react'
import type { SuggestPasteResult } from '@/types'

interface Props {
  prompt: string
  onApply: (result: SuggestPasteResult) => void
  onClose: () => void
}

function extractJsonSlice(text: string): string {
  let t = text.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1)
  return t
}
function extractMarkdownImageUrls(text: string): string[] {
  return [...text.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi)].map((m) => (m[1] ?? '').trim()).filter(Boolean)
}

export function SuggestModal({ prompt, onApply, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleCopy() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  let previewArtworks: string[] = []
  let previewParseError = false
  try {
    if (json.trim()) {
      const imageUrls = extractMarkdownImageUrls(json)
      let raw = extractJsonSlice(json)
      raw = raw.replace(/"\[([^\]]*)\]\(([^)]*)\)"/g, '"$2"')
      const d = JSON.parse(raw)
      const opts = Array.isArray(d.artwork_options) ? d.artwork_options : []
      const legacy = d.artwork ? [String(d.artwork)] : []
      const fromJson = [...opts, ...legacy]
        .map((u: unknown) => String(u).replace(/^\[([^\]]*)\]\(([^)]*)\)$/, '$2').trim())
        .filter(Boolean)
      previewArtworks = [...imageUrls, ...fromJson].slice(0, 4)
    }
  } catch {
    previewParseError = true
  }

  function handleApply() {
    setError('')
    let raw = extractJsonSlice(json)
    raw = raw.replace(/"\[([^\]]*)\]\(([^)]*)\)"/g, '"$2"')
    try {
      const data = JSON.parse(raw)
      const opts: string[] = Array.isArray(data.artwork_options)
        ? data.artwork_options.map((u: unknown) => String(u).trim()).filter(Boolean)
        : []
      const legacy = data.artwork ? String(data.artwork).trim() : ''
      const imageUrls = extractMarkdownImageUrls(json)
      const allOpts = [...imageUrls, ...opts, ...(legacy ? [legacy] : [])].filter(Boolean)
      onApply({
        title: String(data.title ?? ''),
        artist: String(data.artist ?? ''),
        year: String(data.year ?? ''),
        genre: String(data.genre ?? ''),
        lyrics: String(data.lyrics ?? ''),
        artwork: allOpts[0] ?? '',
        artwork_options: allOpts,
      })
    } catch {
      setError('Could not parse JSON — make sure you paste the JSON object (with or without markdown images after it).')
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Suggest from ChatGPT</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">1 · Copy this prompt</p>
          <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-48 overflow-y-auto">
            {prompt}
          </pre>
          <button onClick={handleCopy} className="self-start text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors">
            {copied ? '✓ Copied!' : 'Copy prompt'}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">2 · Paste the JSON + images response here</p>
          <p className="text-[11px] text-zinc-500">
            ChatGPT will show the cover art as images — right-click Save in ChatGPT, then upload via “Cover art”. You can also preview images below after pasting.
          </p>
          <textarea
            ref={textareaRef}
            className="w-full h-32 px-3 py-2 rounded-lg border border-zinc-200 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            placeholder={'{"title": "...", "artist": "...", "year": "...", "genre": "..."}\n![Album cover](https://...)'}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          {previewArtworks.length > 0 && !previewParseError && (
            <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
              <p className="text-xs font-medium text-violet-700">Detected artwork from paste — click to open / right-click Save, then upload via Cover art</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {previewArtworks.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="group flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 hover:border-violet-300 transition-colors" title={url}>
                    <img src={url} alt={`artwork option ${i + 1}`} className="w-full aspect-square object-cover rounded bg-zinc-100" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    <span className="text-[10px] leading-tight text-violet-600 group-hover:text-violet-700 break-all line-clamp-2">Option {i + 1} ↗</span>
                    <span className="text-[10px] text-zinc-400 break-all line-clamp-1">{url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleApply} disabled={!json.trim()} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors">
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
