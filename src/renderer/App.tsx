import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import type { IngestFailure } from '../shared/types'
import TimelineCanvas, { yearViewRange } from './components/TimelineCanvas'
import CalendarHeatmap from './components/CalendarHeatmap'
import MapView from './components/MapView'
import FilesView from './components/FilesView'
import SpotifyView from './components/SpotifyView'
import FileBrowser from './components/FileBrowser'
import EntryModal from './components/EntryModal'
import GroupSidebar from './components/GroupSidebar'
import JournalModal from './components/JournalModal'
import SearchResults from './components/SearchResults'
import SearchBar from './components/SearchBar'
import SettingsView from './components/SettingsView'
import ImportTagModal from './components/ImportTagModal'
import DateRangeGroupModal from './components/DateRangeGroupModal'
import EventsPanel from './components/EventsPanel'
import SpotifyPanel from './components/SpotifyPanel'
import LifeEventModal from './components/LifeEventModal'

function ResizeDivider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 5, flexShrink: 0, cursor: 'ns-resize', userSelect: 'none',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-subtle)',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {hovered && <div style={{ width: 32, height: 2, borderRadius: 1, background: 'var(--scrollbar-thumb)' }} />}
    </div>
  )
}

export default function App() {
  const { setGroups, setEvents, setDataExtent, setVisibleRange, setIngestProgress, setSyncProgress, bumpRefreshKey, setSettings, settings, setVolumes } = useStore()

  useEffect(() => {
    window.api.groups.list().then(setGroups)
    window.api.events.list().then(setEvents)
    window.api.settings.get().then(setSettings)
    window.api.volumes.list().then(setVolumes)
  }, [setGroups, setEvents, setSettings, setVolumes])

  // Apply theme to document root whenever settings.theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings?.theme ?? 'light')
  }, [settings?.theme])

  const refreshExtent = React.useCallback(() => {
    return window.api.entries.extent().then(ext => {
      if (!ext) return
      setDataExtent([ext.min, ext.max])
      setVisibleRange(yearViewRange([ext.min, ext.max]))
    })
  }, [setDataExtent, setVisibleRange])

  useEffect(() => { refreshExtent() }, [refreshExtent])

  useEffect(() => {
    let errors: IngestFailure[] = []
    const offProgress = window.api.ingest.onProgress(evt => {
      if (evt.completed === 0) errors = []  // a new import starts; overwrite any previous banner
      if (evt.error) errors.push({ file: evt.current, error: evt.error })
      setIngestProgress({
        total: evt.total,
        completed: evt.completed,
        current: evt.current,
        errors: [...errors],
        done: false,
        logPath: null,
      })
    })
    const offDone = window.api.ingest.onDone(evt => {
      setIngestProgress({
        total: evt.total,
        completed: evt.total,
        current: '',
        errors: evt.failures,
        done: true,
        logPath: evt.logPath,
      })
      refreshExtent()
      bumpRefreshKey()
      // Folder imports may have created groups
      window.api.groups.list().then(setGroups)
    })
    return () => { offProgress(); offDone() }
  }, [setIngestProgress, bumpRefreshKey, refreshExtent, setGroups])

  useEffect(() => {
    const offProgress = window.api.sync.onProgress(evt => {
      setSyncProgress(evt)
      if (evt.phase === 'done') {
        setTimeout(() => {
          setSyncProgress(null)
          refreshExtent()
          bumpRefreshKey()
          window.api.volumes.list().then(setVolumes)
        }, 1200)
      }
    })
    const offWatcher = window.api.sync.onWatcherIngest(() => {
      refreshExtent()
      bumpRefreshKey()
    })
    return () => { offProgress(); offWatcher() }
  }, [setSyncProgress, refreshExtent, bumpRefreshKey, setVolumes])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <GroupSidebar />
      <Main />
    </div>
  )
}



function SyncProgressBar() {
  const syncProgress = useStore(s => s.syncProgress)
  if (!syncProgress) return null
  const { phase, checked, total, missing, recovered, found, ingested, current } = syncProgress
  const isDone = phase === 'done'

  let label = ''
  let pct = 0
  if (phase === 'checking') {
    label = `Checking files… ${checked}/${total}`
    pct = total > 0 ? (checked / total) * 100 : 0
  } else if (phase === 'scanning') {
    label = 'Scanning for new files…'
    pct = 100
  } else if (phase === 'ingesting') {
    label = `Ingesting ${ingested}/${found}`
    pct = found > 0 ? (ingested / found) * 100 : 0
  } else {
    label = `Sync complete — ${missing} missing, ${recovered} recovered, ${found} new`
    pct = 100
  }

  return (
    <div style={{
      padding: '8px 16px',
      background: '#f0f4ff',
      borderBottom: '1px solid #c7d2fe',
      display: 'flex', flexDirection: 'column', gap: 6,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#1a1a1a' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {!isDone && current && (
          <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {current}
          </span>
        )}
      </div>
      <div style={{ height: 6, background: '#c7d2fe', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: isDone ? '#6366f1' : '#818cf8',
          transition: 'width 120ms ease-out',
        }} />
      </div>
    </div>
  )
}

function IngestProgressBar() {
  const ingestProgress = useStore(s => s.ingestProgress)
  const setIngestProgress = useStore(s => s.setIngestProgress)
  if (!ingestProgress) return null
  const { total, completed, current, errors, done, logPath } = ingestProgress
  const failed = errors.length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const state: 'active' | 'success' | 'error' = !done ? 'active' : failed > 0 ? 'error' : 'success'

  const palette = {
    active:  { bg: '#fffbe6', border: '#f0e6b8', track: '#f0e6b8', fill: '#f59e0b', text: '#1a1a1a' },
    success: { bg: '#f0fdf4', border: '#bbf7d0', track: '#bbf7d0', fill: '#22c55e', text: '#166534' },
    error:   { bg: '#fef2f2', border: '#fecaca', track: '#fecaca', fill: '#ef4444', text: '#b91c1c' },
  }[state]

  const label = !done
    ? `Importing ${completed}/${total} files`
    : failed > 0
      ? `${total - failed}/${total} files imported — ${failed} failed`
      : `✓ ${total}/${total} files imported`

  return (
    <div style={{
      padding: '8px 16px',
      background: palette.bg,
      borderBottom: `1px solid ${palette.border}`,
      display: 'flex', flexDirection: 'column', gap: 6,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: palette.text }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {!done && (
          <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {current}
          </span>
        )}
        {!done && failed > 0 && (
          <span style={{ color: '#b91c1c' }}>{failed} error{failed === 1 ? '' : 's'}</span>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{done ? '' : `${pct}%`}</span>
        <button
          onClick={() => setIngestProgress(null)}
          title="Dismiss"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 15, lineHeight: 1, padding: '0 2px', color: palette.text,
          }}
        >×</button>
      </div>
      <div style={{ height: 6, background: palette.track, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${done ? 100 : pct}%`,
          height: '100%',
          background: palette.fill,
          transition: 'width 120ms ease-out',
        }} />
      </div>
      {done && failed > 0 && (
        <div style={{ fontSize: 11, color: palette.text }}>
          <div style={{ maxHeight: 110, overflowY: 'auto', fontFamily: 'monospace' }}>
            {errors.map((f, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.file} — {f.error}
              </div>
            ))}
          </div>
          {logPath && (
            <div style={{ marginTop: 4, fontWeight: 600 }}>
              Failed files written to {logPath}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Main() {
  const { ingestProgress, syncProgress, selectedPeriod, selectedLocation, fileBrowserOpen, openJournalModal, activeView, setActiveView, searchResults, settings, setSettings } = useStore()
  const browserOpen = fileBrowserOpen || selectedPeriod !== null || selectedLocation !== null
  const bottomOpen = browserOpen || searchResults !== null
  const isSyncing = syncProgress !== null && syncProgress.phase !== 'done'
  const isImporting = ingestProgress !== null && !ingestProgress.done
  const [importPending, setImportPending] = useState<{ paths: string[]; count: number } | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = React.useRef(0)
  const importBusy = isImporting || isSyncing

  const histH = settings?.histogramHeight  // number | null | undefined; null = fullscreen
  const isFixedHistogram = histH !== null && histH !== undefined
  // Height of whichever bottom panel is open: FileBrowser is user-resizable, SearchResults is fixed
  const bottomH = browserOpen ? (settings?.fileBrowserHeight ?? 240) : 240

  const onResizeMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY  = e.clientY
    const startH  = settings?.histogramHeight as number
    const snap    = { ...settings! }
    const onMove  = (ev: MouseEvent) => {
      const newH = Math.max(100, startH + ev.clientY - startY)
      setSettings({ ...snap, histogramHeight: newH })
    }
    const onUp = (ev: MouseEvent) => {
      const newH = Math.max(100, startH + ev.clientY - startY)
      setSettings({ ...snap, histogramHeight: newH })
      window.api.settings.set({ histogramHeight: newH })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [settings, setSettings])

  async function startImportFlow(paths: string[]) {
    if (!paths.length) return
    const count = await window.api.ingest.countFiles(paths)
    setImportPending({ paths, count })
  }

  async function handleImport(mode: 'files' | 'folder') {
    const paths = await window.api.ingest.pickFiles(mode)
    await startImportFlow(paths)
  }

  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    if (importBusy) return
    dragCounterRef.current++
    setIsDraggingFiles(true)
  }, [importBusy])

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = importBusy ? 'none' : 'copy'
  }, [importBusy])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDraggingFiles(false)
  }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFiles(false)
    if (importBusy) return
    const paths = Array.from(e.dataTransfer.files)
      .map(f => window.api.ingest.getPathForFile(f))
      .filter(Boolean)
    await startImportFlow(paths)
  }, [importBusy])

  async function confirmImport(tagNames: string[]) {
    const paths = importPending!.paths
    setImportPending(null)
    await window.api.ingest.start(paths, tagNames)
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px', fontSize: 12, cursor: 'pointer',
    background: active ? 'var(--bg-surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-3)',
    border: 'none', borderRadius: 5,
    fontWeight: active ? 600 : 400,
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
  })

  return (
    <main
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 500,
          background: 'rgba(59, 130, 246, 0.10)',
          border: '3px dashed var(--accent)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '20px 32px', boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
            fontSize: 15, fontWeight: 600, color: 'var(--text)',
          }}>
            Drop files or folders to import
          </div>
        </div>
      )}
      <header style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Timeline</h1>

        {/* View tabs */}
        <div style={{
          display: 'flex', background: 'var(--bg-subtle)', borderRadius: 7, padding: 2, gap: 1,
        }}>
          <button style={tabStyle(activeView === 'timeline')} onClick={() => setActiveView('timeline')}>
            Timeline
          </button>
          <button style={tabStyle(activeView === 'calendar')} onClick={() => setActiveView('calendar')}>
            Calendar
          </button>
          <button style={tabStyle(activeView === 'map')} onClick={() => setActiveView('map')}>
            Map
          </button>
          <button style={tabStyle(activeView === 'files')} onClick={() => setActiveView('files')}>
            Files
          </button>
          <button style={tabStyle(activeView === 'spotify')} onClick={() => setActiveView('spotify')}>
            Spotify
          </button>
          <button style={tabStyle(activeView === 'settings')} onClick={() => setActiveView('settings')}>
            Settings
          </button>
        </div>

        {activeView !== 'settings' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SearchBar />
            <button
              onClick={() => openJournalModal()}
              style={{ padding: '6px 14px', background: '#ec4899', border: 'none', borderRadius: 4, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >+ Journal</button>
            <button
              onClick={() => window.api.sync.run()}
              disabled={isSyncing || isImporting}
              style={{
                padding: '6px 14px',
                background: isSyncing ? 'var(--bg-subtle)' : '#e0e7ff',
                border: 'none', borderRadius: 4,
                color: isSyncing ? 'var(--text-3)' : '#3730a3', fontSize: 13, fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >{isSyncing ? 'Syncing…' : 'Sync'}</button>
            <button
              onClick={() => handleImport('folder')}
              disabled={importBusy}
              style={{
                padding: '6px 14px',
                background: 'var(--bg-subtle)',
                border: 'none', borderRadius: 4,
                color: isImporting ? 'var(--text-3)' : 'var(--text-2)', fontSize: 13, fontWeight: 600,
                cursor: isImporting ? 'not-allowed' : 'pointer',
              }}
            >Import folder…</button>
            <button
              onClick={() => handleImport('files')}
              disabled={importBusy}
              style={{
                padding: '6px 14px',
                background: isImporting ? 'var(--bg-subtle)' : 'var(--accent)',
                border: 'none', borderRadius: 4,
                color: isImporting ? 'var(--text-3)' : 'var(--accent-fg)', fontSize: 13, fontWeight: 600,
                cursor: isImporting ? 'not-allowed' : 'pointer',
              }}
            >+ Import</button>
          </div>
        )}
      </header>

      <IngestProgressBar />
      <SyncProgressBar />


      <div style={{
        flex: (bottomOpen || (activeView === 'timeline' && isFixedHistogram)) ? '0 0 auto' : 1,
        height: bottomOpen ? `calc(100% - ${bottomH}px - 41px)` : (activeView === 'timeline' && isFixedHistogram) ? histH! : undefined,
        minHeight: bottomOpen ? 140 : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeView === 'timeline' ? <TimelineCanvas />
             : activeView === 'calendar' ? <CalendarHeatmap />
             : activeView === 'map' ? <MapView />
             : activeView === 'settings' ? <SettingsView />
             : activeView === 'spotify' ? <SpotifyView />
             : <FilesView />}
          </div>
          {activeView === 'timeline' && <EventsPanel />}
          {activeView === 'timeline' && <SpotifyPanel />}
        </div>
      </div>

      {activeView === 'timeline' && !bottomOpen && isFixedHistogram && (
        <ResizeDivider onMouseDown={onResizeMouseDown} />
      )}

      <SearchResults />
      <FileBrowser />
      <EntryModal />
      <JournalModal />
      <DateRangeGroupModal />
      <LifeEventModal />
      {importPending && (
        <ImportTagModal
          fileCount={importPending.count}
          onConfirm={confirmImport}
          onCancel={() => setImportPending(null)}
        />
      )}
    </main>
  )
}
