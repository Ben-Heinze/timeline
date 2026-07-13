import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

const MS_DAY = 86_400_000

// 'YYYY-MM-DD' (local) ↔ Unix ms at local midnight
const toInputDate = (ts: number): string => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fromInputDate = (s: string): number | null => {
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--border-strong)', borderRadius: 6,
  background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
  boxSizing: 'border-box', fontFamily: 'inherit',
}

export default function LifeEventModal() {
  const { eventModalOpen, eventEditEvent, eventModalDefaults, closeEventModal, setEvents, selectedPeriod } = useStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[8])
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')
  const [ongoing, setOngoing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!eventModalOpen) return
    if (eventEditEvent) {
      setTitle(eventEditEvent.title)
      setDescription(eventEditEvent.description ?? '')
      setColor(eventEditEvent.color)
      setFromStr(toInputDate(eventEditEvent.date_from))
      // date_to is exclusive midnight; back up half a day to land on the inclusive end date
      setToStr(eventEditEvent.date_to != null ? toInputDate(eventEditEvent.date_to - MS_DAY / 2) : '')
      setOngoing(eventEditEvent.date_to == null)
    } else {
      const from = eventModalDefaults?.[0] ?? selectedPeriod?.[0] ?? Date.now()
      // Defaults carry an exclusive end; back up half a day for the inclusive input date
      const to = eventModalDefaults ? eventModalDefaults[1] - MS_DAY / 2 : from
      setTitle('')
      setDescription('')
      setColor(PRESET_COLORS[8])
      setFromStr(toInputDate(from))
      setToStr(toInputDate(to))
      setOngoing(false)
    }
  }, [eventModalOpen, eventEditEvent, eventModalDefaults, selectedPeriod])

  useEffect(() => {
    if (!eventModalOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeEventModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [eventModalOpen, closeEventModal])

  if (!eventModalOpen) return null

  const fromMs = fromInputDate(fromStr)
  const toEndMs = ongoing ? null : (() => {
    const t = fromInputDate(toStr)
    if (t == null) return undefined            // invalid input
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()  // exclusive end
  })()
  const datesValid = fromMs != null && toEndMs !== undefined && (toEndMs === null || toEndMs > fromMs)
  const canSave = title.trim().length > 0 && datesValid && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        color,
        date_from: fromMs!,
        date_to: toEndMs,
      }
      if (eventEditEvent) await window.api.events.update(eventEditEvent.id, payload)
      else await window.api.events.create(payload)
      setEvents(await window.api.events.list())
      closeEventModal()
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
    textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6,
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) closeEventModal() }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 24, width: 400,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {eventEditEvent ? 'Edit Event' : 'New Event'}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            A titled period on your timeline — a home, a job, a school year. Events can overlap freely.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            placeholder="Title (required) — e.g. Freshman year of college"
            style={{ ...inputStyle, fontSize: 14 }}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>From</div>
            <input type="date" value={fromStr} onChange={e => setFromStr(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>To</div>
            <input
              type="date"
              value={toStr}
              onChange={e => setToStr(e.target.value)}
              disabled={ongoing}
              style={{ ...inputStyle, opacity: ongoing ? 0.45 : 1 }}
            />
            <label style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
              fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', userSelect: 'none',
            }}>
              <input type="checkbox" checked={ongoing} onChange={e => setOngoing(e.target.checked)} />
              Ongoing (no end date)
            </label>
          </div>
        </div>
        {!datesValid && fromStr && toStr && !ongoing && (
          <div style={{ fontSize: 12, color: '#ef4444', marginTop: -8 }}>
            End date must be on or after the start date.
          </div>
        )}

        <div>
          <div style={labelStyle}>Color</div>
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
            onClick={handleSave}
            disabled={!canSave}
            style={{
              flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600,
              background: canSave ? color : 'var(--border-strong)',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: canSave ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Saving…' : eventEditEvent ? 'Save Changes' : 'Create Event'}
          </button>
          <button
            onClick={closeEventModal}
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
