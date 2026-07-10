import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AppSettings, DuplicateGroup } from '../../shared/types'
import { THEMES } from '../theme'

export default function SettingsView() {
  const { settings, setSettings } = useStore()
  const [pendingLibraryPath, setPendingLibraryPath] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState<number>(0)
  const [migrating, setMigrating] = useState(false)
  const [migrateError, setMigrateError] = useState<string | null>(null)
  const [dupScanMode, setDupScanMode] = useState<'hash' | 'name_size'>('hash')
  const [dupScanning, setDupScanning] = useState(false)
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null)

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
  }, [setSettings])

  if (!settings) {
    return <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 13 }}>Loading settings…</div>
  }

  async function setMode(mode: AppSettings['importMode']) {
    const next = { ...settings!, importMode: mode }
    await window.api.settings.set({ importMode: mode })
    setSettings(next)
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
    if (settings!.watchedFolders.includes(chosen)) return
    const next = { ...settings!, watchedFolders: [...settings!.watchedFolders, chosen] }
    await window.api.settings.set({ watchedFolders: next.watchedFolders })
    setSettings(next)
  }

  async function resolveWatchedFolder(oldPath: string) {
    const chosen = await window.api.settings.pickFolder()
    if (!chosen) return
    setResolving(oldPath)
    try {
      const { found, total } = await window.api.settings.resolveWatchedFolder(oldPath, chosen)
      const foundRatio = total === 0 ? 1 : found / total
      const next = { ...settings!, watchedFolders: settings!.watchedFolders.map(f => f === oldPath ? chosen : f) }
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

  async function removeWatchedFolder(folder: string) {
    const next = { ...settings!, watchedFolders: settings!.watchedFolders.filter(f => f !== folder) }
    await window.api.settings.set({ watchedFolders: next.watchedFolders })
    setSettings(next)
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
        <div style={{ display: 'flex', gap: 8 }}>
          {THEMES.map(t => {
            const active = activeTheme === t.name
            return (
              <button
                key={t.name}
                onClick={() => setTheme(t.name)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '12px 10px', borderRadius: 8, cursor: 'pointer', flex: 1,
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

      {/* Import mode */}
      <div style={section}>
        <div style={sectionLabel}>Import mode</div>
        <div style={card}>
          <div
            style={row}
            onClick={() => setMode('copy')}
            role="radio"
            aria-checked={settings.importMode === 'copy'}
          >
            <div style={radioBtn(settings.importMode === 'copy')} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Copy files into library</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Files are duplicated into the managed library. Safe and portable — the library is self-contained.
              </div>
            </div>
          </div>
          <div
            style={rowLast}
            onClick={() => setMode('reference')}
            role="radio"
            aria-checked={settings.importMode === 'reference'}
          >
            <div style={radioBtn(settings.importMode === 'reference')} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Reference files in place</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Original files are not copied. No extra disk usage, but the app depends on files staying at their current paths.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Copy mode: library location */}
      {settings.importMode === 'copy' && (
        <div style={section}>
          <div style={sectionLabel}>Library location</div>
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
      )}

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

      {/* Reference mode: watched folders */}
      {settings.importMode === 'reference' && (
        <div style={section}>
          <div style={sectionLabel}>Watched folders</div>
          <div style={card}>
            {settings.watchedFolders.length === 0 ? (
              <div style={{ ...rowLast, color: 'var(--text-3)', fontStyle: 'italic' }}>
                No folders added yet.
              </div>
            ) : (
              settings.watchedFolders.map((folder, i) => {
                const isLast = i === settings.watchedFolders.length - 1
                const health = pathHealth[folder]
                return (
                  <div key={folder} style={isLast ? rowLast : row}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: pathColor(folder) }}>
                        {folder}
                      </span>
                      {health && !health.exists && health.foundRatio === null && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)' }}>— folder not found</span>
                      )}
                      {health?.foundRatio !== null && health?.foundRatio !== undefined && health.foundRatio < 1 && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: health.foundRatio === 0 ? 'var(--text-4)' : '#d97706' }}>
                          — {health.foundRatio === 0 ? 'no files found' : `${Math.round(health.foundRatio * 100)}% of files found`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {needsResolve(folder) && (
                        <button
                          style={btn('default')}
                          onClick={() => resolveWatchedFolder(folder)}
                          disabled={resolving === folder}
                        >
                          {resolving === folder ? 'Resolving…' : 'Resolve…'}
                        </button>
                      )}
                      <button style={btn('danger')} onClick={() => removeWatchedFolder(folder)}>
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })
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
      )}
    </div>
  )
}
