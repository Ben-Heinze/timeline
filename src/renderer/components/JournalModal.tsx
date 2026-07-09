import React, { useState, useCallback, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useStore } from '../store/useStore'

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
        background: active ? '#ede9e0' : 'none',
        border: 'none', borderRadius: 4,
        padding: '3px 8px', fontSize: 13, cursor: 'pointer',
        color: active ? '#1a1a1a' : '#666',
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

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
  })

  // Populate form when modal opens
  useEffect(() => {
    if (!journalModalOpen || !editor) return
    const e = journalEditEntry
    setTitle(e?.title ?? '')
    setDateStr(toDatetimeLocal(e?.timestamp ?? Date.now()))
    setGroupId(e?.group_id ?? null)
    if (e?.rich_text_json) {
      try { editor.commands.setContent(JSON.parse(e.rich_text_json)) }
      catch { editor.commands.setContent(e.rich_text_json) }
    } else {
      editor.commands.setContent('')
    }
    setTimeout(() => editor.commands.focus(), 60)
  }, [journalModalOpen, journalEditEntry, editor])

  const handleSave = useCallback(async () => {
    if (!editor) return
    setSaving(true)
    const rich_text_json = JSON.stringify(editor.getJSON())
    const timestamp = new Date(dateStr).getTime()
    try {
      if (journalEditEntry) {
        await window.api.entries.update(journalEditEntry.id, {
          title: title.trim() || null,
          timestamp,
          rich_text_json,
          group_id: groupId,
        })
      } else {
        await window.api.entries.create({
          type: 'journal',
          timestamp,
          title: title.trim() || null,
          rich_text_json,
          group_id: groupId,
        })
      }
      bumpRefreshKey()
      closeJournalModal()
    } finally {
      setSaving(false)
    }
  }, [editor, title, dateStr, groupId, journalEditEntry, bumpRefreshKey, closeJournalModal])

  useEffect(() => {
    if (!journalModalOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeJournalModal()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [journalModalOpen, closeJournalModal, handleSave])

  if (!journalModalOpen) return null

  const isEdit = !!journalEditEntry

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) closeJournalModal() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div style={{
        width: 660, maxWidth: '92vw', maxHeight: '88vh',
        background: '#fff',
        borderRadius: 12, border: '1px solid #e4e4dc',
        boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #eaeae4', flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
            background: '#ec4899', color: '#fff', borderRadius: 4, padding: '2px 6px',
          }}>Journal</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#444', flex: 1 }}>
            {isEdit ? 'Edit Entry' : 'New Entry'}
          </span>
          <button
            onClick={closeJournalModal}
            style={{ background: 'none', border: 'none', color: '#bbb', fontSize: 18, padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
          >✕</button>
        </div>

        {/* Meta row: title / date / group */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          gap: 8, padding: '10px 16px', borderBottom: '1px solid #f0f0ea', flexShrink: 0,
          alignItems: 'center',
        }}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (optional)"
            style={{
              padding: '6px 10px', fontSize: 14, fontWeight: 500,
              border: '1px solid #e4e4dc', borderRadius: 6,
              background: '#fafaf8', outline: 'none', color: '#1a1a1a',
            }}
          />
          <input
            type="datetime-local"
            value={dateStr}
            onChange={e => setDateStr(e.target.value)}
            style={{
              padding: '6px 8px', fontSize: 13,
              border: '1px solid #e4e4dc', borderRadius: 6,
              background: '#fafaf8', outline: 'none', color: '#444',
            }}
          />
          <select
            value={groupId ?? ''}
            onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
            style={{
              padding: '6px 8px', fontSize: 13,
              border: '1px solid #e4e4dc', borderRadius: 6,
              background: '#fafaf8', color: '#444',
            }}
          >
            <option value="">No group</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {/* Toolbar */}
        {editor && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 1,
            padding: '5px 10px', borderBottom: '1px solid #f0f0ea', flexShrink: 0,
            background: '#fafaf8',
          }}>
            <TBtn active={editor.isActive('bold')} onPress={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></TBtn>
            <TBtn active={editor.isActive('italic')} onPress={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></TBtn>
            <TBtn active={editor.isActive('strike')} onPress={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></TBtn>
            <span style={{ width: 1, background: '#e4e4dc', margin: '2px 4px', alignSelf: 'stretch' }} />
            <TBtn active={editor.isActive('heading', { level: 1 })} onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</TBtn>
            <TBtn active={editor.isActive('heading', { level: 2 })} onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</TBtn>
            <span style={{ width: 1, background: '#e4e4dc', margin: '2px 4px', alignSelf: 'stretch' }} />
            <TBtn active={editor.isActive('bulletList')} onPress={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</TBtn>
            <TBtn active={editor.isActive('orderedList')} onPress={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</TBtn>
            <span style={{ width: 1, background: '#e4e4dc', margin: '2px 4px', alignSelf: 'stretch' }} />
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
          padding: '10px 16px', borderTop: '1px solid #eaeae4', flexShrink: 0,
          background: '#fafaf8',
        }}>
          <span style={{ fontSize: 12, color: '#ccc', marginRight: 'auto' }}>⌘↵ to save · Esc to cancel</span>
          <button
            onClick={closeJournalModal}
            style={{
              padding: '6px 16px', fontSize: 13,
              background: 'none', border: '1px solid #e4e4dc',
              borderRadius: 6, color: '#666', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 20px', fontSize: 13, fontWeight: 600,
              background: saving ? '#d4d4d0' : '#1a1a1a',
              border: 'none', borderRadius: 6, color: '#fff',
              cursor: saving ? 'default' : 'pointer',
            }}
          >{saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
