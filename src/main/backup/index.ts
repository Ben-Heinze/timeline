import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import archiver from 'archiver'
import extractZip from 'extract-zip'
import { getDb, closeDb } from '../db'
import { getLibraryPath, ensureLibraryDirs } from '../library'
import { invalidateSettingsCache } from '../settings'
import { addExistingProfile, switchProfile } from '../profiles'
import { stopWatcher, startWatcher, isCurrentlySyncing } from '../sync'
import { getAllEntriesWithFilePaths, markEntriesMissing, markEntriesFound } from '../db/queries/entries'
import type { BackupExportType, BackupManifest, BackupProgressEvent } from '../../shared/types'

const MANIFEST_FORMAT = 'timeline-backup'
const FORMAT_VERSION = 1

// Extensions that are already compressed — archiving them with deflate wastes
// time for near-zero size gain, so they are stored raw in the zip.
const STORED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg',
  '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus',
  '.zip', '.gz', '.7z', '.rar', '.docx', '.xlsx', '.pptx', '.pdf',
])

interface ZipEntry {
  abs: string
  rel: string // forward-slash path inside the zip
}

async function walkForZip(root: string, zipPrefix: string, out: ZipEntry[]): Promise<void> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of dirents) {
    const abs = path.join(root, d.name)
    const rel = `${zipPrefix}/${d.name}`
    if (d.isDirectory()) await walkForZip(abs, rel, out)
    else if (d.isFile()) out.push({ abs, rel })
  }
}

export interface ExportSummary {
  entries: number
  filesIncluded: number
  skippedReferences: string[]
}

export async function exportBackup(
  destZip: string,
  type: BackupExportType,
  onProgress: (e: BackupProgressEvent) => void,
): Promise<ExportSummary> {
  if (isCurrentlySyncing()) {
    throw new Error('A library sync is in progress — wait for it to finish before exporting.')
  }

  const libraryPath = getLibraryPath()
  const tmpDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'timeline-export-'))
  stopWatcher()

  try {
    onProgress({ phase: 'preparing', completed: 0, total: 0, current: 'Snapshotting database…' })

    // Consistent point-in-time copy of the DB (safe against WAL checkpoints,
    // unlike copying the live file).
    const snapshotPath = path.join(tmpDir, 'timeline.db')
    await getDb().backup(snapshotPath)

    const snap = new Database(snapshotPath)
    let referencedFiles: ZipEntry[] = []
    const skippedReferences: string[] = []

    try {
      if (type === 'full') {
        // Materialize reference-mode entries: their files live outside the
        // library, so they are copied into the archive and rewritten to copy
        // mode — otherwise the backup would silently omit them.
        const refs = snap
          .prepare(`SELECT id, file_path FROM entries WHERE import_mode = 'reference' AND file_path IS NOT NULL`)
          .all() as { id: number; file_path: string }[]
        const rewrite = snap.prepare(
          `UPDATE entries SET file_path = ?, import_mode = 'copy' WHERE id = ?`
        )
        for (const ref of refs) {
          try {
            await fs.access(ref.file_path)
          } catch {
            skippedReferences.push(ref.file_path)
            continue
          }
          const rel = `files/referenced/${ref.id}_${path.basename(ref.file_path)}`
          rewrite.run(rel, ref.id)
          referencedFiles.push({ abs: ref.file_path, rel })
        }
      }

      const count = (table: string) =>
        (snap.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
      const manifest: BackupManifest = {
        format: MANIFEST_FORMAT,
        formatVersion: FORMAT_VERSION,
        exportType: type,
        appVersion: app.getVersion(),
        exportedAt: Date.now(),
        includesFiles: type === 'full',
        counts: {
          entries: count('entries'),
          groups: count('groups'),
          tags: count('tags'),
          events: count('events'),
        },
      }
      await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

      // The restore uses the SQLite snapshot as the single source of truth — it
      // holds every table (entries, groups, people/animals, events, tags, volumes,
      // Spotify listening…), so there is no separate metadata dump to keep in sync.
      const zipEntries: ZipEntry[] = [
        { abs: path.join(tmpDir, 'manifest.json'), rel: 'manifest.json' },
        { abs: snapshotPath, rel: 'timeline.db' },
      ]
      // The library's own preferences (theme, layout, watched folders, map mode)
      // travel with it, so a restored Timeline looks and behaves the same.
      const settingsAbs = path.join(libraryPath, 'settings.json')
      try {
        await fs.access(settingsAbs)
        zipEntries.push({ abs: settingsAbs, rel: 'settings.json' })
      } catch { /* no per-library settings yet — nothing to carry */ }
      const controlFileCount = zipEntries.length   // manifest, db, (settings)
      await walkForZip(path.join(libraryPath, 'thumbnails'), 'thumbnails', zipEntries)
      if (type === 'full') {
        await walkForZip(path.join(libraryPath, 'files'), 'files', zipEntries)
        await walkForZip(path.join(libraryPath, 'spotify'), 'spotify', zipEntries)
        zipEntries.push(...referencedFiles)
      }

      await writeZip(destZip, zipEntries, onProgress)

      onProgress({ phase: 'done', completed: zipEntries.length, total: zipEntries.length, current: '' })
      return {
        entries: manifest.counts.entries,
        filesIncluded: type === 'full' ? zipEntries.length - controlFileCount : 0,
        skippedReferences,
      }
    } finally {
      snap.close()
    }
  } catch (err) {
    // Don't leave a truncated archive behind on failure
    await fs.rm(destZip, { force: true }).catch(() => {})
    throw err
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    startWatcher()
  }
}

function writeZip(
  destZip: string,
  entries: ZipEntry[],
  onProgress: (e: BackupProgressEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZip)
    const archive = archiver('zip', { zlib: { level: 6 } })
    let completed = 0

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      // ENOENT here means a file vanished between listing and archiving
      if ((err as { code?: string }).code !== 'ENOENT') reject(err)
    })
    archive.on('entry', (entry) => {
      completed++
      onProgress({ phase: 'archiving', completed, total: entries.length, current: entry.name })
    })

    archive.pipe(output)
    for (const e of entries) {
      const store = STORED_EXTS.has(path.extname(e.rel).toLowerCase())
      archive.file(e.abs, { name: e.rel, store } as archiver.EntryData)
    }
    archive.finalize()
  })
}

export interface ImportSummary {
  libraryPath: string
  exportType: BackupExportType
  entries: number
  missingFiles: number
}

export async function importBackup(
  zipPath: string,
  destDir: string,
  onProgress: (e: BackupProgressEvent) => void,
): Promise<ImportSummary> {
  if (isCurrentlySyncing()) {
    throw new Error('A library sync is in progress — wait for it to finish before importing.')
  }

  await fs.mkdir(destDir, { recursive: true })
  if ((await fs.readdir(destDir)).length > 0) {
    throw new Error('The destination folder must be empty.')
  }

  // Extract, then validate. The folder was empty, so on a bad archive
  // everything inside it is ours to delete.
  let extracted = 0
  await extractZip(zipPath, {
    dir: destDir,
    onEntry: (entry, zipfile) => {
      extracted++
      onProgress({ phase: 'extracting', completed: extracted, total: zipfile.entryCount, current: entry.fileName })
    },
  })

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(await fs.readFile(path.join(destDir, 'manifest.json'), 'utf-8'))
    if (manifest.format !== MANIFEST_FORMAT) throw new Error('bad format')
    if (manifest.formatVersion > FORMAT_VERSION) {
      throw new Error('This backup was created by a newer version of the app.')
    }
    await fs.access(path.join(destDir, 'timeline.db'))
  } catch (err) {
    for (const name of await fs.readdir(destDir)) {
      await fs.rm(path.join(destDir, name), { recursive: true, force: true })
    }
    const detail = err instanceof Error && err.message.includes('newer version') ? ` ${err.message}` : ''
    throw new Error(`This file is not a valid Timeline backup archive.${detail}`)
  }

  stopWatcher()
  closeDb()

  // The restored library becomes its own profile and the active one, rather than
  // overwriting the current profile — so importing adds a Timeline instead of
  // replacing the one you were using. Its settings.json (if present in the zip)
  // now lives in destDir, so the reopened settings reflect the restored library.
  const imported = addExistingProfile(path.basename(destDir), destDir)
  switchProfile(imported.id)
  invalidateSettingsCache()
  ensureLibraryDirs()
  getDb() // reopens against the restored DB and applies schema migrations

  // Flag entries whose file isn't present (everything media, for a
  // metadata-only archive) so the UI shows them as missing until the user
  // re-syncs the files, which relinks them by content hash.
  const entries = getAllEntriesWithFilePaths()
  const missingIds: number[] = []
  const foundIds: number[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const abs = entry.import_mode === 'reference'
      ? entry.file_path!
      : path.join(destDir, entry.file_path!)
    try {
      await fs.access(abs)
      foundIds.push(entry.id)
    } catch {
      missingIds.push(entry.id)
    }
    if (i % 50 === 0 || i === entries.length - 1) {
      onProgress({ phase: 'checking', completed: i + 1, total: entries.length, current: path.basename(entry.file_path!) })
    }
  }
  markEntriesFound(foundIds)
  markEntriesMissing(missingIds)

  startWatcher()
  onProgress({ phase: 'done', completed: entries.length, total: entries.length, current: '' })

  return {
    libraryPath: destDir,
    exportType: manifest.exportType,
    entries: manifest.counts.entries,
    missingFiles: missingIds.length,
  }
}
