import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)

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

  // The suggestions list must render in a body portal: this editor sits in the
  // bottom footer of an overflow-hidden modal (and inside the context menu), so
  // an in-flow dropdown gets clipped off-screen. We anchor it to the editor's
  // rect and flip it above the field when there isn't room below.
  const MENU_MAX = 140
  const menuOpen = suggestOpen && suggestions.length > 0

  const updateMenuPos = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < MENU_MAX + 8 && r.top > spaceBelow) {
      setMenuPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 2 })
    } else {
      setMenuPos({ left: r.left, width: r.width, top: r.bottom + 2 })
    }
  }, [])

  useLayoutEffect(() => {
    if (!menuOpen) { setMenuPos(null); return }
    updateMenuPos()
    window.addEventListener('resize', updateMenuPos)
    window.addEventListener('scroll', updateMenuPos, true)
    return () => {
      window.removeEventListener('resize', updateMenuPos)
      window.removeEventListener('scroll', updateMenuPos, true)
    }
  }, [menuOpen, input, current.length, updateMenuPos])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
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
      {menuOpen && menuPos && createPortal(
        <div style={{
          position: 'fixed', left: menuPos.left, width: menuPos.width,
          top: menuPos.top, bottom: menuPos.bottom,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 1000,
          maxHeight: MENU_MAX, overflowY: 'auto',
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
        </div>,
        document.body,
      )}
    </div>
  )
}
