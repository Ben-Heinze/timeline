import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DateRangeGroupModal() {
  const { pendingDateRange, setPendingDateRange, setGroups, bumpRefreshKey } = useStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[7])
  const [entryCount, setEntryCount] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!pendingDateRange) {
      setName('')
      setDescription('')
      setColor(PRESET_COLORS[7])
      setEntryCount(null)
      return
    }
    const [from, to] = pendingDateRange
    window.api.entries.forPeriod(from, to).then(entries => setEntryCount(entries.length))
  }, [pendingDateRange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDateRange(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPendingDateRange])

  if (!pendingDateRange) return null
  const [from, to] = pendingDateRange

  const handleCreate = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const group = await window.api.groups.create({
        name: name.trim(),
        parent_id: null,
        color,
        description: description.trim() || null,
        date_from: from,
        date_to: to,
      })
      await window.api.groups.assignEntriesForPeriod(group.id, from, to)
      const groups = await window.api.groups.list()
      setGroups(groups)
      bumpRefreshKey()
      setPendingDateRange(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) setPendingDateRange(null) }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 24, width: 380,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            New Date Range Group
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            {fmtDate(from)} — {fmtDate(to - 1)}
            {entryCount !== null && (
              <span style={{ marginLeft: 6, color: 'var(--text-4)' }}>
                · {entryCount} {entryCount === 1 ? 'entry' : 'entries'} will be assigned
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Title (required)"
            style={{
              width: '100%', padding: '8px 10px', fontSize: 14,
              border: '1px solid var(--border-strong)', borderRadius: 6,
              background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
              boxSizing: 'border-box',
            }}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            style={{
              width: '100%', padding: '8px 10px', fontSize: 13,
              border: '1px solid var(--border-strong)', borderRadius: 6,
              background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
              resize: 'vertical', fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
            textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6,
          }}>
            Color
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {PRESET_COLORS.map(c => (
              <div
                key={c}
                onClick={() => setColor(c)}
                style={{
                  aspectRatio: '1', borderRadius: 5, background: c, cursor: 'pointer',
                  outline: color === c ? '2px solid var(--text)' : '2px solid transparent',
                  outlineOffset: 1,
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            style={{
              flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600,
              background: name.trim() && !saving ? color : 'var(--border-strong)',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: name.trim() && !saving ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Creating…' : 'Create Group'}
          </button>
          <button
            onClick={() => setPendingDateRange(null)}
            style={{
              padding: '8px 16px', fontSize: 13,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
