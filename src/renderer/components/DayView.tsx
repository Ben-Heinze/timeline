import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { Entry, FileViewMode, Group } from '../../shared/types'
import { GridCell, ListRow, THUMB_SIZE, iconFor, toolBtn } from './entryDisplay'

const MS_DAY = 86_400_000
const MIN_HEIGHT = 140

function periodLabel(from: number, to: number): string {
  const rangeMs = to - from
  const d = new Date(from)
  if (rangeMs >= 364 * MS_DAY)
    return String(d.getFullYear())
  if (rangeMs >= 27 * MS_DAY)
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  if (rangeMs >= 6 * MS_DAY)
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  // Day periods span local midnights, so DST days can be 23 or 25 hours
  if (rangeMs >= 23 * 3_600_000)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function AssignDropdown({ selectedIds, groups, onAssign }: {
  selectedIds: Set<number>
  groups: Group[]
  onAssign: (groupId: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 12, padding: '4px 10px',
          background: 'var(--accent)', border: 'none', borderRadius: 5,
          color: 'var(--accent-fg)', fontWeight: 600, cursor: 'pointer',
        }}
      >
        Assign ({selectedIds.size}) ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: 180, zIndex: 50, overflow: 'hidden',
        }}>
          {groups.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-4)' }}>No groups yet</div>
          )}
          {groups.map(g => (
            <div
              key={g.id}
              onClick={() => { onAssign(g.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
              {g.name}
            </div>
          ))}
          <div
            onClick={() => { onAssign(null); setOpen(false) }}
            style={{
              padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-3)',
              borderTop: groups.length > 0 ? '1px solid var(--border-light)' : 'none',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
          >
            Remove from group
          </div>
        </div>
      )}
    </div>
  )
}

export default function DayView() {
  const {
    selectedPeriod, setSelectedPeriod,
    setActiveEntryId,
    setSelection, selectedIds, lastSelectedId,
    selectedGroupId,
    groups,
    refreshKey, bumpRefreshKey,
    settings, setSettings,
  } = useStore()
  const [entries, setEntries] = useState<Entry[]>([])
  const [resizing, setResizing] = useState(false)
  const [handleHovered, setHandleHovered] = useState(false)

  const height = settings?.dayViewHeight ?? 240
  const viewMode: FileViewMode = settings?.dayViewMode ?? 'medium'

  useEffect(() => {
    if (!selectedPeriod) { setEntries([]); return }
    window.api.entries.forPeriod(selectedPeriod[0], selectedPeriod[1], selectedGroupId ?? undefined).then(setEntries)
  }, [selectedPeriod, selectedGroupId, refreshKey])

  useEffect(() => {
    if (!selectedPeriod) setSelection(new Set(), null)
  }, [selectedPeriod, setSelection])

  const handleAssign = useCallback(async (groupId: number | null) => {
    const ids = [...selectedIds]
    await window.api.groups.assignEntries(groupId, ids)
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [selectedIds, setSelection, bumpRefreshKey])

  const setViewMode = useCallback((m: FileViewMode) => {
    if (!settings) return
    setSettings({ ...settings, dayViewMode: m })
    window.api.settings.set({ dayViewMode: m })
  }, [settings, setSettings])

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!settings) return
    e.preventDefault()
    const startY = e.clientY
    const startH = settings.dayViewHeight ?? 240
    const snap = { ...settings }
    const clamp = (h: number) => Math.min(Math.max(h, MIN_HEIGHT), window.innerHeight - 160)
    setResizing(true)
    const onMove = (ev: MouseEvent) => {
      setSettings({ ...snap, dayViewHeight: clamp(startH + startY - ev.clientY) })
    }
    const onUp = (ev: MouseEvent) => {
      const newH = clamp(startH + startY - ev.clientY)
      setSettings({ ...snap, dayViewHeight: newH })
      window.api.settings.set({ dayViewHeight: newH })
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [settings, setSettings])

  const handleClickEntry = useCallback((entry: Entry) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastSelectedId !== null) {
      const from = entries.findIndex(x => x.id === lastSelectedId)
      const to = entries.findIndex(x => x.id === entry.id)
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        setSelection(new Set(entries.slice(a, b + 1).map(x => x.id)), entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [selectedIds, lastSelectedId, entries, setSelection])

  if (!selectedPeriod) return null

  const label = periodLabel(selectedPeriod[0], selectedPeriod[1])
  const count = entries.length

  const renderItem = (entry: Entry) => {
    const common = {
      entry,
      selected: selectedIds.has(entry.id),
      onClick: handleClickEntry(entry),
      onDoubleClick: () => setActiveEntryId(entry.id),
    }
    if (viewMode === 'list') return <ListRow key={entry.id} {...common} />
    return <GridCell key={entry.id} {...common} size={THUMB_SIZE[viewMode]} />
  }

  return (
    <div style={{
      height,
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-app)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
    }}>
      <div
        onMouseDown={onResizeMouseDown}
        onMouseEnter={() => setHandleHovered(true)}
        onMouseLeave={() => setHandleHovered(false)}
        style={{
          position: 'absolute', top: -3, left: 0, right: 0, height: 7,
          cursor: 'ns-resize', zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {(handleHovered || resizing) && (
          <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--scrollbar-thumb)' }} />
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 2 }}>
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        {selectedIds.size > 0 && (
          <AssignDropdown selectedIds={selectedIds} groups={groups} onAssign={handleAssign} />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {(['list', 'small', 'medium', 'large'] as FileViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              style={toolBtn(viewMode === m)}
            >{iconFor(m)}</button>
          ))}
        </div>
        <button
          onClick={() => { setSelectedPeriod(null); setActiveEntryId(null) }}
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-4)', fontSize: 16, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4, cursor: 'pointer',
          }}
        >✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>
            No entries for this period
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ padding: '6px 0' }}>{entries.map(renderItem)}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px' }}>
            {entries.map(renderItem)}
          </div>
        )}
      </div>
    </div>
  )
}
