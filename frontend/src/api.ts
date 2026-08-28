import { api } from '@/api/client'
import type {
  UploadResponse,
  DetectResponse,
  ApplyResponse,
  SegmentInfo,
  SegmentMeta,
  IdentifyResult,
  SuggestPromptResult,
  FileEntry,
  FileStateResponse,
} from '@/types'

export async function listFiles(): Promise<FileEntry[]> {
  const { data } = await api.get<FileEntry[]>('/files')
  return data
}

export async function getFileState(fileId: string): Promise<FileStateResponse> {
  const { data } = await api.get<FileStateResponse>(`/files/${fileId}/state`)
  return data
}

export async function saveSplitPoints(fileId: string, splitPointsMs: number[]): Promise<void> {
  await api.put(`/files/${fileId}/split-points`, { split_points_ms: splitPointsMs })
}

export async function deleteFile(fileId: string): Promise<void> {
  await api.delete(`/files/${fileId}`)
}

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadResponse>(
    '/upload',
    form,
    onProgress
      ? {
          onUploadProgress: (e) => {
            const total = e.total ?? file.size
            onProgress(Math.round((e.loaded / total) * 100))
          },
        }
      : {},
  )
  return data
}

export async function detectSplitPoints(
  fileId: string,
  minSilenceMs = 700,
  silenceThreshDb = -50,
): Promise<DetectResponse> {
  const { data } = await api.post<DetectResponse>('/split/detect', {
    file_id: fileId,
    min_silence_ms: minSilenceMs,
    silence_thresh_db: silenceThreshDb,
  })
  return data
}

// --- Async job variants (non-blocking, pollable) ---
export interface JobStatus {
  job_id: string
  kind: string
  status: 'pending' | 'running' | 'done' | 'failed'
  file_id: string | null
  segment_id: string | null
  result: Record<string, unknown> | null
  error: string | null
}

export async function createDetectJob(
  fileId: string,
  minSilenceMs = 700,
  silenceThreshDb = -50,
): Promise<{ job_id: string }> {
  const { data } = await api.post<{ job_id: string; status: string }>('/jobs/detect', {
    file_id: fileId,
    min_silence_ms: minSilenceMs,
    silence_thresh_db: silenceThreshDb,
  })
  return data
}

export async function createTranscribeJob(opts: {
  segment_id?: string
  file_id?: string
  start_ms?: number
  end_ms?: number
  idx?: number
  model?: string
}): Promise<{ job_id: string }> {
  const { data } = await api.post<{ job_id: string; status: string }>('/jobs/transcribe', {
    segment_id: opts.segment_id,
    file_id: opts.file_id,
    start_ms: opts.start_ms,
    end_ms: opts.end_ms,
    idx: opts.idx,
    model: opts.model ?? 'base',
  })
  return data
}

export async function createIdentifyJob(segmentId: string): Promise<{ job_id: string }> {
  const { data } = await api.post<{ job_id: string; status: string }>('/jobs/identify', {
    segment_id: segmentId,
  })
  return data
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const { data } = await api.get<JobStatus>(`/jobs/${jobId}`)
  return data
}

export async function pollJob(jobId: string, intervalMs = 800, timeoutMs = 300000): Promise<JobStatus> {
  const start = Date.now()
  while (true) {
    const job = await getJob(jobId)
    if (job.status === 'done' || job.status === 'failed') return job
    if (Date.now() - start > timeoutMs) throw new Error('Job polling timed out')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export async function detectSplitPointsAsync(
  fileId: string,
  minSilenceMs = 700,
  silenceThreshDb = -50,
): Promise<DetectResponse> {
  const { job_id } = await createDetectJob(fileId, minSilenceMs, silenceThreshDb)
  const job = await pollJob(job_id)
  if (job.status === 'failed') throw new Error(job.error ?? 'Detect job failed')
  const result = job.result as unknown as DetectResponse
  return result
}

export async function transcribeSegmentAsync(segmentId: string, model = 'base'): Promise<string> {
  const { job_id } = await createTranscribeJob({ segment_id: segmentId, model })
  const job = await pollJob(job_id, 1000)
  if (job.status === 'failed') throw new Error(job.error ?? 'Transcribe failed')
  return (job.result as { lyrics: string }).lyrics
}

export async function transcribePreviewAsync(
  fileId: string,
  startMs: number,
  endMs: number,
  idx: number,
  model = 'base',
): Promise<string> {
  const { job_id } = await createTranscribeJob({ file_id: fileId, start_ms: startMs, end_ms: endMs, idx, model })
  const job = await pollJob(job_id, 1000)
  if (job.status === 'failed') throw new Error(job.error ?? 'Transcribe failed')
  return (job.result as { lyrics: string }).lyrics
}

export async function identifySegmentAsync(segmentId: string): Promise<IdentifyResult> {
  const { job_id } = await createIdentifyJob(segmentId)
  const job = await pollJob(job_id, 800)
  if (job.status === 'failed') throw new Error(job.error ?? 'Identify failed')
  const r = job.result as unknown as IdentifyResult & { available: boolean }
  if (!r.available) return { ...(r as unknown as Record<string, unknown>), available: false } as unknown as IdentifyResult
  return r as unknown as IdentifyResult
}

export async function applySplit(fileId: string, splitPointsMs: number[]): Promise<ApplyResponse> {
  const { data } = await api.post<ApplyResponse>('/split/apply', {
    file_id: fileId,
    split_points_ms: splitPointsMs,
  })
  return data
}

export async function applySliceOne(
  fileId: string,
  index: number,
  startMs: number,
  endMs: number,
): Promise<SegmentInfo> {
  const { data } = await api.post<SegmentInfo>('/split/apply-one', {
    file_id: fileId,
    index,
    start_ms: startMs,
    end_ms: endMs,
  })
  return data
}

export async function updateBoundaries(
  segmentId: string,
  startMs: number,
  endMs: number,
): Promise<SegmentMeta> {
  const { data } = await api.patch<SegmentMeta>(`/segment/${segmentId}/boundaries`, {
    start_ms: startMs,
    end_ms: endMs,
  })
  return data
}

export async function getSegment(segmentId: string): Promise<SegmentMeta> {
  const { data } = await api.get<SegmentMeta>(`/segment/${segmentId}`)
  return data
}

export async function deleteSegment(segmentId: string): Promise<void> {
  await api.delete(`/segment/${segmentId}`)
}

export async function updateSegment(
  segmentId: string,
  patch: Partial<
    Omit<SegmentMeta, 'segment_id' | 'file_id' | 'index' | 'start_ms' | 'end_ms' | 'has_art'>
  >,
): Promise<SegmentMeta> {
  const { data } = await api.patch<SegmentMeta>(`/segment/${segmentId}`, patch)
  return data
}

export async function uploadArt(segmentId: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  await api.post(`/segment/${segmentId}/art`, form)
}

export async function uploadDraftArt(fileId: string, idx: number, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  await api.post(`/files/${fileId}/drafts/${idx}/art`, form)
}

export async function uploadArtFromUrl(segmentId: string, url: string): Promise<void> {
  await api.post(`/segment/${segmentId}/art-url`, { url })
}

export async function identifySegment(segmentId: string): Promise<IdentifyResult> {
  const { data } = await api.post<IdentifyResult>(`/segment/${segmentId}/identify`)
  return data
}

export async function suggestFromLyrics(segmentId: string): Promise<SuggestPromptResult> {
  const { data } = await api.post<SuggestPromptResult>(`/suggest/${segmentId}`)
  return data
}

export async function suggestFromText(lyrics: string): Promise<string> {
  const { data } = await api.post<{ prompt: string }>(`/suggest/preview`, { lyrics })
  return data.prompt
}

export async function suggestLyricsFromSegment(segmentId: string): Promise<string> {
  const { data } = await api.post<{ segment_id: string; prompt: string }>(`/suggest/lyrics/${segmentId}`)
  return data.prompt
}

export async function suggestLyricsFromText(title: string, artist: string, album?: string): Promise<string> {
  const { data } = await api.post<{ prompt: string }>(`/suggest/lyrics/preview`, { title, artist, album: album ?? '' })
  return data.prompt
}

export async function suggestArtworkFromSegment(segmentId: string): Promise<string> {
  const { data } = await api.post<{ segment_id: string; prompt: string }>(`/suggest/artwork/${segmentId}`)
  return data.prompt
}

export async function suggestArtworkFromText(title: string, artist: string, album?: string): Promise<string> {
  const { data } = await api.post<{ prompt: string }>(`/suggest/artwork/preview`, { title, artist, album: album ?? '' })
  return data.prompt
}

export async function fetchLyricsForSegment(
  segmentId: string,
  artist: string,
  title: string,
  album?: string,
): Promise<import('@/types').LyricsResult> {
  const { data } = await api.get<import('@/types').LyricsResult>(`/lyrics/${segmentId}`, {
    params: { artist, title, album },
  })
  return data
}

export async function searchLyrics(
  artist: string,
  title: string,
  album?: string,
): Promise<import('@/types').LyricsResult> {
  const { data } = await api.post<import('@/types').LyricsResult>('/lyrics/search', {
    artist,
    title,
    album,
  })
  return data
}

export async function transcribeSegment(segmentId: string): Promise<string> {
  const { data } = await api.post<{ segment_id: string; lyrics: string }>(
    `/transcribe/${segmentId}`,
    { model: 'base' },
  )
  return data.lyrics
}

export async function transcribePreview(fileId: string, startMs: number, endMs: number, idx: number): Promise<string> {
  const { data } = await api.post<{ file_id: string; lyrics: string }>(`/transcribe/preview`, {
    file_id: fileId,
    start_ms: startMs,
    end_ms: endMs,
    idx,
    model: 'base',
  })
  return data.lyrics
}

export async function patchDraft(fileId: string, idx: number, patch: Partial<import('@/types').DraftState>): Promise<import('@/types').DraftState> {
  const { data } = await api.patch<import('@/types').DraftState>(`/files/${fileId}/drafts/${idx}`, patch)
  return data
}

export async function listDrafts(fileId: string): Promise<import('@/types').DraftState[]> {
  const { data } = await api.get<import('@/types').DraftState[]>(`/files/${fileId}/drafts`)
  return data
}

export async function exportSingle(seg: SegmentMeta): Promise<void> {
  const resp = await api.post(
    '/export/single',
    {
      segment_id: seg.segment_id,
      title: seg.title,
      artist: seg.artist,
      album: seg.album,
      track: seg.track,
      year: seg.year,
      genre: seg.genre,
      lyrics: seg.lyrics,
      art_path: '',
    },
    { responseType: 'blob' },
  )
  const filename =
    resp.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] ??
    `${seg.title || seg.segment_id}.mp3`
  const url = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportAllZip(fileId: string, segments: SegmentMeta[]): Promise<void> {
  const resp = await api.post(
    '/export',
    {
      file_id: fileId,
      segments: segments.map((s) => ({
        segment_id: s.segment_id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        track: s.track,
        year: s.year,
        genre: s.genre,
        lyrics: s.lyrics,
        art_path: '',
      })),
    },
    { responseType: 'blob' },
  )
  const url = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = url
  a.download = `export_${fileId.slice(0, 8)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

export function segmentAudioUrl(segmentId: string): string {
  return `/segment/${segmentId}/audio`
}

export function previewAudioUrl(fileId: string, startMs: number, endMs: number): string {
  return `/files/${fileId}/preview?start_ms=${startMs}&end_ms=${endMs}`
}

export function segmentArtUrl(segmentId: string): string {
  return `/segment/${segmentId}/art`
}

export function draftArtUrl(fileId: string, idx: number): string {
  return `/files/${fileId}/drafts/${idx}/art`
}
