import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UploadResponse } from '@/types'

function youtubeSearchUrl(upload: UploadResponse): string {
  const parts = [upload.artist, upload.title].filter(Boolean)
  const query = parts.length ? parts.join(' ') : upload.original_name
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

interface Props {
  upload: UploadResponse
}

function msToHMS(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  return `${m}m ${sec}s`
}

export function FileInfo({ upload }: Props) {
  const artUrl = upload.has_art ? `/upload/${upload.file_id}/art` : null
  const [lightbox, setLightbox] = useState(false)

  return (
    <div className="flex gap-5 p-5 rounded-2xl border border-zinc-200 bg-white items-center">
      {/* Cover art thumbnail — clickable if art exists */}
      <div className="shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center">
        {artUrl ? (
          <button
            onClick={() => setLightbox(true)}
            className="w-full h-full group relative focus:outline-none"
            title="Click to zoom"
          >
            <img src={artUrl} alt="Cover art" className="w-full h-full object-cover" />
            {/* Zoom hint overlay */}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors rounded-xl">
              <svg
                className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0zM11 8v6M8 11h6"
                />
              </svg>
            </span>
          </button>
        ) : (
          <svg className="w-10 h-10 text-zinc-300" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
          </svg>
        )}
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="text-lg font-semibold text-zinc-900 truncate leading-tight flex-1">
            {upload.title || upload.original_name}
          </p>
          {/* YouTube search button */}
          <a
            href={youtubeSearchUrl(upload)}
            target="_blank"
            rel="noopener noreferrer"
            title="Search on YouTube"
            className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.498 6.186a2.994 2.994 0 0 0-2.107-2.117C19.545 3.6 12 3.6 12 3.6s-7.545 0-9.391.469A2.994 2.994 0 0 0 .502 6.186 31.33 31.33 0 0 0 0 12a31.33 31.33 0 0 0 .502 5.814 2.994 2.994 0 0 0 2.107 2.117C4.455 20.4 12 20.4 12 20.4s7.545 0 9.391-.469a2.994 2.994 0 0 0 2.107-2.117A31.33 31.33 0 0 0 24 12a31.33 31.33 0 0 0-.502-5.814zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
            </svg>
          </a>
        </div>
        {upload.artist && <p className="text-sm text-zinc-600 truncate">{upload.artist}</p>}
        {upload.album && <p className="text-sm text-zinc-400 truncate">{upload.album}</p>}
        <div className="flex gap-3 mt-1 flex-wrap">
          <Badge>{msToHMS(upload.duration_ms)}</Badge>
          {upload.has_art ? (
            <Badge color="green">Cover art embedded</Badge>
          ) : (
            <Badge color="zinc">No cover art</Badge>
          )}
          {(upload.title || upload.artist) && <Badge color="blue">Tagged</Badge>}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox &&
        artUrl &&
        createPortal(<Lightbox src={artUrl} onClose={() => setLightbox(false)} />, document.body)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image — constrained to viewport with padding */}
      <img
        src={src}
        alt="Cover art full size"
        className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()} // clicking image itself doesn't close
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        title="Close (Esc)"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function Badge({
  children,
  color = 'zinc',
}: {
  children: React.ReactNode
  color?: 'zinc' | 'green' | 'blue'
}) {
  const cls = {
    zinc: 'bg-zinc-100 text-zinc-500',
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
  }[color]
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>
}
