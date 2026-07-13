import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from '../../shared/types'

// Searchable group list shared by the Assign dropdown (File Browser / Files tab)
// and the entry context menu's "Add to group" submenu.
export function GroupPickerList({ groups, onPick, onRemove }: {
  groups: Group[]
  onPick: (groupId: number) => void
  onRemove?: () => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.name.toLowerCase().includes(q))
  }, [groups, query])

  return (
    <>
      {groups.length > 0 && (
        <div style={{ padding: 6, borderBottom: '1px solid var(--border-light)' }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filtered.length === 1) onPick(filtered[0].id)
            }}
            placeholder="Search groups…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '4px 8px', fontSize: 12,
              border: '1px solid var(--border-strong)', borderRadius: 5,
              background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
      )}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {groups.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-4)' }}>No groups yet</div>
        )}
        {groups.length > 0 && filtered.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-4)' }}>No matching groups</div>
        )}
        {filtered.map(g => (
          <div
            key={g.id}
            onClick={() => onPick(g.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
          </div>
        ))}
      </div>
      {onRemove && (
        <div
          onClick={onRemove}
          style={{
            padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-3)',
            borderTop: groups.length > 0 ? '1px solid var(--border-light)' : 'none',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
        >
          Remove from group
        </div>
      )}
    </>
  )
}

export function AssignDropdown({ selectedIds, groups, onAssign }: {
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
          minWidth: 200, zIndex: 50, overflow: 'hidden',
        }}>
          <GroupPickerList
            groups={groups}
            onPick={id => { onAssign(id); setOpen(false) }}
            onRemove={() => { onAssign(null); setOpen(false) }}
          />
        </div>
      )}
    </div>
  )
}
