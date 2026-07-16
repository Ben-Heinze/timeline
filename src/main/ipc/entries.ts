import fs from 'fs/promises'
import path from 'path'
import { ipcMain, shell } from 'electron'
import * as q from '../db/queries/entries'
import { getLibraryPath } from '../library'
import { resolveEntryAbsolutePath } from '../volumes/paths'
import { computeFileHash, rescanLibrary } from '../ingest'
import { writePhotoDate } from '../exif'
import type { SetDateParams, SetDateResult, RescanResult } from '../../shared/types'

export function registerEntryHandlers(): void {
  ipcMain.handle('entries:histogram', (_, from, to, zoomLevel, groupId) =>
    q.getHistogram(from, to, zoomLevel, groupId ?? undefined))
  ipcMain.handle('entries:forDay', (_, dateMs) =>
    q.getEntriesForDay(dateMs))
  ipcMain.handle('entries:forPeriod', (_, from, to, groupId) =>
    q.getEntriesForPeriod(from, to, groupId ?? undefined))
  ipcMain.handle('entries:extent', () =>
    q.getDataExtent())
  ipcMain.handle('entries:locations', () =>
    q.getEntriesWithLocation())
  ipcMain.handle('entries:search', (_, filters, page) =>
    q.searchEntries(filters ?? {}, page))
  ipcMain.handle('entries:searchCount', (_, filters) =>
    q.countSearchResults(filters ?? {}))
  ipcMain.handle('entries:listAll', (_, opts) =>
    q.listAllEntries(opts))
  ipcMain.handle('entries:listAllCount', (_, opts) =>
    q.countAllEntries(opts ?? {}))
  ipcMain.handle('entries:monthBuckets', (_, opts) =>
    q.getMonthBuckets(opts))
  ipcMain.handle('entries:get', (_, id) =>
    q.getEntry(id))
  ipcMain.handle('entries:update', (_, id, patch) =>
    q.updateEntry(id, patch))

  ipcMain.handle('entries:setDate', async (_, params: SetDateParams): Promise<SetDateResult> => {
    const { ids, mode, value, writeExif } = params

    // 1. Update the in-app date for every selected entry.
    if (mode === 'set') q.setEntriesTimestamp(ids, value)
    else q.shiftEntriesTimestamp(ids, value)

    const result: SetDateResult = { updated: ids.length, exifWritten: 0, exifSkipped: 0, exifFailed: 0 }
    if (!writeExif) return result

    // 2. Best-effort write of the new date back into the file's metadata.
    //    Only copy-mode photos/videos the app owns are touched; referenced
    //    originals and anything unreachable are left alone.
    for (const id of ids) {
      const entry = q.getEntry(id)
      const writable = entry
        && (entry.type === 'photo' || entry.type === 'video')
        && entry.import_mode === 'copy'
        && !entry.is_missing
      const abs = writable ? resolveEntryAbsolutePath(entry) : null
      if (!abs) { result.exifSkipped++; continue }
      try {
        await writePhotoDate(abs, entry!.timestamp)
        // Rewriting the file changes its bytes; keep the dedupe hash accurate.
        const hash = await computeFileHash(abs)
        q.updateEntry(id, { content_hash: hash })
        result.exifWritten++
      } catch {
        result.exifFailed++
      }
    }
    return result
  })

  ipcMain.handle('library:rescan', async (event): Promise<RescanResult> => {
    const sender = event.sender
    return rescanLibrary(evt => {
      if (!sender.isDestroyed()) sender.send('library:rescanProgress', evt)
    })
  })

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
      // Copy-mode files live inside the library; move them to the OS trash so the
      // user can recover them. Reference-mode entries point at the user's original
      // file, which we never touch.
      if (entry!.import_mode === 'copy' && entry!.file_path) {
        try { await shell.trashItem(path.join(libraryPath, entry!.file_path)) } catch {}
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
      volume_id: null,
      latitude: null,
      longitude: null,
      gps_scanned: 0,
      created_at: Date.now(),
    }))
}
