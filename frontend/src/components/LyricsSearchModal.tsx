import { useState } from 'react'
import { formatLyrics } from '@/utils/lyrics'

interface Props {
  prompt: string
  onApply: (lyrics: string) => void
  onClose: () => void
}

export function LyricsSearchModal({ prompt, onApply, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')

  function handleCopy() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const formatted = pasted.trim() ? formatLyrics(pasted) : ''
  const canApply = Boolean(formatted)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Search lyrics via ChatGPT</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">1 · Copy this prompt</p>
          <p className="text-[11px] text-zinc-500">Uses the current Title and Artist to ask ChatGPT for the full lyrics.</p>
          <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-48 overflow-y-auto">
            {prompt}
          </pre>
          <button onClick={handleCopy} className="self-start text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors">
            {copied ? '✓ Copied!' : 'Copy prompt'}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">2 · Paste the lyrics response here</p>
          <textarea
            className="w-full h-40 px-3 py-2 rounded-lg border border-zinc-200 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono whitespace-pre"
            placeholder={'Paste lyrics returned by ChatGPT here...'}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            autoFocus
          />
          {formatted && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Preview (formatted)</span>
              <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-40 overflow-y-auto">
                {formatted}
              </pre>
              <span className="text-[11px] text-zinc-400">{formatted.split('\n').length} lines · {formatted.length} chars</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onApply(formatted)}
            disabled={!canApply}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            Insert lyrics
          </button>
        </div>
      </div>
    </div>
  )
}
