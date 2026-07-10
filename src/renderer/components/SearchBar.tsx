import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { EntryType, SearchFilters, Tag } from '../../shared/types'

const ALL_TYPES: EntryType[] = ['photo', 'video', 'audio', 'document', 'journal']

const TYPE_LABEL: Record<EntryType, string> = {
  photo: 'Photos', video: 'Videos', audio: 'Audio', document: 'Documents', journal: 'Journals',
}

function toDateInput(ms: number | null | undefined): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromDateInput(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export default function SearchBar() {
  const { tags, setTags, setSearchResults } = useStore()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<Set<EntryType>>(new Set())
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [fileName, setFileName] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { window.api.tags.list().then(setTags) }, [setTags])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const activeFilterCount =
    (types.size > 0 ? 1 : 0) +
    (fromDate || toDate ? 1 : 0) +
    (fileName.trim() ? 1 : 0) +
    (selectedTagIds.size > 0 ? 1 : 0)

  const runSearch = useCallback(async () => {
    const hasText = text.trim().length > 0
    const hasFilters = activeFilterCount > 0
    if (!hasText && !hasFilters) {
      setSearchResults(null)
      return
    }
    const filters: SearchFilters = {
      text: text.trim() || undefined,
      types: types.size ? [...types] : undefined,
      from: fromDateInput(fromDate),
      to: fromDateInput(toDate) != null ? fromDateInput(toDate)! + 86_400_000 - 1 : null,
      fileName: fileName.trim() || undefined,
      tagIds: selectedTagIds.size ? [...selectedTagIds] : undefined,
    }
    const results = await window.api.entries.search(filters)
    setSearchResults(results)
  }, [text, types, fromDate, toDate, fileName, selectedTagIds, activeFilterCount, setSearchResults])

  const clearAll = () => {
    setText(''); setTypes(new Set()); setFromDate(''); setToDate(''); setFileName(''); setSelectedTagIds(new Set())
    setSearchResults(null)
  }

  const toggleType = (t: EntryType) => {
    setTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  const toggleTag = (id: number) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const [newTagName, setNewTagName] = useState('')
  const createTag = async () => {
    const name = newTagName.trim()
    if (!name) return
    await window.api.tags.create(name)
    const list = await window.api.tags.list()
    setTags(list)
    setNewTagName('')
  }

  const isActive = open || activeFilterCount > 0

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 5,
        padding: '0 6px', height: 26,
      }}>
        <span style={{ color: 'var(--text-4)', fontSize: 12, marginRight: 4 }}>⌕</span>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') runSearch()
            if (e.key === 'Escape') clearAll()
          }}
          placeholder="Search…"
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 12, width: 140, color: 'var(--text)',
          }}
        />
        {(text || activeFilterCount > 0) && (
          <button
            onClick={clearAll}
            title="Clear"
            style={{
              background: 'none', border: 'none', color: 'var(--text-4)',
              fontSize: 13, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}
          >✕</button>
        )}
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        title="Filters"
        style={{
          background: isActive ? 'var(--text)' : 'none',
          color: isActive ? 'var(--bg-app)' : 'var(--text-2)',
          border: '1px solid ' + (isActive ? 'var(--text)' : 'var(--border)'),
          borderRadius: 5, padding: '3px 10px',
          fontSize: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <span>Filter</span>
        {activeFilterCount > 0 && (
          <span style={{
            background: 'var(--accent)', color: 'var(--accent-fg)',
            borderRadius: 8, padding: '0 5px', fontSize: 10, fontWeight: 700,
            minWidth: 14, textAlign: 'center',
          }}>{activeFilterCount}</span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            width: 320,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
            padding: 12, zIndex: 60,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <FilterSection label="File type">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ALL_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  style={chipStyle(types.has(t))}
                >{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </FilterSection>

          <FilterSection label="Date range">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} />
            </div>
          </FilterSection>

          <FilterSection label="File name">
            <input
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder="e.g. .jpg or IMG_1234"
              style={{ ...inputStyle, width: '100%' }}
            />
          </FilterSection>

          <FilterSection label="Tags">
            <TagPicker tags={tags} selected={selectedTagIds} onToggle={toggleTag} />
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createTag() }}
                placeholder="New tag…"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={createTag}
                disabled={!newTagName.trim()}
                style={{
                  padding: '3px 10px', fontSize: 11,
                  background: newTagName.trim() ? 'var(--text)' : 'var(--border-strong)',
                  color: newTagName.trim() ? 'var(--bg-app)' : 'var(--text-4)',
                  border: 'none', borderRadius: 4,
                  cursor: newTagName.trim() ? 'pointer' : 'default',
                }}
              >Add</button>
            </div>
          </FilterSection>

          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={() => { runSearch(); setOpen(false) }}
              style={{
                flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600,
                background: 'var(--text)', color: 'var(--bg-app)', border: 'none', borderRadius: 5, cursor: 'pointer',
              }}
            >Apply</button>
            <button
              onClick={clearAll}
              style={{
                padding: '5px 12px', fontSize: 12,
                background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-2)', cursor: 'pointer',
              }}
            >Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function TagPicker({ tags, selected, onToggle }: { tags: Tag[]; selected: Set<number>; onToggle: (id: number) => void }) {
  if (tags.length === 0) return <div style={{ fontSize: 11, color: 'var(--text-4)' }}>No tags yet</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 100, overflowY: 'auto' }}>
      {tags.map(t => (
        <button key={t.id} onClick={() => onToggle(t.id)} style={chipStyle(selected.has(t.id))}>
          #{t.name}
        </button>
      ))}
    </div>
  )
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 11, padding: '3px 8px', borderRadius: 10,
  background: active ? 'var(--text)' : 'var(--bg-subtle)',
  color: active ? 'var(--bg-app)' : 'var(--text-2)',
  border: 'none', cursor: 'pointer',
})

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px',
  border: '1px solid var(--border-strong)', borderRadius: 4,
  background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
}
