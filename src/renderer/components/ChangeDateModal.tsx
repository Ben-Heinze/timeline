import React, { useEffect, useState } from 'react'
import type { SetDateResult } from '../../shared/types'

interface Props {
  ids: number[]
  onClose: () => void
  // Called after a successful change so the caller can refresh its lists.
  onApplied: () => void
}

type Mode = 'set' | 'shift'
type ShiftUnit = 'days' | 'hours' | 'minutes'

const UNIT_MS: Record<ShiftUnit, number> = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
}

// Epoch ms → the local `YYYY-MM-DDTHH:mm` string a datetime-local input wants.
function toLocalInput(ms: number): string {
  const off = new Date(ms).getTimezoneOffset() * 60_000
  return new Date(ms - off).toISOString().slice(0, 16)
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--border-strong)', borderRadius: 6,
  background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
  boxSizing: 'border-box',
}

export default function ChangeDateModal({ ids, onClose, onApplied }: Props) {
  const many = ids.length > 1
  const [mode, setMode] = useState<Mode>('set')
  const [dateStr, setDateStr] = useState(() => toLocalInput(Date.now()))
  const [shiftAmount, setShiftAmount] = useState(1)
  const [shiftUnit, setShiftUnit] = useState<ShiftUnit>('hours')
  const [shiftDir, setShiftDir] = useState<1 | -1>(1)
  const [writeExif, setWriteExif] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SetDateResult | null>(null)

  // Prefill the "set" field from the first selected entry's current date.
  useEffect(() => {
    let alive = true
    if (ids.length > 0) {
      window.api.entries.get(ids[0]).then(e => {
        if (alive && e) setDateStr(toLocalInput(e.timestamp))
      })
    }
    return () => { alive = false }
  }, [ids])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setInvalid = mode === 'set' && (dateStr === '' || Number.isNaN(new Date(dateStr).getTime()))

  const apply = async () => {
    if (busy || setInvalid) return
    const value = mode === 'set'
      ? new Date(dateStr).getTime()
      : shiftDir * shiftAmount * UNIT_MS[shiftUnit]
    if (mode === 'shift' && value === 0) { onClose(); return }
    setBusy(true)
    try {
      const res = await window.api.entries.setDate({ ids, mode, value, writeExif })
      onApplied()
      // With EXIF disabled there's nothing interesting to report — just close.
      if (!writeExif) { onClose(); return }
      setResult(res)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 24, width: 400,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            Change date
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            {ids.length} {ids.length === 1 ? 'item' : 'items'}
          </p>
        </div>

        {result ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
              <div><strong>{result.updated}</strong> {result.updated === 1 ? 'date' : 'dates'} updated</div>
              <div><strong>{result.exifWritten}</strong> {result.exifWritten === 1 ? 'file' : 'files'} written to disk</div>
              {result.exifSkipped > 0 && (
                <div style={{ color: 'var(--text-4)' }}>
                  {result.exifSkipped} skipped (referenced originals / non-photos / missing)
                </div>
              )}
              {result.exifFailed > 0 && (
                <div style={{ color: '#ef4444' }}>{result.exifFailed} failed to write</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        ) : (
          <>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['set', 'shift'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 13, cursor: 'pointer', border: 'none',
                    background: mode === m ? 'var(--accent)' : 'transparent',
                    color: mode === m ? '#fff' : 'var(--text-2)',
                  }}
                >
                  {m === 'set' ? 'Set to' : 'Shift by'}
                </button>
              ))}
            </div>

            {mode === 'set' ? (
              <input
                type="datetime-local"
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={shiftDir} onChange={e => setShiftDir(Number(e.target.value) as 1 | -1)} style={inputStyle}>
                  <option value={1}>Later (+)</option>
                  <option value={-1}>Earlier (−)</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={shiftAmount}
                  onChange={e => setShiftAmount(Math.max(0, Number(e.target.value)))}
                  style={{ ...inputStyle, width: 80 }}
                />
                <select value={shiftUnit} onChange={e => setShiftUnit(e.target.value as ShiftUnit)} style={{ ...inputStyle, flex: 1 }}>
                  <option value="days">days</option>
                  <option value="hours">hours</option>
                  <option value="minutes">minutes</option>
                </select>
              </div>
            )}
            {mode === 'set' && many && (
              <p style={{ margin: '-6px 0 0', fontSize: 11, color: 'var(--text-4)' }}>
                All {ids.length} items will be set to this exact date & time.
              </p>
            )}

            {/* EXIF option */}
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)' }}>
              <input type="checkbox" checked={writeExif} onChange={e => setWriteExif(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                Also write the date into the photo/video file
                <span style={{ display: 'block', color: 'var(--text-4)', fontSize: 11, marginTop: 2 }}>
                  Copied files only — your referenced originals are never modified.
                </span>
              </span>
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={apply}
                disabled={busy || setInvalid}
                style={{ ...primaryBtn, flex: 1, opacity: busy || setInvalid ? 0.5 : 1 }}
              >
                {busy ? 'Applying…' : 'Apply'}
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px', fontSize: 13,
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
  cursor: 'pointer',
}
