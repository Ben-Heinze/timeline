import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppSettings, FileViewMode } from '../shared/types'

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cached) return cached
  const defaultLibrary = path.join(app.getPath('userData'), 'library')
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8')
    // dayViewHeight/dayViewMode are legacy names from before the file-browser rename
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { dayViewHeight?: number; dayViewMode?: FileViewMode }
    cached = {
      importMode: parsed.importMode ?? 'copy',
      libraryPath: parsed.libraryPath || defaultLibrary,
      watchedFolders: Array.isArray(parsed.watchedFolders) ? parsed.watchedFolders : [],
      duplicateScanMode: parsed.duplicateScanMode ?? 'hash',
      histogramHeight: parsed.histogramHeight !== undefined ? parsed.histogramHeight : 420,
      theme: parsed.theme ?? 'light',
      heatmapScale: parsed.heatmapScale ?? 'log',
      heatmapMaxCount: parsed.heatmapMaxCount ?? null,
      curveTension: parsed.curveTension ?? 1,
      fileBrowserHeight: parsed.fileBrowserHeight ?? parsed.dayViewHeight ?? 240,
      fileBrowserMode: parsed.fileBrowserMode ?? parsed.dayViewMode ?? 'medium',
      mapMode: parsed.mapMode ?? 'offline',
    }
  } catch {
    cached = { importMode: 'copy', libraryPath: defaultLibrary, watchedFolders: [], duplicateScanMode: 'hash', histogramHeight: 420, theme: 'light', heatmapScale: 'log', heatmapMaxCount: null, curveTension: 1, fileBrowserHeight: 240, fileBrowserMode: 'medium', mapMode: 'offline' }
  }
  return cached
}

export function saveSettings(settings: AppSettings): void {
  cached = settings
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
}
