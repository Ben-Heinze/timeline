import React, { useEffect, useRef, useState } from 'react'
import type { ProfileList } from '../../shared/types'

// Header control for switching between Timelines (profiles). Each profile is a
// self-contained library folder; switching just reopens the app on it — no data
// is copied — so it's instant even for terabyte libraries. The renderer reloads
// after a switch/create/import so every view re-reads the newly active library.
export default function ProfileSwitcher() {
  const [list, setList] = useState<ProfileList | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'new' | 'rename'>('menu')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.profiles.list().then(setList)
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const active = list?.profiles.find(p => p.id === list.activeId) ?? null

  function close() {
    setOpen(false)
    setMode('menu')
    setName('')
  }

  async function switchTo(id: string) {
    if (busy || id === list?.activeId) return
    setBusy(true)
    try {
      await window.api.profiles.switch(id)
      window.location.reload()   // re-reads all data from the newly active library
    } catch (e) {
      window.alert((e as Error).message ?? 'Could not switch Timeline.')
      setBusy(false)
    }
  }

  async function createNew() {
    const n = name.trim()
    if (busy || !n) return
    setBusy(true)
    try {
      const p = await window.api.profiles.createNew(n)
      await window.api.profiles.switch(p.id)
      window.location.reload()
    } catch (e) {
      window.alert((e as Error).message ?? 'Could not create Timeline.')
      setBusy(false)
    }
  }

  async function openExisting() {
    if (busy) return
    setBusy(true)
    try {
      const p = await window.api.profiles.addExisting('')
      if (!p) { setBusy(false); return }   // dialog cancelled
      await window.api.profiles.switch(p.id)
      window.location.reload()
    } catch (e) {
      window.alert((e as Error).message ?? 'Could not open Timeline.')
      setBusy(false)
    }
  }

  async function renameActive() {
    const n = name.trim()
    if (!list || !active || !n) { setMode('menu'); setName(''); return }
    const updated = await window.api.profiles.rename(active.id, n)
    setList(updated)
    setMode('menu')
    setName('')
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Remove "${label}" from the list?\n\nThis only forgets it here — the library folder on disk is left untouched and can be re-added later.`)) return
    const updated = await window.api.profiles.remove(id)
    setList(updated)
  }

  if (!list || !active) return null

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="Switch Timeline"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '5px 10px', cursor: 'pointer',
          color: 'var(--text)', fontSize: 13, maxWidth: 200,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0,
        }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {active.name}
        </span>
        <span style={{ color: 'var(--text-4)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 200,
          minWidth: 260, background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.22)', padding: 6,
          fontSize: 13, color: 'var(--text)',
        }}>
          {mode === 'menu' && (
            <>
              <div style={{
                padding: '4px 8px 6px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                textTransform: 'uppercase', color: 'var(--text-4)',
              }}>
                Timelines
              </div>
              {list.profiles.map(p => {
                const isActive = p.id === list.activeId
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', borderRadius: 5,
                      cursor: isActive ? 'default' : 'pointer',
                      background: isActive ? 'var(--bg-entry-sel)' : 'transparent',
                    }}
                    onClick={() => !isActive && switchTo(p.id)}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    <span style={{ width: 14, flexShrink: 0, color: '#22c55e', textAlign: 'center' }}>
                      {isActive ? '●' : ''}
                    </span>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.path}
                      </div>
                    </div>
                    {isActive ? (
                      <button
                        onClick={e => { e.stopPropagation(); setName(p.name); setMode('rename') }}
                        title="Rename"
                        style={miniBtn}
                      >Rename</button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); remove(p.id, p.name) }}
                        title="Remove from list"
                        style={{ ...miniBtn, color: 'var(--danger, #e5484d)' }}
                      >Remove</button>
                    )}
                  </div>
                )
              })}

              <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 0' }} />
              <div onClick={() => { setName(''); setMode('new') }} style={actionRow}>+ New Timeline…</div>
              <div onClick={openExisting} style={actionRow}>Open existing folder…</div>
            </>
          )}

          {(mode === 'new' || mode === 'rename') && (
            <div style={{ padding: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                {mode === 'new' ? 'New Timeline' : 'Rename Timeline'}
              </div>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); mode === 'new' ? createNew() : renameActive() } }}
                placeholder={mode === 'new' ? 'e.g. Anna, Family photos…' : 'Timeline name'}
                style={{
                  width: '100%', boxSizing: 'border-box', marginBottom: 10,
                  border: '1px solid var(--border-strong)', borderRadius: 6,
                  padding: '7px 9px', fontSize: 13, background: 'var(--bg-input)', color: 'var(--text)',
                }}
              />
              {mode === 'new' && (
                <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 10 }}>
                  Creates a fresh, empty Timeline with its own photos, people, events and settings.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setMode('menu'); setName('') }} style={{ ...miniBtn, padding: '6px 12px' }}>Cancel</button>
                <button
                  onClick={() => (mode === 'new' ? createNew() : renameActive())}
                  disabled={busy || !name.trim()}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
                    background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                    opacity: busy || !name.trim() ? 0.5 : 1,
                  }}
                >{mode === 'new' ? (busy ? 'Creating…' : 'Create & switch') : 'Save'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
  fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
}

const actionRow: React.CSSProperties = {
  padding: '7px 8px', borderRadius: 5, cursor: 'pointer', color: 'var(--text-2)',
}
