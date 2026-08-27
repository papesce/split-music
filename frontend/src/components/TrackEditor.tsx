import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
import type { SegmentMeta, DraftState, SuggestPasteResult, LyricsResult } from '@/types'
import {
  getSegment,
  updateBoundaries,
  identifySegmentAsync,
  segmentAudioUrl,
  segmentArtUrl,
  draftArtUrl,
  applySliceOne,
  updateSegment,
  uploadArt,
  uploadDraftArt,
  deleteSegment,
  transcribeSegmentAsync,
  transcribePreviewAsync,
  suggestFromLyrics,
  fetchLyricsForSegment,
  searchLyrics,
  suggestLyricsFromSegment,
  patchDraft,
  suggestFromText,
  suggestLyricsFromText,
  exportSingle,
} from '@/api'
import { msDuration } from '@/utils/trackUtils'
import { TimeInput } from '@/components/TimeInput'
import { TRACK_FIELDS } from '@/utils/trackUtils'
import { SuggestModal } from '@/components/SuggestModal'
import { LyricsSearchModal } from '@/components/LyricsSearchModal'
import { FormatLyricsModal } from '@/components/FormatLyricsModal'

type DeleteMode = 'mergePrev' | 'mergeNext' | 'discard'

interface Props {
  id?: string
  fileId: string
  index: number
  startMs: number
  endMs: number
  segmentId: string | null
  draft?: DraftState | undefined
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onBoundariesChange: (s: number, e: number) => void
  onSplit: (sid: string) => void
  onUnclipped?: () => void
  onDelete: (mode: DeleteMode) => void
  onSplitTrack: () => void
  trackCount?: number
  onFocus?: (() => void) | undefined
  onExitFocus?: (() => void) | undefined
  mode: 'list' | 'focused'
  selected?: boolean
  onToggleSelect?: () => void
  collapseSignal?: number
  focused?: boolean // legacy compat, maps to mode==='focused'
}

function LyricsPreviewModal({ result, currentLyrics, onInsert, onClose }: { result: LyricsResult; currentLyrics: string; onInsert: (mode: 'replace'|'append')=>void; onClose: ()=>void }) {
  const [copied, setCopied] = useState(false)
  const lyrics = result.plainLyrics || ''
  function handleCopy(){ navigator.clipboard.writeText(lyrics).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000)})}
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e)=> e.target===e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 flex flex-col gap-4 p-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Lyrics from LRClib<span className="ml-2 text-xs font-normal text-zinc-500">{result.artistName} — {result.trackName}{result.albumName?` · ${result.albumName}`:''}</span></h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none" aria-label="Close">✕</button>
        </div>
        {currentLyrics.trim() && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Track already has lyrics — Replace will overwrite, Append will add below.</p>}
        <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed text-zinc-700 overflow-y-auto flex-1 min-h-[200px] max-h-[50vh]">{lyrics}</pre>
        <div className="flex items-center justify-between">
          <button onClick={handleCopy} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">{copied?'✓ Copied':'Copy'}</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">Cancel</button>
            {currentLyrics.trim() && <button onClick={()=>onInsert('append')} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors">Append</button>}
            <button onClick={()=>onInsert('replace')} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">{currentLyrics.trim()?'Replace':'Insert into track'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TrackEditor(props: Props) {
  const { id, fileId, index, startMs, endMs, segmentId, draft, isPlaying, onPlay, onPause, onBoundariesChange, onSplit, onUnclipped, onDelete, onSplitTrack, trackCount, onFocus, onExitFocus, mode, selected, onToggleSelect, collapseSignal } = props
  const qc = useQueryClient()
  const isSplit = segmentId !== null
  const isFocusedMode = mode === 'focused'
  // expanded: collapsed in list by default, expanded forced in focused (no toggle)
  const [expanded, setExpanded] = useState<boolean>(() => isFocusedMode ? true : (draft?.expanded ?? false))
  const [confirmDelete, setConfirmDelete] = useState(false)

  // keep expanded in sync: focused always true, list follows draft/collapseSignal
  useEffect(() => { if (isFocusedMode) setExpanded(true) }, [isFocusedMode])
  useEffect(() => { if (!isFocusedMode && draft?.expanded !== undefined) setExpanded(draft.expanded) }, [draft?.expanded, isFocusedMode])
  useEffect(() => { if (!isFocusedMode && collapseSignal) setExpanded(false) }, [collapseSignal, isFocusedMode])

  const persistExpanded = useCallback((next: boolean) => {
    if (isFocusedMode) return
    setExpanded(next)
    patchDraft(fileId, index, { expanded: next } as Partial<DraftState>).then(()=> qc.invalidateQueries({ queryKey: queryKeys.drafts(fileId)})).catch(()=>{})
  }, [fileId, index, qc, isFocusedMode])

  useEffect(()=>{ if(!confirmDelete) return; const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') setConfirmDelete(false)}; window.addEventListener('keydown',onKey); return()=> window.removeEventListener('keydown',onKey)},[confirmDelete])

  const { data: seg } = useQuery<SegmentMeta>({ queryKey: queryKeys.segment(segmentId as string), queryFn: ()=> getSegment(segmentId as string), enabled: isSplit })

  const [fields, setFields] = useState({ title:'', artist:'', album:'', track:'', year:'', genre:'' })
  const [lyrics, setLyrics] = useState('')

  // Sync from seg when split, otherwise from draft. Preserve draft values on clip transition.
  const prevIsSplit = useRef(isSplit)
  useEffect(()=> {
    if (isSplit && seg) {
      // if we just clipped and local fields already have draft data, don't clobber with empty seg
      const segHasData = !!(seg.title || seg.artist || seg.lyrics)
      const localHasData = !!(fields.title || fields.artist || lyrics)
      if (!prevIsSplit.current && localHasData && !segHasData) {
        // push local draft data to new segment
        const patch: Partial<SegmentMeta> = {}
        if (fields.title) patch.title = fields.title
        if (fields.artist) patch.artist = fields.artist
        if (fields.album) patch.album = fields.album
        if (fields.track) patch.track = fields.track
        if (fields.year) patch.year = fields.year
        if (fields.genre) patch.genre = fields.genre
        if (lyrics) (patch as any).lyrics = lyrics
        if (Object.keys(patch).length) { updateSegment(segmentId as string, patch).then(u=> qc.setQueryData(queryKeys.segment(segmentId as string), u)).catch(()=>{}) }
      } else {
        setFields({ title: seg.title, artist: seg.artist, album: seg.album, track: seg.track, year: seg.year, genre: seg.genre })
        setLyrics(seg.lyrics)
      }
    } else if (!isSplit) {
      setFields({ title: draft?.title ?? '', artist: draft?.artist ?? '', album: draft?.album ?? '', track: draft?.track ?? String(index+1), year: draft?.year ?? '', genre: draft?.genre ?? '' })
      setLyrics(draft?.lyrics ?? '')
    }
    prevIsSplit.current = isSplit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, draft, isSplit])

  // boundary
  const boundaryDebounce = useRef<ReturnType<typeof setTimeout>|null>(null)
  const boundaryMutation = useMutation({ mutationFn: ({s,e}:{s:number;e:number})=> updateBoundaries(segmentId as string, s,e), onSuccess:(u)=> qc.setQueryData(queryKeys.segment(segmentId as string), u)})
  const handleBoundaryChange = useCallback((newStart:number,newEnd:number)=>{
    onBoundariesChange(newStart,newEnd)
    if(!isSplit) return
    if(boundaryDebounce.current) clearTimeout(boundaryDebounce.current)
    boundaryDebounce.current = setTimeout(()=> boundaryMutation.mutate({s:newStart,e:newEnd}),400)
  },[isSplit,onBoundariesChange,boundaryMutation])

  const identifyMutation = useMutation({
    mutationFn: ()=> identifySegmentAsync(segmentId as string),
    onSuccess: (result)=>{
      if(!result.available) return
      const patch: Partial<SegmentMeta>={}
      const updated={...fields}
      for(const k of ['title','artist','album','year'] as const){ if(result[k] && !fields[k]){ updated[k]=result[k]; patch[k]=result[k]}}
      setFields(updated)
      qc.setQueryData(queryKeys.segment(segmentId as string), (old:SegmentMeta)=> ({...old, ...patch}))
      if(result.mbid) setTimeout(()=> qc.invalidateQueries({queryKey:queryKeys.segment(segmentId as string)}),4000)
    }
  })

  const splitMutation = useMutation({
    mutationFn: ()=> applySliceOne(fileId,index,startMs,endMs),
    onSuccess: (info)=> onSplit(info.segment_id)
  })

  const unsplitMutation = useMutation({
    mutationFn: ()=> deleteSegment(segmentId as string),
    onSuccess: ()=> {
      qc.removeQueries({ queryKey: queryKeys.segment(segmentId as string) })
      qc.invalidateQueries({ queryKey: queryKeys.drafts(fileId) })
      qc.invalidateQueries({ queryKey: queryKeys.draft(fileId, index) })
      onUnclipped?.()
    }
  })

  // draft/segment save + aux mutations
  const [suggestPrompt, setSuggestPrompt] = useState<string|null>(null)
  const [lyricsSearchPrompt, setLyricsSearchPrompt] = useState<string|null>(null)
  const [lyricsResult, setLyricsResult] = useState<LyricsResult|null>(null)
  const [lyricsError, setLyricsError] = useState('')
  const [lyricsErrorDetails, setLyricsErrorDetails] = useState<{status?: number | undefined; detail:string; query:string}|null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [artError, setArtError] = useState('')

  useEffect(()=>{ setLyricsResult(null); setLyricsError(''); setLyricsErrorDetails(null); setFormatOpen(false)},[segmentId])

  const saveMutationSeg = useMutation({ mutationFn: (patch:Partial<SegmentMeta>)=> updateSegment(segmentId as string, patch), onSuccess:(u)=> qc.setQueryData(queryKeys.segment(segmentId as string), u)})
  const saveMutationDraft = useMutation({
    mutationFn: (patch:Partial<DraftState>)=> patchDraft(fileId, index, {...patch, start_ms:startMs, end_ms:endMs}),
    onSuccess:(u)=> qc.setQueryData(queryKeys.draft(fileId, index), u)
  })
  const handleSaveField = (key:string, val:string)=>{
    if(isSplit) saveMutationSeg.mutate({[key]:val} as any)
    else { saveMutationDraft.mutate({[key]:val} as any); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)})}
  }
  const handleSaveLyrics = (val:string)=>{
    if(isSplit){ saveMutationSeg.mutate({lyrics:val} as any); qc.setQueryData(queryKeys.segment(segmentId as string), (o:SegmentMeta)=> ({...o as SegmentMeta, lyrics: val}))}
    else { saveMutationDraft.mutate({lyrics:val} as any); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)}); qc.invalidateQueries({queryKey:queryKeys.draft(fileId, index)})}
  }

  const artMutation = useMutation({ mutationFn:(file:File)=> isSplit ? uploadArt(segmentId as string, file) : uploadDraftArt(fileId, index, file), onSuccess:()=>{ setArtError(''); if(isSplit) qc.invalidateQueries({queryKey:queryKeys.segment(segmentId as string)}); else { qc.invalidateQueries({queryKey:queryKeys.draft(fileId, index)}); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)}) }}, onError:(err:unknown)=>{ const msg = err instanceof Error? err.message : (err as any)?.response?.data?.detail ?? 'Upload failed'; setArtError(String(msg)) }})
  const transcribeMutationSeg = useMutation({ mutationFn: ()=> transcribeSegmentAsync(segmentId as string), onSuccess:(text)=>{ setLyrics(text); qc.setQueryData(queryKeys.segment(segmentId as string), (o:SegmentMeta)=> ({...o, lyrics:text}))}})
  const transcribeMutationDraft = useMutation({ mutationFn: ()=> transcribePreviewAsync(fileId,startMs,endMs,index), onSuccess:(text)=>{ setLyrics(text); qc.setQueryData(queryKeys.draft(fileId, index), (o:DraftState|undefined)=> ({...(o as DraftState), lyrics:text, idx:index, file_id:fileId})); qc.invalidateQueries({queryKey:queryKeys.draft(fileId, index)}); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)})}})
  const suggestMutationSeg = useMutation({ mutationFn: ()=> suggestFromLyrics(segmentId as string), onSuccess:(r)=> setSuggestPrompt(r.prompt)})
  const suggestMutationDraft = useMutation({ mutationFn: ()=> suggestFromText(lyrics), onSuccess:(p)=> setSuggestPrompt(p)})
  const lyricsSearchMutationSeg = useMutation({ mutationFn: ()=> suggestLyricsFromSegment(segmentId as string), onSuccess:(p)=> setLyricsSearchPrompt(p), onError:(err:unknown)=>{ const msg = err instanceof Error? err.message: String(err); const ax=(err as any)?.response?.data?.detail ?? msg; setLyricsError(ax)}})
  const lyricsSearchMutationDraft = useMutation({ mutationFn: ()=> suggestLyricsFromText(fields.title, fields.artist, fields.album), onSuccess:(p)=> setLyricsSearchPrompt(p)})
  const lyricsFetchMutation = useMutation({
    mutationFn: ()=> isSplit ? fetchLyricsForSegment(segmentId as string, fields.artist, fields.title, fields.album) : searchLyrics(fields.artist, fields.title, fields.album),
    onSuccess:(result)=>{
      const hasLyrics = Boolean((result.plainLyrics||'').trim() || (result.syncedLyrics||'').trim())
      if(!hasLyrics){ const query=[fields.artist.trim(),fields.title.trim(),fields.album.trim()].filter(Boolean).join(' — '); const msg=`LRClib returned no lyrics for “${query}”.`; setLyricsError(msg); setLyricsErrorDetails({status:200, detail:'Empty plainLyrics/syncedLyrics', query}); setLyricsResult(null); return }
      setLyricsError(''); setLyricsErrorDetails(null); setLyricsResult(result)
    },
    onError:(err:unknown)=>{
      const ax=err as {message?:string; response?:{status?:number; data?:{detail?:string}}}
      const status=ax?.response?.status; const detail=ax?.response?.data?.detail ?? ax?.message ?? 'Lyrics fetch failed'
      const query=[fields.artist.trim(),fields.title.trim(),fields.album.trim()].filter(Boolean).join(' — ') || `${fields.artist} / ${fields.title}`
      let enriched=detail
      if(status===404 && detail.toLowerCase().includes('no lyrics found')){ const hasMedley=fields.title.includes('/')||fields.artist.includes('/'); enriched=`${detail} — no LRClib match for “${query}”.${hasMedley?' Title/artist contains “/” (medley); try searching each song separately.':''} Try fixing spelling, removing album, or checking https://lrclib.net`}
      else if(status===404 && detail.toLowerCase().includes('instrumental')) enriched=`${detail} — LRClib marks this track as instrumental.`
      else if(status) enriched=`[${status}] ${detail}`
      setLyricsError(enriched); setLyricsErrorDetails({status, detail, query})
    }
  })

  function handleInsertLyrics(mode:'replace'|'append'){
    if(!lyricsResult) return
    const fetched=(lyricsResult.plainLyrics||'').trim(); if(!fetched) return
    const next = mode==='replace' || !lyrics.trim() ? fetched : `${lyrics.trim()}\n\n${fetched}`
    setLyrics(next)
    if(isSplit){ qc.setQueryData(queryKeys.segment(segmentId as string), (o:SegmentMeta)=> ({...(o as SegmentMeta), lyrics: next})); saveMutationSeg.mutate({lyrics: next} as any)}
    else { saveMutationDraft.mutate({lyrics: next} as any); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)}); qc.invalidateQueries({queryKey:queryKeys.draft(fileId, index)})}
    setLyricsResult(null)
  }
  function applyPasteResult(result:SuggestPasteResult){
    if(isSplit){
      const patch: Partial<SegmentMeta>={ title: result.title || fields.title, artist: result.artist || fields.artist, year: result.year || fields.year, genre: result.genre || fields.genre }
      const corrected=result.lyrics?.trim()? result.lyrics : ''
      if(corrected){ setLyrics(corrected); (patch as any).lyrics=corrected; qc.setQueryData(queryKeys.segment(segmentId as string), (o:SegmentMeta)=> ({...o, ...patch, lyrics:corrected}))}
      else qc.setQueryData(queryKeys.segment(segmentId as string), (o:SegmentMeta)=> ({...o, ...patch}))
      setFields({...fields, title:String(patch.title), artist:String(patch.artist), year:String(patch.year), genre:String(patch.genre)})
      saveMutationSeg.mutate(patch as any)
    } else {
      const patch:Partial<DraftState>={}
      if(result.title){ patch.title=result.title; setFields(f=>({...f,title:result.title}))}
      if(result.artist){ patch.artist=result.artist; setFields(f=>({...f,artist:result.artist}))}
      if(result.year){ patch.year=result.year; setFields(f=>({...f,year:result.year}))}
      if(result.genre){ patch.genre=result.genre; setFields(f=>({...f,genre:result.genre}))}
      if(result.lyrics?.trim()){ patch.lyrics=result.lyrics; setLyrics(result.lyrics)}
      if(Object.keys(patch).length>0){ saveMutationDraft.mutate(patch); qc.invalidateQueries({queryKey:queryKeys.drafts(fileId)}); qc.invalidateQueries({queryKey:queryKeys.draft(fileId, index)})}
    }
    setSuggestPrompt(null)
  }

  const identifyResult = identifyMutation.data
  const confidence = identifyResult?.confidence ?? 0
  const identified = identifyResult?.available && confidence > 0.6
  const isDone = isSplit && !!fields.title && !!fields.artist
  const draftHasData = !isSplit && !!draft && (!!draft.title || !!draft.lyrics)
  const canFetchLyrics = Boolean(fields.title.trim() && fields.artist.trim())
  const showFocusedExit = isFocusedMode && onExitFocus

  return (
    <div id={id} className={['border rounded-xl overflow-hidden bg-white transition-opacity', selected===false?'border-zinc-100 opacity-40':'border-zinc-200'].join(' ')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 select-none">
        {mode==='list' && onToggleSelect && (
          <div onClick={onToggleSelect} className="shrink-0 cursor-pointer" title={selected?'Deselect track':'Select track'}>
            <div className={['w-4 h-4 rounded border-2 flex items-center justify-center transition-colors', selected?'bg-blue-600 border-blue-600':'bg-white border-zinc-300 hover:border-zinc-400'].join(' ')}>
              {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
            </div>
          </div>
        )}
        <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
          {isSplit && seg?.has_art ? <img src={segmentArtUrl(segmentId as string)} alt="cover" className="w-full h-full object-cover"/> : !isSplit && draft?.has_art ? <img src={draftArtUrl(fileId, index)} alt="cover" className="w-full h-full object-cover"/> : <svg className="w-5 h-5 text-zinc-300" fill="currentColor" viewBox="0 0 20 20"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-medium text-sm text-zinc-800 truncate">{isSplit ? (fields.title || seg?.title || `Track ${index+1}`) : (draft?.title || `Track ${index+1}`)}</p>
            {!isSplit && draftHasData && !expanded && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">draft</span>}
            {isDone && !expanded && fields.artist && <span className="text-xs text-zinc-400 truncate hidden sm:inline">{fields.artist}</span>}
            {isSplit && identified && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">✓ ID'd</span>}
            {isSplit && identifyMutation.isPending && <span className="shrink-0 text-[10px] text-zinc-400">identifying…</span>}
            {isSplit && identifyResult && !identified && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">low confidence</span>}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <TimeInput valueMs={startMs} onCommit={(ms)=> handleBoundaryChange(ms, endMs)} title="Edit start time"/>
            <span className="text-zinc-300 text-xs">→</span>
            <TimeInput valueMs={endMs} onCommit={(ms)=> handleBoundaryChange(startMs, ms)} title="Edit end time"/>
            <span className="ml-1 text-zinc-300 text-xs">{msDuration(startMs,endMs)}</span>
            {boundaryMutation.isPending && <span className="ml-1 text-blue-400 text-xs">re-slicing…</span>}
          </div>
        </div>
        {onFocus && mode==='list' && <button onClick={onFocus} title="Focus this track (zoom waveform, expand editor)" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></button>}
        <button onClick={isPlaying? onPause: onPlay} title={isPlaying?'Pause':'Preview'} className={isFocusedMode ? "shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors" : "shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"}>
          {isPlaying? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z"/></svg> : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.34-5.89a1.5 1.5 0 000-2.54L6.3 2.84z"/></svg>}
        </button>
        {isSplit && <button onClick={()=> identifyMutation.mutate()} disabled={identifyMutation.isPending} title="Auto-identify" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-40"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/></svg></button>}
        {isSplit && seg && <button onClick={()=> exportSingle(seg)} title="Download as MP3" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>}
        {isSplit && <button onClick={()=> unsplitMutation.mutate()} disabled={unsplitMutation.isPending} title="Discard split MP3 and go back to pre-split (draft) state" className="shrink-0 px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 text-xs hover:bg-amber-50 disabled:opacity-40 transition-colors whitespace-nowrap">{unsplitMutation.isPending?'Discarding…':'Unclip'}</button>}
        {!isSplit && <button onClick={()=> splitMutation.mutate()} disabled={splitMutation.isPending || (mode==='list' && selected===false)} title={mode==='list' && selected===false?'Select track first':'Split this track'} className="shrink-0 px-3 py-1.5 rounded-lg border border-zinc-200 text-xs hover:bg-zinc-50 disabled:opacity-40">{splitMutation.isPending?'Splitting…':'Split'}</button>}
        {!isFocusedMode && <button onClick={()=> persistExpanded(!expanded)} title={expanded?'Collapse':'Expand'} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-zinc-300 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"><svg className={`w-3.5 h-3.5 transition-transform ${expanded?'rotate-180':''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></button>}
        <button onClick={onSplitTrack} disabled={endMs-startMs<1000} title={endMs-startMs<1000?'Track too short to split':'Split this track in two at midpoint'} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zM9.879 9.879L4 4m5.879 5.879a3 3 0 104.243-4.243 3 3 0 00-4.243 4.243z"/></svg></button>
        <button onClick={()=> setConfirmDelete(true)} title="Remove this track" className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
        {showFocusedExit && <button onClick={onExitFocus} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Exit focus"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>}
      </div>

      {confirmDelete && (()=>{ const isFirst=index===0; const isLast=trackCount!==undefined? index===trackCount-1:false; const canMergePrev=!isFirst; const canMergeNext=!isLast; const canDiscard=trackCount===undefined || trackCount>1; return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={()=> setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={e=> e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-sm font-semibold text-zinc-800">Remove track {index+1}?</h3><p className="mt-1.5 text-sm text-zinc-500">Choose what to do with this track's audio.</p>
            <div className="mt-4 flex flex-col gap-2">
              <button onClick={()=>{ setConfirmDelete(false); onDelete('mergePrev')}} disabled={!canMergePrev} className="w-full rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors">Merge with previous<span className="block text-xs font-normal text-zinc-400">Audio joins track {index}</span></button>
              <button onClick={()=>{ setConfirmDelete(false); onDelete('mergeNext')}} disabled={!canMergeNext} className="w-full rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors">Merge with next<span className="block text-xs font-normal text-zinc-400">Audio joins track {index+2}</span></button>
              <button onClick={()=>{ setConfirmDelete(false); onDelete('discard')}} disabled={!canDiscard} className="w-full rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors">Discard<span className="block text-xs font-normal text-red-200">Audio is removed, later tracks shift to close gap</span></button>
            </div>
            <div className="mt-3 flex justify-end"><button onClick={()=> setConfirmDelete(false)} className="rounded-lg border border-zinc-200 px-3.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">Cancel</button></div>
          </div>
        </div>
      )})()}

      {/* Clipped preview bar - preserves everything, just adds */}
      {isSplit && expanded && seg && (
        <div className="px-4 pb-2"><audio key={`${segmentId}-${seg.start_ms}-${seg.end_ms}`} src={segmentAudioUrl(segmentId as string)} controls className="h-8 w-full"/></div>
      )}

      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50 flex flex-col gap-3">
          {suggestPrompt!==null && <SuggestModal prompt={suggestPrompt} onApply={applyPasteResult} onClose={()=> setSuggestPrompt(null)}/>}
          {lyricsSearchPrompt!==null && <LyricsSearchModal prompt={lyricsSearchPrompt} onClose={()=> setLyricsSearchPrompt(null)} onApply={(formatted)=>{ setLyrics(formatted); handleSaveLyrics(formatted); setLyricsSearchPrompt(null)}}/>}
          {lyricsResult && <LyricsPreviewModal result={lyricsResult} currentLyrics={lyrics} onInsert={handleInsertLyrics} onClose={()=> setLyricsResult(null)}/>}
          {formatOpen && <FormatLyricsModal initialText={lyrics} onClose={()=> setFormatOpen(false)} onApply={(formatted)=>{ setLyrics(formatted); handleSaveLyrics(formatted); setFormatOpen(false)}}/>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {TRACK_FIELDS.map(({key,label,size})=> (
              <label key={key} className={`flex flex-col gap-0.5 ${size || 'sm:col-span-2'}`}>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
                <input className="px-2 py-1.5 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" value={fields[key as keyof typeof fields]} onChange={(e)=> setFields({...fields, [key]: e.target.value})} onBlur={(e)=> handleSaveField(key, e.target.value)}/>
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 -mt-1">
            <div className="flex items-center gap-2">
              <button onClick={()=>{ setLyricsError(''); setLyricsErrorDetails(null); setLyricsResult(null); lyricsFetchMutation.reset(); lyricsFetchMutation.mutate()}} disabled={!canFetchLyrics || lyricsFetchMutation.isPending} title={!canFetchLyrics?'Enter title and artist first':'Fetch lyrics from LRClib'} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">{lyricsFetchMutation.isPending?'Searching…':'♪ Fetch lyrics'}</button>
              <span className="text-[11px] text-zinc-500">via LRClib{!lyricsError && lyricsResult && lyricsFetchMutation.isSuccess && <span className="text-emerald-600 ml-2">found — preview opened</span>}</span>
            </div>
            {lyricsError && lyricsErrorDetails && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2"><p className="text-xs text-red-700 leading-relaxed break-words">{lyricsError}</p><button onClick={()=>{ setLyricsError(''); setLyricsErrorDetails(null)}} className="text-red-400 hover:text-red-600 text-xs shrink-0">✕</button></div>
                <p className="text-[11px] text-zinc-600">Searched: <span className="font-medium text-zinc-800">{lyricsErrorDetails.query}</span>{lyricsErrorDetails.status && <span className="text-zinc-500"> · HTTP {lyricsErrorDetails.status}</span>}</p>
                {lyricsErrorDetails.status===404 && <p className="text-[11px] text-zinc-500 leading-relaxed">Tip: verify spelling on <a href={`https://lrclib.net/search?q=${encodeURIComponent(lyricsErrorDetails.query)}`} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-700 underline">LRClib search</a>. For medleys, fetch each track individually.</p>}
              </div>
            )}
            {lyricsError && !lyricsErrorDetails && <p className="text-xs text-red-500">{lyricsError}</p>}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide w-14 shrink-0">Cover art</span>
            {isSplit ? (
              seg?.has_art && <img src={segmentArtUrl(segmentId as string)} alt="cover" className="w-12 h-12 rounded object-cover border border-zinc-200"/>
            ) : (
              draft?.has_art && <img src={draftArtUrl(fileId, index)} alt="cover" className="w-12 h-12 rounded object-cover border border-zinc-200"/>
            )}
            <label className="cursor-pointer px-3 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors">{artMutation.isPending?'Uploading…':'Upload image'}<input type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if(f) artMutation.mutate(f); e.target.value=''}}/></label>
            {artMutation.isError && artError && <span className="text-xs text-red-500 max-w-[200px] truncate" title={artError}>{artError}</span>}
            {artMutation.isSuccess && !artError && <span className="text-xs text-green-600">✓ Saved (converted to JPEG 800px)</span>}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">Lyrics</span>
              <div className="flex items-center gap-2">
                <button onClick={()=> (isSplit? lyricsSearchMutationSeg: lyricsSearchMutationDraft).mutate()} disabled={(isSplit? lyricsSearchMutationSeg: lyricsSearchMutationDraft).isPending || !fields.title.trim() || !fields.artist.trim()} title={!fields.title.trim()||!fields.artist.trim()?'Enter title and artist first':'Copy prompt to search lyrics via ChatGPT'} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">{(isSplit? lyricsSearchMutationSeg: lyricsSearchMutationDraft).isPending?'Building…':'✦ Search lyrics'}</button>
                <button onClick={()=> setFormatOpen(true)} title="Paste raw lyrics and normalize formatting" className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors">{isSplit?'Format lyrics':'Enter lyrics'}</button>
                <button onClick={()=> (isSplit? transcribeMutationSeg: transcribeMutationDraft).mutate()} disabled={(isSplit? transcribeMutationSeg: transcribeMutationDraft).isPending} className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">{(isSplit? transcribeMutationSeg: transcribeMutationDraft).isPending?'Transcribing…':'✦ Whisper'}</button>
                <button onClick={()=> (isSplit? suggestMutationSeg: suggestMutationDraft).mutate()} disabled={(isSplit? suggestMutationSeg: suggestMutationDraft).isPending || !lyrics.trim()} title={!lyrics.trim()?'Transcribe lyrics first':'Copy prompt for ChatGPT'} className="text-xs px-2.5 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">{(isSplit? suggestMutationSeg: suggestMutationDraft).isPending?'Building…':'✦ Suggest'}</button>
              </div>
            </div>
            <textarea className={`w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFocusedMode?'min-h-[40vh] lg:min-h-[50vh]':'h-24'}`} value={lyrics} placeholder="No lyrics yet…" onChange={(e)=> setLyrics(e.target.value)} onBlur={(e)=> handleSaveLyrics(e.target.value)}/>
            {!isSplit && <p className="text-[11px] text-zinc-400">Lyrics are saved automatically and will be carried over when you Split this track.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
