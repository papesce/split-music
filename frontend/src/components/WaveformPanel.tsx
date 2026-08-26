import { useState } from 'react'
import { Waveform, type WaveformHandle } from '@/components/Waveform'
import { SensitivityPopover } from '@/components/SensitivityPopover'

interface Props {
  fileId: string
  durationMs: number
  splitPoints: number[]
  splittableCount: number
  isDetecting: boolean
  minSilenceMs: number
  silenceThreshDb: number
  onSplitPointsChange: (points: number[]) => void
  onRegionClick: (index: number) => void
  onAddSplit: (positionMs: number) => void
  onMinSilenceChange: (ms: number) => void
  onSilenceThreshChange: (db: number) => void
  onRedetect: () => void
  waveformRef: React.Ref<WaveformHandle>
}

export function WaveformPanel({
  fileId,
  durationMs,
  splitPoints,
  splittableCount,
  isDetecting,
  minSilenceMs,
  silenceThreshDb,
  onSplitPointsChange,
  onRegionClick,
  onAddSplit,
  onMinSilenceChange,
  onSilenceThreshChange,
  onRedetect,
  waveformRef,
}: Props) {
  const [showSensitivity, setShowSensitivity] = useState(false)

  return (
    <div className="max-w-5xl mx-auto px-4 py-2 flex flex-col gap-2">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-white/70 text-xs">
          <span className="font-medium text-white">
            {splittableCount} track{splittableCount !== 1 ? 's' : ''}
          </span>
          {isDetecting && <span className="text-white/50">· detecting…</span>}
        </div>

        <div className="flex items-center gap-2 relative">
          {/* Sensitivity popover toggle */}
          <button
            onClick={() => setShowSensitivity((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            Sensitivity
          </button>

          {showSensitivity && (
            <SensitivityPopover
              minSilenceMs={minSilenceMs}
              silenceThreshDb={silenceThreshDb}
              isPending={isDetecting}
              onMinSilenceChange={onMinSilenceChange}
              onSilenceThreshChange={onSilenceThreshChange}
              onApply={() => {
                setShowSensitivity(false)
                onRedetect()
              }}
              onClose={() => setShowSensitivity(false)}
            />
          )}

          <button
            onClick={onRedetect}
            disabled={isDetecting}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-40 transition-colors"
          >
            Re-detect
          </button>
        </div>
      </div>

      {/* Waveform canvas */}
      <Waveform
        ref={waveformRef}
        audioUrl={`/segment/file/${fileId}/audio`}
        splitPoints={splitPoints}
        durationMs={durationMs}
        onSplitPointsChange={onSplitPointsChange}
        onRegionClick={onRegionClick}
        onAddSplit={onAddSplit}
      />
    </div>
  )
}
