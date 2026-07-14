import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getSettings, saveSettings } from '../settings'
import { getFilesPath, getLibraryPath, ensureLibraryDirs } from '../library'
import { closeDb } from '../db'
import { restartWatcher } from '../sync'
import {
  getEntriesWithFilePathPrefix,
  getAllEntriesWithFilePaths,
  markEntriesMissing,
  markEntriesFound,
  updateEntry,
} from '../db/queries/entries'
import { generateTestData } from '../testdata'
import type { AppSettings } from '../../shared/types'

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', (_, patch: Partial<Omit<AppSettings, 'libraryPath'>>) => {
    saveSettings({ ...getSettings(), ...patch })
    if ('watchedFolders' in patch) restartWatcher()
  })

  ipcMain.handle('settings:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('settings:getLibraryFileCount', async () => {
    try {
      const files = await fs.readdir(getFilesPath())
      return files.length
    } catch {
      return 0
    }
  })

  ipcMain.handle('settings:checkPaths', async () => {
    const s = getSettings()
    const libraryExists = await pathExists(s.libraryPath)
    const watchedFolders = await Promise.all(
      s.watchedFolders.map(async f => ({ path: f.path, exists: await pathExists(f.path) }))
    )
    return { libraryExists, watchedFolders }
  })

  // Resolve a watched-folder path: re-link entries from oldPath to newPath prefix.
  ipcMain.handle('settings:resolveWatchedFolder', async (_, oldPath: string, newPath: string) => {
    const entries = getEntriesWithFilePathPrefix(oldPath)
    const foundIds: number[] = []
    const missingIds: number[] = []

    for (const entry of entries) {
      const relPart = entry.file_path!.slice(oldPath.length)
      const newFilePath = path.join(newPath, relPart)
      const exists = await pathExists(newFilePath)
      updateEntry(entry.id, { file_path: newFilePath })
      if (exists) foundIds.push(entry.id)
      else missingIds.push(entry.id)
    }

    if (foundIds.length > 0) markEntriesFound(foundIds)
    if (missingIds.length > 0) markEntriesMissing(missingIds)

    const s = getSettings()
    saveSettings({
      ...s,
      watchedFolders: s.watchedFolders.map(f => f.path === oldPath ? { ...f, path: newPath } : f),
    })
    restartWatcher()

    return { found: foundIds.length, total: entries.length }
  })

  // Relocate the library folder without moving files (library was moved externally).
  ipcMain.handle('settings:relocateLibrary', async (_, newPath: string) => {
    const entries = getAllEntriesWithFilePaths().filter(e => e.import_mode === 'copy')
    const foundIds: number[] = []
    const missingIds: number[] = []

    for (const entry of entries) {
      const absPath = path.join(newPath, entry.file_path!)
      const exists = await pathExists(absPath)
      if (exists) foundIds.push(entry.id)
      else missingIds.push(entry.id)
    }

    if (foundIds.length > 0) markEntriesFound(foundIds)
    if (missingIds.length > 0) markEntriesMissing(missingIds)

    const s = getSettings()
    saveSettings({ ...s, libraryPath: newPath })
    ensureLibraryDirs()
    restartWatcher()

    return { found: foundIds.length, total: entries.length }
  })

  ipcMain.handle('settings:generateTestData', () => generateTestData())

  ipcMain.handle('settings:resetLibrary', async () => {
    closeDb()
    const libPath = getLibraryPath()

    await fs.rm(path.join(libPath, 'timeline.db'), { force: true })
    await fs.rm(path.join(libPath, 'timeline.db-wal'), { force: true })
    await fs.rm(path.join(libPath, 'timeline.db-shm'), { force: true })
    await fs.rm(getFilesPath(), { recursive: true, force: true })
    await fs.rm(path.join(libPath, 'thumbnails'), { recursive: true, force: true })

    ensureLibraryDirs()
    restartWatcher()
    return { success: true }
  })

  ipcMain.handle('settings:migrateLibrary', async (_, newPath: string) => {
    const current = getSettings()
    const oldPath = current.libraryPath
    if (oldPath === newPath) return { success: true }

    closeDb()

    try {
      await fs.rename(oldPath, newPath)
    } catch (e: any) {
      if (e.code === 'EXDEV') {
        // Cross-device move: copy then delete
        await fs.cp(oldPath, newPath, { recursive: true })
        await fs.rm(oldPath, { recursive: true, force: true })
      } else {
        throw e
      }
    }

    saveSettings({ ...current, libraryPath: newPath })
    ensureLibraryDirs()
    return { success: true }
  })
}
