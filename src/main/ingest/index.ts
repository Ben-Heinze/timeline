import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import exifr from 'exifr'
import { getFilesPath, getLibraryPath, getThumbnailPath } from '../library'
import { insertEntry, findEntryByHash, updateEntry, getUnscannedGpsPhotos } from '../db/queries/entries'
import { findOrCreateGroupPath } from '../db/queries/groups'
import { getSettings } from '../settings'
import type { Entry, EntryType, IngestProgressEvent, IngestFailure } from '../../shared/types'

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif',
  '.bmp', '.heic', '.heif', '.avif', '.svg',
])
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg',
])
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus',
])

export function detectType(ext: string): EntryType {
  const e = ext.toLowerCase()
  if (IMAGE_EXTS.has(e)) return 'photo'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  return 'document'
}

async function computeFileHash(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(65536)
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

export async function extractExifTimestamp(sourcePath: string): Promise<number | null> {
  try {
    const data = await exifr.parse(sourcePath, ['DateTimeOriginal', 'CreateDate'])
    const date: unknown = data?.DateTimeOriginal ?? data?.CreateDate
    if (date instanceof Date && !isNaN(date.getTime())) return date.getTime()
    return null
  } catch {
    return null
  }
}

export async function extractExifGps(sourcePath: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const gps = await exifr.gps(sourcePath)
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)
        && (gps.latitude !== 0 || gps.longitude !== 0)) {
      return { latitude: gps.latitude, longitude: gps.longitude }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Re-attach a file to an entry whose file went missing (e.g. after restoring
 * a metadata-only backup). Keeps the entry's metadata, tags and thumbnails.
 */
async function relinkEntry(entry: Entry, sourcePath: string, relDir: string, fileName: string): Promise<void> {
  let storedFilePath: string
  if (entry.import_mode === 'reference') {
    storedFilePath = sourcePath
  } else {
    const relToFiles = path.relative(getFilesPath(), sourcePath)
    const alreadyInLibrary = !relToFiles.startsWith('..') && !path.isAbsolute(relToFiles)
    if (alreadyInLibrary) {
      storedFilePath = path.relative(getLibraryPath(), sourcePath).split(path.sep).join('/')
    } else {
      const destDir = path.join(getFilesPath(), relDir)
      await fs.mkdir(destDir, { recursive: true })
      const destName = await copyWithUniqueName(sourcePath, destDir, fileName)
      storedFilePath = path.join('files', relDir, destName).split(path.sep).join('/')
    }
  }
  updateEntry(entry.id, { file_path: storedFilePath, is_missing: 0 })
}

async function generateImageThumbnails(
  sourcePath: string,
  baseName: string,
): Promise<{ small: string; medium: string; large: string } | null> {
  const sizes: Array<['small' | 'medium' | 'large', number]> = [
    ['small', 128],
    ['medium', 256],
    ['large', 512],
  ]
  try {
    const out = { small: '', medium: '', large: '' }
    for (const [size, dim] of sizes) {
      const fileName = `${baseName}.webp`
      const outPath = path.join(getThumbnailPath(size), fileName)
      await sharp(sourcePath)
        .rotate()
        .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outPath)
      out[size] = `thumbnails/${size}/${fileName}`
    }
    return out
  } catch {
    return null
  }
}

/**
 * Copy into destDir keeping the original name, appending " (2)", " (3)", …
 * on collision. COPYFILE_EXCL makes the claim atomic, so concurrent ingest
 * workers copying identically-named files can't overwrite each other.
 */
async function copyWithUniqueName(sourcePath: string, destDir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName)
  const stem = path.basename(fileName, ext)
  for (let n = 1; ; n++) {
    const destName = n === 1 ? fileName : `${stem} (${n})${ext}`
    try {
      await fs.copyFile(sourcePath, path.join(destDir, destName), fs.constants.COPYFILE_EXCL)
      return destName
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

interface OneResult {
  ok: boolean
  id?: number
  skipped?: boolean
  error?: string
}

// Hashes being ingested right now but not yet inserted. The folder watcher
// fires for every file the importer copies into the library, often before the
// original's row exists — without this guard that race inserts duplicates.
const inFlightHashes = new Set<string>()

async function ingestOne(sourcePath: string, relDir: string, groupPath: string[]): Promise<OneResult> {
  const fileName = path.basename(sourcePath)
  const ext = path.extname(fileName)
  const type = detectType(ext)

  const contentHash = await computeFileHash(sourcePath)
  const existing = findEntryByHash(contentHash)
  if (existing) {
    if (existing.is_missing && existing.file_path) {
      await relinkEntry(existing, sourcePath, relDir, fileName)
    }
    return { ok: true, skipped: true }
  }
  if (inFlightHashes.has(contentHash)) return { ok: true, skipped: true }
  inFlightHashes.add(contentHash)

  try {
    // Group creation happens after the duplicate check, so re-importing an
    // already-ingested folder doesn't leave behind empty groups
    const groupId = groupPath.length > 0 ? findOrCreateGroupPath(groupPath) : null

    // Thumbnails are keyed by a unique stem, independent of the stored file name
    const baseName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`

    const settings = getSettings()
    const isReference = settings.importMode === 'reference'
    let storedFilePath: string

    if (isReference) {
      storedFilePath = sourcePath
    } else {
      const relToFiles = path.relative(getFilesPath(), sourcePath)
      const alreadyInLibrary = !relToFiles.startsWith('..') && !path.isAbsolute(relToFiles)
      if (alreadyInLibrary) {
        // A file already inside the library must be registered in place —
        // copying it again would trigger the watcher and loop forever
        storedFilePath = path.relative(getLibraryPath(), sourcePath).split(path.sep).join('/')
      } else {
        const destDir = path.join(getFilesPath(), relDir)
        await fs.mkdir(destDir, { recursive: true })
        const destName = await copyWithUniqueName(sourcePath, destDir, fileName)
        storedFilePath = path.join('files', relDir, destName).split(path.sep).join('/')
      }
    }

    const stat = await fs.stat(sourcePath)
    let timestamp = stat.mtime.getTime() || Date.now()
    let needsDateReview = 1

    let thumb: { small: string; medium: string; large: string } | null = null
    let gps: { latitude: number; longitude: number } | null = null
    if (type === 'photo' && ext.toLowerCase() !== '.svg') {
      const exifTimestamp = await extractExifTimestamp(sourcePath)
      if (exifTimestamp !== null) {
        timestamp = exifTimestamp
        needsDateReview = 0
      }
      gps = await extractExifGps(sourcePath)
      thumb = await generateImageThumbnails(sourcePath, baseName)
    }

    const id = insertEntry({
      type,
      timestamp,
      title: fileName,
      file_path: storedFilePath,
      thumbnail_small: thumb?.small ?? null,
      thumbnail_medium: thumb?.medium ?? null,
      thumbnail_large: thumb?.large ?? null,
      duration_seconds: null,
      rich_text_json: null,
      group_id: groupId,
      needs_date_review: needsDateReview,
      is_missing: 0,
      content_hash: contentHash,
      import_mode: isReference ? 'reference' : 'copy',
      latitude: gps?.latitude ?? null,
      longitude: gps?.longitude ?? null,
      gps_scanned: 1,
      created_at: Date.now(),
    })

    return { ok: true, id }
  } finally {
    inFlightHashes.delete(contentHash)
  }
}

/**
 * Scan photos imported before GPS support for EXIF coordinates. Each photo is
 * checked once (gps_scanned marks it done, found or not), so repeat syncs skip
 * already-scanned files.
 */
export async function backfillGps(): Promise<number> {
  const photos = getUnscannedGpsPhotos()
  let found = 0
  for (const entry of photos) {
    const absPath = entry.import_mode === 'reference'
      ? entry.file_path!
      : path.join(getLibraryPath(), entry.file_path!)
    const gps = await extractExifGps(absPath)
    if (gps) {
      updateEntry(entry.id, { latitude: gps.latitude, longitude: gps.longitude, gps_scanned: 1 })
      found++
    } else {
      updateEntry(entry.id, { gps_scanned: 1 })
    }
  }
  return found
}

interface PendingFile {
  filePath: string
  relDir: string
  groupPath: string[]  // folder names from the imported root down; [] = don't group
}

async function walkDir(root: string, rootName: string, dir: string, out: PendingFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDir(root, rootName, full, out)
    } else if (entry.isFile()) {
      const relDir = path.relative(root, dir)
      const groupPath = relDir === '' ? [rootName] : [rootName, ...relDir.split(path.sep)]
      out.push({ filePath: full, relDir, groupPath })
    }
  }
}

export async function expandPaths(inputPaths: string[]): Promise<PendingFile[]> {
  const out: PendingFile[] = []
  for (const p of inputPaths) {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) {
      await walkDir(p, path.basename(p), p, out)
    } else {
      out.push({ filePath: p, relDir: '', groupPath: [] })
    }
  }
  return out
}

const CONCURRENCY = 4

export interface IngestResult {
  insertedIds: number[]
  failures: IngestFailure[]
  total: number
}

export async function ingestFiles(
  filePaths: string[],
  onProgress: (event: IngestProgressEvent) => void,
): Promise<IngestResult> {
  const files = await expandPaths(filePaths)
  const total = files.length
  if (total === 0) return { insertedIds: [], failures: [], total: 0 }

  let nextIndex = 0
  let completed = 0
  const insertedIds: number[] = []
  const failures: IngestFailure[] = []

  onProgress({ total, completed: 0, current: path.basename(files[0].filePath) })

  const worker = async () => {
    while (true) {
      const i = nextIndex++
      if (i >= total) return
      const { filePath: src, relDir, groupPath } = files[i]
      const fileName = path.basename(src)
      let error: string | undefined
      try {
        const result = await ingestOne(src, relDir, groupPath)
        if (result.id != null) insertedIds.push(result.id)
      } catch (e) {
        error = (e as Error).message ?? String(e)
        failures.push({ file: src, error })
      }
      completed++
      onProgress({ total, completed, current: fileName, error })
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, worker)
  await Promise.all(workers)
  return { insertedIds, failures, total }
}
