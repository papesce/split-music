import { useState } from 'react'
import { msToTime, parseTimeInput } from '@/utils/trackUtils'

interface Props {
  valueMs: number
  onCommit: (ms: number) => void
  title?: string
}

export function TimeInput({ valueMs, onCommit, title }: Props) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')

  const display = msToTime(valueMs)

  const startEdit = () => {
    setRaw(display)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const ms = parseTimeInput(raw)
    if (ms !== null && ms !== valueMs) onCommit(ms)
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Escape') {
      setEditing(false)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      onCommit(valueMs + 1000)
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onCommit(Math.max(0, valueMs - 1000))
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="w-16 px-1 py-0 rounded border border-blue-400 text-xs text-zinc-800 tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder="m:ss"
        title={title}
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="px-1 py-0 rounded text-xs text-zinc-500 tabular-nums hover:bg-zinc-100 hover:text-zinc-800 transition-colors font-mono"
      title={`${title ?? 'Edit time'} — click to edit, ↑↓ to nudge ±1s`}
    >
      {display}
    </button>
  )
}
