import fs from 'fs/promises'
import path from 'path'
import { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { getSettings } from '../settings'
import { getFilesPath } from '../library'
import {
  getAllEntriesWithFilePaths,
  markEntriesMissing,
  markEntriesFound,
  findDuplicatesByHash,
  findDuplicatesByNameSize,
} from '../db/queries/entries'
import { ingestFiles } from '../ingest'
import type { SyncProgressEvent, DuplicateGroup } from '../../shared/types'

let isSyncing = false
let watcher: ReturnType<typeof chokidar.watch> | null = null

export function isCurrentlySyncing(): boolean {
  return isSyncing
}

export async function runSync(onProgress: (event: SyncProgressEvent) => void): Promise<void> {
  if (isSyncing) return
  isSyncing = true

  try {
    const settings = getSettings()
    const libraryPath = settings.libraryPath
    const entries = getAllEntriesWithFilePaths()

    // Phase 1: Check for missing / recovered files
    const missingIds: number[] = []
    const recoveredIds: number[] = []

    onProgress({
      phase: 'checking', checked: 0, missing: 0, recovered: 0,
      found: 0, ingested: 0, total: entries.length, current: '',
    })

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const absPath = entry.import_mode === 'reference'
        ? entry.file_path!
        : path.join(libraryPath, entry.file_path!)

      let exists = false
      try { await fs.access(absPath); exists = true } catch {}

      if (exists && entry.is_missing) recoveredIds.push(entry.id)
      else if (!exists && !entry.is_missing) missingIds.push(entry.id)

      onProgress({
        phase: 'checking',
        checked: i + 1,
        missing: missingIds.length,
        recovered: recoveredIds.length,
        found: 0,
        ingested: 0,
        total: entries.length,
        current: path.basename(absPath),
      })
    }

    if (missingIds.length > 0) markEntriesMissing(missingIds)
    if (recoveredIds.length > 0) markEntriesFound(recoveredIds)

    // Phase 2: Scan for new files
    onProgress({
      phase: 'scanning',
      checked: entries.length,
      missing: missingIds.length,
      recovered: recoveredIds.length,
      found: 0,
      ingested: 0,
      total: entries.length,
      current: 'Scanning for new files…',
    })

    const foldersToScan = settings.importMode === 'copy'
      ? [getFilesPath()]
      : settings.watchedFolders

    const existingAbsPaths = new Set(
      entries
        .filter(e => e.file_path != null)
        .map(e =>
          e.import_mode === 'reference'
            ? e.file_path!
            : path.join(libraryPath, e.file_path!)
        )
    )

    const newFiles: string[] = []
    for (const folder of foldersToScan) {
      await scanFolder(folder, existingAbsPaths, newFiles)
    }

    // Phase 3: Ingest new files
    if (newFiles.length > 0) {
      await ingestFiles(newFiles, (progress) => {
        onProgress({
          phase: 'ingesting',
          checked: entries.length,
          missing: missingIds.length,
          recovered: recoveredIds.length,
          found: newFiles.length,
          ingested: progress.completed,
          total: newFiles.length,
          current: progress.current,
          error: progress.error,
        })
      })
    }

    onProgress({
      phase: 'done',
      checked: entries.length,
      missing: missingIds.length,
      recovered: recoveredIds.length,
      found: newFiles.length,
      ingested: newFiles.length,
      total: newFiles.length,
      current: '',
    })
  } finally {
    isSyncing = false
  }
}

async function scanFolder(
  dir: string,
  existingPaths: Set<string>,
  newFiles: string[],
): Promise<void> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of dirents) {
    const fullPath = path.join(dir, d.name)
    if (d.isDirectory()) {
      await scanFolder(fullPath, existingPaths, newFiles)
    } else if (d.isFile() && !existingPaths.has(fullPath)) {
      newFiles.push(fullPath)
    }
  }
}

export function scanDuplicates(mode: 'hash' | 'name_size'): DuplicateGroup[] {
  return mode === 'hash' ? findDuplicatesByHash() : findDuplicatesByNameSize()
}

export function startWatcher(): void {
  if (watcher) return
  const settings = getSettings()
  const dirs = settings.importMode === 'copy'
    ? [getFilesPath()]
    : settings.watchedFolders

  if (dirs.length === 0) return

  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent: true,
    depth: 99,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 500 },
  })

  watcher.on('add', async (filePath) => {
    const wins = BrowserWindow.getAllWindows()
    // Ingest silently: emitting ingest:progress here would fight with the
    // import banner (each file the importer copies into the library re-fires
    // this handler as a 1-file "import").
    await ingestFiles([filePath], () => {})
    for (const win of wins) {
      if (!win.webContents.isDestroyed()) win.webContents.send('sync:watcherIngest')
    }
  })
}

export function stopWatcher(): void {
  watcher?.close()
  watcher = null
}

export function restartWatcher(): void {
  stopWatcher()
  startWatcher()
}
