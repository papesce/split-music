import type { UploadResponse } from '@/types'

interface Props {
  upload?: UploadResponse | null
  onArtClick?: () => void
  onReset?: () => void
}

export function AppHeader({ upload, onArtClick, onReset }: Props) {
  return (
    <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-2">
      <AppIcon />
      <h1 className="text-lg font-semibold">Split Music</h1>
      {upload && onReset && (
        <div className="ml-auto flex items-center gap-4 min-w-0">
          <div className="hidden sm:flex items-center gap-2 min-w-0">
            {upload.has_art && onArtClick && (
              <button
                onClick={onArtClick}
                className="shrink-0 focus:outline-none"
                title="View full artwork"
              >
                <img
                  src={`/upload/${upload.file_id}/art`}
                  alt="cover"
                  className="w-7 h-7 rounded object-cover hover:opacity-80 transition-opacity cursor-zoom-in"
                />
              </button>
            )}
            <span className="text-sm text-zinc-700 font-medium truncate max-w-[200px]">
              {upload.title || upload.original_name}
            </span>
            {upload.artist && (
              <span className="text-sm text-zinc-400 truncate max-w-[140px]">{upload.artist}</span>
            )}
          </div>
          <button
            onClick={onReset}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
          >
            New file
          </button>
        </div>
      )}
    </header>
  )
}

export function AppIcon() {
  return (
    <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
    </svg>
  )
}
