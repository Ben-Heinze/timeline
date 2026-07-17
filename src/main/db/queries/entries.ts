import { getDb } from '../index'
import { getGroupSubtreeIds } from './groups'
import { bucketExprSql } from './bucketing'
import type { Entry, Bucket, SearchFilters, DuplicateGroup, PageParams, MonthBucket } from '../../../shared/types'

// Selecting a group includes its whole subtree. Ids come from our own table,
// so inlining them keeps the queries on named parameters only.
function groupFilterSql(groupId: number): string {
  return `group_id IN (${getGroupSubtreeIds(groupId).join(', ')})`
}

export function getHistogram(from: number, to: number, zoomLevel: string, groupId?: number): Bucket[] {
  const bucketExpr = bucketExprSql(zoomLevel)

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      group_id,
      type,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp >= :from AND timestamp < :to${groupId != null ? ` AND ${groupFilterSql(groupId)}` : ''}
    GROUP BY bucket_start, group_id, type
    ORDER BY bucket_start
  `
  return getDb().prepare(sql).all({ from, to }) as Bucket[]
}

export function getEntriesForDay(dateMs: number): Entry[] {
  const end = dateMs + 86_400_000
  return getDb().prepare(`
    SELECT * FROM entries
    WHERE timestamp >= ? AND timestamp < ?
    ORDER BY timestamp
  `).all(dateMs, end) as Entry[]
}

export function getEntriesForPeriod(from: number, to: number, groupId?: number): Entry[] {
  if (groupId != null) {
    return getDb().prepare(
      `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? AND ${groupFilterSql(groupId)} ORDER BY timestamp`
    ).all(from, to) as Entry[]
  }
  return getDb().prepare(
    `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`
  ).all(from, to) as Entry[]
}

export function getDataExtent(): { min: number; max: number } | null {
  const row = getDb().prepare(`SELECT MIN(timestamp) AS min, MAX(timestamp) AS max FROM entries`).get() as { min: number | null; max: number | null }
  if (row.min == null) return null
  return { min: row.min, max: row.max! }
}

export function getEntry(id: number): Entry | null {
  return getDb().prepare('SELECT * FROM entries WHERE id = ?').get(id) as Entry | null
}

export function updateEntry(id: number, patch: Partial<Omit<Entry, 'id'>>): void {
  const fields = Object.keys(patch).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE entries SET ${fields} WHERE id = @id`).run({ ...patch, id })
}

export function deleteEntries(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  getDb().prepare(`DELETE FROM entries WHERE id IN (${placeholders})`).run(...ids)
}

export function listAllEntries(opts: {
  groupId?: number
  sortBy: 'date' | 'title' | 'type' | 'tag'
  sortDir: 'asc' | 'desc'
} & PageParams): Entry[] {
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC'
  const where = opts.groupId != null ? `WHERE e.${groupFilterSql(opts.groupId)}` : ''
  const params: Record<string, unknown> = { limit: opts.limit, offset: opts.offset }

  if (opts.sortBy === 'tag') {
    // Sort by the alphabetically-first tag on each entry; entries with no tags always go last
    return getDb().prepare(`
      SELECT e.*
      FROM entries e
      LEFT JOIN entry_tags et ON et.entry_id = e.id
      LEFT JOIN tags t ON t.id = et.tag_id
      ${where}
      GROUP BY e.id
      ORDER BY
        CASE WHEN MIN(t.name) IS NULL THEN 1 ELSE 0 END ASC,
        MIN(t.name) ${dir},
        e.timestamp DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as Entry[]
  }

  const col = opts.sortBy === 'date' ? 'timestamp' : opts.sortBy === 'title' ? 'title' : 'type'
  const tie = opts.sortBy === 'date' ? '' : ', timestamp DESC'
  const simpleWhere = opts.groupId != null ? `WHERE ${groupFilterSql(opts.groupId)}` : ''
  return getDb().prepare(`
    SELECT * FROM entries
    ${simpleWhere}
    ORDER BY ${col} ${dir}${tie}
    LIMIT @limit OFFSET @offset
  `).all(params) as Entry[]
}

export function countAllEntries(opts: { groupId?: number }): number {
  const where = opts.groupId != null ? `WHERE ${groupFilterSql(opts.groupId)}` : ''
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM entries ${where}`).get() as { count: number }
  return row.count
}

// Header/row skeleton for the Files view's date sort: how many entries fall in each
// calendar month, without fetching the entries themselves. Same bucket convention as
// the timeline histogram, so "July 2026" here means the same span it means there.
export function getMonthBuckets(opts: { groupId?: number; sortDir: 'asc' | 'desc' }): MonthBucket[] {
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC'
  const where = opts.groupId != null ? `WHERE ${groupFilterSql(opts.groupId)}` : ''
  const bucketExpr = bucketExprSql('month')
  const rows = getDb().prepare(`
    SELECT ${bucketExpr} AS bucket_start, COUNT(*) AS count
    FROM entries
    ${where}
    GROUP BY bucket_start
    ORDER BY bucket_start ${dir}
  `).all() as { bucket_start: number; count: number }[]
  return rows.map(r => ({ bucketStart: r.bucket_start, count: r.count }))
}

function buildSearchFilterSql(filters: SearchFilters): { whereSql: string; tagJoin: string; params: Record<string, unknown> } {
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (filters.text && filters.text.trim()) {
    where.push('(e.title LIKE @text OR e.file_path LIKE @text OR e.rich_text_json LIKE @text OR g.name LIKE @text)')
    params.text = `%${filters.text.trim()}%`
  }
  if (filters.fileName && filters.fileName.trim()) {
    where.push('e.file_path LIKE @fileName')
    params.fileName = `%${filters.fileName.trim()}%`
  }
  if (filters.types && filters.types.length > 0) {
    const keys = filters.types.map((_, i) => `@type${i}`)
    where.push(`e.type IN (${keys.join(', ')})`)
    filters.types.forEach((t, i) => { params[`type${i}`] = t })
  }
  if (filters.from != null) {
    where.push('e.timestamp >= @from')
    params.from = filters.from
  }
  if (filters.to != null) {
    where.push('e.timestamp <= @to')
    params.to = filters.to
  }

  let tagJoin = ''
  if (filters.tagIds && filters.tagIds.length > 0) {
    const keys = filters.tagIds.map((_, i) => `@tag${i}`)
    filters.tagIds.forEach((id, i) => { params[`tag${i}`] = id })
    tagJoin = `
      LEFT JOIN entry_tags et ON et.entry_id = e.id AND et.tag_id IN (${keys.join(', ')})
      LEFT JOIN group_tags gt ON gt.group_id = e.group_id AND gt.tag_id IN (${keys.join(', ')})
    `
    where.push('(et.tag_id IS NOT NULL OR gt.tag_id IS NOT NULL)')
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', tagJoin, params }
}

export function searchEntries(filters: SearchFilters, page: PageParams): Entry[] {
  const { whereSql, tagJoin, params } = buildSearchFilterSql(filters)
  const sql = `
    SELECT DISTINCT e.* FROM entries e
    LEFT JOIN groups g ON g.id = e.group_id
    ${tagJoin}
    ${whereSql}
    ORDER BY e.timestamp DESC
    LIMIT @limit OFFSET @offset
  `
  return getDb().prepare(sql).all({ ...params, limit: page.limit, offset: page.offset }) as Entry[]
}

export function countSearchResults(filters: SearchFilters): number {
  const { whereSql, tagJoin, params } = buildSearchFilterSql(filters)
  // DISTINCT count needs a subquery since the tag join can multiply rows per entry
  const sql = `
    SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT e.id FROM entries e
      LEFT JOIN groups g ON g.id = e.group_id
      ${tagJoin}
      ${whereSql}
    )
  `
  const row = getDb().prepare(sql).get(params) as { count: number }
  return row.count
}

export function insertEntry(entry: Omit<Entry, 'id'>): number {
  const result = getDb().prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, original_file_name, import_mode, volume_id, latitude, longitude, gps_scanned, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review,
       @is_missing, @content_hash, @original_file_name, @import_mode, @volume_id, @latitude, @longitude, @gps_scanned, @created_at)
  `).run(entry)
  return result.lastInsertRowid as number
}

export function getEntriesWithLocation(): Entry[] {
  return getDb().prepare(
    `SELECT * FROM entries WHERE latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY timestamp`
  ).all() as Entry[]
}

export function getUnscannedGpsPhotos(): Entry[] {
  return getDb().prepare(
    `SELECT * FROM entries WHERE type = 'photo' AND gps_scanned = 0 AND file_path IS NOT NULL AND is_missing = 0`
  ).all() as Entry[]
}

// Entries a library rescan might need to fix: photos still missing a thumbnail,
// date, or GPS scan, plus every document (whose extension the caller re-checks —
// RAW files imported before RAW support landed were stored as documents).
export function getEntriesNeedingBackfill(): Entry[] {
  return getDb().prepare(`
    SELECT * FROM entries
    WHERE file_path IS NOT NULL AND is_missing = 0
      AND (
        type = 'document'
        OR (type = 'photo' AND (thumbnail_small IS NULL OR needs_date_review = 1 OR gps_scanned = 0))
        OR (type = 'video' AND (thumbnail_small IS NULL OR needs_date_review = 1 OR latitude IS NULL))
      )
    ORDER BY id
  `).all() as Entry[]
}

export function getEntriesWithFilePathPrefix(prefix: string): Entry[] {
  return getDb().prepare(
    `SELECT * FROM entries WHERE file_path LIKE ? AND import_mode = 'reference'`
  ).all(`${prefix}%`) as Entry[]
}

export function findEntryByHash(hash: string): Entry | null {
  return getDb().prepare('SELECT * FROM entries WHERE content_hash = ? LIMIT 1').get(hash) as Entry | null
}

export function getAllEntriesWithFilePaths(): Entry[] {
  return getDb().prepare('SELECT * FROM entries WHERE file_path IS NOT NULL').all() as Entry[]
}

// Manually correcting the date is the user asserting it is right, so we also
// clear the needs_date_review flag. Both variants share the id-placeholder shape.
export function setEntriesTimestamp(ids: number[], timestamp: number): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  getDb().prepare(
    `UPDATE entries SET timestamp = ?, needs_date_review = 0 WHERE id IN (${placeholders})`
  ).run(timestamp, ...ids)
}

export function shiftEntriesTimestamp(ids: number[], deltaMs: number): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  getDb().prepare(
    `UPDATE entries SET timestamp = timestamp + ?, needs_date_review = 0 WHERE id IN (${placeholders})`
  ).run(deltaMs, ...ids)
}

export function markEntriesMissing(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  getDb().prepare(`UPDATE entries SET is_missing = 1 WHERE id IN (${placeholders})`).run(...ids)
}

export function markEntriesFound(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  getDb().prepare(`UPDATE entries SET is_missing = 0 WHERE id IN (${placeholders})`).run(...ids)
}

export function findDuplicatesByHash(): DuplicateGroup[] {
  const rows = getDb().prepare(`
    SELECT content_hash AS key, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM entries
    WHERE content_hash IS NOT NULL
    GROUP BY content_hash
    HAVING COUNT(*) > 1
  `).all() as { key: string; count: number; ids: string }[]
  return rows.map(r => ({ key: r.key, count: r.count, entryIds: r.ids.split(',').map(Number) }))
}

export function findDuplicatesByNameSize(): DuplicateGroup[] {
  const rows = getDb().prepare(`
    SELECT title AS key, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM entries
    WHERE title IS NOT NULL
    GROUP BY title
    HAVING COUNT(*) > 1
  `).all() as { key: string; count: number; ids: string }[]
  return rows.map(r => ({ key: r.key, count: r.count, entryIds: r.ids.split(',').map(Number) }))
}
