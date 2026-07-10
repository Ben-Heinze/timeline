import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { getFilesPath, getThumbnailPath } from '../library'
import { insertEntry, findEntryByHash, findEntryByTitle } from '../db/queries/entries'
import { getSettings } from '../settings'
import type { EntryType, IngestProgressEvent } from '../../shared/types'

const HASH_THRESHOLD = 100 * 1024 * 1024  // 100 MB

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif',
  '.bmp', '.heic', '.heif', '.avif', '.svg',
])
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg',
])
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus',
])

function detectType(ext: string): EntryType {
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

async function isDuplicate(sourcePath: string, fileName: string): Promise<boolean> {
  const stat = await fs.stat(sourcePath)
  if (stat.size < HASH_THRESHOLD) {
    const hash = await computeFileHash(sourcePath)
    return !!findEntryByHash(hash)
  }
  return !!findEntryByTitle(fileName)
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

interface OneResult {
  ok: boolean
  id?: number
  skipped?: boolean
  error?: string
}

async function ingestOne(sourcePath: string): Promise<OneResult> {
  const fileName = path.basename(sourcePath)
  const ext = path.extname(fileName)
  const type = detectType(ext)

  if (await isDuplicate(sourcePath, fileName)) {
    return { ok: true, skipped: true }
  }

  const hash = crypto.randomBytes(6).toString('hex')
  const baseName = `${Date.now()}_${hash}`

  const settings = getSettings()
  const isReference = settings.importMode === 'reference'
  let storedFilePath: string
  let contentHash: string | null = null

  if (isReference) {
    storedFilePath = sourcePath
  } else {
    const destName = `${baseName}${ext}`
    const destPath = path.join(getFilesPath(), destName)
    await fs.copyFile(sourcePath, destPath)
    storedFilePath = `files/${destName}`
  }

  const stat = await fs.stat(sourcePath)
  const timestamp = stat.mtime.getTime() || Date.now()

  if (stat.size < HASH_THRESHOLD) {
    contentHash = await computeFileHash(sourcePath)
  }

  let thumb: { small: string; medium: string; large: string } | null = null
  if (type === 'photo' && ext.toLowerCase() !== '.svg') {
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
    group_id: null,
    needs_date_review: 1,
    is_missing: 0,
    content_hash: contentHash,
    import_mode: isReference ? 'reference' : 'copy',
    created_at: Date.now(),
  })

  return { ok: true, id }
}

const CONCURRENCY = 4

export async function ingestFiles(
  filePaths: string[],
  onProgress: (event: IngestProgressEvent) => void,
): Promise<number[]> {
  const total = filePaths.length
  if (total === 0) return []

  let nextIndex = 0
  let completed = 0
  const insertedIds: number[] = []

  onProgress({ total, completed: 0, current: path.basename(filePaths[0]) })

  const worker = async () => {
    while (true) {
      const i = nextIndex++
      if (i >= total) return
      const src = filePaths[i]
      const fileName = path.basename(src)
      let error: string | undefined
      try {
        const result = await ingestOne(src)
        if (result.id != null) insertedIds.push(result.id)
      } catch (e) {
        error = (e as Error).message ?? String(e)
      }
      completed++
      onProgress({ total, completed, current: fileName, error })
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, worker)
  await Promise.all(workers)
  return insertedIds
}
