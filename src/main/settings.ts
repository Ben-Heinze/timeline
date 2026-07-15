import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppSettings, FileViewMode, WatchedFolder } from '../shared/types'

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

let cached: AppSettings | null = null

// Pre-volume-tracking settings.json stored watchedFolders as string[].
function migrateWatchedFolders(raw: unknown): WatchedFolder[] {
  if (!Array.isArray(raw)) return []
  return raw.map(f => (typeof f === 'string' ? { path: f, volumeId: null } : f))
}

export function getSettings(): AppSettings {
  if (cached) return cached
  const defaultLibrary = path.join(app.getPath('userData'), 'library')
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8')
    // dayViewHeight/dayViewMode are legacy names from before the file-browser rename
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { dayViewHeight?: number; dayViewMode?: FileViewMode }
    cached = {
      libraryPath: parsed.libraryPath || defaultLibrary,
      watchedFolders: migrateWatchedFolders(parsed.watchedFolders),
      duplicateScanMode: parsed.duplicateScanMode ?? 'hash',
      histogramHeight: parsed.histogramHeight !== undefined ? parsed.histogramHeight : 420,
      theme: parsed.theme ?? 'light',
      heatmapScale: parsed.heatmapScale ?? 'log',
      heatmapMaxCount: parsed.heatmapMaxCount ?? null,
      curveTension: parsed.curveTension ?? 1,
      fileBrowserHeight: parsed.fileBrowserHeight ?? parsed.dayViewHeight ?? 240,
      fileBrowserMode: parsed.fileBrowserMode ?? parsed.dayViewMode ?? 'medium',
      mapMode: parsed.mapMode ?? 'offline',
      groupSidebarWidth: parsed.groupSidebarWidth ?? 220,
      eventsPanelWidth: parsed.eventsPanelWidth ?? 272,
      spotifyPanelWidth: parsed.spotifyPanelWidth ?? 272,
      spotifyHistoryCollapsed: parsed.spotifyHistoryCollapsed ?? false,
    }
  } catch {
    cached = { libraryPath: defaultLibrary, watchedFolders: [], duplicateScanMode: 'hash', histogramHeight: 420, theme: 'light', heatmapScale: 'log', heatmapMaxCount: null, curveTension: 1, fileBrowserHeight: 240, fileBrowserMode: 'medium', mapMode: 'offline', groupSidebarWidth: 220, eventsPanelWidth: 272, spotifyPanelWidth: 272, spotifyHistoryCollapsed: false }
  }
  return cached
}

export function saveSettings(settings: AppSettings): void {
  cached = settings
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
}
