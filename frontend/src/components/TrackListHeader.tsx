interface Props {
  trackCount: number
  selectedCount: number
  allSelected: boolean
  noneSelected: boolean
  splitMapSize: number
  identifyingAll: boolean
  splitting: boolean
  allDone: boolean
  pendingCount: number
  splittingProgress: [number, number]
  onToggleAll: () => void
  onIdentifyAll: () => void
  onSplitAll: () => void
}

export function TrackListHeader({
  trackCount,
  selectedCount,
  allSelected,
  noneSelected,
  splitMapSize,
  identifyingAll,
  splitting,
  allDone,
  pendingCount,
  splittingProgress,
  onToggleAll,
  onIdentifyAll,
  onSplitAll,
}: Props) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-zinc-800">
          Tracks <span className="text-zinc-400 font-normal">({trackCount})</span>
        </h2>
        <button
          onClick={onToggleAll}
          className="text-xs text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline transition-colors"
        >
          {allSelected
            ? 'Deselect all'
            : noneSelected
              ? 'Select all'
              : `${selectedCount}/${trackCount} selected`}
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Identify all — only visible once at least one row has been split */}
        {splitMapSize > 0 && (
          <button
            onClick={onIdentifyAll}
            disabled={identifyingAll}
            title="Auto-identify all split tracks via AcoustID"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 text-violet-600 text-sm font-medium hover:bg-violet-50 disabled:opacity-40 transition-colors"
          >
            {identifyingAll ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
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
                Identifying…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"
                  />
                </svg>
                Identify all
              </>
            )}
          </button>
        )}

        <button
          onClick={allDone ? undefined : onSplitAll}
          disabled={splitting || (!allDone && pendingCount === 0)}
          className={[
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-sm font-medium transition-colors',
            allDone
              ? 'bg-green-600 cursor-default'
              : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-40',
          ].join(' ')}
        >
          {splitting ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
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
              {`Splitting ${splittingProgress[0]} of ${splittingProgress[1]}…`}
            </>
          ) : allDone ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              All split
            </>
          ) : (
            `Split selected (${pendingCount})`
          )}
        </button>
      </div>
    </div>
  )
}
