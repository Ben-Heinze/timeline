import { ipcMain } from 'electron'
import path from 'path'
import { promises as fs } from 'fs'
import * as q from '../db/queries/shelf'
import { ingestFiles } from '../ingest'
import { startWatcher, stopWatcher } from '../sync'
import {
  moveEntriesIntoShelf,
  renameCategoryFolder,
  rmdirIfEmpty,
  sanitizeCategoryFolderName,
  shelfRootDir,
} from '../shelf/files'
import { writeImportErrorLog } from './ingest'
import type { IngestDoneEvent, ShelfImportResult, ShelfKind, ShelfMoveResult } from '../../shared/types'

function friendlyConstraintError(err: unknown, name: string): Error {
  const msg = (err as Error).message ?? String(err)
  if (msg.includes('UNIQUE constraint failed')) {
    return new Error(`A category like "${name}" already exists on this shelf`)
  }
  return err as Error
}

export function registerShelfHandlers(): void {
  ipcMain.handle('shelf:listCategories', (_, kind: ShelfKind) => q.listCategories(kind))

  ipcMain.handle('shelf:createCategory', async (_, kind: ShelfKind, name: string) => {
    const folderName = sanitizeCategoryFolderName(name)
    let category
    try {
      category = q.createCategory(kind, name, folderName)
    } catch (err) {
      throw friendlyConstraintError(err, name)
    }
    await fs.mkdir(path.join(shelfRootDir(kind), folderName), { recursive: true })
    return category
  })

  ipcMain.handle('shelf:renameCategory', async (_, id: number, name: string) => {
    const category = q.getCategory(id)
    if (!category) throw new Error('Unknown category')
    const newFolderName = sanitizeCategoryFolderName(name)

    if (newFolderName === category.folder_name) {
      // Display-only rename (e.g. "math" → "Math") — no disk work.
      try {
        return q.renameCategory(id, name, category.folder_name)
      } catch (err) {
        throw friendlyConstraintError(err, name)
      }
    }

    stopWatcher()
    try {
      const { needsPerFileMove } = await renameCategoryFolder(category.kind, category.folder_name, newFolderName)
      let renamed
      try {
        renamed = q.renameCategory(id, name, newFolderName)
      } catch (err) {
        // DB rejected the new name after the folder was already renamed — put
        // the folder back so disk and DB stay in step.
        await renameCategoryFolder(category.kind, newFolderName, category.folder_name).catch(() => {})
        throw friendlyConstraintError(err, name)
      }
      if (needsPerFileMove) {
        // Target folder already existed: relocate this category's files into it.
        await moveEntriesIntoShelf(q.listItemIdsInCategory(id), category.kind, renamed)
        await rmdirIfEmpty(path.join(shelfRootDir(category.kind), category.folder_name))
      }
      return renamed
    } finally {
      startWatcher()
    }
  })

  ipcMain.handle('shelf:deleteCategory', async (_, id: number): Promise<ShelfMoveResult> => {
    const category = q.getCategory(id)
    if (!category) throw new Error('Unknown category')
    const itemIds = q.listItemIdsInCategory(id)
    stopWatcher()
    try {
      // Items become uncategorized, so their files belong at the shelf root.
      const move = await moveEntriesIntoShelf(itemIds, category.kind, null)
      q.deleteCategory(id) // FK sets items' category_id to NULL
      await rmdirIfEmpty(path.join(shelfRootDir(category.kind), category.folder_name))
      return { marked: itemIds.length, ...move }
    } finally {
      startWatcher()
    }
  })

  ipcMain.handle('shelf:listEntries', (_, kind: ShelfKind, filter: q.ShelfEntryFilter) =>
    q.listShelfEntries(kind, filter))

  ipcMain.handle('shelf:forEntries', (_, entryIds: number[]) => q.getShelfInfoForEntries(entryIds))

  ipcMain.handle('shelf:markEntries', async (_, entryIds: number[], kind: ShelfKind, categoryId: number | null): Promise<ShelfMoveResult> => {
    const category = categoryId != null ? q.getCategory(categoryId) : null
    if (categoryId != null && (!category || category.kind !== kind)) throw new Error('Unknown category')
    // Metadata first: the shelf row is the source of truth; the file move
    // mirrors it and can be retried by re-applying the category.
    q.upsertShelfItems(entryIds, kind, category?.id ?? null)
    stopWatcher()
    try {
      const move = await moveEntriesIntoShelf(entryIds, kind, category)
      return { marked: entryIds.length, ...move }
    } finally {
      startWatcher()
    }
  })

  ipcMain.handle('shelf:unmarkEntries', (_, entryIds: number[]) => {
    // DB-only by design: unmarking never moves files back.
    q.unmarkEntries(entryIds)
  })

  // One-time (but idempotent — safe to run again) indexing of the pre-existing
  // files/books/ folder: registers its files in place, adopts its subfolders
  // as categories, and marks everything as books. Never copies, moves, or
  // renames anything on disk.
  ipcMain.handle('shelf:importBooksFolder', async (event): Promise<ShelfImportResult> => {
    const sender = event.sender
    const send = (channel: string, data: unknown) => {
      if (!sender.isDestroyed()) sender.send(channel, data)
    }

    const booksRoot = shelfRootDir('book')
    const result: ShelfImportResult = { indexed: 0, alreadyIndexed: 0, marked: 0, categoriesCreated: 0, failures: [] }

    let rootEntries
    try {
      rootEntries = await fs.readdir(booksRoot, { withFileTypes: true })
    } catch {
      return result // no books folder — nothing to do
    }

    // Adopt each immediate subfolder as a category, on-disk name verbatim.
    const existingFolders = new Set(q.listCategories('book').map(c => c.folder_name))
    const categoryByFolder = new Map<string, number>()
    const filePaths: string[] = []
    const walk = async (dir: string) => {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        if (d.name.startsWith('.')) continue
        const full = path.join(dir, d.name)
        if (d.isDirectory()) await walk(full)
        else if (d.isFile()) filePaths.push(full)
      }
    }
    for (const d of rootEntries) {
      if (d.name.startsWith('.')) continue
      const full = path.join(booksRoot, d.name)
      if (d.isDirectory()) {
        const category = q.findOrCreateCategoryByFolder('book', d.name)
        categoryByFolder.set(d.name, category.id)
        if (!existingFolders.has(d.name)) result.categoriesCreated++
        await walk(full)
      } else if (d.isFile()) {
        filePaths.push(full)
      }
    }

    // Index in place. Files are individual paths (not the folder), so no
    // groups are created; the already-in-library branch of ingest registers
    // them without copying, and hash dedupe skips anything already indexed.
    stopWatcher()
    try {
      const { insertedIds, failures, total } = await ingestFiles(filePaths, 'copy', null, progress => {
        send('ingest:progress', progress)
      })
      result.indexed = insertedIds.length
      result.alreadyIndexed = total - insertedIds.length - failures.length
      result.failures = failures
      if (total > 0) {
        const logPath = failures.length > 0 ? await writeImportErrorLog(failures) : null
        const done: IngestDoneEvent = { total, imported: total - failures.length, failures, logPath }
        send('ingest:done', done)
      }
    } finally {
      startWatcher()
    }

    // Marking pass, path-based rather than insertedIds-based so re-runs also
    // catch files skipped by dedupe — without ever clobbering a category the
    // user has since changed by hand (INSERT OR IGNORE).
    const prefix = 'files/books/'
    const byCategory = new Map<number | null, number[]>()
    for (const row of q.listCopyEntryPathsUnder(prefix)) {
      if (!row.file_path.startsWith(prefix)) continue
      const parts = row.file_path.split('/')
      const categoryId = parts.length >= 4 ? (categoryByFolder.get(parts[2]) ?? null) : null
      const bucket = byCategory.get(categoryId) ?? []
      bucket.push(row.id)
      byCategory.set(categoryId, bucket)
    }
    for (const [categoryId, ids] of byCategory) {
      result.marked += q.markIfUnmarked(ids, 'book', categoryId)
    }

    return result
  })
}
