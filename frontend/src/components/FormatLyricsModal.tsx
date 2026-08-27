import { useState } from 'react'
import { formatLyrics } from '@/utils/lyrics'

export function FormatLyricsModal({ initialText, onApply, onClose }: { initialText: string; onApply: (formatted: string) => void; onClose: () => void }) {
  const [raw, setRaw] = useState(initialText)
  const formatted = formatLyrics(raw)
  const isEmpty = !raw.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Format lyrics</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-zinc-500">Paste raw lyrics below (with or without surrounding quotes). Formatting will trim whitespace, strip outer quotes, and preserve line breaks / stanza spacing.</p>
        <label className="flex flex-col gap-1 flex-1 min-h-0">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Paste / edit raw text</span>
          <textarea className="w-full flex-1 min-h-[140px] px-3 py-2 rounded-lg border border-zinc-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono whitespace-pre resize-none" placeholder={`'Time, it needs time\nTo win back your love again\n...'`} value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus />
        </label>
        {raw.trim() && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Preview (stored as plain text with line breaks)</span>
            <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-[30vh] overflow-y-auto">{formatted || '(empty after formatting)'}</pre>
            <span className="text-[11px] text-zinc-400">{formatted.split('\n').length} lines · {formatted.length} chars</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">Cancel</button>
          <button onClick={() => onApply(formatted)} disabled={isEmpty || !formatted} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">Format &amp; Save</button>
        </div>
      </div>
    </div>
  )
}
