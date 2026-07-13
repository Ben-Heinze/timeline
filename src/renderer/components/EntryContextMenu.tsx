import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import TagEditor from './TagEditor'
import { GroupPickerList } from './GroupPicker'
import type { Entry, Tag } from '../../shared/types'

interface ContextMenuState {
  x: number
  y: number
  ids: number[]
}

// Shared right-click menu for entry lists (Files tab, file browser):
// add tags, assign to a group, delete with confirmation.
export function useEntryContextMenu(entries: Entry[]) {
  const {
    selectedIds, setSelection,
    groups, tags: allTags, setTags: setAllTags,
    bumpRefreshKey,
  } = useStore()

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

  const onEntryContextMenu = useCallback((entry: Entry) => (e: React.MouseEvent) => {
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

  const contextMenuUI = (
    <>
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
                  minWidth: 200,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden',
                }}>
                  <GroupPickerList
                    groups={groups}
                    onPick={assignToGroup}
                    onRemove={() => assignToGroup(null)}
                  />
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
    </>
  )

  return { onEntryContextMenu, contextMenuUI }
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
