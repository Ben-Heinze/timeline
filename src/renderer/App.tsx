import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import TimelineCanvas from './components/TimelineCanvas'
import CalendarHeatmap from './components/CalendarHeatmap'
import FilesView from './components/FilesView'
import DayView from './components/DayView'
import EntryModal from './components/EntryModal'
import GroupSidebar from './components/GroupSidebar'
import JournalModal from './components/JournalModal'
import SearchResults from './components/SearchResults'
import SearchBar from './components/SearchBar'
import SettingsView from './components/SettingsView'
import ImportTagModal from './components/ImportTagModal'
import DateRangeGroupModal from './components/DateRangeGroupModal'

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
  const { setGroups, setDataExtent, setVisibleRange, setIngestProgress, setSyncProgress, bumpRefreshKey, setSettings, settings } = useStore()

  useEffect(() => {
    window.api.groups.list().then(setGroups)
    window.api.settings.get().then(setSettings)
  }, [setGroups, setSettings])

  // Apply theme to document root whenever settings.theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings?.theme ?? 'light')
  }, [settings?.theme])

  const refreshExtent = React.useCallback(() => {
    return window.api.entries.extent().then(ext => {
      if (!ext) return
      const pad = (ext.max - ext.min) * 0.04
      setDataExtent([ext.min, ext.max])
      setVisibleRange([ext.min - pad, ext.max + pad])
    })
  }, [setDataExtent, setVisibleRange])

  useEffect(() => { refreshExtent() }, [refreshExtent])

  useEffect(() => {
    const errors: string[] = []
    const off = window.api.ingest.onProgress(evt => {
      if (evt.error) errors.push(`${evt.current}: ${evt.error}`)
      setIngestProgress({
        total: evt.total,
        completed: evt.completed,
        current: evt.current,
        errors: [...errors],
      })
      if (evt.completed >= evt.total) {
        setTimeout(() => {
          setIngestProgress(null)
          refreshExtent()
          bumpRefreshKey()
        }, 800)
      }
    })
    return off
  }, [setIngestProgress, bumpRefreshKey, refreshExtent])

  useEffect(() => {
    const offProgress = window.api.sync.onProgress(evt => {
      setSyncProgress(evt)
      if (evt.phase === 'done') {
        setTimeout(() => {
          setSyncProgress(null)
          refreshExtent()
          bumpRefreshKey()
        }, 1200)
      }
    })
    const offWatcher = window.api.sync.onWatcherIngest(() => {
      refreshExtent()
      bumpRefreshKey()
    })
    return () => { offProgress(); offWatcher() }
  }, [setSyncProgress, refreshExtent, bumpRefreshKey])

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
  if (!ingestProgress) return null
  const { total, completed, current, errors } = ingestProgress
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const done = completed >= total
  return (
    <div style={{
      padding: '8px 16px',
      background: '#fffbe6',
      borderBottom: '1px solid #f0e6b8',
      display: 'flex', flexDirection: 'column', gap: 6,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#1a1a1a' }}>
        <span style={{ fontWeight: 600 }}>
          {done ? 'Import complete' : 'Importing'} — {completed}/{total} ({pct}%)
        </span>
        {!done && (
          <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {current}
          </span>
        )}
        {errors.length > 0 && (
          <span style={{ color: '#b91c1c', marginLeft: 'auto' }}>{errors.length} error{errors.length === 1 ? '' : 's'}</span>
        )}
      </div>
      <div style={{ height: 6, background: '#f0e6b8', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: done ? '#22c55e' : '#f59e0b',
          transition: 'width 120ms ease-out',
        }} />
      </div>
    </div>
  )
}

function Main() {
  const { ingestProgress, syncProgress, selectedPeriod, openJournalModal, activeView, setActiveView, searchResults, settings, setSettings } = useStore()
  const bottomOpen = selectedPeriod !== null || searchResults !== null
  const isSyncing = syncProgress !== null && syncProgress.phase !== 'done'
  const [importPending, setImportPending] = useState<string[] | null>(null)

  const histH = settings?.histogramHeight  // number | null | undefined; null = fullscreen
  const isFixedHistogram = histH !== null && histH !== undefined

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

  async function handleImport() {
    const paths = await window.api.ingest.pickFiles()
    if (!paths.length) return
    setImportPending(paths)
  }

  async function confirmImport(tagNames: string[]) {
    const paths = importPending!
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
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
          <button style={tabStyle(activeView === 'files')} onClick={() => setActiveView('files')}>
            Files
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
              disabled={isSyncing || !!ingestProgress}
              style={{
                padding: '6px 14px',
                background: isSyncing ? 'var(--bg-subtle)' : '#e0e7ff',
                border: 'none', borderRadius: 4,
                color: isSyncing ? 'var(--text-3)' : '#3730a3', fontSize: 13, fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >{isSyncing ? 'Syncing…' : 'Sync'}</button>
            <button
              onClick={handleImport}
              disabled={!!ingestProgress || isSyncing}
              style={{
                padding: '6px 14px',
                background: ingestProgress ? 'var(--bg-subtle)' : 'var(--accent)',
                border: 'none', borderRadius: 4,
                color: ingestProgress ? 'var(--text-3)' : 'var(--accent-fg)', fontSize: 13, fontWeight: 600,
                cursor: ingestProgress ? 'not-allowed' : 'pointer',
              }}
            >+ Import</button>
          </div>
        )}
      </header>

      <IngestProgressBar />
      <SyncProgressBar />


      <div style={{
        flex: (bottomOpen || (activeView === 'timeline' && isFixedHistogram)) ? '0 0 auto' : 1,
        height: bottomOpen ? 'calc(100% - 240px - 41px)' : (activeView === 'timeline' && isFixedHistogram) ? histH! : undefined,
        minHeight: bottomOpen ? 140 : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {activeView === 'timeline' ? <TimelineCanvas />
         : activeView === 'calendar' ? <CalendarHeatmap />
         : activeView === 'settings' ? <SettingsView />
         : <FilesView />}
      </div>

      {activeView === 'timeline' && !bottomOpen && isFixedHistogram && (
        <ResizeDivider onMouseDown={onResizeMouseDown} />
      )}

      <SearchResults />
      <DayView />
      <EntryModal />
      <JournalModal />
      <DateRangeGroupModal />
      {importPending && (
        <ImportTagModal
          fileCount={importPending.length}
          onConfirm={confirmImport}
          onCancel={() => setImportPending(null)}
        />
      )}
    </main>
  )
}
