import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UploadResponse, SegmentInfo, SegmentMeta } from '@/types'
import { detectSplitPoints, applySplit, getSegment } from '@/api'
import { FileUpload } from '@/components/FileUpload'
import { Waveform } from '@/components/Waveform'
import { SegmentCard } from '@/components/SegmentCard'
import { ExportPanel } from '@/components/ExportPanel'

type Stage = 'upload' | 'split' | 'edit'

export default function App() {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>('upload')
  const [upload, setUpload] = useState<UploadResponse | null>(null)
  const [splitPoints, setSplitPoints] = useState<number[]>([])
  const [segments, setSegments] = useState<SegmentInfo[]>([])
  const [_activeSegmentIdx, setActiveSegmentIdx] = useState<number>(0)

  // Auto-detect split points after upload
  const detectMutation = useMutation({
    mutationFn: (fileId: string) => detectSplitPoints(fileId),
    onSuccess: (result) => {
      setSplitPoints(result.split_points_ms)
      setStage('split')
    },
  })

  // Apply split points → create segments
  const applyMutation = useMutation({
    mutationFn: () => applySplit(upload!.file_id, splitPoints),
    onSuccess: (result) => {
      setSegments(result.segments)
      setStage('edit')
    },
  })

  // Load all segment metas for export panel
  const segmentMetas = useQuery<SegmentMeta[]>({
    queryKey: ['segments', segments.map((s) => s.segment_id)],
    queryFn: () => Promise.all(segments.map((s) => getSegment(s.segment_id))),
    enabled: stage === 'edit' && segments.length > 0,
  })

  const handleUploaded = (result: UploadResponse) => {
    setUpload(result)
    setStage('split')
    detectMutation.mutate(result.file_id)
  }

  const handleReset = () => {
    setStage('upload')
    setUpload(null)
    setSplitPoints([])
    setSegments([])
    qc.clear()
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
          </svg>
          <h1 className="text-lg font-semibold">Split Music</h1>
        </div>

        {upload && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500 truncate max-w-xs">{upload.original_name}</span>
            <button
              onClick={handleReset}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
            >
              New file
            </button>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Stage: upload */}
        {stage === 'upload' && (
          <FileUpload onUploaded={handleUploaded} />
        )}

        {/* Stage: split + edit */}
        {upload && stage !== 'upload' && (
          <>
            {/* Waveform + split controls */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-zinc-800">
                  {stage === 'split' ? 'Adjust split points' : 'Waveform'}
                </h2>
                {stage === 'split' && (
                  <div className="flex items-center gap-2">
                    {detectMutation.isPending && (
                      <span className="text-xs text-zinc-400">Detecting silences…</span>
                    )}
                    <button
                      onClick={() => detectMutation.mutate(upload.file_id)}
                      disabled={detectMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 disabled:opacity-40 transition-colors"
                    >
                      Re-detect
                    </button>
                    <button
                      onClick={() => applyMutation.mutate()}
                      disabled={applyMutation.isPending || splitPoints.length < 2}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      {applyMutation.isPending ? 'Splitting…' : `Split into ${splitPoints.length - 1} tracks →`}
                    </button>
                  </div>
                )}
              </div>

              <Waveform
                fileId={upload.file_id}
                audioUrl={`/segment/file/${upload.file_id}/audio`}
                splitPoints={splitPoints}
                durationMs={upload.duration_ms}
                onSplitPointsChange={setSplitPoints}
                segments={segments}
                onSegmentClick={setActiveSegmentIdx}
              />
            </section>

            {/* Segment editor list */}
            {stage === 'edit' && segments.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="font-semibold text-zinc-800">
                  Tracks <span className="text-zinc-400 font-normal">({segments.length})</span>
                </h2>
                {segments.map((seg, i) => (
                  <SegmentCard
                    key={seg.segment_id}
                    segmentId={seg.segment_id}
                    index={i}
                  />
                ))}
              </section>
            )}

            {/* Export */}
            {stage === 'edit' && segments.length > 0 && (
              <ExportPanel
                fileId={upload.file_id}
                segments={segmentMetas.data ?? []}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
