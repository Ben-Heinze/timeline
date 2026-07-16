import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { BackupExportType, BackupProgressEvent, DuplicateGroup, SpotifyImportProgressEvent, RescanProgressEvent, RescanResult } from '../../shared/types'
import { THEMES } from '../theme'
import { VolumeBadgeInline } from './VolumeBadge'

function ipcErrorMessage(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function SettingsView() {
  const { settings, setSettings, volumes, setVolumes, bumpRefreshKey } = useStore()
  const [refreshingDrives, setRefreshingDrives] = useState(false)
  const [pendingVolumeFolder, setPendingVolumeFolder] = useState<{ path: string; volumeId: number; label: string } | null>(null)
  const [renamingVolumeId, setRenamingVolumeId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [pendingLibraryPath, setPendingLibraryPath] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState<number>(0)
  const [migrating, setMigrating] = useState(false)
  const [migrateError, setMigrateError] = useState<string | null>(null)
  const [dupScanMode, setDupScanMode] = useState<'hash' | 'name_size'>('hash')
  const [dupScanning, setDupScanning] = useState(false)
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null)
  const [resetPending, setResetPending] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState<null | BackupExportType | 'import'>(null)
  const [backupProgress, setBackupProgress] = useState<BackupProgressEvent | null>(null)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<{ zipPath: string; destDir: string } | null>(null)
  const [spotifyBusy, setSpotifyBusy] = useState(false)
  const [spotifyProgress, setSpotifyProgress] = useState<SpotifyImportProgressEvent | null>(null)
  const [spotifyMessage, setSpotifyMessage] = useState<string | null>(null)
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [rescanProgress, setRescanProgress] = useState<RescanProgressEvent | null>(null)
  const [rescanResult, setRescanResult] = useState<RescanResult | null>(null)

  type PathHealth = { exists: boolean; foundRatio: number | null }
  const [pathHealth, setPathHealth] = useState<Record<string, PathHealth>>({})
  const [resolving, setResolving] = useState<string | null>(null)

  function pathColor(p: string): string {
    const h = pathHealth[p]
    if (!h) return 'var(--text-2)'
    if (h.foundRatio !== null) {
      if (h.foundRatio === 0) return 'var(--text-4)'
      if (h.foundRatio < 1) return '#d97706'
      return 'var(--text)'
    }
    return h.exists ? 'var(--text-2)' : 'var(--text-4)'
  }

  function needsResolve(p: string): boolean {
    const h = pathHealth[p]
    if (!h) return false
    if (!h.exists) return true
    if (h.foundRatio !== null && h.foundRatio < 1) return true
    return false
  }

  useEffect(() => {
    window.api.settings.get().then(async s => {
      setSettings(s)
      setDupScanMode(s.duplicateScanMode ?? 'hash')
      const check = await window.api.settings.checkPaths()
      const next: Record<string, { exists: boolean; foundRatio: number | null }> = {}
      next[s.libraryPath] = { exists: check.libraryExists, foundRatio: null }
      for (const { path: p, exists } of check.watchedFolders) {
        next[p] = { exists, foundRatio: null }
      }
      setPathHealth(next)
    })
    window.api.volumes.refresh().then(setVolumes)
  }, [setSettings, setVolumes])

  async function refreshDrives() {
    setRefreshingDrives(true)
    try {
      const list = await window.api.volumes.refresh()
      setVolumes(list)
    } finally {
      setRefreshingDrives(false)
    }
  }

  function volumeFor(volumeId: number | null) {
    if (volumeId == null) return null
    return volumes.find(v => v.id === volumeId) ?? null
  }

  async function startRenameVolume(id: number, currentLabel: string) {
    setRenamingVolumeId(id)
    setRenameText(currentLabel)
  }

  async function commitRenameVolume() {
    if (renamingVolumeId == null) return
    const label = renameText.trim()
    if (label) {
      await window.api.volumes.setLabel(renamingVolumeId, label)
      setVolumes(volumes.map(v => v.id === renamingVolumeId ? { ...v, label } : v))
    }
    setRenamingVolumeId(null)
  }

  useEffect(() => {
    if (typeof window.api.backup?.onProgress !== 'function') return
    return window.api.backup.onProgress(setBackupProgress)
  }, [])

  useEffect(() => {
    if (typeof window.api.spotify?.onProgress !== 'function') return
    return window.api.spotify.onProgress(setSpotifyProgress)
  }, [])

  useEffect(() => {
    if (typeof window.api.library?.onRescanProgress !== 'function') return
    return window.api.library.onRescanProgress(setRescanProgress)
  }, [])

  if (!settings) {
    return <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 13 }}>Loading settings…</div>
  }

  async function setTheme(theme: string) {
    const next = { ...settings!, theme }
    await window.api.settings.set({ theme })
    setSettings(next)
  }

  async function pickLibraryPath() {
    const chosen = await window.api.settings.pickFolder()
    if (!chosen || chosen === settings!.libraryPath) return
    const count = await window.api.settings.getLibraryFileCount()
    setFileCount(count)
    setPendingLibraryPath(chosen)
    setMigrateError(null)
  }

  async function confirmMigration() {
    if (!pendingLibraryPath) return
    setMigrating(true)
    setMigrateError(null)
    try {
      await window.api.settings.migrateLibrary(pendingLibraryPath)
      const next = { ...settings!, libraryPath: pendingLibraryPath }
      setSettings(next)
      setPendingLibraryPath(null)
    } catch (e: any) {
      setMigrateError(e?.message ?? 'Migration failed')
    } finally {
      setMigrating(false)
    }
  }

  async function addWatchedFolder() {
    const chosen = await window.api.settings.pickFolder()
    if (!chosen) return
    if (settings!.watchedFolders.some(f => f.path === chosen)) return

    const { volumeId, osLabel } = await window.api.volumes.matchPath(chosen)
    if (volumeId != null) {
      // Lives on a removable/external drive — confirm the cosmetic label before saving.
      setPendingVolumeFolder({ path: chosen, volumeId, label: osLabel ?? '' })
      window.api.volumes.list().then(setVolumes)
      return
    }

    const next = { ...settings!, watchedFolders: [...settings!.watchedFolders, { path: chosen, volumeId: null }] }
    await window.api.settings.set({ watchedFolders: next.watchedFolders })
    setSettings(next)
  }

  async function confirmVolumeFolder() {
    if (!pendingVolumeFolder) return
    const { path: chosen, volumeId, label } = pendingVolumeFolder
    const trimmed = label.trim()
    if (trimmed) await window.api.volumes.setLabel(volumeId, trimmed)
    const next = { ...settings!, watchedFolders: [...settings!.watchedFolders, { path: chosen, volumeId }] }
    await window.api.settings.set({ watchedFolders: next.watchedFolders })
    setSettings(next)
    setPendingVolumeFolder(null)
    window.api.volumes.list().then(setVolumes)
  }

  async function resolveWatchedFolder(oldPath: string) {
    const chosen = await window.api.settings.pickFolder()
    if (!chosen) return
    setResolving(oldPath)
    try {
      const { found, total } = await window.api.settings.resolveWatchedFolder(oldPath, chosen)
      const foundRatio = total === 0 ? 1 : found / total
      const next = { ...settings!, watchedFolders: settings!.watchedFolders.map(f => f.path === oldPath ? { ...f, path: chosen } : f) }
      setSettings(next)
      setPathHealth(prev => {
        const copy = { ...prev }
        delete copy[oldPath]
        copy[chosen] = { exists: true, foundRatio }
        return copy
      })
    } finally {
      setResolving(null)
    }
  }

  async function resolveLibraryPath() {
    const chosen = await window.api.settings.pickFolder()
    if (!chosen) return
    setResolving(settings!.libraryPath)
    try {
      const { found, total } = await window.api.settings.relocateLibrary(chosen)
      const foundRatio = total === 0 ? 1 : found / total
      const next = { ...settings!, libraryPath: chosen }
      setSettings(next)
      setPathHealth(prev => {
        const copy = { ...prev }
        delete copy[settings!.libraryPath]
        copy[chosen] = { exists: true, foundRatio }
        return copy
      })
    } finally {
      setResolving(null)
    }
  }

  async function changeDupScanMode(mode: 'hash' | 'name_size') {
    setDupScanMode(mode)
    setDupGroups(null)
    const next = { ...settings!, duplicateScanMode: mode }
    await window.api.settings.set({ duplicateScanMode: mode })
    setSettings(next)
  }

  async function runDupScan() {
    setDupScanning(true)
    setDupGroups(null)
    const groups = await window.api.sync.scanDuplicates(dupScanMode)
    setDupGroups(groups)
    setDupScanning(false)
  }

  async function removeWatchedFolder(folderPath: string) {
    const next = { ...settings!, watchedFolders: settings!.watchedFolders.filter(f => f.path !== folderPath) }
    await window.api.settings.set({ watchedFolders: next.watchedFolders })
    setSettings(next)
  }

  async function generateTestData() {
    setGenerating(true)
    setGenerateError(null)
    try {
      if (typeof window.api.settings.generateTestData !== 'function') {
        throw new Error('Not available in the running app yet — restart the dev server (main process and preload are only rebuilt on startup).')
      }
      await window.api.settings.generateTestData()
      window.location.reload()
    } catch (e: any) {
      setGenerateError(e?.message ?? 'Test data generation failed')
      setGenerating(false)
    }
  }

  async function runExport(type: BackupExportType) {
    setBackupBusy(type)
    setBackupError(null)
    setBackupMessage(null)
    setBackupProgress(null)
    try {
      if (typeof window.api.backup?.export !== 'function') {
        throw new Error('Not available in the running app yet — restart the dev server (main process and preload are only rebuilt on startup).')
      }
      const res = await window.api.backup.export(type)
      if (!res.canceled) {
        let msg = `Exported ${res.entries} entr${res.entries === 1 ? 'y' : 'ies'} to ${res.path}`
        if (res.skippedReferences && res.skippedReferences.length > 0) {
          msg += ` — ${res.skippedReferences.length} referenced file${res.skippedReferences.length === 1 ? '' : 's'} could not be read and were skipped`
        }
        setBackupMessage(msg)
      }
    } catch (e) {
      setBackupError(ipcErrorMessage(e))
    } finally {
      setBackupBusy(null)
      setBackupProgress(null)
    }
  }

  async function startRestore() {
    setBackupError(null)
    setBackupMessage(null)
    if (typeof window.api.backup?.pickArchive !== 'function') {
      setBackupError('Not available in the running app yet — restart the dev server (main process and preload are only rebuilt on startup).')
      return
    }
    const zipPath = await window.api.backup.pickArchive()
    if (!zipPath) return
    const destDir = await window.api.settings.pickFolder()
    if (!destDir) return
    setPendingImport({ zipPath, destDir })
  }

  async function confirmRestore() {
    if (!pendingImport) return
    setBackupBusy('import')
    setBackupError(null)
    setBackupProgress(null)
    try {
      await window.api.backup.import(pendingImport.zipPath, pendingImport.destDir)
      window.location.reload()
    } catch (e) {
      setBackupError(ipcErrorMessage(e))
      setBackupBusy(null)
      setBackupProgress(null)
    }
  }

  async function importSpotifyHistory(mode: 'files' | 'folder') {
    setSpotifyError(null)
    setSpotifyMessage(null)
    if (typeof window.api.spotify?.pickExport !== 'function') {
      setSpotifyError('Not available in the running app yet — restart the dev server (main process and preload are only rebuilt on startup).')
      return
    }
    const paths = await window.api.spotify.pickExport(mode)
    if (!paths.length) return
    setSpotifyBusy(true)
    setSpotifyProgress(null)
    try {
      const res = await window.api.spotify.import(paths)
      if (res.totalFiles === 0) {
        setSpotifyError('No Streaming_History_Audio/Video JSON files found in the selected location. Point this at the folder from your Spotify "Extended streaming history" export.')
      } else {
        setSpotifyMessage(`Imported ${res.imported} play${res.imported === 1 ? '' : 's'} from ${res.totalFiles} file${res.totalFiles === 1 ? '' : 's'}.`)
        // Invalidate cached Spotify views (yearly recap, top-artist panel, density ribbon).
        if (res.imported > 0) bumpRefreshKey()
      }
    } catch (e) {
      setSpotifyError(ipcErrorMessage(e))
    } finally {
      setSpotifyBusy(false)
      setSpotifyProgress(null)
    }
  }

  async function rescanLibrary() {
    if (rescanBusy) return
    setRescanBusy(true)
    setRescanResult(null)
    setRescanProgress(null)
    try {
      const res = await window.api.library.rescan()
      setRescanResult(res)
      // Refresh the timeline/map/etc. if anything actually changed.
      if (res.thumbnailsAdded || res.datesUpdated || res.gpsAdded || res.reclassified) bumpRefreshKey()
    } finally {
      setRescanBusy(false)
      setRescanProgress(null)
    }
  }

  async function confirmReset() {
    setResetting(true)
    try {
      await window.api.settings.resetLibrary()
      window.location.reload()
    } catch {
      setResetting(false)
    }
  }

  const section: React.CSSProperties = { marginBottom: 36 }
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 12,
  }
  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
  }
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px', borderBottom: '1px solid var(--border-light)', fontSize: 13,
  }
  const rowLast: React.CSSProperties = { ...row, borderBottom: 'none' }
  const radioBtn = (active: boolean): React.CSSProperties => ({
    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
    border: active ? '5px solid var(--accent)' : '2px solid var(--border-strong)',
    background: 'var(--bg-input)', cursor: 'pointer',
    boxSizing: 'border-box',
  })
  const btn = (variant: 'default' | 'danger' | 'ghost'): React.CSSProperties => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 5,
    border: 'none', cursor: 'pointer',
    background: variant === 'danger' ? '#fee2e2' : variant === 'ghost' ? 'transparent' : 'var(--bg-subtle)',
    color: variant === 'danger' ? '#b91c1c' : 'var(--text)',
  })

  const activeTheme = settings.theme ?? 'light'

  return (
    <div style={{ padding: '32px 40px', maxWidth: 600, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 28, marginTop: 0 }}>Settings</h2>

      {/* Appearance / theme */}
      <div style={section}>
        <div style={sectionLabel}>Appearance</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {THEMES.map(t => {
            const active = activeTheme === t.name
            return (
              <button
                key={t.name}
                onClick={() => setTheme(t.name)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '12px 10px', borderRadius: 8, cursor: 'pointer', flex: '0 0 76px',
                  border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                  background: active ? 'var(--bg-subtle)' : 'transparent',
                  transition: 'border-color 0.1s',
                }}
              >
                <div style={{ display: 'flex', gap: 3 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: t.preview.bg, border: '1px solid var(--border)' }} />
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: t.preview.surface, border: '1px solid var(--border)' }} />
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: t.preview.accent }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? 'var(--text)' : 'var(--text-2)' }}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Library location */}
      <div style={section}>
        <div style={sectionLabel}>Library location</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, marginTop: -6 }}>
          Files you manually import, or that are dropped directly into the library folder, are copied here.
        </div>
        <div style={card}>
          <div style={row}>
            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: pathColor(settings.libraryPath) }}>
              {settings.libraryPath}
              {pathHealth[settings.libraryPath] && !pathHealth[settings.libraryPath].exists && pathHealth[settings.libraryPath].foundRatio === null && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)' }}>— folder not found</span>
              )}
              {pathHealth[settings.libraryPath]?.foundRatio !== null && pathHealth[settings.libraryPath]?.foundRatio! < 1 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: '#d97706' }}>
                  — {Math.round(pathHealth[settings.libraryPath].foundRatio! * 100)}% of files found
                </span>
              )}
            </span>
            {needsResolve(settings.libraryPath) ? (
              <button
                style={btn('default')}
                onClick={resolveLibraryPath}
                disabled={resolving === settings.libraryPath || migrating}
              >
                {resolving === settings.libraryPath ? 'Resolving…' : 'Resolve…'}
              </button>
            ) : (
              <button
                style={btn('default')}
                onClick={pickLibraryPath}
                disabled={migrating}
              >
                Change…
              </button>
            )}
          </div>

          {pendingLibraryPath && (
            <div style={{
              ...rowLast,
              flexDirection: 'column', alignItems: 'flex-start', gap: 10,
              background: '#fffbeb', borderTop: '1px solid #fde68a',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e', marginBottom: 4 }}>
                    Move library to new location?
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                    This will move{' '}
                    <strong>{fileCount} file{fileCount !== 1 ? 's' : ''}</strong> and all thumbnails
                    from the current location to:
                    <br />
                    <span style={{ fontFamily: 'monospace' }}>{pendingLibraryPath}</span>
                    <br />
                    The app will be unavailable during the move. This cannot be undone.
                  </div>
                </div>
              </div>
              {migrateError && (
                <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', padding: '6px 10px', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}>
                  {migrateError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ ...btn('danger'), background: '#b91c1c', color: '#fff', opacity: migrating ? 0.6 : 1 }}
                  onClick={confirmMigration}
                  disabled={migrating}
                >
                  {migrating ? 'Moving…' : 'Move library'}
                </button>
                <button
                  style={btn('ghost')}
                  onClick={() => { setPendingLibraryPath(null); setMigrateError(null) }}
                  disabled={migrating}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backup & restore */}
      <div style={section}>
        <div style={sectionLabel}>Backup &amp; restore</div>
        <div style={card}>
          <div style={{ ...row, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Full backup</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                One .zip with everything: database, all media files, thumbnails, and a plain-text
                metadata.json. Files referenced in place are copied into the archive too.
              </div>
            </div>
            <button
              style={{ ...btn('default'), flexShrink: 0, opacity: backupBusy ? 0.6 : 1 }}
              onClick={() => runExport('full')}
              disabled={backupBusy !== null}
            >
              {backupBusy === 'full' ? 'Exporting…' : 'Export…'}
            </button>
          </div>
          <div style={{ ...row, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Metadata-only backup</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Everything except the media files themselves: database, thumbnails, and metadata.json.
                Much smaller. After restoring, re-import your files and they are matched back to their
                entries by content hash.
              </div>
            </div>
            <button
              style={{ ...btn('default'), flexShrink: 0, opacity: backupBusy ? 0.6 : 1 }}
              onClick={() => runExport('metadata')}
              disabled={backupBusy !== null}
            >
              {backupBusy === 'metadata' ? 'Exporting…' : 'Export…'}
            </button>
          </div>
          <div style={{ ...rowLast, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Restore from backup</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Unpacks a backup archive into an empty folder and switches the app to it.
                Your current library is left untouched on disk.
              </div>
            </div>
            <button
              style={{ ...btn('default'), flexShrink: 0, opacity: backupBusy ? 0.6 : 1 }}
              onClick={startRestore}
              disabled={backupBusy !== null}
            >
              {backupBusy === 'import' ? 'Restoring…' : 'Restore…'}
            </button>
          </div>

          {pendingImport && (
            <div style={{
              ...rowLast,
              flexDirection: 'column', alignItems: 'flex-start', gap: 10,
              background: '#fffbeb', borderTop: '1px solid #fde68a',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e', marginBottom: 4 }}>
                    Restore backup and switch library?
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                    <span style={{ fontFamily: 'monospace' }}>{pendingImport.zipPath}</span>
                    <br />
                    will be unpacked into
                    <br />
                    <span style={{ fontFamily: 'monospace' }}>{pendingImport.destDir}</span>
                    <br />
                    and the app will switch to that library. The destination must be empty.
                    Your current library at{' '}
                    <span style={{ fontFamily: 'monospace' }}>{settings.libraryPath}</span> stays on disk.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ ...btn('danger'), background: '#b45309', color: '#fff', opacity: backupBusy ? 0.6 : 1 }}
                  onClick={confirmRestore}
                  disabled={backupBusy !== null}
                >
                  {backupBusy === 'import' ? 'Restoring…' : 'Restore backup'}
                </button>
                <button
                  style={btn('ghost')}
                  onClick={() => setPendingImport(null)}
                  disabled={backupBusy !== null}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {(backupBusy !== null && backupProgress) && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-3)' }}>
              {backupProgress.phase === 'preparing' && backupProgress.current}
              {backupProgress.phase === 'archiving' && `Archiving ${backupProgress.completed}/${backupProgress.total} — ${backupProgress.current}`}
              {backupProgress.phase === 'extracting' && `Extracting ${backupProgress.completed}/${backupProgress.total} — ${backupProgress.current}`}
              {backupProgress.phase === 'checking' && `Checking files ${backupProgress.completed}/${backupProgress.total}`}
              {backupProgress.phase === 'done' && 'Finishing…'}
            </div>
          )}
          {backupMessage && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: '#16a34a', wordBreak: 'break-all' }}>
              {backupMessage}
            </div>
          )}
          {backupError && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', padding: '6px 10px', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}>
                {backupError}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spotify listening history */}
      <div style={section}>
        <div style={sectionLabel}>Listening history</div>
        <div style={card}>
          <div style={{ ...rowLast, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Import Spotify history</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Point this at your Spotify "Extended streaming history" data export — either the
                folder itself, or the individual files named Streaming_History_Audio_*.json inside it.
                Plays show up when you click on the day you listened to them on the timeline.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                style={{ ...btn('default'), opacity: spotifyBusy ? 0.6 : 1 }}
                onClick={() => importSpotifyHistory('folder')}
                disabled={spotifyBusy}
              >
                {spotifyBusy ? 'Importing…' : 'Choose folder…'}
              </button>
              <button
                style={{ ...btn('default'), opacity: spotifyBusy ? 0.6 : 1 }}
                onClick={() => importSpotifyHistory('files')}
                disabled={spotifyBusy}
              >
                {spotifyBusy ? 'Importing…' : 'Choose files…'}
              </button>
            </div>
          </div>
          {spotifyBusy && spotifyProgress && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-3)' }}>
              Processing file {spotifyProgress.processedFiles}/{spotifyProgress.totalFiles} — {spotifyProgress.current}
            </div>
          )}
          {spotifyMessage && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: '#16a34a', wordBreak: 'break-all' }}>
              {spotifyMessage}
            </div>
          )}
          {spotifyError && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', padding: '6px 10px', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}>
                {spotifyError}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Library maintenance */}
      <div style={section}>
        <div style={sectionLabel}>Library maintenance</div>
        <div style={card}>
          <div style={{ ...rowLast, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Rescan library</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Backfill data for files imported before recent updates: generate missing thumbnails
                (Sony/Canon RAW previews and video poster frames included), reclassify RAW files
                stored as documents into photos, and fill in GPS and any unconfirmed dates from each
                file's metadata. Dates you've already confirmed or changed are left untouched.
              </div>
            </div>
            <button
              style={{ ...btn('default'), opacity: rescanBusy ? 0.6 : 1, flexShrink: 0 }}
              onClick={rescanLibrary}
              disabled={rescanBusy}
            >
              {rescanBusy ? 'Rescanning…' : 'Rescan library'}
            </button>
          </div>
          {rescanBusy && rescanProgress && rescanProgress.total > 0 && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-3)' }}>
              Scanning {rescanProgress.processed}/{rescanProgress.total}
              {rescanProgress.current ? ` — ${rescanProgress.current}` : ''}
            </div>
          )}
          {rescanResult && (
            <div style={{ ...rowLast, borderTop: '1px solid var(--border-light)', fontSize: 12, color: '#16a34a' }}>
              Scanned {rescanResult.scanned} file{rescanResult.scanned === 1 ? '' : 's'} — added{' '}
              {rescanResult.thumbnailsAdded} thumbnail{rescanResult.thumbnailsAdded === 1 ? '' : 's'},{' '}
              {rescanResult.datesUpdated} date{rescanResult.datesUpdated === 1 ? '' : 's'},{' '}
              {rescanResult.gpsAdded} location{rescanResult.gpsAdded === 1 ? '' : 's'}
              {rescanResult.reclassified > 0 ? `, reclassified ${rescanResult.reclassified} RAW file${rescanResult.reclassified === 1 ? '' : 's'}` : ''}.
            </div>
          )}
        </div>
      </div>

      {/* Duplicate scan */}
      <div style={section}>
        <div style={sectionLabel}>Duplicate detection</div>
        <div style={card}>
          <div style={row}>
            <span style={{ flex: 1, fontSize: 13 }}>Detection method</span>
            <select
              value={dupScanMode}
              onChange={e => changeDupScanMode(e.target.value as 'hash' | 'name_size')}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }}
            >
              <option value="hash">Content hash (thorough, slower for large files)</option>
              <option value="name_size">Filename match (fast)</option>
            </select>
          </div>
          <div style={{ ...rowLast, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Automatically, imports use content hash for files under 100 MB and filename match for larger files.
              Run a manual scan to find duplicates already in your library.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                style={{ ...btn('default'), padding: '7px 14px', opacity: dupScanning ? 0.6 : 1 }}
                onClick={runDupScan}
                disabled={dupScanning}
              >
                {dupScanning ? 'Scanning…' : 'Scan for duplicates'}
              </button>
              {dupGroups !== null && !dupScanning && (
                <span style={{ fontSize: 12, color: dupGroups.length === 0 ? '#16a34a' : '#b45309' }}>
                  {dupGroups.length === 0
                    ? 'No duplicates found.'
                    : `${dupGroups.length} duplicate group${dupGroups.length === 1 ? '' : 's'} found (${dupGroups.reduce((s, g) => s + g.count, 0) - dupGroups.length} extra). Review in Files view.`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Histogram size */}
      <div style={section}>
        <div style={sectionLabel}>Histogram size</div>
        <div style={card}>
          {([
            [320,  'Small',      'Compact — leaves most of the screen for content below'],
            [420,  'Medium',     'Balanced default height'],
            [520,  'Large',      'Taller bars for denser timelines'],
            [null, 'Fullscreen', 'Histogram fills the entire window'],
          ] as const).map(([value, title, description], i, arr) => {
            const isLast = i === arr.length - 1
            const active = (settings.histogramHeight ?? 420) === value
            return (
              <div
                key={String(value)}
                style={isLast ? rowLast : row}
                onClick={async () => {
                  const next = { ...settings!, histogramHeight: value }
                  await window.api.settings.set({ histogramHeight: value })
                  setSettings(next)
                }}
                role="radio"
                aria-checked={active}
              >
                <div style={radioBtn(active)} />
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{description}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Timeline */}
      <div style={section}>
        <div style={sectionLabel}>Timeline</div>
        <div style={card}>
          <div style={rowLast}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Curve smoothness</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Controls how tightly the smooth curve bends toward each data point. Only visible in Curve mode.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 16 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.curveTension ?? 1}
                onChange={async e => {
                  const val = parseFloat(e.target.value)
                  const next = { ...settings!, curveTension: val }
                  await window.api.settings.set({ curveTension: val })
                  setSettings(next)
                }}
                style={{ width: 120, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 80, textAlign: 'right' }}>
                {settings.curveTension === 0 || settings.curveTension === undefined
                  ? 'Angular'
                  : settings.curveTension >= 1
                  ? 'Fully smooth'
                  : `${Math.round((settings.curveTension ?? 1) * 100)}%`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar heatmap */}
      <div style={section}>
        <div style={sectionLabel}>Calendar heatmap</div>
        <div style={card}>
          <div
            style={row}
            onClick={async () => {
              const next = { ...settings!, heatmapScale: 'log' as const }
              await window.api.settings.set({ heatmapScale: 'log' })
              setSettings(next)
            }}
            role="radio"
            aria-checked={(settings.heatmapScale ?? 'log') === 'log'}
          >
            <div style={radioBtn((settings.heatmapScale ?? 'log') === 'log')} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Logarithmic scale</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Spreads color more evenly when some days have far more entries than others. Best for most libraries.
              </div>
            </div>
          </div>
          <div
            style={row}
            onClick={async () => {
              const next = { ...settings!, heatmapScale: 'linear' as const }
              await window.api.settings.set({ heatmapScale: 'linear' })
              setSettings(next)
            }}
            role="radio"
            aria-checked={settings.heatmapScale === 'linear'}
          >
            <div style={radioBtn(settings.heatmapScale === 'linear')} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Linear scale</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Each additional file adds the same amount of color. 1 file = coolest heat.
              </div>
            </div>
          </div>
          <div style={rowLast}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Max count threshold</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Days with this many or more entries show the warmest color. Leave blank to use each year's actual maximum.
              </div>
            </div>
            <input
              type="number"
              min={1}
              placeholder="Auto"
              value={settings.heatmapMaxCount ?? ''}
              onChange={async e => {
                const raw = e.target.value.trim()
                const val = raw === '' ? null : Math.max(1, parseInt(raw, 10))
                const next = { ...settings!, heatmapMaxCount: val }
                await window.api.settings.set({ heatmapMaxCount: val })
                setSettings(next)
              }}
              style={{
                width: 72, fontSize: 13, padding: '5px 8px', textAlign: 'center',
                borderRadius: 5, border: '1px solid var(--border-strong)',
                background: 'var(--bg-input)', color: 'var(--text)',
                flexShrink: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* Watched folders */}
      <div style={section}>
        <div style={sectionLabel}>Watched folders</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, marginTop: -6 }}>
          Folders below are watched continuously and their files are referenced in place — never copied.
        </div>
        <div style={card}>
          {settings.watchedFolders.length === 0 ? (
            <div style={{ ...rowLast, color: 'var(--text-3)', fontStyle: 'italic' }}>
              No folders added yet.
            </div>
          ) : (
            settings.watchedFolders.map((folder, i) => {
              const isLast = i === settings.watchedFolders.length - 1 && !pendingVolumeFolder
              const health = pathHealth[folder.path]
              const onDrive = folder.volumeId != null
              return (
                <div key={folder.path} style={isLast ? rowLast : row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: pathColor(folder.path) }}>
                      {folder.path}
                    </span>
                    {onDrive ? (
                      <span style={{ marginLeft: 8 }}>
                        <VolumeBadgeInline volumeId={folder.volumeId} />
                      </span>
                    ) : (
                      <>
                        {health && !health.exists && health.foundRatio === null && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)' }}>— folder not found</span>
                        )}
                        {health?.foundRatio !== null && health?.foundRatio !== undefined && health.foundRatio < 1 && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: health.foundRatio === 0 ? 'var(--text-4)' : '#d97706' }}>
                            — {health.foundRatio === 0 ? 'no files found' : `${Math.round(health.foundRatio * 100)}% of files found`}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {/* A drive-backed folder that isn't found just means "unplugged" —
                        self-heals on reconnect, so no manual re-pointing action here. */}
                    {!onDrive && needsResolve(folder.path) && (
                      <button
                        style={btn('default')}
                        onClick={() => resolveWatchedFolder(folder.path)}
                        disabled={resolving === folder.path}
                      >
                        {resolving === folder.path ? 'Resolving…' : 'Resolve…'}
                      </button>
                    )}
                    <button style={btn('danger')} onClick={() => removeWatchedFolder(folder.path)}>
                      Remove
                    </button>
                  </div>
                </div>
              )
            })
          )}
          {pendingVolumeFolder && (
            <div style={{
              ...rowLast,
              flexDirection: 'column', alignItems: 'flex-start', gap: 10,
              background: '#fffbeb', borderTop: '1px solid #fde68a',
            }}>
              <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                <span style={{ fontFamily: 'monospace' }}>{pendingVolumeFolder.path}</span> is on a
                removable drive. Give it a name to help you recognize it later — this is just a label
                and won't affect how the drive is recognized when reconnected.
              </div>
              <input
                autoFocus
                value={pendingVolumeFolder.label}
                onChange={e => setPendingVolumeFolder({ ...pendingVolumeFolder, label: e.target.value })}
                placeholder="e.g. Rugged HDD 1"
                style={{
                  padding: '6px 10px', fontSize: 13, borderRadius: 5, width: 220,
                  border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text)',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...btn('default'), background: '#b45309', color: '#fff' }} onClick={confirmVolumeFolder}>
                  Add drive folder
                </button>
                <button style={btn('ghost')} onClick={() => setPendingVolumeFolder(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            style={{ ...btn('default'), padding: '7px 14px' }}
            onClick={addWatchedFolder}
          >
            + Add folder
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            Thumbnails are always stored in your library.
          </span>
        </div>
      </div>

      {/* Known drives */}
      <div style={section}>
        <div style={sectionLabel}>Known drives</div>
        <div style={card}>
          {volumes.length === 0 ? (
            <div style={{ ...rowLast, color: 'var(--text-3)', fontStyle: 'italic' }}>
              No drives linked yet — add a watched folder on an external drive above.
            </div>
          ) : (
            volumes.map((v, i) => {
              const isLast = i === volumes.length - 1
              return (
                <div key={v.id} style={isLast ? rowLast : row}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: v.connected ? '#16a34a' : '#ef4444',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renamingVolumeId === v.id ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={e => setRenameText(e.target.value)}
                        onBlur={commitRenameVolume}
                        onKeyDown={e => { if (e.key === 'Enter') commitRenameVolume(); if (e.key === 'Escape') setRenamingVolumeId(null) }}
                        style={{
                          padding: '3px 6px', fontSize: 13, borderRadius: 4, width: 200,
                          border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text)',
                        }}
                      />
                    ) : (
                      <span
                        style={{ fontWeight: 600, cursor: 'pointer' }}
                        title="Click to rename"
                        onClick={() => startRenameVolume(v.id, v.label)}
                      >
                        {v.label}
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {v.connected ? `Connected${v.mountPath ? ` at ${v.mountPath}` : ''}` : 'Not connected'}
                    </div>
                  </div>
                  <button style={btn('default')} onClick={() => startRenameVolume(v.id, v.label)}>
                    Rename
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            style={{ ...btn('default'), padding: '7px 14px', opacity: refreshingDrives ? 0.6 : 1 }}
            onClick={refreshDrives}
            disabled={refreshingDrives}
          >
            {refreshingDrives ? 'Refreshing…' : 'Refresh drives'}
          </button>
        </div>
      </div>

      {/* Testing */}
      <div style={section}>
        <div style={sectionLabel}>Testing</div>
        <div style={card}>
          <div style={{ ...rowLast, flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Generate test data</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Creates 1,000 blank placeholder files (photos, videos, audio, documents) inside your library,
                spread across the last 5 years with a few dense days of 20+ files, randomly tagged from 12
                common tags. About a third of photos/videos carry GPS data clustered around real-world cities
                for the map view, and ten themed same-day clusters (trips, birthdays, reunions) are assigned
                into Groups. Use "Clear entire database" below to remove everything again.
              </div>
            </div>
            <button
              style={{ ...btn('default'), padding: '7px 14px', opacity: generating ? 0.6 : 1 }}
              onClick={generateTestData}
              disabled={generating || resetting}
            >
              {generating ? 'Generating…' : '⚗ Generate 1,000 test files'}
            </button>
            {generateError && (
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', padding: '6px 10px', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}>
                {generateError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div style={section}>
        <div style={{ ...sectionLabel, color: '#b91c1c' }}>Danger zone</div>
        <div style={{ ...card, border: '1px solid #fecaca' }}>
          <div style={{ ...rowLast, flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Clear entire database</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Permanently deletes every entry, group, and tag, plus all copied files and thumbnails in your library.
                Files imported in "Reference in place" mode are not touched at their original location — only the app's
                record of them is removed. This cannot be undone.
              </div>
            </div>
            {!resetPending ? (
              <button
                style={{ ...btn('danger'), padding: '7px 14px' }}
                onClick={() => { setResetPending(true); setResetConfirmText('') }}
              >
                ⚠ Clear everything
              </button>
            ) : (
              <div style={{
                width: '100%', boxSizing: 'border-box',
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
                padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>⚠️</span>
                  <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.5 }}>
                    This will permanently delete all entries, groups, tags, and copied library files. There is no undo.
                    Type <strong>DELETE</strong> to confirm.
                  </div>
                </div>
                <input
                  autoFocus
                  value={resetConfirmText}
                  onChange={e => setResetConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  style={{
                    padding: '7px 10px', fontSize: 13, borderRadius: 5,
                    border: '1px solid #fca5a5', outline: 'none',
                    background: '#fff', color: '#7f1d1d',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{
                      ...btn('danger'), background: '#b91c1c', color: '#fff',
                      opacity: resetConfirmText === 'DELETE' && !resetting ? 1 : 0.5,
                    }}
                    onClick={confirmReset}
                    disabled={resetConfirmText !== 'DELETE' || resetting}
                  >
                    {resetting ? 'Clearing…' : 'Yes, delete everything'}
                  </button>
                  <button
                    style={btn('ghost')}
                    onClick={() => { setResetPending(false); setResetConfirmText('') }}
                    disabled={resetting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
