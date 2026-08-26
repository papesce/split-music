// Shared types mirroring the backend Pydantic models

export interface FileEntry {
  file_id: string
  original_name: string
  duration_ms: number
  title: string
  artist: string
  album: string
  has_art: boolean
}

export interface SessionSegmentRef {
  index: number
  segment_id: string
}

export interface FileStateResponse extends FileEntry {
  split_points_ms: number[]
  segments: SessionSegmentRef[]
}

export interface UploadResponse {
  file_id: string
  original_name: string
  duration_ms: number
  title: string
  artist: string
  album: string
  has_art: boolean
}

export interface DetectResponse {
  file_id: string
  split_points_ms: number[]
}

export interface SegmentInfo {
  segment_id: string
  index: number
  start_ms: number
  end_ms: number
}

export interface ApplyResponse {
  file_id: string
  segments: SegmentInfo[]
}

export interface SegmentMeta {
  segment_id: string
  file_id: string
  index: number
  start_ms: number
  end_ms: number
  title: string
  artist: string
  album: string
  track: string
  year: string
  genre: string
  lyrics: string
  has_art: boolean
}

export interface IdentifyResult {
  segment_id: string
  title: string
  artist: string
  album: string
  year: string
  mbid: string
  confidence: number
  available: boolean
}
