import React, { useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { Entry } from '../../shared/types'

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6', video: '#8b5cf6', audio: '#10b981', document: '#f59e0b', journal: '#ec4899',
}
const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
}

function ResultCard({ entry, onOpen }: { entry: Entry; onOpen: (id: number) => void }) {
  const { selectedIds, setSelection } = useStore()
  const isSelected = selectedIds.has(entry.id)
  const thumbSrc = entry.thumbnail_small ? `timeline:///${entry.thumbnail_small}` : null

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [entry.id, selectedIds, setSelection])

  return (
    <div
      onClick={handleClick}
      onDoubleClick={() => onOpen(entry.id)}
      style={{
        width: 140,
        borderRadius: 8,
        overflow: 'hidden',
        background: isSelected ? 'var(--bg-entry-sel)' : 'var(--bg-surface)',
        border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer', userSelect: 'none', flexShrink: 0,
      }}
    >
      <div style={{ width: 140, height: 110, position: 'relative', overflow: 'hidden', background: 'var(--bg-thumb)' }}>
        {thumbSrc ? (
          <img src={thumbSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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
      </div>
      <div style={{ padding: '7px 8px 8px' }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title ?? entry.type}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

export default function SearchResults() {
  const { searchResults, setSearchResults, setActiveEntryId } = useStore()
  if (searchResults === null) return null

  return (
    <div style={{
      height: 240,
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-app)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Search results</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
        </span>
        <button
          onClick={() => setSearchResults(null)}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: 'var(--text-4)', fontSize: 16, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4, cursor: 'pointer',
          }}
        >✕</button>
      </div>
      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'hidden',
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
      }}>
        {searchResults.length === 0 ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>No matches</div>
        ) : (
          searchResults.map(e => <ResultCard key={e.id} entry={e} onOpen={setActiveEntryId} />)
        )}
      </div>
    </div>
  )
}
