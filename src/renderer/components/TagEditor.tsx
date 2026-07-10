import React, { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Tag } from '../../shared/types'

interface Props {
  tags: Tag[]
  onChange: (names: string[]) => void
  compact?: boolean
}

export default function TagEditor({ tags, onChange, compact }: Props) {
  const { tags: allTags, setTags: setAllTags } = useStore()
  const [current, setCurrent] = useState<Tag[]>(tags)
  const [input, setInput] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)

  useEffect(() => { setCurrent(tags) }, [tags])

  const commit = useCallback((next: Tag[]) => {
    setCurrent(next)
    onChange(next.map(t => t.name))
  }, [onChange])

  const addByName = useCallback(async (rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    if (current.some(t => t.name.toLowerCase() === name.toLowerCase())) { setInput(''); return }
    let existing = allTags.find(t => t.name.toLowerCase() === name.toLowerCase())
    if (!existing) {
      existing = await window.api.tags.create(name)
      const list = await window.api.tags.list()
      setAllTags(list)
    }
    commit([...current, existing])
    setInput('')
  }, [current, allTags, setAllTags, commit])

  const remove = (id: number) => commit(current.filter(t => t.id !== id))

  const currentIds = new Set(current.map(t => t.id))
  const inputLower = input.trim().toLowerCase()
  const suggestions = inputLower
    ? allTags.filter(t => !currentIds.has(t.id) && t.name.toLowerCase().includes(inputLower)).slice(0, 6)
    : allTags.filter(t => !currentIds.has(t.id)).slice(0, 6)

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {current.map(t => (
          <span key={t.id} style={{
            fontSize: compact ? 10 : 11, padding: '2px 6px 2px 8px', borderRadius: 10,
            background: 'var(--bg-subtle)', color: 'var(--text)',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            #{t.name}
            <button
              onClick={() => remove(t.id)}
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
            if (e.key === 'Enter') { e.preventDefault(); addByName(input) }
            if (e.key === 'Backspace' && !input && current.length) remove(current[current.length - 1].id)
          }}
          placeholder={current.length ? '' : 'Add tag…'}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: compact ? 11 : 12, color: 'var(--text)',
            minWidth: 80, flex: 1, padding: '2px 0',
          }}
        />
      </div>
      {suggestOpen && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 20,
          maxHeight: 140, overflowY: 'auto',
        }}>
          {suggestions.map(t => (
            <div
              key={t.id}
              onMouseDown={e => { e.preventDefault(); addByName(t.name) }}
              style={{ fontSize: 12, padding: '5px 8px', cursor: 'pointer', color: 'var(--text)' }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
            >#{t.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}
