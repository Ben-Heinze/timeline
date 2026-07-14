import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useEntryContextMenu } from './EntryContextMenu'
import type { Entry, FileViewMode } from '../../shared/types'
import { GridCell, ListRow, THUMB_SIZE, iconFor, toolBtn } from './entryDisplay'
import { computeScope, SECTION_KEY, SECTION_LABEL } from './scope'
import { AssignDropdown } from './GroupPicker'

const MIN_HEIGHT = 140

export default function FileBrowser() {
  const {
    selectedPeriod, setSelectedPeriod,
    fileBrowserOpen, setFileBrowserOpen,
    zoomLevel, visibleRange, dataExtent,
    setActiveEntryId,
    setSelection, selectedIds, lastSelectedId,
    selectedGroupId,
    groups,
    refreshKey, bumpRefreshKey,
    settings, setSettings,
  } = useStore()
  const [entries, setEntries] = useState<Entry[]>([])
  const [resizing, setResizing] = useState(false)
  const [handleHovered, setHandleHovered] = useState(false)

  const { onEntryContextMenu, contextMenuUI } = useEntryContextMenu(entries)

  const height = settings?.fileBrowserHeight ?? 240
  const viewMode: FileViewMode = settings?.fileBrowserMode ?? 'medium'

  const isOpen = fileBrowserOpen || selectedPeriod !== null
  const scope = useMemo(
    () => isOpen ? computeScope(selectedPeriod, zoomLevel, visibleRange, dataExtent) : null,
    [isOpen, selectedPeriod, zoomLevel, visibleRange, dataExtent]
  )

  const scopeFrom = scope?.from ?? null
  const scopeTo = scope?.to ?? null
  useEffect(() => {
    if (scopeFrom === null || scopeTo === null) { setEntries([]); return }
    let cancelled = false
    window.api.entries.forPeriod(scopeFrom, scopeTo, selectedGroupId ?? undefined).then(res => {
      if (!cancelled) setEntries(res)
    })
    return () => { cancelled = true }
  }, [scopeFrom, scopeTo, selectedGroupId, refreshKey])

  useEffect(() => {
    if (!isOpen) setSelection(new Set(), null)
  }, [isOpen, setSelection])

  const sections = useMemo(() => {
    if (!scope?.sectionUnit) return null
    const keyOf = SECTION_KEY[scope.sectionUnit]
    const labelOf = SECTION_LABEL[scope.sectionUnit]
    const out: { key: string; label: string; items: Entry[] }[] = []
    let currentKey: string | null = null
    for (const e of entries) {
      const d = new Date(e.timestamp)
      const k = keyOf(d)
      if (k !== currentKey) {
        out.push({ key: k, label: labelOf(d), items: [] })
        currentKey = k
      }
      out[out.length - 1].items.push(e)
    }
    return out
  }, [entries, scope?.sectionUnit])

  const handleAssign = useCallback(async (groupId: number | null) => {
    const ids = [...selectedIds]
    await window.api.groups.assignEntries(groupId, ids)
    setSelection(new Set(), null)
    bumpRefreshKey()
  }, [selectedIds, setSelection, bumpRefreshKey])

  const setViewMode = useCallback((m: FileViewMode) => {
    if (!settings) return
    setSettings({ ...settings, fileBrowserMode: m })
    window.api.settings.set({ fileBrowserMode: m })
  }, [settings, setSettings])

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!settings) return
    e.preventDefault()
    const startY = e.clientY
    const startH = settings.fileBrowserHeight ?? 240
    const snap = { ...settings }
    const clamp = (h: number) => Math.min(Math.max(h, MIN_HEIGHT), window.innerHeight - 160)
    setResizing(true)
    const onMove = (ev: MouseEvent) => {
      setSettings({ ...snap, fileBrowserHeight: clamp(startH + startY - ev.clientY) })
    }
    const onUp = (ev: MouseEvent) => {
      const newH = clamp(startH + startY - ev.clientY)
      setSettings({ ...snap, fileBrowserHeight: newH })
      window.api.settings.set({ fileBrowserHeight: newH })
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [settings, setSettings])

  // Keep the selection handlers referentially stable (they read live state via
  // refs) so the memoized grid/list rows don't all re-render on every click.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const lastSelectedIdRef = useRef(lastSelectedId)
  lastSelectedIdRef.current = lastSelectedId
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const onSelect = useCallback((e: React.MouseEvent, entry: Entry) => {
    const selectedIds = selectedIdsRef.current
    const lastSelectedId = lastSelectedIdRef.current
    const entries = entriesRef.current
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds)
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
      setSelection(next, entry.id)
    } else if (e.shiftKey && lastSelectedId !== null) {
      const from = entries.findIndex(x => x.id === lastSelectedId)
      const to = entries.findIndex(x => x.id === entry.id)
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        setSelection(new Set(entries.slice(a, b + 1).map(x => x.id)), entry.id)
      } else {
        setSelection(new Set([entry.id]), entry.id)
      }
    } else {
      setSelection(new Set([entry.id]), entry.id)
    }
  }, [setSelection])

  const onActivate = useCallback((entry: Entry) => setActiveEntryId(entry.id), [setActiveEntryId])

  const close = useCallback(() => {
    setFileBrowserOpen(false)
    setSelectedPeriod(null)
    setActiveEntryId(null)
  }, [setFileBrowserOpen, setSelectedPeriod, setActiveEntryId])

  if (!isOpen) return null

  const label = scope?.label ?? 'All files'
  const count = entries.length

  const renderItem = (entry: Entry) => {
    const common = {
      entry,
      selected: selectedIds.has(entry.id),
      onSelect,
      onActivate,
      onContextMenu: onEntryContextMenu,
    }
    if (viewMode === 'list') return <ListRow key={entry.id} {...common} />
    return <GridCell key={entry.id} {...common} size={THUMB_SIZE[viewMode]} />
  }

  const renderItems = (items: Entry[]) =>
    viewMode === 'list' ? (
      <div style={{ padding: '6px 0' }}>{items.map(renderItem)}</div>
    ) : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px' }}>
        {items.map(renderItem)}
      </div>
    )

  return (
    <div style={{
      height,
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-app)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
    }}>
      <div
        onMouseDown={onResizeMouseDown}
        onMouseEnter={() => setHandleHovered(true)}
        onMouseLeave={() => setHandleHovered(false)}
        style={{
          position: 'absolute', top: -3, left: 0, right: 0, height: 7,
          cursor: 'ns-resize', zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {(handleHovered || resizing) && (
          <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--scrollbar-thumb)' }} />
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 2 }}>
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        {selectedPeriod && fileBrowserOpen && (
          <button
            onClick={() => setSelectedPeriod(null)}
            title="Back to the full view scope"
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 5,
              color: 'var(--text-3)', fontSize: 11, padding: '2px 8px', cursor: 'pointer',
            }}
          >← Back</button>
        )}
        {selectedIds.size > 0 && (
          <AssignDropdown selectedIds={selectedIds} groups={groups} onAssign={handleAssign} />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {(['list', 'small', 'medium', 'large'] as FileViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              style={toolBtn(viewMode === m)}
            >{iconFor(m)}</button>
          ))}
        </div>
        <button
          onClick={close}
          title="Close file browser"
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-4)', fontSize: 16, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4, cursor: 'pointer',
          }}
        >✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', fontSize: 13,
          }}>
            No entries for this period
          </div>
        ) : sections ? (
          sections.map(section => (
            <section key={section.key}>
              <header style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--bg-app)',
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

      {contextMenuUI}
    </div>
  )
}
