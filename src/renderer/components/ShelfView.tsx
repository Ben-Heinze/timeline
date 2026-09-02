import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Entry, ShelfCategory, ShelfKind } from '../../shared/types'
import { GridCell, THUMB_SIZE } from './entryDisplay'
import { useEntryContextMenu } from './EntryContextMenu'

type ShelfEntry = Entry & { category_id: number | null }
type Filter = 'all' | 'uncategorized' | number

function ipcErrorMessage(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const KIND_LABELS: Record<ShelfKind, { one: string; many: string }> = {
  book: { one: 'book', many: 'Books' },
  recipe: { one: 'recipe', many: 'Recipes' },
}

export default function ShelfView({ kind }: { kind: ShelfKind }) {
  const { selectedIds, lastSelectedId, setSelection, setActiveEntryId, refreshKey, bumpRefreshKey } = useStore()
  const [categories, setCategories] = useState<ShelfCategory[]>([])
  const [entries, setEntries] = useState<ShelfEntry[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [message, setMessage] = useState<string | null>(null)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [busy, setBusy] = useState(false)

  const labels = KIND_LABELS[kind]

  const reload = useCallback(async () => {
    const [cats, all] = await Promise.all([
      window.api.shelf.listCategories(kind),
      window.api.shelf.listEntries(kind, 'all'),
    ])
    setCategories(cats)
    setEntries(all)
  }, [kind])

  useEffect(() => { reload() }, [reload, refreshKey])

  // Counts derive from the (fully fetched) entry list so the rail and grid
  // can never disagree.
  const uncategorizedCount = useMemo(() => entries.filter(e => e.category_id === null).length, [entries])
  const countByCategory = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of entries) if (e.category_id !== null) m.set(e.category_id, (m.get(e.category_id) ?? 0) + 1)
    return m
  }, [entries])

  const visible = useMemo(() => {
    if (filter === 'all') return entries
    if (filter === 'uncategorized') return entries.filter(e => e.category_id === null)
    return entries.filter(e => e.category_id === filter)
  }, [entries, filter])

  // A deleted/emptied category can leave the filter pointing nowhere.
  useEffect(() => {
    if (typeof filter === 'number' && !categories.some(c => c.id === filter)) setFilter('all')
  }, [filter, categories])

  const { onEntryContextMenu, contextMenuUI } = useEntryContextMenu(visible)

  // Stable selection handlers, same recipe as FilesView.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const lastSelectedIdRef = useRef(lastSelectedId)
  lastSelectedIdRef.current = lastSelectedId
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const onSelect = useCallback((e: React.MouseEvent, entry: Entry) => {
    const selected = selectedIdsRef.current
    const lastId = lastSelectedIdRef.current
    const list = visibleRef.current
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastId !== null) {
      const fromIdx = list.findIndex(x => x.id === lastId)
      const toIdx = list.findIndex(x => x.id === entry.id)
      if (fromIdx >= 0 && toIdx >= 0) {
        const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
        setSelection(new Set(list.slice(a, b + 1).map(x => x.id)), entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [setSelection])

  const onActivate = useCallback((entry: Entry) => setActiveEntryId(entry.id), [setActiveEntryId])

  const reportMove = useCallback((r: { moved: number; failures: { entryId: number; error: string }[] }, verb: string) => {
    if (r.failures.length > 0) {
      setMessage(`${verb}, but ${r.failures.length} file${r.failures.length === 1 ? '' : 's'} could not be moved: ${r.failures[0].error}`)
    } else {
      setMessage(null)
    }
  }, [])

  const moveSelectionTo = useCallback(async (categoryId: number | null) => {
    const ids = [...selectedIdsRef.current]
    if (ids.length === 0) return
    try {
      const r = await window.api.shelf.markEntries(ids, kind, categoryId)
      reportMove(r, 'Moved')
    } catch (e) {
      setMessage(ipcErrorMessage(e))
    }
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [kind, reportMove, setSelection, bumpRefreshKey])

  const removeSelection = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    if (ids.length === 0) return
    await window.api.shelf.unmarkEntries(ids)
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [setSelection, bumpRefreshKey])

  const createCategory = useCallback(async () => {
    const name = newCatName.trim()
    if (!name) { setNewCatOpen(false); return }
    try {
      const cat = await window.api.shelf.createCategory(kind, name)
      setNewCatName('')
      setNewCatOpen(false)
      await reload()
      setFilter(cat.id)
    } catch (e) {
      setMessage(ipcErrorMessage(e))
    }
  }, [kind, newCatName, reload])

  const commitRename = useCallback(async () => {
    const id = renamingId
    const name = renameText.trim()
    setRenamingId(null)
    if (id === null || !name) return
    try {
      await window.api.shelf.renameCategory(id, name)
      bumpRefreshKey()
    } catch (e) {
      setMessage(ipcErrorMessage(e))
    }
  }, [renamingId, renameText, bumpRefreshKey])

  const deleteCategory = useCallback(async (cat: ShelfCategory) => {
    const n = countByCategory.get(cat.id) ?? 0
    const files = kind === 'book' ? 'books' : 'recipes'
    if (!window.confirm(
      `Delete category "${cat.name}"?\n\n${n} item${n === 1 ? '' : 's'} become${n === 1 ? 's' : ''} uncategorized; their files move to the ${files} folder. No files are deleted.`
    )) return
    try {
      const r = await window.api.shelf.deleteCategory(cat.id)
      reportMove(r, 'Deleted')
    } catch (e) {
      setMessage(ipcErrorMessage(e))
    }
    bumpRefreshKey()
  }, [kind, countByCategory, reportMove, bumpRefreshKey])

  const importBooksFolder = useCallback(async () => {
    if (!window.confirm(
      'Index the existing books folder?\n\nEvery file already inside the library’s files/books/ folder is added to the timeline in place (nothing is copied, moved, or renamed), marked as a book, and its subfolder becomes a category. Generating thumbnails can take several minutes. Safe to run again.'
    )) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await window.api.shelf.importBooksFolder()
      const bits = [
        `${r.indexed} file${r.indexed === 1 ? '' : 's'} indexed`,
        r.alreadyIndexed > 0 ? `${r.alreadyIndexed} already indexed or duplicates` : null,
        `${r.marked} marked as books`,
        r.categoriesCreated > 0 ? `${r.categoriesCreated} categor${r.categoriesCreated === 1 ? 'y' : 'ies'} created` : null,
        r.failures.length > 0 ? `${r.failures.length} failed` : null,
      ].filter(Boolean)
      setMessage(`Books folder import: ${bits.join(', ')}.`)
    } catch (e) {
      setMessage(ipcErrorMessage(e))
    } finally {
      setBusy(false)
      bumpRefreshKey()
    }
  }, [bumpRefreshKey])

  const railItem = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', userSelect: 'none',
    background: active ? 'var(--bg-entry-sel)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-2)',
    fontSize: 13, fontWeight: active ? 600 : 400,
  })
  const railCount: React.CSSProperties = { marginLeft: 'auto', fontSize: 11, color: 'var(--text-4)' }
  const railBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)',
    fontSize: 12, padding: '0 2px', lineHeight: 1,
  }
  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg-input)', outline: 'none', color: 'var(--text)', width: '100%',
  }

  const size = THUMB_SIZE.medium

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* ─── Category rail ─── */}
      <div style={{
        width: 230, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)',
      }}>
        <div style={{ padding: '12px 12px 6px', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'var(--text-4)', textTransform: 'uppercase' }}>
          {labels.many}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px 12px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={railItem(filter === 'all')} onClick={() => setFilter('all')}>
            All<span style={railCount}>{entries.length}</span>
          </div>
          <div style={railItem(filter === 'uncategorized')} onClick={() => setFilter('uncategorized')}>
            Uncategorized<span style={railCount}>{uncategorizedCount}</span>
          </div>
          {categories.map(cat => (
            <div key={cat.id} style={railItem(filter === cat.id)} onClick={() => setFilter(cat.id)} className="shelf-cat-row">
              {renamingId === cat.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={e => setRenameText(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                  onClick={e => e.stopPropagation()}
                  style={inputStyle}
                />
              ) : (
                <>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                  <span style={railCount}>{countByCategory.get(cat.id) ?? 0}</span>
                  <button
                    title="Rename category"
                    style={railBtn}
                    onClick={e => { e.stopPropagation(); setRenamingId(cat.id); setRenameText(cat.name) }}
                  >✎</button>
                  <button
                    title="Delete category"
                    style={railBtn}
                    onClick={e => { e.stopPropagation(); deleteCategory(cat) }}
                  >✕</button>
                </>
              )}
            </div>
          ))}
          {newCatOpen ? (
            <div style={{ padding: '4px 2px' }}>
              <input
                autoFocus
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onBlur={createCategory}
                onKeyDown={e => { if (e.key === 'Enter') createCategory(); if (e.key === 'Escape') { setNewCatOpen(false); setNewCatName('') } }}
                placeholder="Category name…"
                style={inputStyle}
              />
            </div>
          ) : (
            <button
              onClick={() => setNewCatOpen(true)}
              style={{
                marginTop: 4, padding: '5px 10px', fontSize: 12, textAlign: 'left',
                background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
                color: 'var(--text-3)', cursor: 'pointer',
              }}
            >
              + New category
            </button>
          )}
        </div>
        {kind === 'book' && (
          <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={importBooksFolder}
              disabled={busy}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text-2)', cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Importing…' : 'Import books folder…'}
            </button>
          </div>
        )}
      </div>

      {/* ─── Item grid ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
          borderBottom: '1px solid var(--border)', minHeight: 40,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {filter === 'all' ? `All ${labels.many.toLowerCase()}`
              : filter === 'uncategorized' ? 'Uncategorized'
              : categories.find(c => c.id === filter)?.name ?? ''}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
            {visible.length} item{visible.length === 1 ? '' : 's'}
          </span>
          {selectedIds.size > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{selectedIds.size} selected</span>
              <select
                value=""
                onChange={e => {
                  const v = e.target.value
                  if (v === '') return
                  moveSelectionTo(v === 'none' ? null : Number(v))
                }}
                style={{
                  fontSize: 12, padding: '3px 6px', borderRadius: 5,
                  background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)',
                }}
              >
                <option value="" disabled>Move to category…</option>
                <option value="none">Uncategorized</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={removeSelection}
                style={{
                  fontSize: 12, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
                }}
              >
                Remove from {labels.many}
              </button>
            </div>
          )}
        </div>

        {message && (
          <div style={{
            padding: '6px 14px', fontSize: 12, color: 'var(--text-2)',
            background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1 }}>{message}</span>
            <button onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)' }}>✕</button>
          </div>
        )}

        <div
          style={{ flex: 1, overflowY: 'auto', padding: 12 }}
          onClick={e => { if (e.target === e.currentTarget) setSelection(new Set(), null) }}
        >
          {visible.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-4)', textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
              No {labels.many.toLowerCase()} here yet.<br />
              Right-click files anywhere and choose “Add to {labels.many}”.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
              {visible.map(entry => (
                <GridCell
                  key={entry.id}
                  entry={entry}
                  size={size}
                  selected={selectedIds.has(entry.id)}
                  onSelect={onSelect}
                  onActivate={onActivate}
                  onContextMenu={onEntryContextMenu}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {contextMenuUI}
    </div>
  )
}
