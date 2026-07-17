import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Person, PersonKind, Entry } from '../../shared/types'
import { Thumb } from './entryDisplay'
import { PERSON_COLORS, randomPersonColor } from './PeopleEditor'

type Filter = 'all' | 'person' | 'animal'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Birthday helpers — birthdays are stored as ISO 'YYYY-MM-DD' calendar dates.
function parseBirthday(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return { y: +match[1], m: +match[2], d: +match[3] }
}

function birthdaySummary(iso: string | null): string | null {
  if (!iso) return null
  const b = parseBirthday(iso)
  if (!b) return null
  const dateLabel = new Date(b.y, b.m - 1, b.d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const today = new Date()
  let age = today.getFullYear() - b.y
  const hadBirthday = today.getMonth() + 1 > b.m || (today.getMonth() + 1 === b.m && today.getDate() >= b.d)
  if (!hadBirthday) age -= 1
  // Days until next birthday
  let next = new Date(today.getFullYear(), b.m - 1, b.d)
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    next = new Date(today.getFullYear() + 1, b.m - 1, b.d)
  }
  const daysUntil = Math.round((next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  const soon = daysUntil === 0 ? ' · 🎂 today!' : daysUntil <= 30 ? ` · in ${daysUntil}d` : ''
  return `${dateLabel} · turns ${age + 1} next${soon}`
}

function Avatar({ person, thumb, size }: { person: Person; thumb: string | null; size: number }) {
  if (thumb) {
    return (
      <img
        src={`timeline:///${thumb}`}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-thumb)' }}
        draggable={false}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: person.color, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.36, userSelect: 'none',
    }}>
      {person.kind === 'animal' ? '🐾' : initials(person.name)}
    </div>
  )
}

export default function PeopleView() {
  const { people, setPeople, setActiveEntryId, refreshKey, bumpRefreshKey } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Person | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])

  const refreshPeople = useCallback(() => window.api.people.list().then(setPeople), [setPeople])

  useEffect(() => { refreshPeople() }, [refreshPeople, refreshKey])

  // Load the selected person's full record + their tagged media.
  useEffect(() => {
    if (selectedId === null) { setDraft(null); setEntries([]); return }
    let cancelled = false
    window.api.people.get(selectedId).then(p => { if (!cancelled) setDraft(p) })
    window.api.people.entries(selectedId).then(es => { if (!cancelled) setEntries(es) })
    return () => { cancelled = true }
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people.filter(p =>
      (filter === 'all' || p.kind === filter) &&
      (!q || p.name.toLowerCase().includes(q) || (p.relationship?.toLowerCase().includes(q) ?? false))
    )
  }, [people, filter, search])

  const selectedListItem = people.find(p => p.id === selectedId) ?? null

  const addPerson = useCallback(async (kind: PersonKind) => {
    const created = await window.api.people.create({ kind, name: kind === 'animal' ? 'New Animal' : 'New Person', color: randomPersonColor() })
    await refreshPeople()
    setSelectedId(created.id)
  }, [refreshPeople])

  // Persist a single field. Refresh the list so name/kind/avatar changes show there.
  const saveField = useCallback(async (patch: Partial<Omit<Person, 'id'>>) => {
    if (!draft) return
    const updated = await window.api.people.update(draft.id, patch)
    setDraft(updated)
    await refreshPeople()
  }, [draft, refreshPeople])

  const onDraftChange = (patch: Partial<Person>) => setDraft(d => d ? { ...d, ...patch } : d)

  const deletePerson = useCallback(async () => {
    if (!draft) return
    if (!window.confirm(`Delete ${draft.name}? This removes them and untags them from all photos. The photos themselves are kept.`)) return
    await window.api.people.delete(draft.id)
    setSelectedId(null)
    await refreshPeople()
    bumpRefreshKey()
  }, [draft, refreshPeople, bumpRefreshKey])

  const setAvatar = useCallback(async (entryId: number | null) => {
    await saveField({ avatar_entry_id: entryId })
  }, [saveField])

  const avatarThumb = useMemo(() => {
    if (!draft?.avatar_entry_id) return null
    return entries.find(e => e.id === draft.avatar_entry_id)?.thumbnail_small
      ?? selectedListItem?.avatar_thumb ?? null
  }, [draft, entries, selectedListItem])

  const peopleCount = people.filter(p => p.kind === 'person').length
  const animalCount = people.filter(p => p.kind === 'animal').length

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* ─── List column ─── */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)',
      }}>
        <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderRadius: 6, padding: 2, gap: 1, flex: 1 }}>
              {(['all', 'person', 'animal'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    flex: 1, padding: '4px 0', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: filter === f ? 'var(--bg-app)' : 'transparent',
                    color: filter === f ? 'var(--text)' : 'var(--text-3)', fontWeight: filter === f ? 600 : 400,
                  }}
                >
                  {f === 'all' ? `All ${people.length}` : f === 'person' ? `People ${peopleCount}` : `Animals ${animalCount}`}
                </button>
              ))}
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people…"
            style={{
              padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-input)', outline: 'none', color: 'var(--text)',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => addPerson('person')} style={addBtnStyle}>+ Person</button>
            <button onClick={() => addPerson('animal')} style={addBtnStyle}>+ Animal</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-4)', textAlign: 'center', marginTop: 20 }}>
              {people.length === 0 ? 'No people yet. Add one, or tag someone in a photo.' : 'No matches'}
            </p>
          ) : filtered.map(p => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8,
                cursor: 'pointer', userSelect: 'none',
                background: selectedId === p.id ? 'var(--bg-selected)' : 'transparent',
              }}
              onMouseEnter={e => { if (selectedId !== p.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { if (selectedId !== p.id) (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <Avatar person={p} thumb={p.avatar_thumb} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.relationship || (p.kind === 'animal' ? 'Animal' : 'Person')}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-4)', flexShrink: 0 }}>{p.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Detail column ─── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {!draft ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 14 }}>
            Select someone to see their info sheet
          </div>
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 32px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 24 }}>
              <Avatar person={draft} thumb={avatarThumb} size={88} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  value={draft.name}
                  onChange={e => onDraftChange({ name: e.target.value })}
                  onBlur={() => saveField({ name: draft.name.trim() || 'Unnamed' })}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{
                    fontSize: 24, fontWeight: 700, color: 'var(--text)', width: '100%',
                    border: '1px solid transparent', borderRadius: 6, padding: '2px 6px', marginLeft: -6,
                    background: 'transparent', outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.border = '1px solid var(--border)'; e.currentTarget.style.background = 'var(--bg-input)' }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  {(['person', 'animal'] as PersonKind[]).map(k => (
                    <button
                      key={k}
                      onClick={() => saveField({ kind: k })}
                      style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                        border: '1px solid var(--border)',
                        background: draft.kind === k ? 'var(--text)' : 'transparent',
                        color: draft.kind === k ? 'var(--bg-app)' : 'var(--text-3)',
                      }}
                    >{k === 'person' ? 'Person' : 'Animal'}</button>
                  ))}
                  <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
                    {PERSON_COLORS.slice(0, 8).map(c => (
                      <div
                        key={c}
                        onClick={() => saveField({ color: c })}
                        title="Set color"
                        style={{
                          width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer',
                          outline: draft.color === c ? '2px solid var(--text)' : '2px solid transparent', outlineOffset: 1,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={deletePerson} title="Delete" style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--danger, #e5484d)',
                fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start',
              }}>Delete</button>
            </div>

            {/* Info sheet fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', marginBottom: 28 }}>
              <Field label="Relationship" value={draft.relationship} placeholder={draft.kind === 'animal' ? 'e.g. Dog, Cat' : 'e.g. Brother, Friend'}
                onChange={v => onDraftChange({ relationship: v })} onCommit={v => saveField({ relationship: v })} />
              <Field label="Birthday" type="date" value={draft.birthday} placeholder=""
                onChange={v => onDraftChange({ birthday: v })} onCommit={v => saveField({ birthday: v })}
                hint={birthdaySummary(draft.birthday) ?? undefined} />

              {draft.kind === 'animal' ? (
                <>
                  <Field label="Species" value={draft.species} placeholder="e.g. Dog"
                    onChange={v => onDraftChange({ species: v })} onCommit={v => saveField({ species: v })} />
                  <Field label="Breed" value={draft.breed} placeholder="e.g. Golden Retriever"
                    onChange={v => onDraftChange({ breed: v })} onCommit={v => saveField({ breed: v })} />
                </>
              ) : (
                <>
                  <Field label="Phone" value={draft.phone} placeholder=""
                    onChange={v => onDraftChange({ phone: v })} onCommit={v => saveField({ phone: v })} />
                  <Field label="Email" value={draft.email} placeholder=""
                    onChange={v => onDraftChange({ email: v })} onCommit={v => saveField({ email: v })} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Address" value={draft.address} placeholder=""
                      onChange={v => onDraftChange({ address: v })} onCommit={v => saveField({ address: v })} />
                  </div>
                </>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  value={draft.notes ?? ''}
                  onChange={e => onDraftChange({ notes: e.target.value })}
                  onBlur={e => saveField({ notes: e.target.value.trim() || null })}
                  placeholder="Anything you'd like to remember…"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px',
                    fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Tagged media */}
            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 10 }}>
                Photos & Videos · {entries.length}
              </div>
              {entries.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-4)' }}>
                  Not tagged in anything yet. Open a photo or video and add them under “People”.
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {entries.map(e => (
                    <div key={e.id} style={{ position: 'relative', width: 110 }}>
                      <div onClick={() => setActiveEntryId(e.id)} style={{ cursor: 'pointer' }}>
                        <Thumb entry={e} size={110} />
                      </div>
                      <button
                        onClick={() => setAvatar(draft.avatar_entry_id === e.id ? null : e.id)}
                        title={draft.avatar_entry_id === e.id ? 'Remove as profile photo' : 'Set as profile photo'}
                        style={{
                          position: 'absolute', top: 4, right: 4,
                          background: draft.avatar_entry_id === e.id ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
                          color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22,
                          fontSize: 12, cursor: 'pointer', lineHeight: 1,
                        }}
                      >{draft.avatar_entry_id === e.id ? '★' : '☆'}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const addBtnStyle: React.CSSProperties = {
  flex: 1, padding: '5px 0', fontSize: 12, cursor: 'pointer',
  background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-2)',
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4 }}>
      {children}
    </div>
  )
}

function Field({ label, value, placeholder, type, onChange, onCommit, hint }: {
  label: string
  value: string | null
  placeholder: string
  type?: string
  onChange: (v: string) => void
  onCommit: (v: string | null) => void
  hint?: string
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type ?? 'text'}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onCommit(e.target.value.trim() || null)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px',
          fontSize: 13, background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
        }}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
