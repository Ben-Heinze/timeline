import React from 'react'
import type { Entry, FileViewMode } from '../../shared/types'

export const THUMB_SIZE: Record<Exclude<FileViewMode, 'list'>, number> = {
  small: 84, medium: 132, large: 200,
}

export const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6', video: '#8b5cf6', audio: '#10b981', document: '#f59e0b', journal: '#ec4899',
}
export const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
}

export const Thumb = React.memo(function Thumb({ entry, size }: { entry: Entry; size: number }) {
  const src = entry.thumbnail_medium ?? entry.thumbnail_small ?? entry.thumbnail_large
  if (src) {
    return (
      <img
        src={`timeline:///${src}`}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block', borderRadius: 6, background: 'var(--bg-thumb)' }}
        draggable={false}
      />
    )
  }
  const badge = Math.round(size * 0.4)
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, background: 'var(--bg-thumb)',
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
})

// Handlers are entry-aware and stable across renders so the memoized items below
// only re-render when their own `selected` flag flips — not on every selection
// change in a large list. See FileBrowser/FilesView for the stable callbacks.
export interface RowCommonProps {
  entry: Entry
  selected: boolean
  onSelect: (e: React.MouseEvent, entry: Entry) => void
  onActivate: (entry: Entry) => void
  onContextMenu?: (e: React.MouseEvent, entry: Entry) => void
}

export const GridCell = React.memo(function GridCell({ entry, selected, onSelect, onActivate, onContextMenu, size }: RowCommonProps & { size: number }) {
  return (
    <div
      data-entry-id={entry.id}
      data-selected={selected ? '1' : '0'}
      onClick={e => onSelect(e, entry)}
      onDoubleClick={() => onActivate(entry)}
      onContextMenu={onContextMenu ? e => onContextMenu(e, entry) : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        width: size + 20, padding: 8, borderRadius: 8,
        background: selected ? 'var(--bg-entry-sel)' : 'transparent',
        outline: selected ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <Thumb entry={entry} size={size} />
      <div style={{
        fontSize: 12, color: 'var(--text)', maxWidth: size + 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {entry.title ?? entry.type}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
})

export const ListRow = React.memo(function ListRow({ entry, selected, onSelect, onActivate, onContextMenu }: RowCommonProps) {
  return (
    <div
      data-entry-id={entry.id}
      data-selected={selected ? '1' : '0'}
      onClick={e => onSelect(e, entry)}
      onDoubleClick={() => onActivate(entry)}
      onContextMenu={onContextMenu ? e => onContextMenu(e, entry) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 90px 180px',
        alignItems: 'center', gap: 12,
        padding: '5px 14px',
        background: selected ? 'var(--bg-entry-sel)' : 'transparent',
        borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
        cursor: 'pointer', userSelect: 'none',
        fontSize: 13,
      }}
    >
      <Thumb entry={entry} size={26} />
      <span style={{
        color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
        {new Date(entry.timestamp).toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </span>
    </div>
  )
})

export function iconFor(m: FileViewMode): React.ReactNode {
  if (m === 'list') return <span style={{ letterSpacing: 1 }}>≡</span>
  if (m === 'small') return <IconGrid n={3} />
  if (m === 'medium') return <IconGrid n={2} />
  return <IconGrid n={1} />
}

export function IconGrid({ n }: { n: 1 | 2 | 3 }) {
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

export const toolBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--text)' : 'none',
  color: active ? 'var(--bg-app)' : 'var(--text-2)',
  border: active ? 'none' : '1px solid var(--border)',
  borderRadius: 5, padding: '3px 8px',
  fontSize: 12, cursor: 'pointer', lineHeight: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 24, minWidth: 26,
})
