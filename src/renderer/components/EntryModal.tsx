import React, { useEffect, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useStore } from '../store/useStore'
import type { Entry, Tag, FileInfo, Person, ShelfCategory, ShelfItemInfo, ShelfKind } from '../../shared/types'
import TagEditor from './TagEditor'
import PeopleEditor from './PeopleEditor'
import ChangeDateModal from './ChangeDateModal'
import SetLocationModal from './SetLocationModal'
import ReferencePickerModal from './ReferencePickerModal'
import { useVolumeStatus, VolumeBadgeInline } from './VolumeBadge'
import LocationMiniMap from './LocationMiniMap'
import { Thumb } from './entryDisplay'

const TYPE_COLORS: Record<string, string> = {
  photo:    '#3b82f6',
  video:    '#8b5cf6',
  audio:    '#10b981',
  document: '#f59e0b',
  journal:  '#ec4899',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: '#fff',
      background: TYPE_COLORS[type] ?? '#555',
      borderRadius: 4, padding: '2px 6px',
    }}>
      {type}
    </span>
  )
}

function RichTextView({ json }: { json: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    editable: false,
    content: (() => { try { return JSON.parse(json) } catch { return json } })(),
  })

  useEffect(() => {
    if (!editor) return
    try { editor.commands.setContent(JSON.parse(json)) }
    catch { editor.commands.setContent(json) }
  }, [editor, json])

  return <EditorContent editor={editor} />
}

function TypeIconBlock({ type }: { type: string }) {
  return (
    <div style={{
      width: 72, height: 72, borderRadius: 16,
      background: TYPE_COLORS[type] ?? '#555',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 28,
    }}>
      {type === 'photo'    ? '📷'
      : type === 'video'   ? '🎬'
      : type === 'audio'   ? '🎵'
      :                      '📄'}
    </div>
  )
}

function useMediaUrl(entry: Entry): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (entry.file_path && !entry.is_missing && (entry.type === 'video' || entry.type === 'audio')) {
      window.api.files.getMediaUrl(entry.id).then(u => { if (alive) setUrl(u) })
    }
    return () => { alive = false }
  }, [entry.id, entry.file_path, entry.is_missing, entry.type])
  return url
}

function EntryContent({ entry }: { entry: Entry }) {
  const thumbSrc = entry.thumbnail_large
    ? `timeline:///${entry.thumbnail_large}`
    : entry.thumbnail_medium
      ? `timeline:///${entry.thumbnail_medium}`
      : null

  const dateStr = new Date(entry.timestamp).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const mediaSrc = useMediaUrl(entry)

  if (entry.type === 'video' && mediaSrc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <video
          src={mediaSrc}
          controls
          poster={thumbSrc ?? undefined}
          style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 6, background: '#000' }}
        />
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{dateStr}</div>
      </div>
    )
  }

  if (entry.type === 'audio' && mediaSrc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', padding: '12px 0' }}>
        <TypeIconBlock type={entry.type} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            {entry.title ?? '(untitled)'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{dateStr}</div>
        </div>
        <audio src={mediaSrc} controls style={{ width: '100%', maxWidth: 480 }} />
      </div>
    )
  }

  if (thumbSrc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <img
          src={thumbSrc}
          style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 6 }}
          draggable={false}
        />
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{dateStr}</div>
      </div>
    )
  }

  if (entry.type === 'journal') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
            {entry.title ?? '(untitled)'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{dateStr}</div>
        </div>
        {entry.rich_text_json ? (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
            <RichTextView json={entry.rich_text_json} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>No content</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
      <TypeIconBlock type={entry.type} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          {entry.title ?? '(untitled)'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>{dateStr}</div>
        {!entry.file_path && (
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>No file attached</div>
        )}
      </div>
      {entry.rich_text_json && (
        <div style={{
          maxWidth: 520, width: '100%', textAlign: 'left',
          background: 'var(--bg-muted)', borderRadius: 8, padding: 16,
        }}>
          <RichTextView json={entry.rich_text_json} />
        </div>
      )}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do { v /= 1024; i++ } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function MetadataPanel({ entry }: { entry: Entry }) {
  const [info, setInfo] = useState<FileInfo | null>(null)
  const volumeStatus = useVolumeStatus(entry.volume_id)

  useEffect(() => {
    let alive = true
    setInfo(null)
    if (entry.file_path && !entry.is_missing) {
      window.api.files.getFileInfo(entry.id).then(i => { if (alive) setInfo(i) })
    }
    return () => { alive = false }
  }, [entry.id, entry.file_path, entry.is_missing])

  const fileName = entry.file_path?.split(/[\\/]/).pop() ?? null
  const ext = fileName?.includes('.') ? fileName.split('.').pop()!.toUpperCase() : null

  const rows: Array<[string, React.ReactNode]> = []
  if (fileName) rows.push(['File name', fileName])
  rows.push(['Kind', ext ? `${entry.type} (${ext})` : entry.type])
  if (info) rows.push(['Size', formatBytes(info.sizeBytes)])
  if (info?.width && info?.height) rows.push(['Dimensions', `${info.width} × ${info.height}`])
  if (entry.duration_seconds != null) rows.push(['Duration', formatDuration(entry.duration_seconds)])
  rows.push(['Date taken', formatDateTime(entry.timestamp)])
  if (entry.latitude != null && entry.longitude != null) {
    rows.push(['GPS', `${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)}`])
  }
  if (info) rows.push(['Modified', formatDateTime(info.modifiedMs)])
  rows.push(['Added', formatDateTime(entry.created_at)])
  if (entry.file_path) {
    rows.push(['Location', info?.absolutePath ?? entry.file_path])
    rows.push(['Import mode', entry.import_mode === 'copy' ? 'Copied into library' : 'Referenced in place'])
  }
  if (volumeStatus) rows.push(['Drive', <VolumeBadgeInline volumeId={entry.volume_id} />])
  if (entry.content_hash) {
    rows.push(['SHA-256', (
      <span title={entry.content_hash} style={{ fontFamily: 'monospace', fontSize: 11 }}>
        {entry.content_hash.slice(0, 16)}…
      </span>
    )])
  }
  if (entry.is_missing) rows.push(['Status', <span style={{ color: '#ef4444' }}>File is missing</span>])
  if (entry.needs_date_review) rows.push(['Date review', 'Needs review'])

  return (
    <div style={{
      marginTop: 20, borderTop: '1px solid var(--border-light)', paddingTop: 14,
      display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6,
      fontSize: 12,
    }}>
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <span style={{
            color: 'var(--text-4)', fontWeight: 600, letterSpacing: 0.4,
            textTransform: 'uppercase', fontSize: 10, alignSelf: 'baseline', paddingTop: 1,
          }}>
            {label}
          </span>
          <span style={{ color: 'var(--text-2)', wordBreak: 'break-all', alignSelf: 'baseline' }}>
            {value}
          </span>
        </React.Fragment>
      ))}
      {entry.latitude != null && entry.longitude != null && (
        <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <LocationMiniMap latitude={entry.latitude} longitude={entry.longitude} />
        </div>
      )}
    </div>
  )
}

const fileBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
  fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', lineHeight: 1.2,
}

function FileActions({ entry }: { entry: Entry }) {
  const [error, setError] = useState<string | null>(null)
  const volumeStatus = useVolumeStatus(entry.volume_id)
  const disconnected = volumeStatus !== null && !volumeStatus.connected
  const unreachable = !!entry.is_missing || disconnected

  const run = async (action: () => Promise<string | void>) => {
    setError(null)
    const err = await action()
    if (err) setError(err)
  }

  return (
    <div style={{
      padding: '10px 16px', borderTop: '1px solid var(--border-light)',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <button style={{ ...fileBtnStyle, opacity: unreachable ? 0.5 : 1 }} disabled={unreachable} onClick={() => run(() => window.api.files.showInFolder(entry.id))}>
        📁 Show in Folder
      </button>
      <button style={{ ...fileBtnStyle, opacity: unreachable ? 0.5 : 1 }} disabled={unreachable} onClick={() => run(() => window.api.files.openDefault(entry.id))}>
        Open
      </button>
      <button style={{ ...fileBtnStyle, opacity: unreachable ? 0.5 : 1 }} disabled={unreachable} onClick={() => run(() => window.api.files.openWith(entry.id))}>
        Open With…
      </button>
      {entry.is_missing ? (
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>File is missing</span>
      ) : disconnected ? (
        <VolumeBadgeInline volumeId={entry.volume_id} />
      ) : null}
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </div>
  )
}

export default function EntryModal() {
  const { activeEntryId, setActiveEntryId, selectedPeriod, selectedLocation, selectedGroupId, openJournalModal, bumpRefreshKey, setPeople } = useStore()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [entryTags, setEntryTags] = useState<Tag[]>([])
  const [shelfInfo, setShelfInfo] = useState<ShelfItemInfo | null>(null)
  const [shelfCats, setShelfCats] = useState<ShelfCategory[]>([])
  const [entryPeople, setEntryPeople] = useState<Person[]>([])
  const [entryReferences, setEntryReferences] = useState<Entry[]>([])
  const [referencedBy, setReferencedBy] = useState<Entry[]>([])
  const [periodEntries, setPeriodEntries] = useState<Entry[]>([])
  const [dateModalOpen, setDateModalOpen] = useState(false)
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!activeEntryId) {
      setEntry(null); setEntryTags([]); setEntryPeople([])
      setEntryReferences([]); setReferencedBy([]); setShelfInfo(null)
      return
    }
    window.api.entries.get(activeEntryId).then(setEntry)
    window.api.tags.forEntry(activeEntryId).then(setEntryTags)
    window.api.people.forEntry(activeEntryId).then(setEntryPeople)
    window.api.entries.references(activeEntryId).then(setEntryReferences)
    window.api.entries.referencedBy(activeEntryId).then(setReferencedBy)
    window.api.shelf.forEntries([activeEntryId]).then(info => setShelfInfo(info[0] ?? null))
  }, [activeEntryId])

  // Categories for the shelf section's dropdown, per the entry's current kind.
  useEffect(() => {
    if (!shelfInfo) { setShelfCats([]); return }
    let cancelled = false
    window.api.shelf.listCategories(shelfInfo.kind).then(cats => { if (!cancelled) setShelfCats(cats) })
    return () => { cancelled = true }
  }, [shelfInfo])

  const handleShelfKind = useCallback(async (kind: ShelfKind | null) => {
    if (!activeEntryId) return
    if (kind === null) {
      await window.api.shelf.unmarkEntries([activeEntryId])
    } else {
      const r = await window.api.shelf.markEntries([activeEntryId], kind, null)
      if (r.failures.length > 0) window.alert(`Marked, but the file could not be moved: ${r.failures[0].error}`)
    }
    const [info] = await window.api.shelf.forEntries([activeEntryId])
    setShelfInfo(info ?? null)
    // The file may have moved on disk.
    window.api.entries.get(activeEntryId).then(setEntry)
    bumpRefreshKey()
  }, [activeEntryId, bumpRefreshKey])

  const handleShelfCategory = useCallback(async (categoryId: number | null) => {
    if (!activeEntryId || !shelfInfo) return
    const r = await window.api.shelf.markEntries([activeEntryId], shelfInfo.kind, categoryId)
    if (r.failures.length > 0) window.alert(`Recategorized, but the file could not be moved: ${r.failures[0].error}`)
    setShelfInfo({ ...shelfInfo, category_id: categoryId })
    window.api.entries.get(activeEntryId).then(setEntry)
    bumpRefreshKey()
  }, [activeEntryId, shelfInfo, bumpRefreshKey])

  const handleTagsChange = useCallback(async (names: string[]) => {
    if (!activeEntryId) return
    const updated = await window.api.tags.setForEntry(activeEntryId, names)
    setEntryTags(updated)
  }, [activeEntryId])

  const handlePeopleChange = useCallback(async (personIds: number[]) => {
    if (!activeEntryId) return
    const updated = await window.api.people.setForEntry(activeEntryId, personIds)
    setEntryPeople(updated)
    // Keep the People tab's tagged-counts in sync.
    setPeople(await window.api.people.list())
  }, [activeEntryId, setPeople])

  const handleReferencesChange = useCallback(async (refIds: number[]) => {
    if (!activeEntryId) return
    const updated = await window.api.entries.setReferences(activeEntryId, refIds)
    setEntryReferences(updated)
  }, [activeEntryId])

  const addReferences = useCallback((added: Entry[]) => {
    const merged = [...entryReferences]
    for (const e of added) if (!merged.some(x => x.id === e.id)) merged.push(e)
    handleReferencesChange(merged.map(e => e.id))
  }, [entryReferences, handleReferencesChange])

  const removeReference = useCallback((id: number) => {
    handleReferencesChange(entryReferences.filter(e => e.id !== id).map(e => e.id))
  }, [entryReferences, handleReferencesChange])

  useEffect(() => {
    if (selectedLocation) { setPeriodEntries(selectedLocation); return }
    if (!selectedPeriod) { setPeriodEntries([]); return }
    window.api.entries.forPeriod(selectedPeriod[0], selectedPeriod[1], selectedGroupId ?? undefined).then(setPeriodEntries)
  }, [selectedPeriod, selectedGroupId, selectedLocation])

  const idx = entry ? periodEntries.findIndex(e => e.id === entry.id) : -1
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < periodEntries.length - 1

  const navigatePrev = useCallback(() => {
    if (hasPrev) setActiveEntryId(periodEntries[idx - 1].id)
  }, [hasPrev, idx, periodEntries, setActiveEntryId])

  const navigateNext = useCallback(() => {
    if (hasNext) setActiveEntryId(periodEntries[idx + 1].id)
  }, [hasNext, idx, periodEntries, setActiveEntryId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeEntryId) return
      // While a child modal is open it owns the keyboard (Escape, typing).
      if (dateModalOpen || locationModalOpen || pickerOpen) return
      if (e.key === 'Escape') setActiveEntryId(null)
      if (e.key === 'ArrowLeft') navigatePrev()
      if (e.key === 'ArrowRight') navigateNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeEntryId, navigatePrev, navigateNext, setActiveEntryId, dateModalOpen, locationModalOpen, pickerOpen])

  if (!activeEntryId) return null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setActiveEntryId(null) }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div style={{
        width: 600, maxWidth: '90vw', maxHeight: '88vh',
        background: 'var(--bg-surface)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}>
          {entry && <TypeBadge type={entry.type} />}
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry?.title ?? (entry?.type ?? '…')}
          </span>
          {entry?.type === 'journal' && (
            <button
              onClick={() => { openJournalModal(entry); setActiveEntryId(null) }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
            >Edit</button>
          )}
          {entry && (
            <button
              onClick={() => setDateModalOpen(true)}
              title="Change date"
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
            >Edit date</button>
          )}
          {entry && (
            <button
              onClick={() => setLocationModalOpen(true)}
              title="Set location"
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
            >{entry.latitude != null && entry.longitude != null ? 'Edit location' : 'Add location'}</button>
          )}
          <button
            onClick={() => setActiveEntryId(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 18, padding: '2px 6px', borderRadius: 4, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', minHeight: 220 }}>
          {entry ? (
            <>
              <EntryContent entry={entry} />
              <MetadataPanel entry={entry} />
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--text-3)' }}>
              Loading…
            </div>
          )}
        </div>

        {entry?.file_path && <FileActions entry={entry} />}

        {entry && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0 }}>
              Tags
            </span>
            <div style={{ flex: 1 }}>
              <TagEditor tags={entryTags} onChange={handleTagsChange} />
            </div>
          </div>
        )}

        {entry && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0 }}>
              People
            </span>
            <div style={{ flex: 1 }}>
              <PeopleEditor people={entryPeople} onChange={handlePeopleChange} />
            </div>
          </div>
        )}

        {entry && entry.type !== 'journal' && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0 }}>
              Shelf
            </span>
            <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderRadius: 6, padding: 2, gap: 1 }}>
              {([['None', null], ['Book', 'book'], ['Recipe', 'recipe']] as [string, ShelfKind | null][]).map(([label, kind]) => {
                const active = (shelfInfo?.kind ?? null) === kind
                return (
                  <button
                    key={label}
                    onClick={() => { if (!active) handleShelfKind(kind) }}
                    style={{
                      padding: '3px 10px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: active ? 'var(--bg-app)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-3)', fontWeight: active ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {shelfInfo && (
              <select
                value={shelfInfo.category_id ?? 'none'}
                onChange={e => handleShelfCategory(e.target.value === 'none' ? null : Number(e.target.value))}
                style={{
                  fontSize: 12, padding: '3px 6px', borderRadius: 5,
                  background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)',
                }}
              >
                <option value="none">Uncategorized</option>
                {shelfCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        )}

        {entry?.type === 'journal' && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0, paddingTop: 4 }}>
              Files
            </span>
            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {entryReferences.map(e => (
                <span
                  key={e.id}
                  onClick={() => setActiveEntryId(e.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    fontSize: 11, padding: '2px 6px 2px 3px', borderRadius: 14,
                    background: 'var(--bg-subtle)', color: 'var(--text)',
                  }}
                >
                  <Thumb entry={e} size={20} />
                  <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title ?? e.type}
                  </span>
                  <button
                    onClick={ev => { ev.stopPropagation(); removeReference(e.id) }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 12, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                  >×</button>
                </span>
              ))}
              <button
                onClick={() => setPickerOpen(true)}
                style={{
                  fontSize: 12, padding: '4px 10px', flexShrink: 0,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'none', color: 'var(--text-2)', cursor: 'pointer',
                }}
              >📎 Reference files</button>
            </div>
          </div>
        )}

        {referencedBy.length > 0 && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', flexShrink: 0, paddingTop: 1 }}>
              Referenced In
            </span>
            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {referencedBy.map(e => (
                <span
                  key={e.id}
                  onClick={() => setActiveEntryId(e.id)}
                  style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {e.title ?? '(untitled journal)'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer nav */}
        {periodEntries.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            borderTop: '1px solid var(--border-light)',
            flexShrink: 0,
          }}>
            <button
              onClick={navigatePrev}
              disabled={!hasPrev}
              style={{
                background: hasPrev ? 'var(--bg-subtle)' : 'transparent',
                border: '1px solid var(--border)',
                color: hasPrev ? 'var(--text)' : 'var(--text-4)',
                borderRadius: 6, padding: '5px 14px', fontSize: 13,
              }}
            >← Prev</button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {idx + 1} / {periodEntries.length}
            </span>
            <button
              onClick={navigateNext}
              disabled={!hasNext}
              style={{
                background: hasNext ? 'var(--bg-subtle)' : 'transparent',
                border: '1px solid var(--border)',
                color: hasNext ? 'var(--text)' : 'var(--text-4)',
                borderRadius: 6, padding: '5px 14px', fontSize: 13,
              }}
            >Next →</button>
          </div>
        )}
      </div>

      {dateModalOpen && entry && (
        <ChangeDateModal
          ids={[entry.id]}
          onClose={() => setDateModalOpen(false)}
          onApplied={() => {
            window.api.entries.get(entry.id).then(setEntry)
            bumpRefreshKey()
          }}
        />
      )}

      {locationModalOpen && entry && (
        <SetLocationModal
          ids={[entry.id]}
          onClose={() => setLocationModalOpen(false)}
          onApplied={() => {
            window.api.entries.get(entry.id).then(setEntry)
            bumpRefreshKey()
          }}
        />
      )}

      {pickerOpen && entry && (
        <ReferencePickerModal
          excludeIds={new Set([entry.id, ...entryReferences.map(e => e.id)])}
          onAdd={addReferences}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
