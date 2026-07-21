import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from '../../shared/types'

// Searchable group list shared by the Assign dropdown (File Browser / Files tab)
// and the entry context menu's "Add to group" submenu.
// When `onCreate` is supplied, a "Create new group" row appears at the top; its
// input creates a group (nested under `parentName` when the caller passes one).
interface PickerRow { group: Group; depth: number; hasChildren: boolean }

export function GroupPickerList({ groups, onPick, onRemove, onCreate, parentName }: {
  groups: Group[]
  onPick: (groupId: number) => void
  onRemove?: () => void
  onCreate?: (name: string) => void
  parentName?: string | null
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const q = query.trim().toLowerCase()

  // Group the flat list into a parent→children map so the picker can mirror the
  // sidebar's hierarchy instead of showing one long alphabetical list.
  const { roots, childrenOf } = useMemo(() => {
    const byId = new Map(groups.map(g => [g.id, g]))
    const childrenOf = new Map<number, Group[]>()
    const roots: Group[] = []
    for (const g of groups) {
      if (g.parent_id != null && byId.has(g.parent_id)) {
        const arr = childrenOf.get(g.parent_id)
        if (arr) arr.push(g); else childrenOf.set(g.parent_id, [g])
      } else {
        roots.push(g)
      }
    }
    const byName = (a: Group, b: Group) => a.name.localeCompare(b.name)
    roots.sort(byName)
    for (const arr of childrenOf.values()) arr.sort(byName)
    return { roots, childrenOf }
  }, [groups])

  // When searching, keep any group whose name matches plus its ancestors (so the
  // tree stays connected) and force every kept branch open.
  const searchVisible = useMemo(() => {
    if (!q) return null
    const byId = new Map(groups.map(g => [g.id, g]))
    const keep = new Set<number>()
    for (const g of groups) {
      if (g.name.toLowerCase().includes(q)) {
        keep.add(g.id)
        let p = g.parent_id
        while (p != null && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null }
      }
    }
    return keep
  }, [q, groups])

  // Flatten the tree into the ordered, indented rows actually rendered, honoring
  // expand/collapse state (or the search's forced-open branches).
  const rows = useMemo(() => {
    const out: PickerRow[] = []
    const walk = (list: Group[], depth: number) => {
      for (const g of list) {
        if (searchVisible && !searchVisible.has(g.id)) continue
        const kids = childrenOf.get(g.id) ?? []
        const visibleKids = searchVisible ? kids.filter(k => searchVisible.has(k.id)) : kids
        out.push({ group: g, depth, hasChildren: visibleKids.length > 0 })
        const isOpen = searchVisible ? true : expanded.has(g.id)
        if (isOpen && visibleKids.length) walk(visibleKids, depth + 1)
      }
    }
    walk(roots, 0)
    return out
  }, [roots, childrenOf, expanded, searchVisible])

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const submitCreate = () => {
    const name = newName.trim()
    if (!name) return
    onCreate?.(name)
    setNewName('')
    setCreating(false)
  }

  return (
    <>
      {onCreate && (
        <div style={{ padding: 6, borderBottom: '1px solid var(--border-light)' }}>
          {creating ? (
            <>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); submitCreate() }
                  else if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setNewName('') }
                }}
                placeholder="New group name…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '4px 8px', fontSize: 12,
                  border: '1px solid var(--border-strong)', borderRadius: 5,
                  background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
                }}
              />
              {parentName && (
                <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4, padding: '0 2px' }}>
                  Nested inside <strong style={{ color: 'var(--text-3)' }}>{parentName}</strong>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  onClick={submitCreate}
                  disabled={!newName.trim()}
                  style={{
                    flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 5, border: 'none',
                    background: 'var(--accent)', color: 'var(--accent-fg, #fff)', fontWeight: 600,
                    cursor: newName.trim() ? 'pointer' : 'default', opacity: newName.trim() ? 1 : 0.5,
                  }}
                >
                  Create
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName('') }}
                  style={{
                    fontSize: 12, padding: '4px 8px', borderRadius: 5,
                    background: 'none', border: '1px solid var(--border-strong)',
                    color: 'var(--text-2)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div
              onClick={() => setCreating(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 6px', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
                borderRadius: 5,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <span style={{ fontSize: 15, lineHeight: 1, color: 'var(--text-3)' }}>＋</span>
              <span>Create new group{parentName ? ` in ${parentName}` : ''}…</span>
            </div>
          )}
        </div>
      )}
      {groups.length > 0 && (
        <div style={{ padding: 6, borderBottom: '1px solid var(--border-light)' }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && rows.length === 1) onPick(rows[0].group.id)
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
        {groups.length > 0 && rows.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-4)' }}>No matching groups</div>
        )}
        {rows.map(({ group: g, depth, hasChildren }) => {
          const isOpen = searchVisible ? true : expanded.has(g.id)
          return (
            <div
              key={g.id}
              onClick={() => onPick(g.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                paddingTop: 7, paddingBottom: 7, paddingRight: 12,
                paddingLeft: 8 + depth * 14,
                cursor: 'pointer', fontSize: 13, color: 'var(--text)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-subtle)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <span
                onClick={e => { e.stopPropagation(); if (hasChildren) toggle(g.id) }}
                style={{
                  width: 12, fontSize: 8, color: 'var(--text-4)', textAlign: 'center', flexShrink: 0,
                  visibility: hasChildren ? 'visible' : 'hidden',
                  display: 'inline-block',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.12s',
                }}
              >▶</span>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
            </div>
          )
        })}
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
