import React, { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Person } from '../../shared/types'

export const PERSON_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

export function randomPersonColor(): string {
  return PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)]
}

// Chip editor for tagging people/animals in an entry. Works with Person identities
// (not names) so two people can share a name. Typing a brand-new name creates a
// person (kind 'person') the user can flesh out later in the People tab.
interface Props {
  people: Person[]
  onChange: (personIds: number[]) => void
  compact?: boolean
}

export default function PeopleEditor({ people, onChange, compact }: Props) {
  const { people: allPeople, setPeople } = useStore()
  const [current, setCurrent] = useState<Person[]>(people)
  const [input, setInput] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)

  useEffect(() => { setCurrent(people) }, [people])

  const commit = useCallback((next: Person[]) => {
    setCurrent(next)
    onChange(next.map(p => p.id))
  }, [onChange])

  const addExisting = useCallback((p: Person) => {
    if (current.some(c => c.id === p.id)) { setInput(''); return }
    commit([...current, p])
    setInput('')
  }, [current, commit])

  const createByName = useCallback(async (rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    const created = await window.api.people.create({ kind: 'person', name, color: randomPersonColor() })
    setPeople(await window.api.people.list())
    commit([...current, created])
    setInput('')
  }, [current, commit, setPeople])

  const remove = (id: number) => commit(current.filter(p => p.id !== id))

  const currentIds = new Set(current.map(p => p.id))
  const inputLower = input.trim().toLowerCase()
  const suggestions = (inputLower
    ? allPeople.filter(p => !currentIds.has(p.id) && p.name.toLowerCase().includes(inputLower))
    : allPeople.filter(p => !currentIds.has(p.id))
  ).slice(0, 6)
  const exactExists = allPeople.some(p => p.name.toLowerCase() === inputLower)

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {current.map(p => (
          <span key={p.id} style={{
            fontSize: compact ? 10 : 11, padding: '2px 6px 2px 6px', borderRadius: 10,
            background: 'var(--bg-subtle)', color: 'var(--text)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
            {p.kind === 'animal' ? '🐾 ' : ''}{p.name}
            <button
              onClick={() => remove(p.id)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-4)',
                fontSize: 11, padding: '0 2px', cursor: 'pointer', lineHeight: 1,
              }}
            >×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const match = allPeople.find(p => p.name.toLowerCase() === inputLower && !currentIds.has(p.id))
              if (match) addExisting(match)
              else createByName(input)
            }
            if (e.key === 'Backspace' && !input && current.length) remove(current[current.length - 1].id)
          }}
          placeholder={current.length ? '' : 'Add person…'}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: compact ? 11 : 12, color: 'var(--text)',
            minWidth: 90, flex: 1, padding: '2px 0',
          }}
        />
      </div>
      {suggestOpen && (suggestions.length > 0 || (inputLower && !exactExists)) && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 20,
          maxHeight: 160, overflowY: 'auto',
        }}>
          {suggestions.map(p => (
            <div
              key={p.id}
              onMouseDown={e => { e.preventDefault(); addExisting(p) }}
              style={{ fontSize: 12, padding: '5px 8px', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
              {p.kind === 'animal' ? '🐾 ' : ''}{p.name}
            </div>
          ))}
          {inputLower && !exactExists && (
            <div
              onMouseDown={e => { e.preventDefault(); createByName(input) }}
              style={{ fontSize: 12, padding: '5px 8px', cursor: 'pointer', color: 'var(--accent)', borderTop: suggestions.length ? '1px solid var(--border-light)' : 'none' }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
            >
              + Create “{input.trim()}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}
