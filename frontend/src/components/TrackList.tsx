import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SegmentMeta } from '@/types'
import { getSegment } from '@/api'
import { TrackEditor } from '@/components/TrackEditor'
import { listDrafts, patchDraft } from '@/api'
import { queryKeys } from '@/api/queryKeys'

type DeleteMode = 'mergePrev' | 'mergeNext' | 'discard'

interface TrackListProps {
  fileId: string
  splitPoints: number[]
  initialSplitMap?: Map<number, string>
  onSplitPointsChange: (points: number[]) => void
  onPlay: (index: number, startMs: number, endMs: number) => void
  onPause: () => void
  onStop?: (() => void) | undefined
  playingTrack: number | null
  waveformReady?: boolean | undefined
  onDeleteTrack: (index: number, mode: DeleteMode) => void
  onSplitComplete: (segments: SegmentMeta[]) => void
  onFocusTrack?: (index: number) => void
  focusedIndex?: number | null
  onExitFocus?: () => void
}

export function TrackList({ fileId, splitPoints, initialSplitMap, onSplitPointsChange, onPlay, onPause, onStop, playingTrack, waveformReady, onDeleteTrack, onSplitComplete, onFocusTrack, focusedIndex = null, onExitFocus }: TrackListProps) {
  const qc = useQueryClient()
  const trackCount = splitPoints.length - 1
  const isFocused = focusedIndex !== null && focusedIndex !== undefined

  const { data: drafts } = useQuery({ queryKey: queryKeys.drafts(fileId), queryFn: () => listDrafts(fileId) })

  const [selected, setSelected] = useState<Set<number>>(() => new Set(Array.from({ length: trackCount }, (_, i) => i)))
  useEffect(() => { setSelected(new Set(Array.from({ length: trackCount }, (_, i) => i))) }, [trackCount])

  const [splitMap, setSplitMap] = useState<Map<number, string>>(() => initialSplitMap ?? new Map())
  const [splitErrors] = useState<string[]>([])
  const [collapseSignal, setCollapseSignal] = useState(0)

  // keep splitMap in sync if parent changes initialSplitMap (e.g. clip in focused / unclip)
  useEffect(() => {
    if (initialSplitMap) {
      setSplitMap(new Map(initialSplitMap))
    }
  }, [initialSplitMap])

  useEffect(() => {
    if (!initialSplitMap || initialSplitMap.size === 0) return
    collectSegments(initialSplitMap).then(onSplitComplete).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleIndex = (i: number) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })
  }
  const toggleAll = () => setSelected((prev) => prev.size === trackCount ? new Set() : new Set(Array.from({ length: trackCount }, (_, i) => i)))
  const handleCollapseAll = useCallback(() => {
    setCollapseSignal((n) => n + 1)
    for (let i = 0; i < trackCount; i++) patchDraft(fileId, i, { expanded: false } as Partial<import('@/types').DraftState>).catch(() => {})
    qc.setQueryData(queryKeys.drafts(fileId), (old: import('@/types').DraftState[] | undefined) => old?.map((d) => ({ ...d, expanded: false })))
  }, [fileId, trackCount, qc])

  const collectSegments = useCallback((map: Map<number, string>): Promise<SegmentMeta[]> => Promise.all(Array.from(map.values()).map((sid) => getSegment(sid))), [])

  const handleRowSplit = useCallback(async (index: number, segmentId: string) => {
    setSplitMap((prev) => { const next = new Map(prev).set(index, segmentId); collectSegments(next).then(onSplitComplete); return next })
    qc.invalidateQueries({ queryKey: queryKeys.drafts(fileId) })
    qc.invalidateQueries({ queryKey: queryKeys.draft(fileId, index) })
  }, [collectSegments, onSplitComplete, qc, fileId])

  const handleRowUnclipped = useCallback((index: number) => {
    setSplitMap((prev) => {
      const next = new Map(prev)
      next.delete(index)
      collectSegments(next).then(onSplitComplete).catch(() => {})
      return next
    })
    qc.invalidateQueries({ queryKey: queryKeys.drafts(fileId) })
    qc.invalidateQueries({ queryKey: queryKeys.draft(fileId, index) })
  }, [collectSegments, onSplitComplete, qc, fileId])

  const handleSplitTrack = useCallback((index: number) => {
    const start = splitPoints[index]; const end = splitPoints[index + 1]; if (start===undefined||end===undefined) return; if (end-start<1000) return
    const mid = Math.floor((start+end)/2); if (mid<=start||mid>=end) return
    const next=[...splitPoints]; next.splice(index+1,0,mid); next.sort((a,b)=>a-b)
    setSplitMap((prev)=>{ const m=new Map<number,string>(); for(const [k,v] of prev){ if(k<index) m.set(k,v); else if(k>index) m.set(k+1,v)} collectSegments(m).then(onSplitComplete).catch(()=>{}); return m})
    onSplitPointsChange(next)
  }, [splitPoints, onSplitPointsChange, collectSegments, onSplitComplete])

  const handleDeleteTrackWrapper = useCallback((index:number, mode:DeleteMode)=>{
    setSplitMap((prev)=>{ const m=new Map<number,string>(); if(mode==='discard'){ for(const [k,v] of prev){ if(k<index) m.set(k,v); else if(k>index) m.set(k-1,v) } } else if(mode==='mergePrev'){ for(const [k,v] of prev){ if(k<index-1) m.set(k,v); else if(k>index) m.set(k-1,v)} } else { for(const [k,v] of prev){ if(k<index) m.set(k,v); else if(k>index+1) m.set(k-1,v)} } collectSegments(m).then(onSplitComplete).catch(()=>{}); return m})
    onDeleteTrack(index,mode)
  },[onDeleteTrack, collectSegments, onSplitComplete])

  const indices = isFocused ? [focusedIndex as number] : Array.from({length: trackCount}, (_,i)=>i)

  return (
    <section className="flex flex-col gap-3 pb-20">
      {splitErrors.length>0 && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><p className="font-semibold mb-1">Some tracks failed to split:</p><ul className="list-disc list-inside space-y-0.5">{splitErrors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
      {!isFocused && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-zinc-800">Tracks <span className="text-zinc-400 font-normal">({trackCount})</span></h2>
            <button onClick={toggleAll} className="text-xs text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline transition-colors">{selected.size===trackCount? 'Deselect all' : selected.size===0? 'Select all' : `${selected.size}/${trackCount} selected`}</button>
            <span className="text-zinc-300 text-xs">·</span>
            <button onClick={handleCollapseAll} className="text-xs text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline transition-colors">Collapse all</button>
          </div>
        </div>
      )}
      {isFocused && <div className="flex items-center justify-between"><h2 className="font-semibold text-zinc-800">Track {focusedIndex!+1} <span className="text-zinc-400 font-normal">focused</span></h2></div>}
      <div className="flex flex-col gap-3">
        {indices.map((i)=>{
          const startMs = splitPoints[i] as number
          const endMs = splitPoints[i+1] as number
          const draft = drafts?.find((d)=> d.idx===i)
          return (
            <TrackEditor
              key={`${fileId}-${i}`}
              id={`track-row-${i}`}
              fileId={fileId}
              index={i}
              startMs={startMs}
              endMs={endMs}
              segmentId={splitMap.get(i) ?? null}
              draft={draft}
              isPlaying={playingTrack===i}
              waveformReady={waveformReady}
              onPlay={()=> onPlay(i, startMs, endMs)}
              onPause={onPause}
              onStop={onStop}
              onBoundariesChange={(ns,ne)=>{ const updated=[...splitPoints]; updated[i]=ns; updated[i+1]=ne; onSplitPointsChange(updated)}}
              onSplit={(sid)=> handleRowSplit(i,sid)}
              onUnclipped={()=> handleRowUnclipped(i)}
              onDelete={(mode)=> handleDeleteTrackWrapper(i,mode)}
              onSplitTrack={()=> handleSplitTrack(i)}
              trackCount={trackCount}
              onFocus={isFocused? undefined : ()=> onFocusTrack?.(i)}
              onExitFocus={isFocused? onExitFocus : undefined}
              mode={isFocused? 'focused':'list'}
              selected={selected.has(i)}
              onToggleSelect={()=> toggleIndex(i)}
              collapseSignal={collapseSignal}
            />
          )
        })}
      </div>
    </section>
  )
}
