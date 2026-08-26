interface Props {
  minSilenceMs: number
  silenceThreshDb: number
  isPending: boolean
  onMinSilenceChange: (ms: number) => void
  onSilenceThreshChange: (db: number) => void
  onApply: () => void
  onClose: () => void
}

export function SensitivityPopover({
  minSilenceMs,
  silenceThreshDb,
  isPending,
  onMinSilenceChange,
  onSilenceThreshChange,
  onApply,
  onClose,
}: Props) {
  return (
    <>
      {/* Click-outside backdrop */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-8 z-20 w-72 p-4 bg-white border border-zinc-200 rounded-xl shadow-xl flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-zinc-600">
            <span>Min silence</span>
            <span className="font-medium tabular-nums">{minSilenceMs} ms</span>
          </div>
          <input
            type="range"
            min={200}
            max={3000}
            step={50}
            value={minSilenceMs}
            onChange={(e) => onMinSilenceChange(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>200ms (dense)</span>
            <span>3000ms (sparse)</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-zinc-600">
            <span>Silence threshold</span>
            <span className="font-medium tabular-nums">{silenceThreshDb} dB</span>
          </div>
          <input
            type="range"
            min={-70}
            max={-20}
            step={1}
            value={silenceThreshDb}
            onChange={(e) => onSilenceThreshChange(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>-70dB (sensitive)</span>
            <span>-20dB (strict)</span>
          </div>
        </div>

        <button
          onClick={onApply}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Re-detect with these settings
        </button>
      </div>
    </>
  )
}
