import axios from 'axios'
import type {
  UploadResponse,
  DetectResponse,
  ApplyResponse,
  SegmentInfo,
  SegmentMeta,
  IdentifyResult,
  FileEntry,
  FileStateResponse,
} from '@/types'

const api = axios.create({ baseURL: '/' })

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

export async function applySplit(fileId: string, splitPointsMs: number[]): Promise<ApplyResponse> {
  const { data } = await api.post<ApplyResponse>('/split/apply', {
    file_id: fileId,
    split_points_ms: splitPointsMs,
  })
  return data
}

export async function applySliceOne(
  fileId: string,
  startMs: number,
  endMs: number,
): Promise<SegmentInfo> {
  const { data } = await api.post<SegmentInfo>('/split/apply-one', {
    file_id: fileId,
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

export async function identifySegment(segmentId: string): Promise<IdentifyResult> {
  const { data } = await api.post<IdentifyResult>(`/segment/${segmentId}/identify`)
  return data
}

export async function transcribeSegment(segmentId: string): Promise<string> {
  const { data } = await api.post<{ segment_id: string; lyrics: string }>(
    `/transcribe/${segmentId}`,
    { model: 'base' },
  )
  return data.lyrics
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

export function segmentArtUrl(segmentId: string): string {
  return `/segment/${segmentId}/art`
}
