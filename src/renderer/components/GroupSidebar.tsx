import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { Group, GroupStats, Tag, ArtistPlaytime } from '../../shared/types'
import TagEditor from './TagEditor'
import { computeScope } from './scope'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

type GroupSortBy = 'name' | 'date' | 'size'

interface TreeNode { group: Group; children: TreeNode[] }
interface RenameState { id: number; value: string }
interface MenuState { x: number; y: number; group: Group }

function buildTree(groups: Group[], cmp: (a: Group, b: Group) => number): TreeNode[] {
  const map = new Map<number, TreeNode>()
  for (const g of groups) map.set(g.id, { group: g, children: [] })
  const roots: TreeNode[] = []
  for (const [, node] of map) {
    const pid = node.group.parent_id
    if (pid !== null && map.has(pid)) {
      map.get(pid)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => cmp(a.group, b.group))
    nodes.forEach(n => sort(n.children))
    return nodes
  }
  return sort(roots)
}

// Inline "soundtrack" strip for a selected date-range group — top artists heard
// during that span, reusing the same query the Spotify panel uses for a period.
function GroupSoundtrack({ from, to, depth }: { from: number; to: number; depth: number }) {
  const [artists, setArtists] = useState<ArtistPlaytime[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setArtists(null)
    window.api.spotify.topArtists(from, to, 3).then(res => {
      if (!cancelled) setArtists(res)
    })
    return () => { cancelled = true }
  }, [from, to])

  if (!artists || artists.length === 0) return null

  return (
    <div style={{
      paddingLeft: 6 + depth * 14 + 26, paddingRight: 6, paddingBottom: 6,
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{ fontSize: 10, color: '#1DB954', flexShrink: 0 }}>♫</span>
      <span style={{
        fontSize: 11, color: 'var(--text-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {artists.map(a => a.artist_name).join(' · ')}
      </span>
    </div>
  )
}

// ─── Single group row ────────────────────────────────────────────────────────

interface GroupNodeProps {
  node: TreeNode
  depth: number
  expanded: Set<number>
  onToggle: (id: number) => void
  selectedGroupId: number | null
  onSelect: (id: number | null) => void
  onEdit: (g: Group) => void
  onDelete: (id: number) => void
  onContextMenu: (g: Group, e: React.MouseEvent) => void
  rename: RenameState | null
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  stats: Map<number, GroupStats>
}

function GroupNode(props: GroupNodeProps) {
  const {
    node, depth, expanded, onToggle, selectedGroupId, onSelect, onEdit, onDelete,
    onContextMenu, rename, onRenameChange, onRenameCommit, onRenameCancel, stats,
  } = props
  const [hovered, setHovered] = useState(false)
  const { group, children } = node
  const isExpanded = expanded.has(group.id)
  const isSelected = selectedGroupId === group.id
  const isRenaming = rename?.id === group.id
  const count = stats.get(group.id)?.count ?? 0

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { if (!isRenaming) onSelect(isSelected ? null : group.id) }}
        onContextMenu={e => onContextMenu(group, e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: 6 + depth * 14, paddingRight: 6,
          paddingTop: 5, paddingBottom: 5,
          borderRadius: 6,
          background: isSelected ? 'var(--bg-selected)' : hovered ? 'var(--bg-hover)' : 'transparent',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span
          onClick={e => { e.stopPropagation(); if (children.length) onToggle(group.id) }}
          style={{
            width: 12, fontSize: 8, color: 'var(--text-4)', textAlign: 'center', flexShrink: 0,
            visibility: children.length > 0 ? 'visible' : 'hidden',
            display: 'inline-block',
            transform: isExpanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.12s',
          }}
        >▶</span>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: group.color, flexShrink: 0 }} />
        {isRenaming ? (
          <input
            autoFocus
            value={rename!.value}
            onChange={e => onRenameChange(e.target.value)}
            onClick={e => e.stopPropagation()}
            onFocus={e => e.currentTarget.select()}
            onBlur={onRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            style={{
              flex: 1, minWidth: 0, fontSize: 13, padding: '1px 4px',
              border: '1px solid var(--border-strong)', borderRadius: 4,
              background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
            }}
          />
        ) : (
          <span style={{
            fontSize: 13, color: 'var(--text)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {group.name}
          </span>
        )}
        {hovered ? (
          <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onEdit(group) }}
              title="Edit"
              style={{
                background: 'none', border: 'none', padding: '1px 4px',
                fontSize: 10, color: 'var(--text-3)', borderRadius: 3, cursor: 'pointer',
              }}
            >✏</button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(group.id) }}
              title="Delete"
              style={{
                background: 'none', border: 'none', padding: '1px 4px',
                fontSize: 10, color: 'var(--text-3)', borderRadius: 3, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-4)', flexShrink: 0 }}>{count}</span>
        )}
      </div>
      {isSelected && group.date_from != null && group.date_to != null && (
        <GroupSoundtrack from={group.date_from} to={group.date_to} depth={depth} />
      )}
      {isExpanded && children.map(child => (
        <GroupNode key={child.group.id} {...props} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

// ─── Create / Edit form ───────────────────────────────────────────────────────

interface FormProps {
  mode: 'create' | 'edit'
  groups: Group[]
  editTargetId: number | null
  name: string
  color: string
  parentId: number | null
  tags: Tag[]
  onChange: (name: string, color: string, parentId: number | null) => void
  onTagsChange: (names: string[]) => void
  onSubmit: () => void
  onCancel: () => void
}

function GroupForm({ mode, groups, editTargetId, name, color, parentId, tags, onChange, onTagsChange, onSubmit, onCancel }: FormProps) {
  const parentOptions = groups.filter(g => g.parent_id === null && g.id !== editTargetId)

  return (
    <div style={{
      borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 6,
      display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)' }}>
        {mode === 'create' ? 'New Group' : 'Edit Group'}
      </div>
      <input
        autoFocus
        value={name}
        onChange={e => onChange(e.target.value, color, parentId)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Group name"
        style={{
          width: '100%', padding: '5px 8px', fontSize: 13,
          border: '1px solid var(--border-strong)', borderRadius: 5,
          background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
        }}
      />
      {parentOptions.length > 0 && (
        <select
          value={parentId ?? ''}
          onChange={e => onChange(name, color, e.target.value ? Number(e.target.value) : null)}
          style={{
            fontSize: 12, padding: '4px 6px',
            border: '1px solid var(--border-strong)', borderRadius: 5,
            background: 'var(--bg-input)', color: 'var(--text-2)',
          }}
        >
          <option value="">No parent (root group)</option>
          {parentOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 3 }}>
          Tags
        </div>
        <TagEditor tags={tags} onChange={onTagsChange} compact />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
        {PRESET_COLORS.map(c => (
          <div
            key={c}
            onClick={() => onChange(name, c, parentId)}
            style={{
              aspectRatio: '1', borderRadius: 4, background: c, cursor: 'pointer',
              outline: color === c ? '2px solid var(--text)' : '2px solid transparent',
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onSubmit}
          disabled={!name.trim()}
          style={{
            flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600,
            background: name.trim() ? 'var(--text)' : 'var(--border-strong)',
            color: name.trim() ? 'var(--bg-app)' : 'var(--text-4)',
            border: 'none', borderRadius: 5, cursor: name.trim() ? 'pointer' : 'default',
          }}
        >{mode === 'create' ? 'Create' : 'Save'}</button>
        <button
          onClick={onCancel}
          style={{
            padding: '5px 10px', fontSize: 12, cursor: 'pointer',
            background: 'none', border: '1px solid var(--border-strong)', borderRadius: 5, color: 'var(--text-2)',
          }}
        >Cancel</button>
      </div>
    </div>
  )
}

function GroupMenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
        color: danger ? 'var(--danger, #e5484d)' : 'var(--text)',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
    >
      {label}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export default function GroupSidebar() {
  const {
    groups, setGroups, selectedGroupId, setSelectedGroupId,
    zoomLevel, visibleRange, selectedPeriod, dataExtent, refreshKey,
    groupSidebarOpen,
  } = useStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle')
  const [editTarget, setEditTarget] = useState<Group | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState(PRESET_COLORS[7])
  const [formParentId, setFormParentId] = useState<number | null>(null)
  const [formTags, setFormTags] = useState<Tag[]>([])
  const [pendingTagNames, setPendingTagNames] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<GroupSortBy>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterText, setFilterText] = useState('')
  const [stats, setStats] = useState<Map<number, GroupStats>>(new Map())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [rename, setRename] = useState<RenameState | null>(null)

  // The sidebar follows the same scope as the file browser: year view shows
  // every group; month/day zoom (or a clicked bar) narrows to that timeframe.
  const scope = useMemo(
    () => computeScope(selectedPeriod, zoomLevel, visibleRange, dataExtent),
    [selectedPeriod, zoomLevel, visibleRange, dataExtent]
  )
  const isScoped = selectedPeriod !== null || zoomLevel !== 'year'

  const scopeFrom = scope?.from ?? null
  const scopeTo = scope?.to ?? null
  useEffect(() => {
    if (scopeFrom === null || scopeTo === null) { setStats(new Map()); return }
    let cancelled = false
    window.api.groups.statsForPeriod(scopeFrom, scopeTo).then(rows => {
      if (!cancelled) setStats(new Map(rows.map(r => [r.group_id, r])))
    })
    return () => { cancelled = true }
  }, [scopeFrom, scopeTo, refreshKey])

  // Roll each group's stats up into its ancestors so parents show subtree
  // totals, matching the subtree filtering when a parent group is selected.
  const rolledStats = useMemo(() => {
    const byId = new Map(groups.map(g => [g.id, g]))
    const out = new Map<number, GroupStats>()
    for (const s of stats.values()) {
      const seen = new Set<number>()
      let id: number | null = s.group_id
      while (id !== null && !seen.has(id)) {
        seen.add(id)
        const cur = out.get(id)
        if (cur) {
          cur.count += s.count
          cur.first_ts = Math.min(cur.first_ts, s.first_ts)
          cur.last_ts = Math.max(cur.last_ts, s.last_ts)
        } else {
          out.set(id, { group_id: id, count: s.count, first_ts: s.first_ts, last_ts: s.last_ts })
        }
        id = byId.get(id)?.parent_id ?? null
      }
    }
    return out
  }, [stats, groups])

  useEffect(() => {
    if (mode === 'edit' && editTarget) {
      window.api.tags.forGroup(editTarget.id).then(ts => {
        setFormTags(ts)
        setPendingTagNames(ts.map(t => t.name))
      })
    } else {
      setFormTags([]); setPendingTagNames([])
    }
  }, [mode, editTarget])

  const refreshGroups = useCallback(async () => {
    const list = await window.api.groups.list()
    setGroups(list)
  }, [setGroups])

  const openCreate = () => {
    setFormName(''); setFormColor(PRESET_COLORS[7]); setFormParentId(null)
    setEditTarget(null); setMode('create')
  }

  const openEdit = (g: Group) => {
    setFormName(g.name); setFormColor(g.color); setFormParentId(g.parent_id)
    setEditTarget(g); setMode('edit')
  }

  const handleFormChange = (name: string, color: string, parentId: number | null) => {
    setFormName(name); setFormColor(color); setFormParentId(parentId)
  }

  const handleSubmit = async () => {
    if (!formName.trim()) return
    let groupId: number
    if (mode === 'create') {
      const created = await window.api.groups.create({ name: formName.trim(), color: formColor, parent_id: formParentId })
      groupId = created.id
    } else if (mode === 'edit' && editTarget) {
      await window.api.groups.update(editTarget.id, { name: formName.trim(), color: formColor, parent_id: formParentId })
      groupId = editTarget.id
    } else {
      return
    }
    await window.api.tags.setForGroup(groupId, pendingTagNames)
    setMode('idle')
    refreshGroups()
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this group? Entries will be unassigned.')) return
    await window.api.groups.delete(id)
    if (selectedGroupId === id) setSelectedGroupId(null)
    refreshGroups()
  }

  const openMenu = (g: Group, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, group: g })
  }

  const startRename = (g: Group) => {
    setMenu(null)
    setRename({ id: g.id, value: g.name })
  }

  const commitRename = async () => {
    if (!rename) return
    const target = groups.find(g => g.id === rename.id)
    const name = rename.value.trim()
    setRename(null)
    if (!target || !name || name === target.name) return
    await window.api.groups.update(target.id, { name })
    refreshGroups()
  }

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const changeSortBy = (by: GroupSortBy) => {
    setSortBy(by)
    // Sensible default direction per key: A→Z, oldest first, biggest first
    setSortDir(by === 'size' ? 'desc' : 'asc')
  }

  // Groups shown for the current scope: in year view all of them; when scoped,
  // those with entries in the period or a date range overlapping it. Ancestors
  // of visible groups are kept so the tree stays connected.
  const visibleGroups = useMemo(() => {
    let result = groups
    if (isScoped && scope) {
      const byId = new Map(groups.map(g => [g.id, g]))
      const keep = new Set<number>()
      for (const g of groups) {
        const overlapsRange = g.date_from != null && g.date_to != null
          && g.date_from < scope.to && g.date_to > scope.from
        if (rolledStats.has(g.id) || overlapsRange || g.id === selectedGroupId) keep.add(g.id)
      }
      for (const id of [...keep]) {
        let p = byId.get(id)?.parent_id ?? null
        while (p !== null && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null }
      }
      result = groups.filter(g => keep.has(g.id))
    }
    const q = filterText.trim().toLowerCase()
    if (q) {
      const byId = new Map(result.map(g => [g.id, g]))
      const keep = new Set<number>()
      for (const g of result) if (g.name.toLowerCase().includes(q)) keep.add(g.id)
      for (const id of [...keep]) {
        let p = byId.get(id)?.parent_id ?? null
        while (p !== null && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null }
      }
      result = result.filter(g => keep.has(g.id))
    }
    return result
  }, [groups, rolledStats, isScoped, scope, selectedGroupId, filterText])

  const cmp = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return (a: Group, b: Group): number => {
      if (sortBy === 'size') {
        const d = (rolledStats.get(a.id)?.count ?? 0) - (rolledStats.get(b.id)?.count ?? 0)
        if (d !== 0) return d * dir
      } else if (sortBy === 'date') {
        const av = rolledStats.get(a.id)?.first_ts ?? a.date_from ?? a.created_at
        const bv = rolledStats.get(b.id)?.first_ts ?? b.date_from ?? b.created_at
        if (av !== bv) return (av - bv) * dir
      } else {
        const d = a.name.localeCompare(b.name)
        if (d !== 0) return d * dir
      }
      return a.name.localeCompare(b.name)
    }
  }, [sortBy, sortDir, rolledStats])

  const tree = buildTree(visibleGroups, cmp)
  const scopeLabel = isScoped && scope ? scope.label : 'All groups'

  if (!groupSidebarOpen) return null

  return (
    <aside style={{
      width: 220,
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)',
      padding: '12px 8px 12px 10px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, paddingLeft: 2 }}>
        <h2 style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-4)', flex: 1, margin: 0 }}>
          Groups
        </h2>
        <button
          onClick={openCreate}
          title="New group"
          style={{
            background: 'none', border: '1px solid var(--border-strong)', borderRadius: 4,
            color: 'var(--text-2)', fontSize: 14, lineHeight: 1, padding: '1px 6px', cursor: 'pointer',
          }}
        >+</button>
      </div>

      {/* Scope + sort controls */}
      <div style={{
        fontSize: 11, color: isScoped ? 'var(--text-2)' : 'var(--text-4)',
        fontWeight: isScoped ? 600 : 400,
        paddingLeft: 2, marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {scopeLabel}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
        <select
          value={sortBy}
          onChange={e => changeSortBy(e.target.value as GroupSortBy)}
          title="Sort groups"
          style={{
            fontSize: 11, padding: '3px 4px', flexShrink: 0,
            border: '1px solid var(--border)', borderRadius: 5,
            background: 'var(--bg-input)', color: 'var(--text-2)',
          }}
        >
          <option value="name">Name</option>
          <option value="date">Date</option>
          <option value="size">Size</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 5,
            color: 'var(--text-2)', fontSize: 11, padding: '3px 6px', cursor: 'pointer', flexShrink: 0,
          }}
        >{sortDir === 'asc' ? '↑' : '↓'}</button>
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter groups…"
          style={{
            flex: 1, minWidth: 0, padding: '3px 6px', fontSize: 11,
            border: '1px solid var(--border)', borderRadius: 5,
            background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
          }}
        />
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* "All entries" row */}
        <div
          onClick={() => setSelectedGroupId(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 6px', borderRadius: 6, marginBottom: 4,
            background: selectedGroupId === null ? 'var(--bg-selected)' : 'transparent',
            cursor: 'pointer', userSelect: 'none', fontSize: 13, color: 'var(--text-2)',
          }}
        >
          <span style={{ width: 12, flexShrink: 0 }} />
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--scrollbar-thumb)', flexShrink: 0 }} />
          All entries
        </div>

        {groups.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-4)', paddingLeft: 20, marginTop: 4 }}>No groups yet</p>
        ) : visibleGroups.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-4)', paddingLeft: 20, marginTop: 4 }}>
            {filterText.trim() ? 'No matching groups' : 'No groups in this period'}
          </p>
        ) : (
          tree.map(node => (
            <GroupNode
              key={node.group.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpand}
              selectedGroupId={selectedGroupId}
              onSelect={setSelectedGroupId}
              onEdit={openEdit}
              onDelete={handleDelete}
              onContextMenu={openMenu}
              rename={rename}
              onRenameChange={value => setRename(r => r && { ...r, value })}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRename(null)}
              stats={rolledStats}
            />
          ))
        )}
      </div>

      {/* Right-click menu */}
      {menu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onMouseDown={() => setMenu(null)}
            onContextMenu={e => { e.preventDefault(); setMenu(null) }}
          />
          <div style={{
            position: 'fixed', zIndex: 101,
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 120),
            minWidth: 150,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 4, fontSize: 13, color: 'var(--text)',
          }}>
            <GroupMenuItem label="Rename" onClick={() => startRename(menu.group)} />
            <GroupMenuItem label="Edit…" onClick={() => { setMenu(null); openEdit(menu.group) }} />
            <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
            <GroupMenuItem label="Delete…" danger onClick={() => { setMenu(null); handleDelete(menu.group.id) }} />
          </div>
        </>
      )}

      {/* Create / Edit form */}
      {mode !== 'idle' && (
        <GroupForm
          mode={mode}
          groups={groups}
          editTargetId={editTarget?.id ?? null}
          name={formName}
          color={formColor}
          parentId={formParentId}
          tags={formTags}
          onChange={handleFormChange}
          onTagsChange={setPendingTagNames}
          onSubmit={handleSubmit}
          onCancel={() => setMode('idle')}
        />
      )}
    </aside>
  )
}
