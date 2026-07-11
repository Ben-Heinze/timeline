import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import TagEditor from './TagEditor'
import type { Entry, EntryType, Tag } from '../../shared/types'

type ViewMode = 'list' | 'small' | 'medium' | 'large'
type SortBy = 'date' | 'title' | 'type' | 'tag'
type SortDir = 'asc' | 'desc'

const THUMB_SIZE: Record<Exclude<ViewMode, 'list'>, number> = {
  small: 84, medium: 132, large: 200,
}

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6', video: '#8b5cf6', audio: '#10b981', document: '#f59e0b', journal: '#ec4899',
}
const TYPE_LABELS: Record<string, string> = {
  photo: 'PHO', video: 'VID', audio: 'AUD', document: 'DOC', journal: 'JNL',
}

function monthYearKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}`
}
function monthYearLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function Thumb({ entry, size }: { entry: Entry; size: number }) {
  const src = entry.thumbnail_medium ?? entry.thumbnail_small ?? entry.thumbnail_large
  if (src) {
    return (
      <img
        src={`timeline:///${src}`}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block', borderRadius: 6, background: 'var(--bg-thumb)' }}
        draggable={false}
      />
    )
  }
  const badge = Math.round(size * 0.4)
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, background: 'var(--bg-thumb)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: badge, height: badge, borderRadius: badge * 0.22,
        background: TYPE_COLORS[entry.type] ?? '#555',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(badge * 0.32), fontWeight: 700, color: '#fff', letterSpacing: 0.5,
      }}>
        {TYPE_LABELS[entry.type] ?? '?'}
      </div>
    </div>
  )
}

interface RowCommonProps {
  entry: Entry
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function GridCell({ entry, selected, onClick, onDoubleClick, onContextMenu, size }: RowCommonProps & { size: number }) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        width: size + 20, padding: 8, borderRadius: 8,
        background: selected ? 'var(--bg-entry-sel)' : 'transparent',
        outline: selected ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <Thumb entry={entry} size={size} />
      <div style={{
        fontSize: 12, color: 'var(--text)', maxWidth: size + 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {entry.title ?? entry.type}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
}

function ListRow({ entry, selected, onClick, onDoubleClick, onContextMenu }: RowCommonProps) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 90px 180px',
        alignItems: 'center', gap: 12,
        padding: '5px 14px',
        background: selected ? 'var(--bg-entry-sel)' : 'transparent',
        borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
        cursor: 'pointer', userSelect: 'none',
        fontSize: 13,
      }}
    >
      <Thumb entry={entry} size={26} />
      <span style={{
        color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {entry.title ?? entry.file_path ?? entry.type}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: '#fff', background: TYPE_COLORS[entry.type] ?? '#555',
        borderRadius: 3, padding: '2px 6px', justifySelf: 'start',
      }}>
        {entry.type}
      </span>
      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
        {new Date(entry.timestamp).toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </span>
    </div>
  )
}

interface ContextMenuState {
  x: number
  y: number
  ids: number[]
}

export default function FilesView() {
  const {
    selectedGroupId, refreshKey, bumpRefreshKey,
    setActiveEntryId,
    selectedIds, setSelection, lastSelectedId,
    groups, tags: allTags, setTags: setAllTags,
  } = useStore()

  const [entries, setEntries] = useState<Entry[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('medium')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [groupSubOpen, setGroupSubOpen] = useState(false)
  const [tagModalIds, setTagModalIds] = useState<number[] | null>(null)
  const [pendingTagNames, setPendingTagNames] = useState<string[]>([])
  const [existingTags, setExistingTags] = useState<{ tag: Tag; count: number }[]>([])

  // Tags already on the targeted entries, with how many of them carry each tag
  useEffect(() => {
    if (tagModalIds === null) { setExistingTags([]); return }
    let cancelled = false
    Promise.all(tagModalIds.map(id => window.api.tags.forEntry(id))).then(perEntry => {
      if (cancelled) return
      const counts = new Map<number, { tag: Tag; count: number }>()
      for (const tags of perEntry) {
        for (const t of tags) {
          const cur = counts.get(t.id)
          if (cur) cur.count += 1
          else counts.set(t.id, { tag: t, count: 1 })
        }
      }
      setExistingTags([...counts.values()].sort((a, b) => a.tag.name.localeCompare(b.tag.name)))
    })
    return () => { cancelled = true }
  }, [tagModalIds])

  // Controlled tags for the modal's TagEditor: resolve pending names back to Tag
  // objects so chips added from the all-tags list below appear inside the editor.
  const pendingTags = useMemo(
    () => pendingTagNames
      .map(n => allTags.find(t => t.name.toLowerCase() === n.toLowerCase()))
      .filter((t): t is Tag => t != null),
    [pendingTagNames, allTags]
  )

  useEffect(() => {
    window.api.entries.listAll({
      groupId: selectedGroupId ?? undefined,
      sortBy, sortDir,
    }).then(setEntries)
  }, [selectedGroupId, sortBy, sortDir, refreshKey])

  const handleClickEntry = useCallback((entry: Entry) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastSelectedId !== null) {
      const from = entries.findIndex(x => x.id === lastSelectedId)
      const to = entries.findIndex(x => x.id === entry.id)
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        const range = new Set(entries.slice(a, b + 1).map(x => x.id))
        setSelection(range, entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [selectedIds, lastSelectedId, entries, setSelection])

  const handleContextMenu = useCallback((entry: Entry) => (e: React.MouseEvent) => {
    e.preventDefault()
    // Right-clicking outside the current selection retargets it to just that entry
    let ids: number[]
    if (selectedIds.has(entry.id)) {
      ids = [...selectedIds]
    } else {
      ids = [entry.id]
      setSelection(new Set([entry.id]), entry.id)
    }
    setGroupSubOpen(false)
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }, [selectedIds, setSelection])

  const closeMenu = useCallback(() => {
    setMenu(null)
    setGroupSubOpen(false)
  }, [])

  useEffect(() => {
    if (!menu && tagModalIds === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setGroupSubOpen(false)
        setTagModalIds(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, tagModalIds])

  const openTagModal = useCallback(() => {
    if (!menu) return
    setPendingTagNames([])
    setTagModalIds(menu.ids)
    closeMenu()
  }, [menu, closeMenu])

  const applyTags = useCallback(async () => {
    if (!tagModalIds || pendingTagNames.length === 0) { setTagModalIds(null); return }
    await window.api.tags.addToEntries(tagModalIds, pendingTagNames)
    setAllTags(await window.api.tags.list())
    setTagModalIds(null)
    bumpRefreshKey()
  }, [tagModalIds, pendingTagNames, setAllTags, bumpRefreshKey])

  const assignToGroup = useCallback(async (groupId: number | null) => {
    if (!menu) return
    await window.api.groups.assignEntries(groupId, menu.ids)
    closeMenu()
    bumpRefreshKey()
  }, [menu, closeMenu, bumpRefreshKey])

  const deleteSelected = useCallback(async () => {
    if (!menu) return
    const ids = menu.ids
    closeMenu()
    const hasCopied = entries.some(e => ids.includes(e.id) && e.import_mode === 'copy' && e.file_path)
    const msg = `Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'} from the database?`
      + (hasCopied ? ' Files copied into the library will be moved to the trash.' : '')
    if (!window.confirm(msg)) return
    await window.api.entries.delete(ids)
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [menu, entries, closeMenu, setSelection, bumpRefreshKey])

  const groupedByMonth = useMemo(() => {
    if (sortBy !== 'date') return null
    const out: { key: string; label: string; items: Entry[] }[] = []
    let currentKey: string | null = null
    for (const e of entries) {
      const key = monthYearKey(e.timestamp)
      if (key !== currentKey) {
        out.push({ key, label: monthYearLabel(e.timestamp), items: [] })
        currentKey = key
      }
      out[out.length - 1].items.push(e)
    }
    return out
  }, [entries, sortBy])

  const renderItem = (entry: Entry) => {
    const selected = selectedIds.has(entry.id)
    const common = {
      entry, selected,
      onClick: handleClickEntry(entry),
      onDoubleClick: () => setActiveEntryId(entry.id),
      onContextMenu: handleContextMenu(entry),
    }
    if (viewMode === 'list') return <ListRow key={entry.id} {...common} />
    return <GridCell key={entry.id} {...common} size={THUMB_SIZE[viewMode]} />
  }

  const renderItems = (items: Entry[]) => {
    if (viewMode === 'list') {
      return <div>{items.map(renderItem)}</div>
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px' }}>
        {items.map(renderItem)}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-muted)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          View
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['list', 'small', 'medium', 'large'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              style={toolBtn(viewMode === m)}
            >{iconFor(m)}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          Sort
        </span>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          style={selectStyle}
        >
          <option value="date">Date</option>
          <option value="title">Title</option>
          <option value="type">Type</option>
          <option value="tag">Tag</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'desc' ? 'Newest / Z→A first' : 'Oldest / A→Z first'}
          style={toolBtn(false)}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>
            No entries
          </div>
        ) : groupedByMonth ? (
          groupedByMonth.map(section => (
            <section key={section.key}>
              <header style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--bg-surface)',
                padding: '10px 14px 6px', fontSize: 12, fontWeight: 700,
                color: 'var(--text-2)', letterSpacing: 0.4,
                borderBottom: '1px solid var(--border-light)',
              }}>
                {section.label}
                <span style={{ marginLeft: 8, color: 'var(--text-4)', fontWeight: 400 }}>
                  {section.items.length}
                </span>
              </header>
              {renderItems(section.items)}
            </section>
          ))
        ) : (
          renderItems(entries)
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onMouseDown={closeMenu}
            onContextMenu={e => { e.preventDefault(); closeMenu() }}
          />
          <div style={{
            position: 'fixed', zIndex: 101,
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 140),
            minWidth: 190,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 4, fontSize: 13, color: 'var(--text)',
          }}>
            <div style={{
              padding: '4px 10px 6px', fontSize: 11, color: 'var(--text-4)',
              borderBottom: '1px solid var(--border-light)', marginBottom: 4,
            }}>
              {menu.ids.length} {menu.ids.length === 1 ? 'item' : 'items'}
            </div>
            <MenuItem label="Add tags…" onClick={openTagModal} />
            <div
              style={{ position: 'relative' }}
              onMouseEnter={() => setGroupSubOpen(true)}
              onMouseLeave={() => setGroupSubOpen(false)}
            >
              <MenuItem label="Add to group" trailing="›" onClick={() => setGroupSubOpen(o => !o)} />
              {groupSubOpen && (
                <div style={{
                  position: 'absolute', left: '100%', top: -4, zIndex: 102,
                  minWidth: 170, maxHeight: 260, overflowY: 'auto',
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 4,
                }}>
                  {groups.length === 0 && (
                    <div style={{ padding: '6px 10px', color: 'var(--text-4)', fontSize: 12 }}>No groups</div>
                  )}
                  {groups.map(g => (
                    <MenuItem
                      key={g.id}
                      label={g.name}
                      swatch={g.color}
                      onClick={() => assignToGroup(g.id)}
                    />
                  ))}
                  <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
                  <MenuItem label="Remove from group" onClick={() => assignToGroup(null)} />
                </div>
              )}
            </div>
            <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
            <MenuItem label="Delete…" danger onClick={deleteSelected} />
          </div>
        </>
      )}

      {/* Add-tags modal */}
      {tagModalIds !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 110,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) setTagModalIds(null) }}
        >
          <div style={{
            width: 380, maxWidth: '90vw',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Add tags
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              Tags will be added to {tagModalIds.length} {tagModalIds.length === 1 ? 'item' : 'items'}. Existing tags are kept.
            </div>
            {existingTags.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                  color: 'var(--text-4)', marginBottom: 6,
                }}>
                  Already assigned
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 80, overflowY: 'auto' }}>
                  {existingTags.map(({ tag, count }) => (
                    <span key={tag.id} style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 10,
                      background: 'var(--bg-entry-sel)', color: 'var(--text-2)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      #{tag.name}
                      {tagModalIds.length > 1 && count < tagModalIds.length && (
                        <span style={{ color: 'var(--text-4)', fontSize: 10 }}>
                          {count}/{tagModalIds.length}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 8px', background: 'var(--bg-input)', marginBottom: 12,
            }}>
              <TagEditor tags={pendingTags} onChange={setPendingTagNames} />
            </div>
            {allTags.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                  color: 'var(--text-4)', marginBottom: 6,
                }}>
                  All tags
                </div>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 4,
                  maxHeight: 120, overflowY: 'auto',
                }}>
                  {allTags.map(t => {
                    const added = pendingTagNames.some(n => n.toLowerCase() === t.name.toLowerCase())
                    return (
                      <button
                        key={t.id}
                        disabled={added}
                        onClick={() => setPendingTagNames(prev => [...prev, t.name])}
                        style={{
                          fontSize: 11, padding: '3px 8px', borderRadius: 10,
                          border: '1px solid var(--border)', cursor: added ? 'default' : 'pointer',
                          background: added ? 'var(--bg-entry-sel)' : 'var(--bg-subtle)',
                          color: added ? 'var(--text-4)' : 'var(--text)',
                          opacity: added ? 0.6 : 1,
                        }}
                      >
                        #{t.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setTagModalIds(null)} style={modalBtn(false)}>Cancel</button>
              <button
                onClick={applyTags}
                disabled={pendingTagNames.length === 0}
                style={{ ...modalBtn(true), opacity: pendingTagNames.length === 0 ? 0.5 : 1 }}
              >
                Add tags
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, danger, trailing, swatch }: {
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: string
  swatch?: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
        color: danger ? 'var(--danger, #e5484d)' : 'var(--text)',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
    >
      {swatch && (
        <span style={{ width: 10, height: 10, borderRadius: 3, background: swatch, flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {trailing && <span style={{ color: 'var(--text-4)' }}>{trailing}</span>}
    </div>
  )
}

const modalBtn = (primary: boolean): React.CSSProperties => ({
  fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text)',
})

function iconFor(m: ViewMode): React.ReactNode {
  if (m === 'list') return <span style={{ letterSpacing: 1 }}>≡</span>
  if (m === 'small') return <IconGrid n={3} />
  if (m === 'medium') return <IconGrid n={2} />
  return <IconGrid n={1} />
}

function IconGrid({ n }: { n: 1 | 2 | 3 }) {
  const cells = n * n
  return (
    <span style={{
      display: 'inline-grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 1.5,
      width: 12, height: 12, verticalAlign: 'middle',
    }}>
      {Array.from({ length: cells }).map((_, i) => (
        <span key={i} style={{ background: 'currentColor', borderRadius: 1 }} />
      ))}
    </span>
  )
}

const toolBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--text)' : 'none',
  color: active ? 'var(--bg-app)' : 'var(--text-2)',
  border: active ? 'none' : '1px solid var(--border)',
  borderRadius: 5, padding: '3px 8px',
  fontSize: 12, cursor: 'pointer', lineHeight: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 24, minWidth: 26,
})

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px',
  border: '1px solid var(--border)', borderRadius: 5,
  background: 'var(--bg-input)', color: 'var(--text)',
}
