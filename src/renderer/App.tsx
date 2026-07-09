import React, { useEffect } from 'react'
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

export default function App() {
  const { setGroups, setDataExtent, setVisibleRange, setIngestProgress, bumpRefreshKey } = useStore()

  useEffect(() => {
    window.api.groups.list().then(setGroups)
  }, [setGroups])

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

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <GroupSidebar />
      <Main />
    </div>
  )
}

async function handleImport() {
  const paths = await window.api.ingest.pickFiles()
  if (!paths.length) return
  await window.api.ingest.start(paths)
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
  const { ingestProgress, selectedPeriod, openJournalModal, activeView, setActiveView, searchResults } = useStore()
  const bottomOpen = selectedPeriod !== null || searchResults !== null

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px', fontSize: 12, cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1a1a1a' : '#888',
    border: 'none', borderRadius: 5,
    fontWeight: active ? 600 : 400,
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
  })

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <header style={{
        padding: '8px 16px',
        borderBottom: '1px solid #e4e4dc',
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#fff', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>Timeline</h1>

        {/* View tabs */}
        <div style={{
          display: 'flex', background: '#f0f0ea', borderRadius: 7, padding: 2, gap: 1,
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
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <SearchBar />
          <button
            onClick={() => openJournalModal()}
            style={{ padding: '6px 14px', background: '#ec4899', border: 'none', borderRadius: 4, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >+ Journal</button>
          <button
            onClick={handleImport}
            disabled={!!ingestProgress}
            style={{
              padding: '6px 14px',
              background: ingestProgress ? '#e4e4dc' : '#f59e0b',
              border: 'none', borderRadius: 4,
              color: '#1a1a1a', fontSize: 13, fontWeight: 600,
              cursor: ingestProgress ? 'not-allowed' : 'pointer',
            }}
          >+ Import</button>
        </div>
      </header>

      <IngestProgressBar />


      <div style={{
        flex: bottomOpen ? '0 0 auto' : 1,
        height: bottomOpen ? 'calc(100% - 240px - 41px)' : undefined,
        minHeight: bottomOpen ? 140 : undefined,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {activeView === 'timeline' ? <TimelineCanvas />
         : activeView === 'calendar' ? <CalendarHeatmap />
         : <FilesView />}
      </div>

      <SearchResults />
      <DayView />
      <EntryModal />
      <JournalModal />
    </main>
  )
}
