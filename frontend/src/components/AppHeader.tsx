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
            Switch session
          </button>
        </div>
      )}
    </header>
  )
}

export function AppIcon() {
  return <img src="/favicon.svg" alt="Split Music" className="w-6 h-6 shrink-0" />
}
