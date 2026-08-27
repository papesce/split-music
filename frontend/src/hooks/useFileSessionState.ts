import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UploadResponse, FileEntry, SegmentMeta } from '@/types'
import { detectSplitPoints, getFileState, listFiles, saveSplitPoints, deleteFile } from '@/api'
import { queryKeys } from '@/api/queryKeys'

export type Stage = 'loading' | 'resume' | 'upload' | 'working'

export function useFileSessionState() {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>('loading')
  const [upload, setUpload] = useState<UploadResponse | null>(null)
  const uploadRef = useRef<UploadResponse | null>(null)
  uploadRef.current = upload
  const [splitPoints, setSplitPointsRaw] = useState<number[]>([])
  const [splitMap, setSplitMap] = useState<Map<number, string>>(new Map())
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [splitSegments, setSplitSegments] = useState<SegmentMeta[]>([])
  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [minSilenceMs, setMinSilenceMs] = useState(700)
  const [silenceThreshDb, setSilenceThreshDb] = useState(-50)

  const { data: existingFiles, isLoading: filesLoading } = useQuery({
    queryKey: queryKeys.files(),
    queryFn: listFiles,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (filesLoading) return
    if (existingFiles && existingFiles.length > 0) setStage('resume')
    else setStage('upload')
  }, [existingFiles, filesLoading])

  const detectMutation = useMutation({
    mutationFn: (fileId: string) => detectSplitPoints(fileId, minSilenceMs, silenceThreshDb),
    onSuccess: (result) => {
      setSplitPointsRaw(result.split_points_ms)
      saveSplitPoints(result.file_id, result.split_points_ms).catch((err) =>
        console.error('[save-split-points] Failed after detect:', err),
      )
    },
    onError: (err) => console.error('[detect] Split-point detection failed:', err),
  })

  const persistPoints = useCallback(
    (pts: number[]) => {
      const fid = uploadRef.current?.file_id
      if (!fid) return
      if (saveDebounce.current) clearTimeout(saveDebounce.current)
      saveDebounce.current = setTimeout(() => {
        saveSplitPoints(fid, pts).catch((err) => console.error('[save-split-points] Failed:', err))
      }, 500)
    },
    [],
  )

  const handleSplitPointsChange = useCallback(
    (points: number[]) => {
      setSplitPointsRaw(points)
      persistPoints(points)
    },
    [persistPoints],
  )

  const handleAddSplit = useCallback(
    (positionMs: number) => {
      setSplitPointsRaw((prev) => {
        if (prev.includes(positionMs)) return prev
        const next = [...prev, positionMs].sort((a, b) => a - b)
        persistPoints(next)
        return next
      })
    },
    [persistPoints],
  )

  const handleUploaded = (result: UploadResponse) => {
    setUpload(result)
    setStage('working')
    detectMutation.mutate(result.file_id)
  }

  const handleResume = async (entry: FileEntry) => {
    try {
      const state = await getFileState(entry.file_id)
      const uploadLike: UploadResponse = {
        file_id: state.file_id,
        original_name: state.original_name,
        duration_ms: state.duration_ms,
        title: state.title,
        artist: state.artist,
        album: state.album,
        has_art: state.has_art,
      }
      const restoredMap = new Map(state.segments.map((s) => [s.index, s.segment_id]))
      setUpload(uploadLike)
      setSplitPointsRaw(state.split_points_ms)
      setSplitMap(restoredMap)
      setStage('working')
    } catch (err) {
      console.error('[resume] Failed to load session state:', err)
    }
  }

  const handleDeleteSession = async (fileId: string) => {
    await deleteFile(fileId)
    qc.invalidateQueries({ queryKey: queryKeys.files() })
    const remaining = (existingFiles ?? []).filter((f) => f.file_id !== fileId)
    if (remaining.length === 0) setStage('upload')
  }

  const handleReset = () => {
    setStage(existingFiles && existingFiles.length > 0 ? 'resume' : 'upload')
    setUpload(null)
    setSplitPointsRaw([])
    setSplitSegments([])
    setSplitMap(new Map())
    setFocusedIndex(null)
    qc.clear()
    qc.invalidateQueries({ queryKey: queryKeys.files() })
  }

  useEffect(() => {
    if (focusedIndex !== null && focusedIndex >= splitPoints.length - 1) setFocusedIndex(null)
  }, [splitPoints, focusedIndex])

  return {
    stage,
    setStage,
    upload,
    splitPoints,
    setSplitPoints: setSplitPointsRaw,
    splitMap,
    setSplitMap,
    focusedIndex,
    setFocusedIndex,
    existingFiles,
    filesLoading,
    detectMutation,
    minSilenceMs,
    setMinSilenceMs,
    silenceThreshDb,
    setSilenceThreshDb,
    handleUploaded,
    handleResume,
    handleDeleteSession,
    handleReset,
    handleSplitPointsChange,
    handleAddSplit,
    splitSegments,
    setSplitSegments,
  }
}
