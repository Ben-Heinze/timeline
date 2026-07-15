import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useEntryContextMenu } from './EntryContextMenu'
import type { Entry, FileViewMode, SpotifyPlay } from '../../shared/types'
import { GridCell, ListRow, THUMB_SIZE, iconFor, toolBtn } from './entryDisplay'
import { computeScope, SECTION_KEY, SECTION_LABEL } from './scope'
import { AssignDropdown } from './GroupPicker'

const MIN_HEIGHT = 140

function formatPlayDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000))
  if (totalMin < 60) return `${totalMin}m`
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

export default function FileBrowser() {
  const {
    selectedPeriod, setSelectedPeriod,
    selectedLocation, setSelectedLocation,
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
  const [plays, setPlays] = useState<SpotifyPlay[]>([])
  const [resizing, setResizing] = useState(false)
  const [handleHovered, setHandleHovered] = useState(false)

  const { onEntryContextMenu, contextMenuUI } = useEntryContextMenu(entries)

  const height = settings?.fileBrowserHeight ?? 240
  const viewMode: FileViewMode = settings?.fileBrowserMode ?? 'medium'
  const historyCollapsed = settings?.spotifyHistoryCollapsed ?? false

  const isOpen = fileBrowserOpen || selectedPeriod !== null || selectedLocation !== null
  const scope = useMemo(
    () => (isOpen && !selectedLocation) ? computeScope(selectedPeriod, zoomLevel, visibleRange, dataExtent) : null,
    [isOpen, selectedPeriod, zoomLevel, visibleRange, dataExtent, selectedLocation]
  )

  const scopeFrom = scope?.from ?? null
  const scopeTo = scope?.to ?? null
  useEffect(() => {
    if (selectedLocation) { setEntries(selectedLocation); return }
    if (scopeFrom === null || scopeTo === null) { setEntries([]); return }
    let cancelled = false
    window.api.entries.forPeriod(scopeFrom, scopeTo, selectedGroupId ?? undefined).then(res => {
      if (!cancelled) setEntries(res)
    })
    return () => { cancelled = true }
  }, [scopeFrom, scopeTo, selectedGroupId, refreshKey, selectedLocation])

  useEffect(() => {
    if (selectedLocation) { setPlays([]); return }
    let cancelled = false
    // A selected group narrows the listening history to that group's own
    // timeframe (its date range, or its entries' span) rather than whatever
    // period the timeline happens to be zoomed to.
    if (selectedGroupId != null) {
      window.api.groups.dateRange(selectedGroupId).then(range => {
        if (cancelled) return
        if (!range) { setPlays([]); return }
        window.api.spotify.forPeriod(range.from, range.to).then(res => {
          if (!cancelled) setPlays(res)
        })
      })
      return () => { cancelled = true }
    }
    if (scopeFrom === null || scopeTo === null) { setPlays([]); return }
    window.api.spotify.forPeriod(scopeFrom, scopeTo).then(res => {
      if (!cancelled) setPlays(res)
    })
    return () => { cancelled = true }
  }, [scopeFrom, scopeTo, refreshKey, selectedLocation, selectedGroupId])

  const playGroups = useMemo(() => {
    interface PlayGroup {
      key: string
      track: string
      artist: string | null
      mediaType: 'track' | 'episode'
      count: number
      msPlayed: number
    }
    const map = new Map<string, PlayGroup>()
    const order: string[] = []
    for (const p of plays) {
      if (!p.track_name) continue
      const key = `${p.track_name}::${p.artist_name ?? ''}`
      let g = map.get(key)
      if (!g) {
        g = { key, track: p.track_name, artist: p.artist_name, mediaType: p.media_type, count: 0, msPlayed: 0 }
        map.set(key, g)
        order.push(key)
      }
      g.count++
      g.msPlayed += p.ms_played
    }
    return order.map(k => map.get(k)!)
  }, [plays])

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

  const toggleHistoryCollapsed = useCallback(() => {
    if (!settings) return
    const next = !historyCollapsed
    setSettings({ ...settings, spotifyHistoryCollapsed: next })
    window.api.settings.set({ spotifyHistoryCollapsed: next })
  }, [settings, setSettings, historyCollapsed])

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
    setSelectedLocation(null)
    setActiveEntryId(null)
  }, [setFileBrowserOpen, setSelectedPeriod, setSelectedLocation, setActiveEntryId])

  if (!isOpen) return null

  const label = selectedLocation ? 'Photos near this location' : (scope?.label ?? 'All files')
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
        {selectedPeriod && fileBrowserOpen && !selectedLocation && (
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
        {playGroups.length > 0 && (
          <section>
            <header
              onClick={toggleHistoryCollapsed}
              title={historyCollapsed ? 'Expand listening history' : 'Collapse listening history'}
              style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--bg-app)',
                padding: '10px 14px 6px', fontSize: 12, fontWeight: 700,
                color: 'var(--text-2)', letterSpacing: 0.4,
                borderBottom: historyCollapsed ? 'none' : '1px solid var(--border-light)',
                cursor: 'pointer', userSelect: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{
                display: 'inline-block', fontSize: 10, color: 'var(--text-4)',
                transform: historyCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                transition: 'transform 0.12s ease',
              }}>▾</span>
              Listening History
              <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>
                {playGroups.length}
              </span>
            </header>
            {!historyCollapsed && (
              <div style={{ padding: '6px 14px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {playGroups.map(g => (
                  <div key={g.key} style={{
                    display: 'flex', alignItems: 'baseline', gap: 8,
                    fontSize: 12.5, color: 'var(--text)',
                  }}>
                    <span style={{ flexShrink: 0 }}>{g.mediaType === 'episode' ? '🎙️' : '🎵'}</span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.track}
                    </span>
                    {g.artist && (
                      <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        — {g.artist}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', color: 'var(--text-4)', fontSize: 11.5, flexShrink: 0 }}>
                      {g.count > 1 ? `×${g.count} · ` : ''}{formatPlayDuration(g.msPlayed)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {entries.length === 0 && playGroups.length === 0 ? (
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
