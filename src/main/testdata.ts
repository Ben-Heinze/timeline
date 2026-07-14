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

const MS_DAY = 86_400_000

// General-purpose tags, plus two context pools that get extra weight when an
// entry has GPS data (travel-flavored) or doesn't (everyday-flavored) — so
// tag filtering and the map view tell a consistent story together.
const GENERAL_TAGS = ['friends', 'holidays', 'pets', 'birthday']
const HOME_TAGS = ['work', 'school', 'family']
const TRAVEL_TAGS = ['travel', 'vacation', 'nature', 'beach', 'hiking']
const TEST_TAGS = [...GENERAL_TAGS, ...HOME_TAGS, ...TRAVEL_TAGS]

// Weighted toward photos, like a real library
const TEST_EXTS = [
  '.jpg', '.jpg', '.jpg', '.jpeg', '.png', '.png', '.gif', '.webp', '.heic',
  '.mp4', '.mp4', '.mov', '.mkv',
  '.mp3', '.wav', '.m4a',
  '.pdf', '.pdf', '.txt', '.docx',
]

// Real-world clusters that GPS-tagged entries scatter around, so the map
// heatmap shows several distinct hotspots instead of one blob.
const WORLD_LOCATIONS = [
  { name: 'New York', lat: 40.7128, lng: -74.0060 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241 },
  { name: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { name: 'Reykjavik', lat: 64.1466, lng: -21.9426 },
  { name: 'Banff', lat: 51.1784, lng: -115.5708 },
]
const LOCATION_RATE = 0.35   // fraction of GPS-eligible (photo/video) entries that get a location at all
const OUTLIER_RATE = 0.08    // of those, fraction placed at a fully random point instead of a cluster
const JITTER_DEG = 0.12      // ~10km scatter around a cluster center

// Themed same-day clusters that become Groups, so Groups/Map/Tags all have
// something to show together. Themes with a `location` pin most of that
// day's entries near a real place; the rest just share tag flavor.
interface GroupTheme {
  name: string
  color: string
  location?: { lat: number; lng: number }
  tagBias: string[]
}
const GROUP_THEMES: GroupTheme[] = [
  { name: 'Paris Trip', color: '#3b82f6', location: WORLD_LOCATIONS[1], tagBias: ['travel', 'vacation'] },
  { name: 'Tokyo Trip', color: '#ef4444', location: WORLD_LOCATIONS[2], tagBias: ['travel', 'vacation'] },
  { name: 'Rio Carnival', color: '#f59e0b', location: WORLD_LOCATIONS[5], tagBias: ['travel', 'friends'] },
  { name: 'Banff Camping', color: '#22c55e', location: WORLD_LOCATIONS[9], tagBias: ['nature', 'hiking'] },
  { name: 'Cape Town Safari', color: '#84cc16', location: WORLD_LOCATIONS[4], tagBias: ['travel', 'nature'] },
  { name: "Ben's Birthday", color: '#ec4899', tagBias: ['birthday', 'family'] },
  { name: 'Family Reunion', color: '#8b5cf6', tagBias: ['family', 'friends'] },
  { name: 'Graduation Day', color: '#06b6d4', tagBias: ['family', 'friends'] },
  { name: 'Wedding Weekend', color: '#f97316', tagBias: ['friends', 'family'] },
  { name: 'Company Retreat', color: '#6b7280', tagBias: ['work', 'friends'] },
]
const GROUP_DAY_MIN = 4
const GROUP_DAY_MAX = 9
const GROUP_ASSIGN_MIN = 0.55  // fraction of a themed day's entries that actually join the group
const GROUP_ASSIGN_MAX = 1.0

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const randFloat = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// A random ms within the given local calendar day, biased to daytime hours
function randomTimeInDay(dayStartMs: number): number {
  return dayStartMs + randInt(8, 21) * 3_600_000 + randInt(0, 3_599_999)
}

function jitteredLocation(center: { lat: number; lng: number }): { latitude: number; longitude: number } {
  return {
    latitude: center.lat + randFloat(-JITTER_DEG, JITTER_DEG),
    longitude: center.lng + randFloat(-JITTER_DEG, JITTER_DEG),
  }
}

function randomWorldLocation(): { latitude: number; longitude: number } {
  return { latitude: randFloat(-60, 70), longitude: randFloat(-180, 180) }
}

function decideLocation(
  type: string,
  theme: GroupTheme | null,
): { latitude: number | null; longitude: number | null } {
  if (type !== 'photo' && type !== 'video') return { latitude: null, longitude: null }
  if (theme?.location && Math.random() < 0.9) return jitteredLocation(theme.location)
  if (Math.random() < LOCATION_RATE) {
    const loc = Math.random() < OUTLIER_RATE ? randomWorldLocation() : jitteredLocation(pick(WORLD_LOCATIONS))
    return loc
  }
  return { latitude: null, longitude: null }
}

function tagPoolFor(theme: GroupTheme | null, hasLocation: boolean): string[] {
  const bias = theme?.tagBias ?? (hasLocation ? TRAVEL_TAGS : HOME_TAGS)
  // Double-weight the contextually relevant tags without a full weighted-random implementation
  return [...TEST_TAGS, ...bias, ...bias]
}

function pickTags(pool: string[], count: number): string[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const out: string[] = []
  for (const t of shuffled) {
    if (!out.includes(t)) out.push(t)
    if (out.length === count) break
  }
  return out
}

interface TimestampSlot {
  ts: number
  theme: GroupTheme | null
}

function buildTimestamps(): { slots: TimestampSlot[]; themeDayStart: Map<GroupTheme, number> } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const slots: TimestampSlot[] = []
  const usedDays = new Set<number>()

  // Dense clusters: a few days each holding well over 20 files, for stress-testing the timeline
  for (let d = 0; d < DENSE_DAYS; d++) {
    let dayStart: number
    do {
      dayStart = today - randInt(30, 2 * 365) * MS_DAY
    } while (usedDays.has(dayStart))
    usedDays.add(dayStart)
    const count = randInt(DENSE_MIN, DENSE_MAX)
    for (let i = 0; i < count && slots.length < TOTAL_FILES; i++) {
      slots.push({ ts: randomTimeInDay(dayStart), theme: null })
    }
  }

  // Themed same-day clusters, each becomes a Group
  const themeDayStart = new Map<GroupTheme, number>()
  for (const theme of GROUP_THEMES) {
    let dayStart: number
    do {
      dayStart = today - randInt(14, 4 * 365) * MS_DAY
    } while (usedDays.has(dayStart))
    usedDays.add(dayStart)
    themeDayStart.set(theme, dayStart)
    const count = randInt(GROUP_DAY_MIN, GROUP_DAY_MAX)
    for (let i = 0; i < count && slots.length < TOTAL_FILES; i++) {
      slots.push({ ts: randomTimeInDay(dayStart), theme })
    }
  }

  // Sparse remainder: random days across the last SPARSE_YEARS years
  while (slots.length < TOTAL_FILES) {
    const dayStart = today - randInt(0, SPARSE_YEARS * 365) * MS_DAY
    slots.push({ ts: randomTimeInDay(dayStart), theme: null })
  }

  return { slots, themeDayStart }
}

export interface TestDataResult {
  entries: number
  tags: number
  denseDays: number
  located: number
  groups: number
}

/**
 * Generate TOTAL_FILES placeholder files inside the managed library and insert
 * matching entries: randomly tagged from a fixed set of tags, a third or so
 * carrying GPS data clustered around real-world cities, and several themed
 * same-day clusters assigned into Groups — so Timeline, Map, Tags, and
 * Groups all have something to show. Everything lives in the library files/
 * dir and the database, so the existing "Clear entire database" reset
 * removes all of it.
 */
export async function generateTestData(): Promise<TestDataResult> {
  ensureLibraryDirs()
  const destDir = path.join(getFilesPath(), TEST_DIR)
  await fs.mkdir(destDir, { recursive: true })

  const { slots, themeDayStart } = buildTimestamps()
  const runId = crypto.randomBytes(4).toString('hex')

  interface Pending {
    fileName: string
    relPath: string
    timestamp: number
    contentHash: string
    type: string
    theme: GroupTheme | null
    latitude: number | null
    longitude: number | null
  }
  const pending: Pending[] = []

  // Write the placeholder files. Each gets one unique marker line so content
  // hashes differ — truly empty files would all flag as duplicates of each other.
  const WRITE_BATCH = 50
  for (let start = 0; start < slots.length; start += WRITE_BATCH) {
    const batch = slots.slice(start, start + WRITE_BATCH)
    await Promise.all(batch.map(async (slot, j) => {
      const n = start + j
      const ext = pick(TEST_EXTS)
      const type = detectType(ext)
      const fileName = `test_${runId}_${String(n + 1).padStart(4, '0')}${ext}`
      const content = `timeline test file ${runId} ${n + 1}\n`
      await fs.writeFile(path.join(destDir, fileName), content)
      const { latitude, longitude } = decideLocation(type, slot.theme)
      pending.push({
        fileName,
        relPath: ['files', TEST_DIR, fileName].join('/'),
        timestamp: slot.ts,
        contentHash: crypto.createHash('sha256').update(content).digest('hex'),
        type,
        theme: slot.theme,
        latitude,
        longitude,
      })
    }))
  }

  const db = getDb()
  const insertEntry = db.prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, latitude, longitude, gps_scanned, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0,
       @content_hash, 'copy', @latitude, @longitude, @gps_scanned, @created_at)
  `)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertEntryTag = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')
  const insertGroup = db.prepare(`
    INSERT INTO groups (name, parent_id, color, description, date_from, date_to, created_at)
    VALUES (@name, NULL, @color, NULL, @date_from, @date_to, @created_at)
  `)
  const assignGroup = db.prepare('UPDATE entries SET group_id = ? WHERE id = ?')

  const groupsMade = db.transaction(() => {
    const tagIdByName = new Map<string, number>()
    for (const name of TEST_TAGS) {
      insertTag.run(name)
      tagIdByName.set(name, (getTagId.get(name) as { id: number }).id)
    }

    const createdAt = Date.now()
    const groupEntries = new Map<GroupTheme, number[]>()

    for (const p of pending) {
      const result = insertEntry.run({
        type: p.type,
        timestamp: p.timestamp,
        title: p.fileName,
        file_path: p.relPath,
        content_hash: p.contentHash,
        latitude: p.latitude,
        longitude: p.longitude,
        gps_scanned: (p.type === 'photo' || p.type === 'video') ? 1 : 0,
        created_at: createdAt,
      })
      const entryId = result.lastInsertRowid as number

      if (p.theme) {
        const arr = groupEntries.get(p.theme) ?? []
        arr.push(entryId)
        groupEntries.set(p.theme, arr)
      }

      // ~60% of entries get 1–3 random tags, weighted toward the entry's context
      if (Math.random() < 0.6) {
        const pool = tagPoolFor(p.theme, p.latitude !== null)
        const count = randInt(1, 3)
        for (const name of pickTags(pool, count)) {
          insertEntryTag.run(entryId, tagIdByName.get(name)!)
        }
      }
    }

    let made = 0
    for (const [theme, entryIds] of groupEntries) {
      if (entryIds.length < GROUP_DAY_MIN) continue
      const dayStart = themeDayStart.get(theme)!
      const result = insertGroup.run({
        name: theme.name,
        color: theme.color,
        date_from: dayStart,
        date_to: dayStart + MS_DAY,
        created_at: createdAt,
      })
      const groupId = result.lastInsertRowid as number
      made++

      const shuffled = [...entryIds].sort(() => Math.random() - 0.5)
      const takeCount = Math.max(2, Math.round(entryIds.length * randFloat(GROUP_ASSIGN_MIN, GROUP_ASSIGN_MAX)))
      for (const id of shuffled.slice(0, takeCount)) assignGroup.run(groupId, id)
    }
    return made
  })()

  return {
    entries: pending.length,
    tags: TEST_TAGS.length,
    denseDays: DENSE_DAYS,
    located: pending.filter(p => p.latitude !== null).length,
    groups: groupsMade,
  }
}
