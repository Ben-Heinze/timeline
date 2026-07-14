import fs from 'fs/promises'
import path from 'path'
import { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { getSettings } from '../settings'
import { getFilesPath, isPathUnder } from '../library'
import {
  getAllEntriesWithFilePaths,
  markEntriesMissing,
  markEntriesFound,
  findDuplicatesByHash,
  findDuplicatesByNameSize,
} from '../db/queries/entries'
import { ingestFiles, backfillGps } from '../ingest'
import { refreshVolumes } from '../volumes'
import { resolveEntryAbsolutePath } from '../volumes/paths'
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
    // Refresh which removable volumes are currently connected before anything
    // else, so the missing-check and dedup logic below see current state.
    await refreshVolumes()

    const settings = getSettings()
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
      const absPath = resolveEntryAbsolutePath(entry)

      // A null path for a volume-backed entry means its drive isn't
      // currently connected — not reachable to check, and importantly
      // not "missing" either (that's reserved for files actually gone
      // from a volume that IS connected).
      if (absPath == null) {
        onProgress({
          phase: 'checking',
          checked: i + 1,
          missing: missingIds.length,
          recovered: recoveredIds.length,
          found: 0,
          ingested: 0,
          total: entries.length,
          current: entry.title ?? '',
        })
        continue
      }

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

    // Backfill GPS coordinates for photos imported before location support
    await backfillGps()

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

    // Entries on a currently-disconnected volume resolve to null and are
    // simply omitted — safe, since their source folder isn't reachable to
    // scan anyway while the drive is unplugged.
    const existingAbsPaths = new Set(
      entries
        .map(e => resolveEntryAbsolutePath(e))
        .filter((p): p is string => p != null)
    )

    const newLibraryFiles: string[] = []
    await scanFolder(getFilesPath(), existingAbsPaths, newLibraryFiles)

    // Scanned per-folder (not flattened) since different watched folders can
    // be on different volumes and each needs its own volumeId at ingest time.
    const newWatchedByFolder: { volumeId: number | null; files: string[] }[] = []
    for (const folder of settings.watchedFolders) {
      const files: string[] = []
      await scanFolder(folder.path, existingAbsPaths, files)
      if (files.length > 0) newWatchedByFolder.push({ volumeId: folder.volumeId, files })
    }

    const newFiles = [...newLibraryFiles, ...newWatchedByFolder.flatMap(f => f.files)]

    // Phase 3: Ingest new files — copy-mode and each watched folder's
    // reference-mode files are ingested in separate calls since they need
    // different modes/volumeIds, but progress is reported as one phase.
    let ingested = 0
    const reportIngest = (progress: { completed: number; current: string; error?: string }) => {
      onProgress({
        phase: 'ingesting',
        checked: entries.length,
        missing: missingIds.length,
        recovered: recoveredIds.length,
        found: newFiles.length,
        ingested: ingested + progress.completed,
        total: newFiles.length,
        current: progress.current,
        error: progress.error,
      })
    }
    if (newLibraryFiles.length > 0) {
      await ingestFiles(newLibraryFiles, 'copy', null, reportIngest)
      ingested += newLibraryFiles.length
    }
    for (const { volumeId, files } of newWatchedByFolder) {
      await ingestFiles(files, 'reference', volumeId, reportIngest)
      ingested += files.length
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
  const dirs = [getFilesPath(), ...settings.watchedFolders.map(f => f.path)]

  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent: true,
    depth: 99,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 500 },
  })

  watcher.on('add', async (filePath) => {
    const wins = BrowserWindow.getAllWindows()
    let mode: 'copy' | 'reference' = 'copy'
    let volumeId: number | null = null
    if (!isPathUnder(getFilesPath(), filePath)) {
      mode = 'reference'
      const folder = settings.watchedFolders
        .filter(f => isPathUnder(f.path, filePath))
        .sort((a, b) => b.path.length - a.path.length)[0]
      volumeId = folder?.volumeId ?? null
    }
    // Ingest silently: emitting ingest:progress here would fight with the
    // import banner (each file the importer copies into the library re-fires
    // this handler as a 1-file "import").
    await ingestFiles([filePath], mode, volumeId, () => {})
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
