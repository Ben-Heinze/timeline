import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { Entry, Group } from '../../shared/types'

const MS_DAY = 86_400_000

function periodLabel(from: number, to: number): string {
  const rangeMs = to - from
  const d = new Date(from)
  if (rangeMs >= 364 * MS_DAY)
    return String(d.getFullYear())
  if (rangeMs >= 27 * MS_DAY)
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  if (rangeMs >= 6 * MS_DAY)
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (rangeMs >= MS_DAY - 1)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const TYPE_COLORS: Record<string, string> = {
  photo:    '#3b82f6',
  video:    '#8b5cf6',
  audio:    '#10b981',
  document: '#f59e0b',
  journal:  '#ec4899',
}

const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
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
          background: '#f59e0b', border: 'none', borderRadius: 5,
          color: '#1a1a1a', fontWeight: 600, cursor: 'pointer',
        }}
      >
        Assign ({selectedIds.size}) ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: '#fff', border: '1px solid #e4e4dc', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: 180, zIndex: 50, overflow: 'hidden',
        }}>
          {groups.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#bbb' }}>No groups yet</div>
          )}
          {groups.map(g => (
            <div
              key={g.id}
              onClick={() => { onAssign(g.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#333',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f5f5f0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
              {g.name}
            </div>
          ))}
          <div
            onClick={() => { onAssign(null); setOpen(false) }}
            style={{
              padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#888',
              borderTop: groups.length > 0 ? '1px solid #eaeae4' : 'none',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f5f5f0' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
          >
            Remove from group
          </div>
        </div>
      )}
    </div>
  )
}

function EntryCard({ entry, onOpen }: { entry: Entry; onOpen: (id: number) => void }) {
  const { selectedIds, setSelection, lastSelectedId } = useStore()
  const isSelected = selectedIds.has(entry.id)
  const thumbSrc = entry.thumbnail_small ? `timeline:///${entry.thumbnail_small}` : null

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastSelectedId !== null) {
      setSelection(new Set([entry.id]), entry.id)
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [entry.id, selectedIds, lastSelectedId, setSelection])

  return (
    <div
      onClick={handleClick}
      onDoubleClick={() => onOpen(entry.id)}
      style={{
        width: 140,
        borderRadius: 8,
        overflow: 'hidden',
        background: isSelected ? '#fffbeb' : '#fff',
        border: `2px solid ${isSelected ? '#f59e0b' : '#e8e8e0'}`,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'border-color 0.1s',
        flexShrink: 0,
      }}
    >
      <div style={{ width: 140, height: 110, position: 'relative', overflow: 'hidden', background: '#f4f4ef' }}>
        {thumbSrc ? (
          <img
            src={thumbSrc}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
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
        {isSelected && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            width: 18, height: 18, borderRadius: 9,
            background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#fff',
          }}>✓</div>
        )}
      </div>
      <div style={{ padding: '7px 8px 8px' }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: '#222',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title ?? entry.type}
        </div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
          {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

export default function DayView() {
  const {
    selectedPeriod, setSelectedPeriod,
    setActiveEntryId,
    setSelection, selectedIds,
    selectedGroupId,
    groups,
    refreshKey, bumpRefreshKey,
  } = useStore()
  const [entries, setEntries] = useState<Entry[]>([])

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

  if (!selectedPeriod) return null

  const label = periodLabel(selectedPeriod[0], selectedPeriod[1])
  const count = entries.length

  return (
    <div style={{
      height: 240,
      borderTop: '1px solid #e4e4dc',
      background: '#f8f8f5',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid #eaeae4',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#999', marginLeft: 2 }}>
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        {selectedIds.size > 0 && (
          <AssignDropdown selectedIds={selectedIds} groups={groups} onAssign={handleAssign} />
        )}
        <button
          onClick={() => { setSelectedPeriod(null); setActiveEntryId(null) }}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: '#bbb', fontSize: 16, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4,
          }}
        >✕</button>
      </div>

      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'hidden',
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
      }}>
        {entries.length === 0 ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#bbb', fontSize: 13,
          }}>
            No entries for this period
          </div>
        ) : (
          entries.map(e => (
            <EntryCard key={e.id} entry={e} onOpen={setActiveEntryId} />
          ))
        )}
      </div>
    </div>
  )
}
