import { useState } from 'react'

interface Props {
  prompt: string
  onClose: () => void
  onUpload: (file: File) => void
  uploading?: boolean
}

export function ArtworkSearchModal({ prompt, onClose, onUpload, uploading }: Props) {
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')

  function handleCopy() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setSelectedFile(file)
      setFileName(file.name)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(file))
    }
    e.target.value = ''
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Search artwork on Google</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">1 · Copy this query</p>
          <p className="text-[11px] text-zinc-500">Copy and paste into Google Images to find artwork.</p>
          <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 max-h-48 overflow-y-auto">
            {prompt}
          </pre>
          <button onClick={handleCopy} className="self-start text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors">
            {copied ? '✓ Copied!' : 'Copy query'}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">2 · Upload image</p>
          <p className="text-[11px] text-zinc-500">Save the image from Google, then upload it here.</p>
          <label className="cursor-pointer px-3 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors text-center">
            {fileName ? fileName : 'Choose image…'}
            <input type="file" accept="image/*" className="hidden" onChange={onFilePicked} />
          </label>
          {preview && (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Preview</span>
              <img src={preview} alt="artwork preview" className="w-full max-h-64 object-contain rounded bg-white border border-zinc-200" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => {
              if (selectedFile) {
                onUpload(selectedFile)
              }
            }}
            disabled={!selectedFile || !!uploading}
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
          >
            {uploading ? 'Uploading…' : 'Upload artwork'}
          </button>
        </div>
      </div>
    </div>
  )
}
