import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useStore } from '../store/useStore'
import type { Entry } from '../../shared/types'
import { Thumb } from './entryDisplay'
import ReferencePickerModal from './ReferencePickerModal'

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function TBtn({
  active, onPress, children, title,
}: { active?: boolean; onPress: () => void; children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onPress() }}
      style={{
        background: active ? 'var(--bg-hover)' : 'none',
        border: 'none', borderRadius: 4,
        padding: '3px 8px', fontSize: 13, cursor: 'pointer',
        color: active ? 'var(--text)' : 'var(--text-2)',
        fontWeight: active ? 700 : 400,
        lineHeight: 1.4,
      }}
    >{children}</button>
  )
}

export default function JournalModal() {
  const {
    journalModalOpen, journalEditEntry,
    openJournalModal: _open, closeJournalModal,
    bumpRefreshKey, groups,
  } = useStore()

  const [title, setTitle] = useState('')
  const [dateStr, setDateStr] = useState(toDatetimeLocal(Date.now()))
  const [groupId, setGroupId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [referencedEntries, setReferencedEntries] = useState<Entry[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  const isEdit = !!journalEditEntry

  const initialSnapshotRef = useRef<{
    title: string; dateStr: string; groupId: number | null; contentJSON: string; refIds: string
  } | null>(null)

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
  })

  useEffect(() => {
    if (!journalModalOpen || !editor) return
    const e = journalEditEntry
    const nextTitle = e?.title ?? ''
    const nextDateStr = toDatetimeLocal(e?.timestamp ?? Date.now())
    const nextGroupId = e?.group_id ?? null
    setTitle(nextTitle)
    setDateStr(nextDateStr)
    setGroupId(nextGroupId)
    if (e?.rich_text_json) {
      try { editor.commands.setContent(JSON.parse(e.rich_text_json)) }
      catch { editor.commands.setContent(e.rich_text_json) }
    } else {
      editor.commands.setContent('')
    }
    const loadRefs = e?.id ? window.api.entries.references(e.id) : Promise.resolve([])
    loadRefs.then(refs => {
      setReferencedEntries(refs)
      initialSnapshotRef.current = {
        title: nextTitle,
        dateStr: nextDateStr,
        groupId: nextGroupId,
        contentJSON: JSON.stringify(editor.getJSON()),
        refIds: JSON.stringify(refs.map((r: Entry) => r.id).sort()),
      }
    })
    setTimeout(() => editor.commands.focus(), 60)
  }, [journalModalOpen, journalEditEntry, editor])

  const isDirty = useCallback(() => {
    if (!editor) return false
    const snap = initialSnapshotRef.current
    if (!snap) return false
    return (
      title !== snap.title
      || dateStr !== snap.dateStr
      || groupId !== snap.groupId
      || JSON.stringify(editor.getJSON()) !== snap.contentJSON
      || JSON.stringify(referencedEntries.map(e => e.id).sort()) !== snap.refIds
    )
  }, [editor, title, dateStr, groupId, referencedEntries])

  const handleSave = useCallback(async () => {
    if (!editor) return
    setSaving(true)
    const rich_text_json = JSON.stringify(editor.getJSON())
    const timestamp = new Date(dateStr).getTime()
    try {
      let entryId: number
      if (journalEditEntry) {
        entryId = journalEditEntry.id
        await window.api.entries.update(entryId, {
          title: title.trim() || null,
          timestamp,
          rich_text_json,
          group_id: groupId,
        })
      } else {
        entryId = await window.api.entries.create({
          type: 'journal',
          timestamp,
          title: title.trim() || null,
          rich_text_json,
          group_id: groupId,
        })
      }
      await window.api.entries.setReferences(entryId, referencedEntries.map(e => e.id))
      bumpRefreshKey()
      closeJournalModal()
    } finally {
      setSaving(false)
    }
  }, [editor, title, dateStr, groupId, journalEditEntry, referencedEntries, bumpRefreshKey, closeJournalModal])

  const requestClose = useCallback(() => {
    if (isDirty()) setConfirmDiscardOpen(true)
    else closeJournalModal()
  }, [isDirty, closeJournalModal])

  useEffect(() => {
    if (!journalModalOpen) return
    const handler = (e: KeyboardEvent) => {
      if (pickerOpen) return
      if (confirmDiscardOpen) {
        if (e.key === 'Escape') setConfirmDiscardOpen(false)
        return
      }
      if (e.key === 'Escape') requestClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [journalModalOpen, requestClose, handleSave, pickerOpen, confirmDiscardOpen])

  if (!journalModalOpen) return null

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div style={{
        width: 660, maxWidth: '92vw', maxHeight: '88vh',
        background: 'var(--bg-surface)',
        borderRadius: 12, border: '1px solid var(--border)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
            background: '#ec4899', color: '#fff', borderRadius: 4, padding: '2px 6px',
          }}>Journal</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', flex: 1 }}>
            {isEdit ? 'Edit Entry' : 'New Entry'}
          </span>
          <button
            onClick={requestClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 18, padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
          >✕</button>
        </div>

        {/* Meta row: title / date / group */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
          alignItems: 'center',
        }}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (optional)"
            style={{
              padding: '6px 10px', fontSize: 14, fontWeight: 500,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-muted)', outline: 'none', color: 'var(--text)',
            }}
          />
          <input
            type="datetime-local"
            value={dateStr}
            onChange={e => setDateStr(e.target.value)}
            style={{
              padding: '6px 8px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-muted)', outline: 'none', color: 'var(--text-2)',
            }}
          />
          <select
            value={groupId ?? ''}
            onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
            style={{
              padding: '6px 8px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-muted)', color: 'var(--text-2)',
            }}
          >
            <option value="">No group</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {/* References row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '8px 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
        }}>
          <button
            onClick={() => setPickerOpen(true)}
            style={{
              fontSize: 12, padding: '4px 10px', flexShrink: 0,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'none', color: 'var(--text-2)', cursor: 'pointer',
            }}
          >📎 Reference files</button>
          {referencedEntries.map(e => (
            <span key={e.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11, padding: '2px 6px 2px 3px', borderRadius: 14,
              background: 'var(--bg-subtle)', color: 'var(--text)',
            }}>
              <Thumb entry={e} size={20} />
              <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.title ?? e.type}
              </span>
              <button
                onClick={() => setReferencedEntries(prev => prev.filter(x => x.id !== e.id))}
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 12, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>

        {/* Toolbar */}
        {editor && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 1,
            padding: '5px 10px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
            background: 'var(--bg-muted)',
          }}>
            <TBtn active={editor.isActive('bold')} onPress={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></TBtn>
            <TBtn active={editor.isActive('italic')} onPress={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></TBtn>
            <TBtn active={editor.isActive('strike')} onPress={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></TBtn>
            <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px', alignSelf: 'stretch' }} />
            <TBtn active={editor.isActive('heading', { level: 1 })} onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</TBtn>
            <TBtn active={editor.isActive('heading', { level: 2 })} onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</TBtn>
            <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px', alignSelf: 'stretch' }} />
            <TBtn active={editor.isActive('bulletList')} onPress={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</TBtn>
            <TBtn active={editor.isActive('orderedList')} onPress={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</TBtn>
            <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px', alignSelf: 'stretch' }} />
            <TBtn active={editor.isActive('blockquote')} onPress={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">"</TBtn>
            <TBtn active={editor.isActive('code')} onPress={() => editor.chain().focus().toggleCode().run()} title="Inline code">`</TBtn>
            <span style={{ flex: 1 }} />
            <TBtn active={false} onPress={() => editor.chain().focus().undo().run()} title="Undo">↩</TBtn>
            <TBtn active={false} onPress={() => editor.chain().focus().redo().run()} title="Redo">↪</TBtn>
          </div>
        )}

        {/* Editor area */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', cursor: 'text', minHeight: 0 }}
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent editor={editor} />
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderTop: '1px solid var(--border-light)', flexShrink: 0,
          background: 'var(--bg-muted)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-4)', marginRight: 'auto' }}>⌘↵ to save · Esc to cancel</span>
          <button
            onClick={requestClose}
            style={{
              padding: '6px 16px', fontSize: 13,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 20px', fontSize: 13, fontWeight: 600,
              background: saving ? 'var(--border-strong)' : 'var(--text)',
              border: 'none', borderRadius: 6, color: 'var(--bg-app)',
              cursor: saving ? 'default' : 'pointer',
            }}
          >{saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>

      {pickerOpen && (
        <ReferencePickerModal
          excludeIds={new Set([
            ...(journalEditEntry ? [journalEditEntry.id] : []),
            ...referencedEntries.map(e => e.id),
          ])}
          onAdd={added => setReferencedEntries(prev => [...prev, ...added])}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {confirmDiscardOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setConfirmDiscardOpen(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{
            width: 360, maxWidth: '90vw',
            background: 'var(--bg-surface)',
            borderRadius: 12, border: '1px solid var(--border)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
            padding: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
              Unsaved changes
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 18 }}>
              {isEdit ? 'Save your changes to this entry before closing?' : 'Save this entry before closing?'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => { setConfirmDiscardOpen(false); closeJournalModal() }}
                style={{
                  padding: '6px 14px', fontSize: 13,
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 6, color: '#ef4444', cursor: 'pointer',
                }}
              >Discard</button>
              <button
                onClick={() => setConfirmDiscardOpen(false)}
                style={{
                  padding: '6px 14px', fontSize: 13,
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={() => { setConfirmDiscardOpen(false); handleSave() }}
                disabled={saving}
                style={{
                  padding: '6px 16px', fontSize: 13, fontWeight: 600,
                  background: saving ? 'var(--border-strong)' : 'var(--text)',
                  border: 'none', borderRadius: 6, color: 'var(--bg-app)',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >{isEdit ? 'Save changes' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
