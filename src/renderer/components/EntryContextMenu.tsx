import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import TagEditor from './TagEditor'
import PeopleEditor from './PeopleEditor'
import { GroupPickerList } from './GroupPicker'
import ChangeDateModal from './ChangeDateModal'
import SetLocationModal from './SetLocationModal'
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
    groups, setGroups, selectedGroupId,
    tags: allTags, setTags: setAllTags,
    people: allPeople, setPeople,
    bumpRefreshKey,
  } = useStore()

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Clamped on-screen position, refined from the menu's real measured size so a
  // menu opened near the bottom/right edge flips fully into view instead of
  // spilling off-screen (its height varies with which items are shown).
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const [groupSubOpen, setGroupSubOpen] = useState(false)
  const groupRowRef = useRef<HTMLDivElement>(null)
  const groupSubRef = useRef<HTMLDivElement>(null)
  // Fixed position for the "Add to group" flyout. It must live outside the
  // menu's scroll container (which clips overflow), so it's positioned in
  // viewport coords from the anchor row and flipped/clamped to stay on-screen.
  const [groupSubPos, setGroupSubPos] = useState<{ left: number; top: number } | null>(null)
  const [tagModalIds, setTagModalIds] = useState<number[] | null>(null)
  const [peopleModalIds, setPeopleModalIds] = useState<number[] | null>(null)
  const [pendingPersonIds, setPendingPersonIds] = useState<number[]>([])
  const [dateModalIds, setDateModalIds] = useState<number[] | null>(null)
  const [locationModalIds, setLocationModalIds] = useState<number[] | null>(null)
  const [renameId, setRenameId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameFile, setRenameFile] = useState(false)
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

  // Read the live selection through a ref so this handler stays referentially
  // stable — passing it to hundreds of memoized rows must not invalidate them.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const onEntryContextMenu = useCallback((e: React.MouseEvent, entry: Entry) => {
    e.preventDefault()
    // Right-clicking outside the current selection retargets it to just that entry
    const selectedIds = selectedIdsRef.current
    let ids: number[]
    if (selectedIds.has(entry.id)) {
      ids = [...selectedIds]
    } else {
      ids = [entry.id]
      setSelection(new Set([entry.id]), entry.id)
    }
    setGroupSubOpen(false)
    setMenuPos(null)
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }, [setSelection])

  // After the menu mounts (or its contents change), measure its real box and
  // clamp so the whole menu stays on-screen — including when opened near the
  // bottom edge, where a fixed height guess used to let the tail fall off.
  useLayoutEffect(() => {
    if (!menu) return
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin))
    const top = Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin))
    setMenuPos({ left, top })
  }, [menu])

  // Position the group flyout next to its anchor row, flipping to the left side
  // when it would overflow the right edge and clamping vertically.
  useLayoutEffect(() => {
    if (!groupSubOpen) { setGroupSubPos(null); return }
    const row = groupRowRef.current
    const sub = groupSubRef.current
    if (!row || !sub) return
    const anchor = row.getBoundingClientRect()
    const { width, height } = sub.getBoundingClientRect()
    const margin = 8
    let left = anchor.right - 2
    if (left + width + margin > window.innerWidth) left = anchor.left - width + 2
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
    const top = Math.max(margin, Math.min(anchor.top - 4, window.innerHeight - height - margin))
    setGroupSubPos({ left, top })
  }, [groupSubOpen, groups])

  const closeMenu = useCallback(() => {
    setMenu(null)
    setGroupSubOpen(false)
  }, [])

  useEffect(() => {
    if (!menu && tagModalIds === null && peopleModalIds === null && renameId === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setGroupSubOpen(false)
        setTagModalIds(null)
        setPeopleModalIds(null)
        setRenameId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, tagModalIds, peopleModalIds, renameId])

  const openTagModal = useCallback(() => {
    if (!menu) return
    setPendingTagNames([])
    setTagModalIds(menu.ids)
    closeMenu()
  }, [menu, closeMenu])

  const openPeopleModal = useCallback(() => {
    if (!menu) return
    setPendingPersonIds([])
    setPeopleModalIds(menu.ids)
    closeMenu()
  }, [menu, closeMenu])

  const applyPeople = useCallback(async () => {
    if (!peopleModalIds || pendingPersonIds.length === 0) { setPeopleModalIds(null); return }
    await window.api.people.addToEntries(peopleModalIds, pendingPersonIds)
    setPeople(await window.api.people.list())
    setPeopleModalIds(null)
    bumpRefreshKey()
  }, [peopleModalIds, pendingPersonIds, setPeople, bumpRefreshKey])

  const openDateModal = useCallback(() => {
    if (!menu) return
    setDateModalIds(menu.ids)
    closeMenu()
  }, [menu, closeMenu])

  const openLocationModal = useCallback(() => {
    if (!menu) return
    setLocationModalIds(menu.ids)
    closeMenu()
  }, [menu, closeMenu])

  const openRenameModal = useCallback(() => {
    if (!menu || menu.ids.length !== 1) return
    const entry = entries.find(e => e.id === menu.ids[0])
    setRenameValue(entry?.title ?? '')
    setRenameFile(false)
    setRenameId(menu.ids[0])
    closeMenu()
  }, [menu, entries, closeMenu])

  const applyRename = useCallback(async () => {
    if (renameId === null) return
    const res = await window.api.entries.rename(renameId, renameValue, renameFile)
    if (!res.ok) { window.alert(res.error ?? 'Rename failed.'); return }
    if (res.note) window.alert(res.note)
    setRenameId(null)
    bumpRefreshKey()
  }, [renameId, renameValue, renameFile, bumpRefreshKey])

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

  // Hierarchical remove: move the targeted entries up to their group's parent
  // (out entirely only when they sit in a top-level group), so removing from a
  // subgroup keeps them in the ancestor groups.
  const removeFromGroup = useCallback(async () => {
    if (!menu) return
    await window.api.groups.removeEntries(menu.ids)
    closeMenu()
    bumpRefreshKey()
  }, [menu, closeMenu, bumpRefreshKey])

  // Create a new group from the submenu, then assign the targeted entries to it.
  // Nests under the sidebar's highlighted group (selectedGroupId) when one is set.
  const createAndAssignGroup = useCallback(async (name: string) => {
    if (!menu) return
    const ids = menu.ids
    const created = await window.api.groups.create({
      name, parent_id: selectedGroupId, color: pickGroupColor(name),
    })
    setGroups(await window.api.groups.list())
    await window.api.groups.assignEntries(created.id, ids)
    closeMenu()
    bumpRefreshKey()
  }, [menu, selectedGroupId, setGroups, closeMenu, bumpRefreshKey])

  // Name of the highlighted sidebar group, shown as the nesting hint in the submenu.
  const parentGroupName = useMemo(
    () => groups.find(g => g.id === selectedGroupId)?.name ?? null,
    [groups, selectedGroupId]
  )

  // The "Remove from group" action: gated so it's hidden when nothing is
  // grouped, and labeled with the destination. When every targeted entry shares
  // one group we name it — "Remove from 'batch1'" — and note the parent it moves
  // up into; a mixed selection falls back to the generic label.
  const removeInfo = useMemo(() => {
    if (!menu) return null
    const byId = new Map(groups.map(g => [g.id, g]))
    const groupIds = new Set<number>()
    for (const id of menu.ids) {
      const entry = entries.find(e => e.id === id)
      if (entry?.group_id != null) groupIds.add(entry.group_id)
    }
    if (groupIds.size === 0) return null
    if (groupIds.size > 1) return { label: 'Remove from group', hint: null }
    const group = byId.get([...groupIds][0])
    if (!group) return { label: 'Remove from group', hint: null }
    const parent = group.parent_id != null ? byId.get(group.parent_id) : null
    return {
      label: `Remove from “${group.name}”`,
      hint: parent ? `Moves up to ${parent.name}` : 'Leaves it ungrouped',
    }
  }, [menu, entries, groups])

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
          <div ref={menuRef} style={{
            position: 'fixed', zIndex: 101,
            // Before measurement, position at the click point but hidden to
            // avoid a flash; the layout effect then clamps it fully on-screen.
            left: menuPos ? menuPos.left : menu.x,
            top: menuPos ? menuPos.top : menu.y,
            visibility: menuPos ? 'visible' : 'hidden',
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
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
            {menu.ids.length === 1 && (
              <MenuItem label="Rename…" onClick={openRenameModal} />
            )}
            <MenuItem label="Add tags…" onClick={openTagModal} />
            <MenuItem label="Tag people…" onClick={openPeopleModal} />
            <div
              ref={groupRowRef}
              onMouseEnter={() => setGroupSubOpen(true)}
              onMouseLeave={() => setGroupSubOpen(false)}
            >
              <MenuItem label="Add to group" trailing="›" onClick={() => setGroupSubOpen(o => !o)} />
              {groupSubOpen && (
                <div
                  ref={groupSubRef}
                  onMouseEnter={() => setGroupSubOpen(true)}
                  onMouseLeave={() => setGroupSubOpen(false)}
                  style={{
                    position: 'fixed', zIndex: 102,
                    left: groupSubPos ? groupSubPos.left : 0,
                    top: groupSubPos ? groupSubPos.top : 0,
                    visibility: groupSubPos ? 'visible' : 'hidden',
                    minWidth: 200, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  }}
                >
                  <GroupPickerList
                    groups={groups}
                    onPick={assignToGroup}
                    onCreate={createAndAssignGroup}
                    parentName={parentGroupName}
                  />
                </div>
              )}
            </div>
            {removeInfo && (
              <MenuItem label={removeInfo.label} sublabel={removeInfo.hint ?? undefined} onClick={removeFromGroup} />
            )}
            <MenuItem label="Change date…" onClick={openDateModal} />
            <MenuItem label="Set location…" onClick={openLocationModal} />
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

      {/* Tag-people modal */}
      {peopleModalIds !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 110,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) setPeopleModalIds(null) }}
        >
          <div style={{
            width: 400, maxWidth: '90vw',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Tag people
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              Added to {peopleModalIds.length} {peopleModalIds.length === 1 ? 'item' : 'items'}. Existing people are kept.
            </div>
            <div style={{
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 8px', background: 'var(--bg-input)', marginBottom: 12, minHeight: 34,
            }}>
              <PeopleEditor
                people={pendingPersonIds
                  .map(id => allPeople.find(p => p.id === id))
                  .filter((p): p is NonNullable<typeof p> => p != null)}
                onChange={setPendingPersonIds}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setPeopleModalIds(null)} style={modalBtn(false)}>Cancel</button>
              <button
                onClick={applyPeople}
                disabled={pendingPersonIds.length === 0}
                style={{ ...modalBtn(true), opacity: pendingPersonIds.length === 0 ? 0.5 : 1 }}
              >
                Tag people
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameId !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 110,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) setRenameId(null) }}
        >
          <div style={{
            width: 380, maxWidth: '90vw',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              Rename
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); applyRename() }
              }}
              placeholder="Name"
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '8px 10px', fontSize: 13, marginBottom: 12,
                background: 'var(--bg-input)', color: 'var(--text)',
              }}
            />
            {(() => {
              const target = entries.find(e => e.id === renameId)
              const hasFile = !!target?.file_path && !target.is_missing
              if (!hasFile) return null
              return (
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={renameFile}
                    onChange={e => setRenameFile(e.target.checked)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span>
                    Also rename the file on disk
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                      {target!.import_mode === 'reference'
                        ? 'This renames your original linked file outside the library. The original name is kept in the database.'
                        : 'The original name is kept in the database for safety.'}
                    </span>
                  </span>
                </label>
              )
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setRenameId(null)} style={modalBtn(false)}>Cancel</button>
              <button onClick={applyRename} style={modalBtn(true)}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Change-date modal */}
      {dateModalIds !== null && (
        <ChangeDateModal
          ids={dateModalIds}
          onClose={() => setDateModalIds(null)}
          onApplied={bumpRefreshKey}
        />
      )}

      {/* Set-location modal */}
      {locationModalIds !== null && (
        <SetLocationModal
          ids={locationModalIds}
          onClose={() => setLocationModalIds(null)}
          onApplied={bumpRefreshKey}
        />
      )}
    </>
  )

  return { onEntryContextMenu, contextMenuUI }
}

function MenuItem({ label, onClick, danger, trailing, swatch, sublabel }: {
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: string
  swatch?: string
  sublabel?: string
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
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
        {sublabel && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>{sublabel}</span>
        )}
      </span>
      {trailing && <span style={{ color: 'var(--text-4)' }}>{trailing}</span>}
    </div>
  )
}

// Deterministic group color from the name, mirroring the palette the main
// process uses (createGroup's autoColor) so quick-created groups look native.
const GROUP_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]
function pickGroupColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length]
}

const modalBtn = (primary: boolean): React.CSSProperties => ({
  fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text)',
})
