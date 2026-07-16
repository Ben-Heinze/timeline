import React, { useEffect, useRef, useState } from 'react'
import type { ImportPreview, Tag } from '../../shared/types'

interface Props {
  preview: ImportPreview
  onConfirm: (tagNames: string[]) => void
  onCancel: () => void
}

const TYPE_LABELS: Record<string, string> = {
  photo: 'photo', video: 'video', audio: 'audio', document: 'document', journal: 'journal',
}

export default function ImportTagModal({ preview, onConfirm, onCancel }: Props) {
  const { total: fileCount, byType } = preview
  const breakdown = (Object.entries(byType) as [string, number][])
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
  // Junk swept in from OS/filesystem clutter (Spotlight indexes, Recycle Bin,
  // fsck orphans, …) almost always lands in the catch-all "document" bucket,
  // so a large, disproportionate document count is the tell that something
  // other than real media got picked up.
  const suspicious = fileCount > 1000 && byType.document / fileCount > 0.25
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.tags.list().then(setAllTags)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  function toggleTag(name: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function addInputTag() {
    const name = input.trim()
    if (!name) return
    if (!allTags.find(t => t.name.toLowerCase() === name.toLowerCase())) {
      setAllTags(prev => [...prev, { id: -1, name }])
    }
    setSelected(prev => new Set([...prev, name]))
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addInputTag() }
    if (e.key === 'Escape') onCancel()
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  }
  const modal: React.CSSProperties = {
    background: 'var(--bg-surface)', borderRadius: 10,
    border: '1px solid var(--border)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
    padding: '28px 28px 24px',
    width: 480, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', gap: 20,
  }
  const pill = (active: boolean, isNew: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none',
    border: active
      ? (isNew ? '2px solid #059669' : '2px solid var(--accent)')
      : '2px solid var(--border)',
    background: active
      ? (isNew ? '#d1fae5' : 'var(--bg-subtle)')
      : 'var(--bg-subtle)',
    color: active
      ? (isNew ? '#065f46' : 'var(--text)')
      : 'var(--text-2)',
    transition: 'all 80ms',
  })

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={modal}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Tag this import
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {fileCount.toLocaleString()} file{fileCount !== 1 ? 's' : ''} selected — tags are optional
          </div>
          {breakdown.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
              {breakdown.map(([type, n]) => `${n.toLocaleString()} ${TYPE_LABELS[type] ?? type}${n !== 1 ? 's' : ''}`).join(' · ')}
            </div>
          )}
          {suspicious && (
            <div style={{
              marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 12,
              background: 'var(--bg-subtle)', border: '1px solid #d97706', color: 'var(--text-2)',
            }}>
              ⚠ That's a lot of files for what looks like a media import, and most of them
              are "document" type. This can happen when a folder (especially on an external
              drive) contains hidden OS files (Recycle Bin, Spotlight index, lost+found, etc.)
              alongside your media. Consider canceling and double-checking the source folder
              before importing {fileCount.toLocaleString()} files.
            </div>
          )}
        </div>

        {/* Existing + newly added tags */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Tags
          </div>
          {allTags.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>No tags yet — create one below.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allTags.map(tag => {
                const isNew = tag.id === -1
                const active = selected.has(tag.name)
                return (
                  <span
                    key={tag.name}
                    style={pill(active, isNew)}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {isNew && !active && <span style={{ opacity: 0.5 }}>+</span>}
                    {tag.name}
                    {isNew && <span style={{ fontSize: 10, opacity: 0.7 }}>new</span>}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* New tag input */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Create new tag
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tag name…"
              style={{
                flex: 1, padding: '7px 10px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 6,
                outline: 'none', background: 'var(--bg-input)', color: 'var(--text)',
              }}
            />
            <button
              onClick={addInputTag}
              disabled={!input.trim()}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 600,
                background: input.trim() ? 'var(--accent)' : 'var(--bg-subtle)',
                color: input.trim() ? 'var(--accent-fg)' : 'var(--text-4)',
                border: 'none', borderRadius: 6, cursor: input.trim() ? 'pointer' : 'default',
              }}
            >+ Add</button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          {selected.size > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center', marginRight: 'auto' }}>
              {selected.size} tag{selected.size !== 1 ? 's' : ''} selected
            </span>
          )}
          <button
            onClick={onCancel}
            style={{
              padding: '7px 16px', fontSize: 13, fontWeight: 600,
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)',
            }}
          >Skip</button>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            style={{
              padding: '7px 20px', fontSize: 13, fontWeight: 600,
              background: 'var(--accent)', border: 'none',
              borderRadius: 6, cursor: 'pointer', color: 'var(--accent-fg)',
            }}
          >Import {fileCount} file{fileCount !== 1 ? 's' : ''}</button>
        </div>
      </div>
    </div>
  )
}
