import React, { useState, useCallback, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { Group, Tag } from '../../shared/types'
import TagEditor from './TagEditor'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

interface TreeNode { group: Group; children: TreeNode[] }

function buildTree(groups: Group[]): TreeNode[] {
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
    nodes.sort((a, b) => a.group.name.localeCompare(b.group.name))
    nodes.forEach(n => sort(n.children))
    return nodes
  }
  return sort(roots)
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
}

function GroupNode({ node, depth, expanded, onToggle, selectedGroupId, onSelect, onEdit, onDelete }: GroupNodeProps) {
  const [hovered, setHovered] = useState(false)
  const { group, children } = node
  const isExpanded = expanded.has(group.id)
  const isSelected = selectedGroupId === group.id

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(isSelected ? null : group.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: 6 + depth * 14, paddingRight: 6,
          paddingTop: 5, paddingBottom: 5,
          borderRadius: 6,
          background: isSelected ? '#e5e1d8' : hovered ? '#eae8e2' : 'transparent',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span
          onClick={e => { e.stopPropagation(); if (children.length) onToggle(group.id) }}
          style={{
            width: 12, fontSize: 8, color: '#bbb', textAlign: 'center', flexShrink: 0,
            visibility: children.length > 0 ? 'visible' : 'hidden',
            display: 'inline-block',
            transform: isExpanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.12s',
          }}
        >▶</span>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: group.color, flexShrink: 0 }} />
        <span style={{
          fontSize: 13, color: '#333', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {group.name}
        </span>
        {hovered && (
          <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onEdit(group) }}
              title="Edit"
              style={{
                background: 'none', border: 'none', padding: '1px 4px',
                fontSize: 10, color: '#999', borderRadius: 3, cursor: 'pointer',
              }}
            >✏</button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(group.id) }}
              title="Delete"
              style={{
                background: 'none', border: 'none', padding: '1px 4px',
                fontSize: 10, color: '#999', borderRadius: 3, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        )}
      </div>
      {isExpanded && children.map(child => (
        <GroupNode
          key={child.group.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selectedGroupId={selectedGroupId}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
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
      borderTop: '1px solid #e4e4dc', paddingTop: 12, marginTop: 6,
      display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa' }}>
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
          border: '1px solid #d8d8d0', borderRadius: 5,
          background: '#fff', outline: 'none', color: '#1a1a1a',
        }}
      />
      {parentOptions.length > 0 && (
        <select
          value={parentId ?? ''}
          onChange={e => onChange(name, color, e.target.value ? Number(e.target.value) : null)}
          style={{
            fontSize: 12, padding: '4px 6px',
            border: '1px solid #d8d8d0', borderRadius: 5,
            background: '#fff', color: '#444',
          }}
        >
          <option value="">No parent (root group)</option>
          {parentOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#aaa', marginBottom: 3 }}>
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
              outline: color === c ? '2px solid #333' : '2px solid transparent',
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
            background: name.trim() ? '#1a1a1a' : '#d4d4d0',
            color: '#fff', border: 'none', borderRadius: 5, cursor: name.trim() ? 'pointer' : 'default',
          }}
        >{mode === 'create' ? 'Create' : 'Save'}</button>
        <button
          onClick={onCancel}
          style={{
            padding: '5px 10px', fontSize: 12, cursor: 'pointer',
            background: 'none', border: '1px solid #d8d8d0', borderRadius: 5, color: '#666',
          }}
        >Cancel</button>
      </div>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export default function GroupSidebar() {
  const { groups, setGroups, selectedGroupId, setSelectedGroupId } = useStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle')
  const [editTarget, setEditTarget] = useState<Group | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState(PRESET_COLORS[7])
  const [formParentId, setFormParentId] = useState<number | null>(null)
  const [formTags, setFormTags] = useState<Tag[]>([])
  const [pendingTagNames, setPendingTagNames] = useState<string[]>([])

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

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const tree = buildTree(groups)

  return (
    <aside style={{
      width: 220,
      background: '#f2f2ed',
      borderRight: '1px solid #e4e4dc',
      padding: '12px 8px 12px 10px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, paddingLeft: 2 }}>
        <h2 style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', flex: 1, margin: 0 }}>
          Groups
        </h2>
        <button
          onClick={openCreate}
          title="New group"
          style={{
            background: 'none', border: '1px solid #d8d8d0', borderRadius: 4,
            color: '#666', fontSize: 14, lineHeight: 1, padding: '1px 6px', cursor: 'pointer',
          }}
        >+</button>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* "All entries" row */}
        <div
          onClick={() => setSelectedGroupId(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 6px', borderRadius: 6, marginBottom: 4,
            background: selectedGroupId === null ? '#e5e1d8' : 'transparent',
            cursor: 'pointer', userSelect: 'none', fontSize: 13, color: '#555',
          }}
        >
          <span style={{ width: 12, flexShrink: 0 }} />
          <span style={{ width: 9, height: 9, borderRadius: 2, background: '#c8c8c0', flexShrink: 0 }} />
          All entries
        </div>

        {groups.length === 0 ? (
          <p style={{ fontSize: 12, color: '#bbb', paddingLeft: 20, marginTop: 4 }}>No groups yet</p>
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
            />
          ))
        )}
      </div>

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
