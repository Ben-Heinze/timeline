import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { getDb } from './db'
import { getFilesPath, ensureLibraryDirs } from './library'
import { detectType } from './ingest'

const TOTAL_FILES = 1000
const DENSE_DAYS = 3               // day buckets guaranteed to hold DENSE_MIN+ files
const DENSE_MIN = 25
const DENSE_MAX = 45
const SPARSE_YEARS = 5             // sparse files spread over the last N years
const TEST_DIR = 'test-data'       // subfolder of library files/ so reset wipes it

const TEST_TAGS = [
  'family', 'vacation', 'friends', 'work', 'school',
  'holidays', 'pets', 'nature', 'birthday', 'travel',
]

// Weighted toward photos, like a real library
const TEST_EXTS = [
  '.jpg', '.jpg', '.jpg', '.jpeg', '.png', '.png', '.gif', '.webp', '.heic',
  '.mp4', '.mp4', '.mov', '.mkv',
  '.mp3', '.wav', '.m4a',
  '.pdf', '.pdf', '.txt', '.docx',
]

const MS_DAY = 86_400_000

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// A random ms within the given local calendar day, biased to daytime hours
function randomTimeInDay(dayStartMs: number): number {
  return dayStartMs + randInt(8, 21) * 3_600_000 + randInt(0, 3_599_999)
}

function buildTimestamps(): number[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const timestamps: number[] = []

  // Dense clusters: a few days each holding well over 20 files
  const usedDays = new Set<number>()
  for (let d = 0; d < DENSE_DAYS; d++) {
    let dayStart: number
    do {
      dayStart = today - randInt(30, 2 * 365) * MS_DAY
    } while (usedDays.has(dayStart))
    usedDays.add(dayStart)
    const count = randInt(DENSE_MIN, DENSE_MAX)
    for (let i = 0; i < count && timestamps.length < TOTAL_FILES; i++) {
      timestamps.push(randomTimeInDay(dayStart))
    }
  }

  // Sparse remainder: random days across the last SPARSE_YEARS years
  while (timestamps.length < TOTAL_FILES) {
    const dayStart = today - randInt(0, SPARSE_YEARS * 365) * MS_DAY
    timestamps.push(randomTimeInDay(dayStart))
  }

  return timestamps
}

export interface TestDataResult {
  entries: number
  tags: number
  denseDays: number
}

/**
 * Generate TOTAL_FILES placeholder files inside the managed library and insert
 * matching entries, tagged randomly from a fixed set of 10 tags. Everything
 * lives in the library files/ dir and the database, so the existing
 * "Clear entire database" reset removes all of it.
 */
export async function generateTestData(): Promise<TestDataResult> {
  ensureLibraryDirs()
  const destDir = path.join(getFilesPath(), TEST_DIR)
  await fs.mkdir(destDir, { recursive: true })

  const timestamps = buildTimestamps()
  const runId = crypto.randomBytes(4).toString('hex')

  interface Pending {
    fileName: string
    relPath: string
    timestamp: number
    contentHash: string
  }
  const pending: Pending[] = []

  // Write the placeholder files. Each gets one unique marker line so content
  // hashes differ — truly empty files would all flag as duplicates of each other.
  const WRITE_BATCH = 50
  for (let start = 0; start < timestamps.length; start += WRITE_BATCH) {
    const batch = timestamps.slice(start, start + WRITE_BATCH)
    await Promise.all(batch.map(async (timestamp, j) => {
      const n = start + j
      const ext = pick(TEST_EXTS)
      const fileName = `test_${runId}_${String(n + 1).padStart(4, '0')}${ext}`
      const content = `timeline test file ${runId} ${n + 1}\n`
      await fs.writeFile(path.join(destDir, fileName), content)
      pending.push({
        fileName,
        relPath: ['files', TEST_DIR, fileName].join('/'),
        timestamp,
        contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      })
    }))
  }

  const db = getDb()
  const insertEntry = db.prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0,
       @content_hash, 'copy', @created_at)
  `)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertEntryTag = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')

  db.transaction(() => {
    const tagIds = TEST_TAGS.map(name => {
      insertTag.run(name)
      return (getTagId.get(name) as { id: number }).id
    })

    const createdAt = Date.now()
    for (const p of pending) {
      const result = insertEntry.run({
        type: detectType(path.extname(p.fileName)),
        timestamp: p.timestamp,
        title: p.fileName,
        file_path: p.relPath,
        content_hash: p.contentHash,
        created_at: createdAt,
      })
      const entryId = result.lastInsertRowid as number

      // ~60% of entries get 1–3 random tags, so tags overlap across many entries
      if (Math.random() < 0.6) {
        const count = randInt(1, 3)
        const shuffled = [...tagIds].sort(() => Math.random() - 0.5)
        for (let t = 0; t < count; t++) insertEntryTag.run(entryId, shuffled[t])
      }
    }
  })()

  return { entries: pending.length, tags: TEST_TAGS.length, denseDays: DENSE_DAYS }
}
