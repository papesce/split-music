import { useCallback, useState } from 'react'
import type { UploadResponse } from '@/types'
import { uploadFile } from '@/api'

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'])

interface Props {
  onUploaded: (result: UploadResponse) => void
}

export function FileUpload({ onUploaded }: Props) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!AUDIO_EXTS.has(ext)) {
      setError('Unsupported format. Drop an MP3, M4A, WAV, FLAC, AAC or OGG file.')
      return
    }
    setError(null)
    setLoading(true)
    setUploadPct(0)
    try {
      const result = await uploadFile(file, (pct) => setUploadPct(pct))
      onUploaded(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setLoading(false)
      setUploadPct(0)
    }
  }, [onUploaded])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-12">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center justify-center w-full max-w-xl h-52 rounded-2xl border-2 border-dashed cursor-pointer transition-colors',
          dragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100',
        ].join(' ')}
      >
        <input
          type="file"
          accept=".mp3,.m4a,.wav,.flac,.aac,.ogg,audio/*"
          className="hidden"
          onChange={onInputChange}
          disabled={loading}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <Spinner />
            <span className="text-sm text-zinc-500">
              {uploadPct < 100 ? `Uploading… ${uploadPct}%` : 'Processing…'}
            </span>
            {uploadPct > 0 && (
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-500">
            <svg className="w-10 h-10 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <span className="font-medium text-zinc-700">Drop an audio file here</span>
            <span className="text-sm">MP3, M4A, WAV, FLAC — or click to browse</span>
          </div>
        )}
      </label>

      {error && (
        <p className="text-sm text-red-600 text-center max-w-sm">{error}</p>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
