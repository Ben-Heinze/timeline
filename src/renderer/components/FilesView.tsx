import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { useEntryContextMenu } from './EntryContextMenu'
import type { Entry, FileViewMode as ViewMode } from '../../shared/types'
import { GridCell, ListRow, THUMB_SIZE, iconFor, toolBtn } from './entryDisplay'
import { AssignDropdown } from './GroupPicker'

type SortBy = 'date' | 'title' | 'type' | 'tag'
type SortDir = 'asc' | 'desc'

function monthYearKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}`
}
function monthYearLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export default function FilesView() {
  const {
    selectedGroupId, refreshKey, bumpRefreshKey,
    setActiveEntryId,
    selectedIds, setSelection, lastSelectedId,
    groups,
  } = useStore()

  const [entries, setEntries] = useState<Entry[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('medium')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { onEntryContextMenu, contextMenuUI } = useEntryContextMenu(entries)

  useEffect(() => {
    window.api.entries.listAll({
      groupId: selectedGroupId ?? undefined,
      sortBy, sortDir,
    }).then(setEntries)
  }, [selectedGroupId, sortBy, sortDir, refreshKey])

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
        const range = new Set(entries.slice(a, b + 1).map(x => x.id))
        setSelection(range, entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [selectedIds, lastSelectedId, entries, setSelection])

  const handleAssign = useCallback(async (groupId: number | null) => {
    await window.api.groups.assignEntries(groupId, [...selectedIds])
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [selectedIds, setSelection, bumpRefreshKey])

  const groupedByMonth = useMemo(() => {
    if (sortBy !== 'date') return null
    const out: { key: string; label: string; items: Entry[] }[] = []
    let currentKey: string | null = null
    for (const e of entries) {
      const key = monthYearKey(e.timestamp)
      if (key !== currentKey) {
        out.push({ key, label: monthYearLabel(e.timestamp), items: [] })
        currentKey = key
      }
      out[out.length - 1].items.push(e)
    }
    return out
  }, [entries, sortBy])

  const renderItem = (entry: Entry) => {
    const selected = selectedIds.has(entry.id)
    const common = {
      entry, selected,
      onClick: handleClickEntry(entry),
      onDoubleClick: () => setActiveEntryId(entry.id),
      onContextMenu: onEntryContextMenu(entry),
    }
    if (viewMode === 'list') return <ListRow key={entry.id} {...common} />
    return <GridCell key={entry.id} {...common} size={THUMB_SIZE[viewMode]} />
  }

  const renderItems = (items: Entry[]) => {
    if (viewMode === 'list') {
      return <div>{items.map(renderItem)}</div>
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px' }}>
        {items.map(renderItem)}
      </div>
    )
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
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>
            No entries
          </div>
        ) : groupedByMonth ? (
          groupedByMonth.map(section => (
            <section key={section.key}>
              <header style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--bg-surface)',
                padding: '10px 14px 6px', fontSize: 12, fontWeight: 700,
                color: 'var(--text-2)', letterSpacing: 0.4,
                borderBottom: '1px solid var(--border-light)',
              }}>
                {section.label}
                <span style={{ marginLeft: 8, color: 'var(--text-4)', fontWeight: 400 }}>
                  {section.items.length}
                </span>
              </header>
              {renderItems(section.items)}
            </section>
          ))
        ) : (
          renderItems(entries)
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
