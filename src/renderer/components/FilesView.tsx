import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Entry, EntryType } from '../../shared/types'

type ViewMode = 'list' | 'small' | 'medium' | 'large'
type SortBy = 'date' | 'title' | 'type'
type SortDir = 'asc' | 'desc'

const THUMB_SIZE: Record<Exclude<ViewMode, 'list'>, number> = {
  small: 84, medium: 132, large: 200,
}

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6', video: '#8b5cf6', audio: '#10b981', document: '#f59e0b', journal: '#ec4899',
}
const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
}

function monthYearKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}`
}
function monthYearLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function Thumb({ entry, size }: { entry: Entry; size: number }) {
  const src = entry.thumbnail_medium ?? entry.thumbnail_small ?? entry.thumbnail_large
  if (src) {
    return (
      <img
        src={`timeline:///${src}`}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block', borderRadius: 6, background: '#f4f4ef' }}
        draggable={false}
      />
    )
  }
  const badge = Math.round(size * 0.4)
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, background: '#f4f4ef',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: badge, height: badge, borderRadius: badge * 0.22,
        background: TYPE_COLORS[entry.type] ?? '#555',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(badge * 0.32), fontWeight: 700, color: '#fff', letterSpacing: 0.5,
      }}>
        {TYPE_LABELS[entry.type] ?? '?'}
      </div>
    </div>
  )
}

interface RowCommonProps {
  entry: Entry
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
}

function GridCell({ entry, selected, onClick, onDoubleClick, size }: RowCommonProps & { size: number }) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        width: size + 20, padding: 8, borderRadius: 8,
        background: selected ? '#fffbeb' : 'transparent',
        outline: selected ? '2px solid #f59e0b' : '2px solid transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <Thumb entry={entry} size={size} />
      <div style={{
        fontSize: 12, color: '#222', maxWidth: size + 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {entry.title ?? entry.type}
      </div>
      <div style={{ fontSize: 10, color: '#999' }}>
        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
}

function ListRow({ entry, selected, onClick, onDoubleClick }: RowCommonProps) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 90px 180px',
        alignItems: 'center', gap: 12,
        padding: '5px 14px',
        background: selected ? '#fffbeb' : 'transparent',
        borderLeft: selected ? '3px solid #f59e0b' : '3px solid transparent',
        cursor: 'pointer', userSelect: 'none',
        fontSize: 13,
      }}
    >
      <Thumb entry={entry} size={26} />
      <span style={{
        color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {entry.title ?? entry.file_path ?? entry.type}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: '#fff', background: TYPE_COLORS[entry.type] ?? '#555',
        borderRadius: 3, padding: '2px 6px', justifySelf: 'start',
      }}>
        {entry.type}
      </span>
      <span style={{ color: '#888', fontSize: 12 }}>
        {new Date(entry.timestamp).toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </span>
    </div>
  )
}

export default function FilesView() {
  const {
    selectedGroupId, refreshKey,
    setActiveEntryId,
    selectedIds, setSelection, lastSelectedId,
  } = useStore()

  const [entries, setEntries] = useState<Entry[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('medium')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  // Group into month-year sections (only meaningful when sorting by date)
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px', borderBottom: '1px solid #eaeae4',
        background: '#fafaf8', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#aaa', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
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

        <div style={{ width: 1, height: 18, background: '#e4e4dc', margin: '0 4px' }} />

        <span style={{ fontSize: 11, color: '#aaa', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
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
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'desc' ? 'Newest / Z→A first' : 'Oldest / A→Z first'}
          style={toolBtn(false)}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#999' }}>
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#bbb', fontSize: 13,
          }}>
            No entries
          </div>
        ) : groupedByMonth ? (
          groupedByMonth.map(section => (
            <section key={section.key}>
              <header style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'linear-gradient(#fff, #fff 70%, rgba(255,255,255,0))',
                padding: '10px 14px 6px', fontSize: 12, fontWeight: 700,
                color: '#555', letterSpacing: 0.4,
                borderBottom: '1px solid #eaeae4',
              }}>
                {section.label}
                <span style={{ marginLeft: 8, color: '#bbb', fontWeight: 400 }}>
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
    </div>
  )
}

function iconFor(m: ViewMode): React.ReactNode {
  if (m === 'list') return <span style={{ letterSpacing: 1 }}>≡</span>
  if (m === 'small') return <IconGrid n={3} />
  if (m === 'medium') return <IconGrid n={2} />
  return <IconGrid n={1} />
}

function IconGrid({ n }: { n: 1 | 2 | 3 }) {
  const cells = n * n
  return (
    <span style={{
      display: 'inline-grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 1.5,
      width: 12, height: 12, verticalAlign: 'middle',
    }}>
      {Array.from({ length: cells }).map((_, i) => (
        <span key={i} style={{ background: 'currentColor', borderRadius: 1 }} />
      ))}
    </span>
  )
}

const toolBtn = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a1a1a' : 'none',
  color: active ? '#fff' : '#666',
  border: active ? 'none' : '1px solid #e4e4dc',
  borderRadius: 5, padding: '3px 8px',
  fontSize: 12, cursor: 'pointer', lineHeight: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 24, minWidth: 26,
})

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px',
  border: '1px solid #e4e4dc', borderRadius: 5,
  background: '#fff', color: '#333',
}
