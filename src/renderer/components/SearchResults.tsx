import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Entry } from '../../shared/types'
import { VolumeBadgeDot } from './VolumeBadge'

// Same rationale as FilesView: search can match huge numbers of entries, and both
// mounting a card per match AND fetching every match up front used to hang/crash
// the renderer or stall on the IPC round-trip. Only the cards intersecting the
// horizontal viewport are ever in the DOM, and only their page of results is ever
// fetched — the rest of the match set is neither transferred nor held in memory.
const CARD_WIDTH = 140
const CARD_GAP = 10
const H_PADDING = 14
const OVERSCAN_PX = 400
const PAGE_SIZE = 200

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6', video: '#8b5cf6', audio: '#10b981', document: '#f59e0b', journal: '#ec4899',
}
const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
}

function ResultCard({ entry, onOpen }: { entry: Entry; onOpen: (id: number) => void }) {
  const { selectedIds, setSelection } = useStore()
  const isSelected = selectedIds.has(entry.id)
  const thumbSrc = entry.thumbnail_small ? `timeline:///${entry.thumbnail_small}` : null

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [entry.id, selectedIds, setSelection])

  return (
    <div
      onClick={handleClick}
      onDoubleClick={() => onOpen(entry.id)}
      style={{
        width: 140,
        borderRadius: 8,
        overflow: 'hidden',
        background: isSelected ? 'var(--bg-entry-sel)' : 'var(--bg-surface)',
        border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer', userSelect: 'none', flexShrink: 0,
      }}
    >
      <div style={{ width: 140, height: 110, position: 'relative', overflow: 'hidden', background: 'var(--bg-thumb)' }}>
        {thumbSrc ? (
          <img src={thumbSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: TYPE_COLORS[entry.type] ?? '#555',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 0.5,
            }}>
              {TYPE_LABELS[entry.type] ?? '?'}
            </div>
          </div>
        )}
        <VolumeBadgeDot volumeId={entry.volume_id} />
      </div>
      <div style={{ padding: '7px 8px 8px' }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title ?? entry.type}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

export default function SearchResults() {
  const { searchFilters, setSearchFilters, setActiveEntryId } = useStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [total, setTotal] = useState(0)
  const [, bumpCacheVersion] = useReducer((n: number) => n + 1, 0)
  // Loaded pages of results, keyed by page index — populated on demand as the
  // visible range demands them, not all up front.
  const pageCacheRef = useRef<Map<number, Entry[]>>(new Map())
  const inFlightRef = useRef<Set<number>>(new Set())
  const epochRef = useRef(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new (or cleared) search invalidates everything already loaded.
  useEffect(() => {
    epochRef.current++
    const epoch = epochRef.current
    pageCacheRef.current = new Map()
    inFlightRef.current = new Set()
    setTotal(0)
    setScrollLeft(0)
    if (scrollRef.current) scrollRef.current.scrollLeft = 0
    bumpCacheVersion()
    if (!searchFilters) return
    window.api.entries.searchCount(searchFilters).then(count => {
      if (epochRef.current === epoch) setTotal(count)
    })
  }, [searchFilters])

  const step = CARD_WIDTH + CARD_GAP
  const startIdx = total ? Math.max(0, Math.floor((scrollLeft - OVERSCAN_PX) / step)) : 0
  const endIdx = total ? Math.min(total - 1, Math.ceil((scrollLeft + viewportWidth + OVERSCAN_PX) / step)) : -1

  // Fetch whichever pages the currently-visible index range needs.
  useEffect(() => {
    if (!searchFilters || total === 0 || endIdx < startIdx) return
    const epoch = epochRef.current
    const firstPage = Math.floor(startIdx / PAGE_SIZE)
    const lastPage = Math.floor(endIdx / PAGE_SIZE)
    for (let p = firstPage; p <= lastPage; p++) {
      if (pageCacheRef.current.has(p) || inFlightRef.current.has(p)) continue
      inFlightRef.current.add(p)
      window.api.entries.search(searchFilters, { limit: PAGE_SIZE, offset: p * PAGE_SIZE }).then(rows => {
        inFlightRef.current.delete(p)
        if (epochRef.current !== epoch) return
        pageCacheRef.current.set(p, rows)
        bumpCacheVersion()
      })
    }
  }, [searchFilters, startIdx, endIdx, total])

  if (searchFilters === null) return null

  const totalWidth = total > 0 ? total * step - CARD_GAP + H_PADDING * 2 : 0
  const visible: { index: number; entry: Entry }[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const entry = pageCacheRef.current.get(Math.floor(i / PAGE_SIZE))?.[i % PAGE_SIZE]
    if (entry) visible.push({ index: i, entry })
  }

  return (
    <div style={{
      height: 240,
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-app)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Search results</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {total} {total === 1 ? 'match' : 'matches'}
        </span>
        <button
          onClick={() => setSearchFilters(null)}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: 'var(--text-4)', fontSize: 16, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4, cursor: 'pointer',
          }}
        >✕</button>
      </div>
      <div
        ref={scrollRef}
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
        style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}
      >
        {total === 0 ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>No matches</div>
        ) : (
          <div style={{ position: 'relative', width: totalWidth, height: '100%' }}>
            {visible.map(({ index, entry }) => (
              <div key={entry.id} style={{
                position: 'absolute', top: 12, left: H_PADDING + index * step,
              }}>
                <ResultCard entry={entry} onOpen={setActiveEntryId} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
