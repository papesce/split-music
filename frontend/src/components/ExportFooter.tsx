import type { SegmentMeta } from '@/types'

interface Props {
  segments: SegmentMeta[]
  exporting: boolean
  onExport: () => void
}

export function ExportFooter({ segments, exporting, onExport }: Props) {
  if (segments.length === 0) return null

  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t border-zinc-200 px-6 py-3 flex items-center justify-between gap-4 z-30">
      <span className="text-sm text-zinc-600">
        <span className="font-semibold text-zinc-800">{segments.length}</span> track
        {segments.length !== 1 ? 's' : ''} ready
      </span>
      <button
        onClick={onExport}
        disabled={exporting}
        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
      >
        {exporting ? (
          <>
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Exporting…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export all as ZIP
          </>
        )}
      </button>
    </div>
  )
}
