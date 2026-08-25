import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import type { SegmentMeta } from '@/types'

interface Props {
  fileId: string
  segments: SegmentMeta[]
}

export function ExportPanel({ fileId, segments }: Props) {
  const [done, setDone] = useState(false)

  const exportMutation = useMutation({
    mutationFn: async () => {
      const payload = {
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
      }
      const resp = await axios.post('/export', payload, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `export_${fileId.slice(0, 8)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => setDone(true),
  })

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-zinc-200 bg-white">
      <button
        onClick={() => { setDone(false); exportMutation.mutate() }}
        disabled={exportMutation.isPending || segments.length === 0}
        className="px-5 py-2 rounded-lg bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-40 transition-colors"
      >
        {exportMutation.isPending ? 'Exporting…' : '⬇ Export all as ZIP'}
      </button>

      {done && !exportMutation.isPending && (
        <span className="text-sm text-green-700">Download started!</span>
      )}
      {exportMutation.isError && (
        <span className="text-sm text-red-600">Export failed. Check the server logs.</span>
      )}

      <span className="text-xs text-zinc-400 ml-auto">
        {segments.length} track{segments.length !== 1 ? 's' : ''}
      </span>
    </div>
  )
}
