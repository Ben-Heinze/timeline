import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { spawn, spawnSync } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import sharp from 'sharp'
import exifr from 'exifr'
import { getFilesPath, getLibraryPath, getThumbnailPath } from '../library'
import { insertEntry, findEntryByHash, updateEntry, getUnscannedGpsPhotos, getEntriesNeedingBackfill } from '../db/queries/entries'
import { findOrCreateGroupPath } from '../db/queries/groups'
import { getVolumeById } from '../db/queries/volumes'
import { getMountPathForSerial } from '../volumes'
import { resolveEntryAbsolutePath } from '../volumes/paths'
import { extractRawPreview, readRawMetadata, readVideoMetadata } from '../exif'
import type { Entry, EntryType, IngestProgressEvent, IngestFailure, RescanProgressEvent, RescanResult } from '../../shared/types'

/** Current mount path for a volume id, or null if unknown/not connected. */
function mountPathForVolumeId(volumeId: number): string | null {
  const vol = getVolumeById(volumeId)
  return vol ? getMountPathForSerial(vol.volume_serial) : null
}

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif',
  '.bmp', '.heic', '.heif', '.avif', '.svg',
])
// Camera RAW formats. sharp/libvips can't decode these, so thumbnails are built
// from the JPEG preview embedded in the file (see extractRawPreview).
export const RAW_EXTS = new Set([
  '.arw', '.sr2', '.srf',   // Sony
  '.cr2', '.cr3', '.crw',   // Canon
  '.nef', '.nrw',           // Nikon
  '.dng',                   // Adobe / generic
  '.raf',                   // Fujifilm
  '.rw2',                   // Panasonic
  '.orf',                   // Olympus
  '.pef',                   // Pentax
  '.srw',                   // Samsung
])
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg',
])
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus',
])

export function detectType(ext: string): EntryType {
  const e = ext.toLowerCase()
  if (IMAGE_EXTS.has(e) || RAW_EXTS.has(e)) return 'photo'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  return 'document'
}

export async function computeFileHash(filePath: string): Promise<string> {
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
    const mountPath = entry.volume_id != null ? mountPathForVolumeId(entry.volume_id) : null
    storedFilePath = mountPath
      ? path.relative(mountPath, sourcePath).split(path.sep).join('/')
      : sourcePath
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
  // A path for regular images, or the embedded-preview JPEG buffer for RAW files.
  source: string | Buffer,
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
      // failOn:'none' + no pixel cap: sharp otherwise aborts on the slightest JPEG
      // warning (truncated data, stray markers) and on very large panoramas/scans —
      // both extremely common in real photo libraries.
      await sharp(source, { failOn: 'none', limitInputPixels: false })
        .rotate()
        .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outPath)
      out[size] = `thumbnails/${size}/${fileName}`
    }
    return out
  } catch (err) {
    if (typeof source === 'string') {
      console.warn(`Thumbnail generation failed for ${source}: ${(err as Error).message}`)
    }
    return null
  }
}

// ffmpeg path, resolved once. undefined = not yet probed, null = unavailable.
// We probe by actually running `-version`: a prebuilt binary that can't exec
// (a real risk on NixOS) is treated as absent rather than crashing ingest.
let ffmpegPath: string | null | undefined
function resolveFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath
  // ffmpeg-static ships a per-platform binary; in a packaged app it's unpacked
  // out of the asar archive so it can be exec'd. Prefer an explicit override or a
  // system ffmpeg (e.g. from the Nix env in dev), then fall back to the bundled one.
  const bundled = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null
  const candidates = [process.env.TIMELINE_FFMPEG, 'ffmpeg', bundled].filter(Boolean) as string[]
  for (const cand of candidates) {
    try {
      if (spawnSync(cand, ['-version'], { stdio: 'ignore' }).status === 0) {
        ffmpegPath = cand
        return cand
      }
    } catch { /* try the next candidate */ }
  }
  ffmpegPath = null
  console.warn('ffmpeg not found (set TIMELINE_FFMPEG or add it to PATH) — video thumbnails will be skipped')
  return null
}

/** Decode a single frame from the video into a JPEG buffer, or null on failure. */
function extractVideoFrame(videoPath: string, seekSeconds: number): Promise<Buffer | null> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return Promise.resolve(null)
  return new Promise(resolve => {
    // -ss before -i = fast seek; grab one frame and write it to stdout as mjpeg.
    const args = ['-loglevel', 'error', '-ss', String(seekSeconds), '-i', videoPath,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']
    const proc = spawn(ffmpeg, args)
    const chunks: Buffer[] = []
    let failed = false
    proc.stdout.on('data', d => chunks.push(d))
    proc.on('error', () => { failed = true; resolve(null) })
    proc.on('close', code => {
      if (failed) return
      const buf = Buffer.concat(chunks)
      resolve(code === 0 && buf.length > 0 ? buf : null)
    })
  })
}

/**
 * Build thumbnails for a video by decoding a poster frame with ffmpeg and running
 * it through the same sharp resizer as photos. Tries 1s in (skips black intros),
 * then the very first frame for clips shorter than a second. Returns null if
 * ffmpeg is unavailable or the video can't be decoded.
 */
async function generateVideoThumbnails(
  videoPath: string,
  baseName: string,
): Promise<{ small: string; medium: string; large: string } | null> {
  for (const seek of [1, 0]) {
    const frame = await extractVideoFrame(videoPath, seek)
    if (frame) {
      const thumb = await generateImageThumbnails(frame, baseName)
      if (thumb) return thumb
    }
  }
  return null
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

async function ingestOne(sourcePath: string, relDir: string, groupPath: string[], mode: 'copy' | 'reference', volumeId: number | null): Promise<OneResult> {
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

    const isReference = mode === 'reference'
    let storedFilePath: string

    if (isReference) {
      const mountPath = volumeId != null ? mountPathForVolumeId(volumeId) : null
      storedFilePath = mountPath
        ? path.relative(mountPath, sourcePath).split(path.sep).join('/')
        : sourcePath
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
    if (type === 'photo' && RAW_EXTS.has(ext.toLowerCase())) {
      // exifr/sharp can't reliably read RAW; use ExifTool for date, GPS, and the
      // embedded JPEG preview we resize into thumbnails.
      const meta = await readRawMetadata(sourcePath)
      if (meta.timestamp !== null) {
        timestamp = meta.timestamp
        needsDateReview = 0
      }
      gps = meta.gps
      const preview = await extractRawPreview(sourcePath)
      if (preview) thumb = await generateImageThumbnails(preview, baseName)
    } else if (type === 'photo' && ext.toLowerCase() !== '.svg') {
      const exifTimestamp = await extractExifTimestamp(sourcePath)
      if (exifTimestamp !== null) {
        timestamp = exifTimestamp
        needsDateReview = 0
      }
      gps = await extractExifGps(sourcePath)
      thumb = await generateImageThumbnails(sourcePath, baseName)
    } else if (type === 'video') {
      const meta = await readVideoMetadata(sourcePath)
      if (meta.timestamp !== null) {
        timestamp = meta.timestamp
        needsDateReview = 0
      }
      gps = meta.gps
      thumb = await generateVideoThumbnails(sourcePath, baseName)
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
      volume_id: isReference ? volumeId : null,
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
    const absPath = resolveEntryAbsolutePath(entry)
    if (!absPath) continue // e.g. on a currently-disconnected volume — try again next sync
    const gps = RAW_EXTS.has(path.extname(absPath).toLowerCase())
      ? (await readRawMetadata(absPath)).gps
      : await extractExifGps(absPath)
    if (gps) {
      updateEntry(entry.id, { latitude: gps.latitude, longitude: gps.longitude, gps_scanned: 1 })
      found++
    } else {
      updateEntry(entry.id, { gps_scanned: 1 })
    }
  }
  return found
}

/**
 * Retroactively backfill data for entries imported before newer ingest features.
 * Used by the Settings "Rescan library" action. For each candidate it:
 *   - reclassifies RAW/image files that were stored as documents into photos,
 *   - generates thumbnails for anything still missing them,
 *   - fills GPS that was never scanned,
 *   - and fills the date ONLY for entries still flagged needs_date_review, so a
 *     confirmed or manually-corrected date is never overwritten.
 * Idempotent: a second run finds nothing left to do.
 */
export async function rescanLibrary(
  onProgress: (event: RescanProgressEvent) => void,
): Promise<RescanResult> {
  const candidates = getEntriesNeedingBackfill()
  const result: RescanResult = { scanned: 0, reclassified: 0, thumbnailsAdded: 0, datesUpdated: 0, gpsAdded: 0 }
  const total = candidates.length

  for (const entry of candidates) {
    onProgress({ processed: result.scanned, total, current: path.basename(entry.file_path ?? '') })
    result.scanned++

    const absPath = resolveEntryAbsolutePath(entry)
    if (!absPath) continue // unreachable (e.g. disconnected volume) — try again later

    const ext = path.extname(absPath).toLowerCase()

    // Videos need a poster thumbnail plus date/GPS from their container metadata.
    if (entry.type === 'video') {
      if (!VIDEO_EXTS.has(ext)) continue
      const patch: Partial<Omit<Entry, 'id'>> = {}
      if (!entry.thumbnail_small) {
        const baseName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
        const thumb = await generateVideoThumbnails(absPath, baseName)
        if (thumb) {
          patch.thumbnail_small = thumb.small
          patch.thumbnail_medium = thumb.medium
          patch.thumbnail_large = thumb.large
        }
      }
      // One ExifTool read covers both date and GPS. Location-less videos have no
      // coords to find, so they're re-checked each rescan — cheap for a manual op.
      const needDate = entry.needs_date_review === 1
      const needGps = entry.latitude == null
      if (needDate || needGps) {
        const meta = await readVideoMetadata(absPath)
        if (needDate && meta.timestamp !== null) { patch.timestamp = meta.timestamp; patch.needs_date_review = 0 }
        if (needGps && meta.gps) { patch.latitude = meta.gps.latitude; patch.longitude = meta.gps.longitude }
      }
      if (Object.keys(patch).length > 0) updateEntry(entry.id, patch)
      if (patch.thumbnail_small) result.thumbnailsAdded++
      if (patch.needs_date_review === 0) result.datesUpdated++
      if (patch.latitude != null) result.gpsAdded++
      continue
    }

    const isRaw = RAW_EXTS.has(ext)
    const isImage = IMAGE_EXTS.has(ext)
    if (!isRaw && !isImage) continue // a genuine document (PDF, …) — nothing to backfill

    const patch: Partial<Omit<Entry, 'id'>> = {}
    const wasDocument = entry.type === 'document'
    if (wasDocument) patch.type = 'photo'

    // Documents were never scanned as photos, so force a GPS read when reclassifying.
    const needDate = entry.needs_date_review === 1
    const needGps = entry.gps_scanned === 0 || wasDocument
    // One ExifTool pass covers both date and GPS for RAW.
    const rawMeta = isRaw && (needDate || needGps) ? await readRawMetadata(absPath) : null

    if (!entry.thumbnail_small && ext !== '.svg') {
      const baseName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
      const source = isRaw ? await extractRawPreview(absPath) : absPath
      if (source) {
        const thumb = await generateImageThumbnails(source, baseName)
        if (thumb) {
          patch.thumbnail_small = thumb.small
          patch.thumbnail_medium = thumb.medium
          patch.thumbnail_large = thumb.large
        }
      }
    }

    if (needDate) {
      const ts = isRaw ? rawMeta?.timestamp ?? null : await extractExifTimestamp(absPath)
      if (ts !== null) { patch.timestamp = ts; patch.needs_date_review = 0 }
    }

    if (needGps) {
      const gps = isRaw ? rawMeta?.gps ?? null : await extractExifGps(absPath)
      if (gps) { patch.latitude = gps.latitude; patch.longitude = gps.longitude }
      patch.gps_scanned = 1
    }

    if (Object.keys(patch).length > 0) updateEntry(entry.id, patch)
    if (patch.type) result.reclassified++
    if (patch.thumbnail_small) result.thumbnailsAdded++
    if (patch.needs_date_review === 0) result.datesUpdated++
    if (patch.latitude != null) result.gpsAdded++
  }

  onProgress({ processed: total, total, current: '' })
  return result
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
  mode: 'copy' | 'reference',
  volumeId: number | null,
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
        const result = await ingestOne(src, relDir, groupPath, mode, volumeId)
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
