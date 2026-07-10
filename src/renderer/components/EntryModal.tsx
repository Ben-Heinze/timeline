import React, { useEffect, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useStore } from '../store/useStore'
import type { Entry, Tag } from '../../shared/types'
import TagEditor from './TagEditor'

const TYPE_COLORS: Record<string, string> = {
  photo:    '#3b82f6',
  video:    '#8b5cf6',
  audio:    '#10b981',
  document: '#f59e0b',
  journal:  '#ec4899',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: '#fff',
      background: TYPE_COLORS[type] ?? '#555',
      borderRadius: 4, padding: '2px 6px',
    }}>
      {type}
    </span>
  )
}

function RichTextView({ json }: { json: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    editable: false,
    content: (() => { try { return JSON.parse(json) } catch { return json } })(),
  })

  useEffect(() => {
    if (!editor) return
    try { editor.commands.setContent(JSON.parse(json)) }
    catch { editor.commands.setContent(json) }
  }, [editor, json])

  return <EditorContent editor={editor} />
}

function EntryContent({ entry }: { entry: Entry }) {
  const thumbSrc = entry.thumbnail_large
    ? `timeline:///${entry.thumbnail_large}`
    : entry.thumbnail_medium
      ? `timeline:///${entry.thumbnail_medium}`
      : null

  const dateStr = new Date(entry.timestamp).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  if (thumbSrc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <img
          src={thumbSrc}
          style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 6 }}
          draggable={false}
        />
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{dateStr}</div>
      </div>
    )
  }

  if (entry.type === 'journal') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
            {entry.title ?? '(untitled)'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{dateStr}</div>
        </div>
        {entry.rich_text_json ? (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
            <RichTextView json={entry.rich_text_json} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>No content</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
      <div style={{
        width: 72, height: 72, borderRadius: 16,
        background: TYPE_COLORS[entry.type] ?? '#555',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28,
      }}>
        {entry.type === 'photo'    ? '📷'
        : entry.type === 'video'   ? '🎬'
        : entry.type === 'audio'   ? '🎵'
        :                            '📄'}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          {entry.title ?? '(untitled)'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>{dateStr}</div>
        {!entry.file_path && (
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>No file attached</div>
        )}
      </div>
      {entry.rich_text_json && (
        <div style={{
          maxWidth: 520, width: '100%', textAlign: 'left',
          background: 'var(--bg-muted)', borderRadius: 8, padding: 16,
        }}>
          <RichTextView json={entry.rich_text_json} />
        </div>
      )}
    </div>
  )
}

export default function EntryModal() {
  const { activeEntryId, setActiveEntryId, selectedPeriod, selectedGroupId, openJournalModal } = useStore()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [entryTags, setEntryTags] = useState<Tag[]>([])
  const [periodEntries, setPeriodEntries] = useState<Entry[]>([])

  useEffect(() => {
    if (!activeEntryId) { setEntry(null); setEntryTags([]); return }
    window.api.entries.get(activeEntryId).then(setEntry)
    window.api.tags.forEntry(activeEntryId).then(setEntryTags)
  }, [activeEntryId])

  const handleTagsChange = useCallback(async (names: string[]) => {
    if (!activeEntryId) return
    const updated = await window.api.tags.setForEntry(activeEntryId, names)
    setEntryTags(updated)
  }, [activeEntryId])

  useEffect(() => {
    if (!selectedPeriod) { setPeriodEntries([]); return }
    window.api.entries.forPeriod(selectedPeriod[0], selectedPeriod[1], selectedGroupId ?? undefined).then(setPeriodEntries)
  }, [selectedPeriod, selectedGroupId])

  const idx = entry ? periodEntries.findIndex(e => e.id === entry.id) : -1
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < periodEntries.length - 1

  const navigatePrev = useCallback(() => {
    if (hasPrev) setActiveEntryId(periodEntries[idx - 1].id)
  }, [hasPrev, idx, periodEntries, setActiveEntryId])

  const navigateNext = useCallback(() => {
    if (hasNext) setActiveEntryId(periodEntries[idx + 1].id)
  }, [hasNext, idx, periodEntries, setActiveEntryId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeEntryId) return
      if (e.key === 'Escape') setActiveEntryId(null)
      if (e.key === 'ArrowLeft') navigatePrev()
      if (e.key === 'ArrowRight') navigateNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeEntryId, navigatePrev, navigateNext, setActiveEntryId])

  if (!activeEntryId) return null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setActiveEntryId(null) }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div style={{
        width: 600, maxWidth: '90vw',
        background: 'var(--bg-surface)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}>
          {entry && <TypeBadge type={entry.type} />}
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry?.title ?? (entry?.type ?? '…')}
          </span>
          {entry?.type === 'journal' && (
            <button
              onClick={() => { openJournalModal(entry); setActiveEntryId(null) }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
            >Edit</button>
          )}
          <button
            onClick={() => setActiveEntryId(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 18, padding: '2px 6px', borderRadius: 4, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', minHeight: 220 }}>
          {entry ? <EntryContent entry={entry} /> : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--text-3)' }}>
              Loading…
            </div>
          )}
        </div>

        {entry && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0 }}>
              Tags
            </span>
            <div style={{ flex: 1 }}>
              <TagEditor tags={entryTags} onChange={handleTagsChange} />
            </div>
          </div>
        )}

        {/* Footer nav */}
        {periodEntries.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            borderTop: '1px solid var(--border-light)',
            flexShrink: 0,
          }}>
            <button
              onClick={navigatePrev}
              disabled={!hasPrev}
              style={{
                background: hasPrev ? 'var(--bg-subtle)' : 'transparent',
                border: '1px solid var(--border)',
                color: hasPrev ? 'var(--text)' : 'var(--text-4)',
                borderRadius: 6, padding: '5px 14px', fontSize: 13,
              }}
            >← Prev</button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {idx + 1} / {periodEntries.length}
            </span>
            <button
              onClick={navigateNext}
              disabled={!hasNext}
              style={{
                background: hasNext ? 'var(--bg-subtle)' : 'transparent',
                border: '1px solid var(--border)',
                color: hasNext ? 'var(--text)' : 'var(--text-4)',
                borderRadius: 6, padding: '5px 14px', fontSize: 13,
              }}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
