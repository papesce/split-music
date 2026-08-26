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

export interface DraftState {
  idx: number
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

export interface FileStateResponse extends FileEntry {
  split_points_ms: number[]
  segments: SessionSegmentRef[]
  drafts: DraftState[]
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

export interface SuggestPromptResult {
  segment_id: string
  prompt: string
}

export interface SuggestPasteResult {
  title: string
  artist: string
  year: string
  genre: string
  lyrics: string
  artwork: string
  artwork_options: string[]
  // markdown images pasted alongside JSON are extracted but not applied automatically
}

export interface LyricsResult {
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string
  syncedLyrics: string
  source: string
}
