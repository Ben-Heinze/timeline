import fs from 'fs/promises'
import path from 'path'
import { ipcMain } from 'electron'
import * as q from '../db/queries/entries'
import { getLibraryPath } from '../library'

export function registerEntryHandlers(): void {
  ipcMain.handle('entries:histogram', (_, from, to, zoomLevel, groupId) =>
    q.getHistogram(from, to, zoomLevel, groupId ?? undefined))
  ipcMain.handle('entries:forDay', (_, dateMs) =>
    q.getEntriesForDay(dateMs))
  ipcMain.handle('entries:forPeriod', (_, from, to, groupId) =>
    q.getEntriesForPeriod(from, to, groupId ?? undefined))
  ipcMain.handle('entries:extent', () =>
    q.getDataExtent())
  ipcMain.handle('entries:search', (_, filters) =>
    q.searchEntries(filters ?? {}))
  ipcMain.handle('entries:listAll', (_, opts) =>
    q.listAllEntries(opts))
  ipcMain.handle('entries:get', (_, id) =>
    q.getEntry(id))
  ipcMain.handle('entries:update', (_, id, patch) =>
    q.updateEntry(id, patch))

  ipcMain.handle('entries:delete', async (_, ids: number[]) => {
    const entries = (ids as number[]).map(id => q.getEntry(id)).filter(Boolean)
    q.deleteEntries(ids)

    const libraryPath = getLibraryPath()
    for (const entry of entries) {
      for (const key of ['thumbnail_small', 'thumbnail_medium', 'thumbnail_large'] as const) {
        const rel = entry![key]
        if (!rel) continue
        try { await fs.unlink(path.join(libraryPath, rel)) } catch {}
      }
    }
  })

  ipcMain.handle('entries:create', (_, data) =>
    q.insertEntry({
      type: data.type,
      timestamp: data.timestamp,
      title: data.title ?? null,
      file_path: null,
      thumbnail_small: null, thumbnail_medium: null, thumbnail_large: null,
      duration_seconds: null,
      rich_text_json: data.rich_text_json ?? null,
      group_id: data.group_id ?? null,
      needs_date_review: 0,
      is_missing: 0,
      content_hash: null,
      import_mode: 'copy',
      created_at: Date.now(),
    }))
}
