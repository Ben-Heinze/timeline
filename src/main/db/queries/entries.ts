import { getDb } from '../index'
import type { Entry, Bucket, SearchFilters, DuplicateGroup } from '../../../shared/types'

export function getHistogram(from: number, to: number, zoomLevel: string, groupId?: number): Bucket[] {
  // All expressions bucket by LOCAL calendar date and return the LOCAL midnight as a UTC ms
  // timestamp (using the 'utc' modifier so the result matches new Date(y,m,d).getTime() in JS).
  let bucketExpr: string
  if (zoomLevel === 'year') {
    bucketExpr = `CAST(strftime('%s', strftime('%Y', datetime(timestamp/1000, 'unixepoch', 'localtime')) || '-01-01', 'utc') AS INTEGER) * 1000`
  } else if (zoomLevel === 'month') {
    bucketExpr = `CAST(strftime('%s', strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) || '-01', 'utc') AS INTEGER) * 1000`
  } else if (zoomLevel === 'week') {
    // Snap to the Sunday that starts the week in local time
    bucketExpr = `CAST(strftime('%s', date(datetime(timestamp/1000, 'unixepoch', 'localtime'), '-' || CAST(strftime('%w', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) || ' days'), 'utc') AS INTEGER) * 1000`
  } else {
    bucketExpr = `CAST(strftime('%s', date(datetime(timestamp/1000, 'unixepoch', 'localtime')), 'utc') AS INTEGER) * 1000`
  }

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      group_id,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp >= :from AND timestamp < :to${groupId != null ? ' AND group_id = :groupId' : ''}
    GROUP BY bucket_start, group_id
    ORDER BY bucket_start
  `
  const params: Record<string, number> = { from, to }
  if (groupId != null) params.groupId = groupId
  return getDb().prepare(sql).all(params) as Bucket[]
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
      `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? AND group_id = ? ORDER BY timestamp`
    ).all(from, to, groupId) as Entry[]
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
}): Entry[] {
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC'
  const where = opts.groupId != null ? 'WHERE e.group_id = @groupId' : ''
  const params: Record<string, unknown> = {}
  if (opts.groupId != null) params.groupId = opts.groupId

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
    `).all(params) as Entry[]
  }

  const col = opts.sortBy === 'date' ? 'timestamp' : opts.sortBy === 'title' ? 'title' : 'type'
  const tie = opts.sortBy === 'date' ? '' : ', timestamp DESC'
  const simpleWhere = opts.groupId != null ? 'WHERE group_id = @groupId' : ''
  return getDb().prepare(`
    SELECT * FROM entries
    ${simpleWhere}
    ORDER BY ${col} ${dir}${tie}
  `).all(params) as Entry[]
}

export function searchEntries(filters: SearchFilters): Entry[] {
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

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sql = `
    SELECT DISTINCT e.* FROM entries e
    LEFT JOIN groups g ON g.id = e.group_id
    ${tagJoin}
    ${whereSql}
    ORDER BY e.timestamp DESC
    LIMIT 500
  `
  return getDb().prepare(sql).all(params) as Entry[]
}

export function insertEntry(entry: Omit<Entry, 'id'>): number {
  const result = getDb().prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review,
       @is_missing, @content_hash, @import_mode, @created_at)
  `).run(entry)
  return result.lastInsertRowid as number
}

export function getEntriesWithFilePathPrefix(prefix: string): Entry[] {
  return getDb().prepare(
    `SELECT * FROM entries WHERE file_path LIKE ? AND import_mode = 'reference'`
  ).all(`${prefix}%`) as Entry[]
}

export function findEntryByHash(hash: string): Entry | null {
  return getDb().prepare('SELECT * FROM entries WHERE content_hash = ? LIMIT 1').get(hash) as Entry | null
}

export function findEntryByTitle(title: string): Entry | null {
  return getDb().prepare('SELECT * FROM entries WHERE title = ? LIMIT 1').get(title) as Entry | null
}

export function getAllEntriesWithFilePaths(): Entry[] {
  return getDb().prepare('SELECT * FROM entries WHERE file_path IS NOT NULL').all() as Entry[]
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
