import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry } from '../../shared/types'
import { Thumb } from './entryDisplay'

interface Props {
  excludeIds: Set<number>
  onAdd: (entries: Entry[]) => void
  onClose: () => void
}

const PAGE_LIMIT = 60

// Search-and-select modal for linking existing library entries to another
// entry (e.g. photos referenced from a journal entry). Selection is staged
// locally and only handed back to the caller on "Add" — persistence is the
// caller's job.
export default function ReferencePickerModal({ excludeIds, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Map<number, Entry>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      window.api.entries.search({ text: query.trim() || undefined }, { limit: PAGE_LIMIT, offset: 0 }).then(res => {
        if (!cancelled) { setResults(res); setLoading(false) }
      })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const toggle = useCallback((entry: Entry) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(entry.id)) next.delete(entry.id); else next.set(entry.id, entry)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = results.filter(e => !excludeIds.has(e.id))

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300,
      }}
    >
      <div style={{
        width: 480, maxWidth: '90vw', maxHeight: '80vh',
        background: 'var(--bg-surface)',
        borderRadius: 12, border: '1px solid var(--border)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Reference Files</div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search library…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-muted)', outline: 'none', color: 'var(--text)',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 200 }}>
          {loading && visible.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 13, padding: 24 }}>Searching…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 13, padding: 24 }}>No matching files</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visible.map(entry => {
                const isSelected = selected.has(entry.id)
                return (
                  <div
                    key={entry.id}
                    onClick={() => toggle(entry)}
                    title={entry.title ?? entry.type}
                    style={{
                      width: 100, padding: 8, borderRadius: 8,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      cursor: 'pointer', userSelect: 'none',
                      background: isSelected ? 'var(--bg-entry-sel)' : 'transparent',
                      outline: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                  >
                    <Thumb entry={entry} size={84} />
                    <div style={{
                      fontSize: 11, color: 'var(--text)', maxWidth: 96,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.title ?? entry.type}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderTop: '1px solid var(--border-light)', flexShrink: 0,
          background: 'var(--bg-muted)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-4)', marginRight: 'auto' }}>
            {selected.size} selected
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px', fontSize: 13,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={() => { onAdd([...selected.values()]); onClose() }}
            disabled={selected.size === 0}
            style={{
              padding: '6px 20px', fontSize: 13, fontWeight: 600,
              background: selected.size ? 'var(--text)' : 'var(--border-strong)',
              border: 'none', borderRadius: 6,
              color: selected.size ? 'var(--bg-app)' : 'var(--text-4)',
              cursor: selected.size ? 'pointer' : 'default',
            }}
          >Add{selected.size ? ` (${selected.size})` : ''}</button>
        </div>
      </div>
    </div>
  )
}
