import { getDb } from '../index'
import type { Entry, Bucket, SearchFilters } from '../../../shared/types'

export function getHistogram(from: number, to: number, bucketMs: number, groupId?: number): Bucket[] {
  const sql = `
    SELECT
      CAST(timestamp / :bucket AS INTEGER) * :bucket AS bucket_start,
      group_id,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp BETWEEN :from AND :to${groupId != null ? ' AND group_id = :groupId' : ''}
    GROUP BY bucket_start, group_id
    ORDER BY bucket_start
  `
  const params: Record<string, number> = { bucket: bucketMs, from, to }
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
  sortBy: 'date' | 'title' | 'type'
  sortDir: 'asc' | 'desc'
}): Entry[] {
  const col = opts.sortBy === 'date' ? 'timestamp' : opts.sortBy === 'title' ? 'title' : 'type'
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC'
  const tie = opts.sortBy === 'date' ? '' : ', timestamp DESC'
  const where = opts.groupId != null ? 'WHERE group_id = @groupId' : ''
  const params: Record<string, unknown> = {}
  if (opts.groupId != null) params.groupId = opts.groupId
  return getDb().prepare(`
    SELECT * FROM entries
    ${where}
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
    // Match entries whose own tags include any specified tag, OR whose group carries any specified tag
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
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review, @created_at)
  `).run(entry)
  return result.lastInsertRowid as number
}
