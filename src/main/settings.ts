import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { getLibraryPath } from './library'
import type { AppSettings, FileViewMode, WatchedFolder } from '../shared/types'

// Preferences now live INSIDE each library folder (<libraryPath>/settings.json)
// so every profile keeps its own theme, layout, watched folders and map mode,
// and so a backup of the library carries its settings with it. `libraryPath`
// itself is NOT stored here — it's derived from the active profile.
const settingsFile = () => path.join(getLibraryPath(), 'settings.json')
// One-time fallback: settings used to live here before per-library settings.
const legacyGlobalFile = () => path.join(app.getPath('userData'), 'settings.json')

let cached: AppSettings | null = null

// Pre-volume-tracking settings.json stored watchedFolders as string[].
function migrateWatchedFolders(raw: unknown): WatchedFolder[] {
  if (!Array.isArray(raw)) return []
  return raw.map(f => (typeof f === 'string' ? { path: f, volumeId: null } : f))
}

function readRawSettings(): (Partial<AppSettings> & { dayViewHeight?: number; dayViewMode?: FileViewMode }) | null {
  // Prefer the per-library file; fall back once to the legacy global file so an
  // upgrading install keeps its existing preferences.
  for (const file of [settingsFile(), legacyGlobalFile()]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch { /* try next */ }
  }
  return null
}

export function getSettings(): AppSettings {
  if (cached) return cached
  const parsed = readRawSettings()
  const base = parsed ?? {}
  cached = {
    // libraryPath is injected from the active profile, never persisted here.
    libraryPath: getLibraryPath(),
    watchedFolders: migrateWatchedFolders(base.watchedFolders),
    duplicateScanMode: base.duplicateScanMode ?? 'hash',
    histogramHeight: base.histogramHeight !== undefined ? base.histogramHeight : 420,
    theme: base.theme ?? 'light',
    heatmapScale: base.heatmapScale ?? 'log',
    heatmapMaxCount: base.heatmapMaxCount ?? null,
    curveTension: base.curveTension ?? 1,
    fileBrowserHeight: base.fileBrowserHeight ?? base.dayViewHeight ?? 240,
    fileBrowserMode: base.fileBrowserMode ?? base.dayViewMode ?? 'medium',
    mapMode: base.mapMode ?? 'offline',
    groupSidebarWidth: base.groupSidebarWidth ?? 220,
    eventsPanelWidth: base.eventsPanelWidth ?? 272,
    spotifyPanelWidth: base.spotifyPanelWidth ?? 272,
    spotifyHistoryCollapsed: base.spotifyHistoryCollapsed ?? false,
  }
  return cached
}

export function saveSettings(settings: AppSettings): void {
  cached = { ...settings, libraryPath: getLibraryPath() }
  // Persist everything except the derived libraryPath into the library folder.
  const { libraryPath: _omit, ...toStore } = settings
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(toStore, null, 2), 'utf-8')
}

/** Drop the in-memory cache so the next read reflects a switched/restored library. */
export function invalidateSettingsCache(): void {
  cached = null
}
