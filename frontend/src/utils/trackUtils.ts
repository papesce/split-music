// Shared helpers used across TrackList and its sub-components

export function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

export function msDuration(startMs: number, endMs: number): string {
  const s = Math.round((endMs - startMs) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

/** Parse "m:ss", "h:mm:ss", or plain seconds into milliseconds. Returns null on invalid input. */
export function parseTimeInput(s: string): number | null {
  const trimmed = s.trim()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000
  const parts = trimmed.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 2) {
    const [m = 0, sec = 0] = parts
    return (m * 60 + sec) * 1000
  }
  if (parts.length === 3) {
    const [h = 0, m = 0, sec = 0] = parts
    return (h * 3600 + m * 60 + sec) * 1000
  }
  return null
}

export const TRACK_FIELDS = [
  { key: 'title', label: 'Title', size: 'col-span-2 sm:col-span-2' },
  { key: 'artist', label: 'Artist', size: 'col-span-2 sm:col-span-2' },
  { key: 'album', label: 'Album', size: 'col-span-2 sm:col-span-2' },
  { key: 'track', label: 'Track #', size: '' },
  { key: 'year', label: 'Year', size: '' },
  { key: 'genre', label: 'Genre', size: '' },
] as const
