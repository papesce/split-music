import type { UploadResponse } from '@/types'

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

  return (
    <div className="flex gap-5 p-5 rounded-2xl border border-zinc-200 bg-white items-center">
      {/* Cover art */}
      <div className="shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center">
        {artUrl ? (
          <img src={artUrl} alt="Cover art" className="w-full h-full object-cover" />
        ) : (
          <svg className="w-10 h-10 text-zinc-300" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
          </svg>
        )}
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1 min-w-0">
        <p className="text-lg font-semibold text-zinc-900 truncate leading-tight">
          {upload.title || upload.original_name}
        </p>
        {upload.artist && (
          <p className="text-sm text-zinc-600 truncate">{upload.artist}</p>
        )}
        {upload.album && (
          <p className="text-sm text-zinc-400 truncate">{upload.album}</p>
        )}
        <div className="flex gap-3 mt-1 flex-wrap">
          <Badge>{msToHMS(upload.duration_ms)}</Badge>
          {upload.has_art
            ? <Badge color="green">Cover art embedded</Badge>
            : <Badge color="zinc">No cover art</Badge>
          }
          {(upload.title || upload.artist) && <Badge color="blue">Tagged</Badge>}
        </div>
      </div>
    </div>
  )
}

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
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {children}
    </span>
  )
}
