import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useEntryContextMenu } from './EntryContextMenu'
import type { Entry, FileViewMode as ViewMode, MonthBucket } from '../../shared/types'
import { GridCell, ListRow, THUMB_SIZE, iconFor, toolBtn } from './entryDisplay'
import { AssignDropdown } from './GroupPicker'

type SortBy = 'date' | 'title' | 'type' | 'tag'
type SortDir = 'asc' | 'desc'

function monthYearLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// Cells/rows are a fixed height per view mode, so rather than mount every entry
// (tens of thousands is a realistic library size for a lifelong archive, and
// used to hang/crash the renderer), only the rows intersecting the viewport are
// ever put in the DOM. Likewise the row *skeleton* (below) is built from counts
// only — the actual Entry data for a row is fetched in PAGE_SIZE-sized pages as
// the visible range demands, not fetched or held in full up front.
const ROW_GAP = 8
const H_PADDING = 12
const LIST_ROW_HEIGHT = 38
const HEADER_ROW_HEIGHT = 34
const OVERSCAN_PX = 600
const PAGE_SIZE = 300
const FETCH_OVERSCAN_ITEMS = PAGE_SIZE
function gridRowHeight(viewMode: Exclude<ViewMode, 'list'>): number {
  return THUMB_SIZE[viewMode] + 58 // thumb + label lines + cell padding, with a little headroom
}

type Row =
  | { kind: 'header'; label: string; count: number; height: number; bucketStart: number; collapsed: boolean }
  | { kind: 'items'; startIndex: number; count: number; height: number }

/** Largest index i such that offsets[i] <= y (offsets is non-decreasing, length = rows.length + 1). */
function findRowAt(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 2
  if (hi < 0) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, number, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setW(entry.contentRect.width)
      setH(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w, h]
}

function GridSkeleton({ size }: { size: number }) {
  return (
    <div style={{ width: size + 20, padding: 8, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-thumb)', opacity: 0.5 }} />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div style={{ padding: '5px 14px', height: '100%', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: '60%', height: 12, borderRadius: 4, background: 'var(--bg-thumb)', opacity: 0.5 }} />
    </div>
  )
}

export default function FilesView() {
  const {
    selectedGroupId, refreshKey, bumpRefreshKey,
    setActiveEntryId,
    selectedIds, setSelection, lastSelectedId,
    groups,
  } = useStore()

  const [viewMode, setViewMode] = useState<ViewMode>('medium')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  // Month buckets the user has collapsed, keyed by bucketStart. Collapsing hides
  // a bucket's item rows while its global index range stays reserved, so paging
  // and shift-selection indices remain aligned with the backend ordering.
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<number>>(new Set())

  const toggleBucket = useCallback((bucketStart: number) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev)
      if (next.has(bucketStart)) next.delete(bucketStart); else next.add(bucketStart)
      return next
    })
  }, [])

  const [total, setTotal] = useState(0)
  const [monthBuckets, setMonthBuckets] = useState<MonthBucket[]>([])
  // Loaded pages of entries, keyed by page index, plus a reverse id -> global-index
  // lookup (used for shift-range selection) — populated on demand, never all at once.
  const pageCacheRef = useRef<Map<number, Entry[]>>(new Map())
  const idToIndexRef = useRef<Map<number, number>>(new Map())
  const inFlightRef = useRef<Set<number>>(new Set())
  const epochRef = useRef(0)
  const [cacheVersion, bumpCacheVersion] = useReducer((n: number) => n + 1, 0)

  const [scrollRef, viewportWidth, viewportHeight] = useElementSize<HTMLDivElement>()
  const [scrollTop, setScrollTop] = useState(0)
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), [])

  // Reload the row skeleton (counts + month buckets) for the current filter/sort
  // and invalidate every loaded page so visible rows refetch. Intentionally
  // leaves scrollTop and collapsed months untouched — callers decide whether the
  // change warrants jumping back to the top.
  const reload = useCallback(() => {
    epochRef.current++
    const epoch = epochRef.current
    pageCacheRef.current = new Map()
    idToIndexRef.current = new Map()
    inFlightRef.current = new Set()
    bumpCacheVersion()

    const groupId = selectedGroupId ?? undefined
    window.api.entries.listAllCount({ groupId }).then(count => {
      if (epochRef.current === epoch) setTotal(count)
    })
    if (sortBy === 'date') {
      window.api.entries.monthBuckets({ groupId, sortDir }).then(buckets => {
        if (epochRef.current === epoch) setMonthBuckets(buckets)
      })
    } else {
      setMonthBuckets([])
    }
  }, [selectedGroupId, sortBy, sortDir])

  // Filter/sort identity changed: everything already loaded is invalid, and the
  // old scroll position/collapsed months are meaningless — reset to the top.
  useEffect(() => {
    setTotal(0)
    setMonthBuckets([])
    setCollapsedBuckets(new Set())
    setScrollTop(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    reload()
    // scrollRef is a stable ref object; reload is recreated with these same deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, sortBy, sortDir])

  // An action was applied (tag/person edit, delete, group change, ingest) and
  // bumped refreshKey: refresh the data in place while keeping the user where
  // they were. Skips the initial mount, already covered by the effect above.
  const refreshMountedRef = useRef(false)
  useEffect(() => {
    if (!refreshMountedRef.current) { refreshMountedRef.current = true; return }
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const { onEntryContextMenu, contextMenuUI } = useEntryContextMenu(
    useMemo(() => {
      const out: Entry[] = []
      for (const page of pageCacheRef.current.values()) out.push(...page)
      return out
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheVersion])
  )

  // Stable handlers (live state read via refs) so the memoized rows below only
  // re-render when their own selection state changes, not on every click.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const lastSelectedIdRef = useRef(lastSelectedId)
  lastSelectedIdRef.current = lastSelectedId

  const onSelect = useCallback((e: React.MouseEvent, entry: Entry) => {
    const selectedIds = selectedIdsRef.current
    const lastSelectedId = lastSelectedIdRef.current
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastSelectedId !== null) {
      // Range selection only spans entries whose page has already been loaded —
      // in practice both shift-click endpoints are ones the user has scrolled to.
      const fromIdx = idToIndexRef.current.get(lastSelectedId)
      const toIdx = idToIndexRef.current.get(entry.id)
      if (fromIdx != null && toIdx != null) {
        const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
        const range = new Set<number>()
        for (const page of pageCacheRef.current.values()) {
          for (const e2 of page) {
            const idx = idToIndexRef.current.get(e2.id)
            if (idx != null && idx >= a && idx <= b) range.add(e2.id)
          }
        }
        setSelection(range, entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [setSelection])

  const onActivate = useCallback((entry: Entry) => setActiveEntryId(entry.id), [setActiveEntryId])

  const handleAssign = useCallback(async (groupId: number | null) => {
    const ids = [...selectedIds]
    // null is the dropdown's "Remove from group" signal: move entries up to
    // their group's parent rather than ungrouping them outright.
    if (groupId === null) await window.api.groups.removeEntries(ids)
    else await window.api.groups.assignEntries(groupId, ids)
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [selectedIds, setSelection, bumpRefreshKey])

  const columns = viewMode === 'list'
    ? 1
    : Math.max(1, Math.floor((viewportWidth - H_PADDING * 2 + ROW_GAP) / (THUMB_SIZE[viewMode] + 20 + ROW_GAP)))

  // Row skeleton: built from total/monthBuckets counts only, never from fetched
  // entries, so it's available (and cheap) before a single page has loaded.
  const rows = useMemo<Row[]>(() => {
    const itemHeight = viewMode === 'list' ? LIST_ROW_HEIGHT : gridRowHeight(viewMode)
    const out: Row[] = []
    const pushItemRows = (startIndex: number, count: number) => {
      if (viewMode === 'list') {
        for (let i = 0; i < count; i++) out.push({ kind: 'items', startIndex: startIndex + i, count: 1, height: itemHeight })
      } else {
        for (let i = 0; i < count; i += columns) {
          out.push({ kind: 'items', startIndex: startIndex + i, count: Math.min(columns, count - i), height: itemHeight })
        }
      }
    }
    if (sortBy === 'date' && monthBuckets.length > 0) {
      let cursor = 0
      for (const bucket of monthBuckets) {
        const collapsed = collapsedBuckets.has(bucket.bucketStart)
        out.push({
          kind: 'header', label: monthYearLabel(bucket.bucketStart), count: bucket.count,
          height: HEADER_ROW_HEIGHT, bucketStart: bucket.bucketStart, collapsed,
        })
        if (!collapsed) pushItemRows(cursor, bucket.count)
        cursor += bucket.count
      }
    } else if (sortBy !== 'date') {
      pushItemRows(0, total)
    }
    return out
  }, [total, monthBuckets, sortBy, viewMode, columns, collapsedBuckets])

  const offsets = useMemo(() => {
    const out = new Array<number>(rows.length + 1)
    out[0] = 0
    for (let i = 0; i < rows.length; i++) out[i + 1] = out[i] + rows[i].height
    return out
  }, [rows])
  const totalHeight = offsets[offsets.length - 1] ?? 0

  const startIdx = rows.length ? findRowAt(offsets, Math.max(0, scrollTop - OVERSCAN_PX)) : 0
  const endIdx = rows.length ? findRowAt(offsets, scrollTop + viewportHeight + OVERSCAN_PX) : -1

  // Range of global entry indices covered by the currently-visible rows.
  let minVisibleIndex = Infinity
  let maxVisibleIndex = -Infinity
  for (let i = startIdx; i <= endIdx; i++) {
    const row = rows[i]
    if (row?.kind === 'items') {
      minVisibleIndex = Math.min(minVisibleIndex, row.startIndex)
      maxVisibleIndex = Math.max(maxVisibleIndex, row.startIndex + row.count - 1)
    }
  }

  // Fetch whichever pages the visible range (plus overscan) needs.
  useEffect(() => {
    if (total === 0 || minVisibleIndex > maxVisibleIndex) return
    const epoch = epochRef.current
    const groupId = selectedGroupId ?? undefined
    const from = Math.max(0, minVisibleIndex - FETCH_OVERSCAN_ITEMS)
    const to = Math.min(total - 1, maxVisibleIndex + FETCH_OVERSCAN_ITEMS)
    const firstPage = Math.floor(from / PAGE_SIZE)
    const lastPage = Math.floor(to / PAGE_SIZE)
    for (let p = firstPage; p <= lastPage; p++) {
      if (pageCacheRef.current.has(p) || inFlightRef.current.has(p)) continue
      inFlightRef.current.add(p)
      window.api.entries.listAll({ groupId, sortBy, sortDir, limit: PAGE_SIZE, offset: p * PAGE_SIZE }).then(page => {
        inFlightRef.current.delete(p)
        if (epochRef.current !== epoch) return
        pageCacheRef.current.set(p, page)
        for (let i = 0; i < page.length; i++) idToIndexRef.current.set(page[i].id, p * PAGE_SIZE + i)
        bumpCacheVersion()
      })
    }
    // cacheVersion is a dependency so an in-place reload() (edit/tag/date/delete
    // that invalidates the cache without changing total/scroll) forces the visible
    // pages to refetch. The loop skips already-cached/in-flight pages, so the
    // per-page bump on load can't spin — it just fills any still-missing pages.
  }, [total, minVisibleIndex, maxVisibleIndex, selectedGroupId, sortBy, sortDir, cacheVersion])

  const renderEntry = (entry: Entry) => {
    const selected = selectedIds.has(entry.id)
    const common = { entry, selected, onSelect, onActivate, onContextMenu: onEntryContextMenu }
    if (viewMode === 'list') return <ListRow key={entry.id} {...common} />
    return <GridCell key={entry.id} {...common} size={THUMB_SIZE[viewMode]} />
  }

  const renderSlot = (globalIndex: number) => {
    const page = pageCacheRef.current.get(Math.floor(globalIndex / PAGE_SIZE))
    const entry = page?.[globalIndex % PAGE_SIZE]
    if (entry) return renderEntry(entry)
    return viewMode === 'list'
      ? <ListSkeleton key={`sk-${globalIndex}`} />
      : <GridSkeleton key={`sk-${globalIndex}`} size={THUMB_SIZE[viewMode]} />
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-muted)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          View
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['list', 'small', 'medium', 'large'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              style={toolBtn(viewMode === m)}
            >{iconFor(m)}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          Sort
        </span>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          style={selectStyle}
        >
          <option value="date">Date</option>
          <option value="title">Title</option>
          <option value="type">Type</option>
          <option value="tag">Tag</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'desc' ? 'Newest / Z→A first' : 'Oldest / A→Z first'}
          style={toolBtn(false)}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>

        {selectedIds.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <AssignDropdown selectedIds={selectedIds} groups={groups} onAssign={handleAssign} />
          </>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {total} {total === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Body */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative' }}>
        {total === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>
            No entries
          </div>
        ) : (
          <div style={{ position: 'relative', height: totalHeight }}>
            {rows.slice(startIdx, endIdx + 1).map((row, i) => {
              const index = startIdx + i
              const top = offsets[index]
              if (row.kind === 'header') {
                return (
                  <header
                    key={`h-${index}`}
                    onClick={() => toggleBucket(row.bucketStart)}
                    title={row.collapsed ? 'Expand month' : 'Collapse month'}
                    style={{
                      position: 'absolute', top, left: 0, right: 0, height: row.height,
                      background: 'var(--bg-surface)',
                      padding: '10px 14px 6px', fontSize: 12, fontWeight: 700,
                      color: 'var(--text-2)', letterSpacing: 0.4,
                      borderBottom: '1px solid var(--border-light)',
                      cursor: 'pointer', userSelect: 'none',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{
                      display: 'inline-block', fontSize: 10, color: 'var(--text-4)',
                      transform: row.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.12s ease',
                    }}>▾</span>
                    {row.label}
                    <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>
                      {row.count}
                    </span>
                  </header>
                )
              }
              if (viewMode === 'list') {
                return (
                  <div key={`r-${index}`} style={{ position: 'absolute', top, left: 0, right: 0, height: row.height }}>
                    {renderSlot(row.startIndex)}
                  </div>
                )
              }
              return (
                <div key={`r-${index}`} style={{
                  position: 'absolute', top, left: 0, right: 0, height: row.height,
                  display: 'flex', gap: ROW_GAP, padding: `0 ${H_PADDING}px`,
                }}>
                  {Array.from({ length: row.count }, (_, j) => renderSlot(row.startIndex + j))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {contextMenuUI}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px',
  border: '1px solid var(--border)', borderRadius: 5,
  background: 'var(--bg-input)', color: 'var(--text)',
}
