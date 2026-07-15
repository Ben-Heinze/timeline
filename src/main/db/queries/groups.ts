import { getDb } from '../index'
import type { Group, GroupStats, NewGroup } from '../../../shared/types'

export function listGroups(): Group[] {
  return getDb().prepare('SELECT * FROM groups ORDER BY name').all() as Group[]
}

/** A group's id plus all descendant ids. UNION (not UNION ALL) so a parent-id cycle can't loop forever. */
export function getGroupSubtreeIds(rootId: number): number[] {
  const rows = getDb().prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM groups WHERE id = ?
      UNION
      SELECT g.id FROM groups g JOIN subtree s ON g.parent_id = s.id
    )
    SELECT id FROM subtree
  `).all(rootId) as { id: number }[]
  return rows.map(r => r.id)
}

/**
 * The timeframe a group covers: its explicit date_from/date_to if it's a
 * date-range group, otherwise the min/max timestamp of its (subtree's)
 * entries. Null if neither is available.
 */
export function getGroupDateRange(groupId: number): { from: number; to: number } | null {
  const db = getDb()
  const group = db.prepare('SELECT date_from, date_to FROM groups WHERE id = ?').get(groupId) as
    { date_from: number | null; date_to: number | null } | undefined
  if (group?.date_from != null && group.date_to != null) {
    return { from: group.date_from, to: group.date_to }
  }
  const ids = getGroupSubtreeIds(groupId)
  const row = db.prepare(
    `SELECT MIN(timestamp) AS min, MAX(timestamp) AS max FROM entries WHERE group_id IN (${ids.join(', ')})`
  ).get() as { min: number | null; max: number | null }
  if (row.min == null) return null
  return { from: row.min, to: row.max! + 1 }
}

export function getGroupStatsForPeriod(from: number, to: number): GroupStats[] {
  return getDb().prepare(`
    SELECT group_id, COUNT(*) AS count, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
    FROM entries
    WHERE group_id IS NOT NULL AND timestamp >= ? AND timestamp < ?
    GROUP BY group_id
  `).all(from, to) as GroupStats[]
}

export function createGroup(data: NewGroup): Group {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO groups (name, parent_id, color, description, date_from, date_to, created_at)
    VALUES (@name, @parent_id, @color, @description, @date_from, @date_to, @created_at)
  `).run({
    name: data.name,
    parent_id: data.parent_id,
    color: data.color,
    description: data.description ?? null,
    date_from: data.date_from ?? null,
    date_to: data.date_to ?? null,
    created_at: Date.now(),
  })
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid) as Group
}

const AUTO_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

function autoColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AUTO_COLORS[Math.abs(h) % AUTO_COLORS.length]
}

/**
 * Resolve a folder-derived chain of group names (outermost first) to a group
 * id, creating any missing levels. Names match case-insensitively so
 * re-importing the same folder reuses its groups.
 */
export function findOrCreateGroupPath(segments: string[]): number | null {
  const db = getDb()
  let parentId: number | null = null
  for (const name of segments) {
    const existing = (parentId === null
      ? db.prepare('SELECT id FROM groups WHERE parent_id IS NULL AND name = ? COLLATE NOCASE').get(name)
      : db.prepare('SELECT id FROM groups WHERE parent_id = ? AND name = ? COLLATE NOCASE').get(parentId, name)
    ) as { id: number } | undefined
    if (existing) {
      parentId = existing.id
    } else {
      const result = db.prepare(`
        INSERT INTO groups (name, parent_id, color, created_at)
        VALUES (?, ?, ?, ?)
      `).run(name, parentId, autoColor(name), Date.now())
      parentId = result.lastInsertRowid as number
    }
  }
  return parentId
}

export function updateGroup(id: number, patch: Partial<Omit<Group, 'id'>>): Group {
  const db = getDb()
  const fields = Object.keys(patch).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE groups SET ${fields} WHERE id = @id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group
}

export function deleteGroup(id: number): void {
  getDb().prepare('DELETE FROM groups WHERE id = ?').run(id)
}

export function assignEntriesToGroup(groupId: number | null, entryIds: number[]): void {
  if (entryIds.length === 0) return
  const db = getDb()
  const stmt = db.prepare('UPDATE entries SET group_id = ? WHERE id = ?')
  db.transaction((ids: number[]) => {
    for (const id of ids) stmt.run(groupId, id)
  })(entryIds)
}

export function assignEntriesForPeriod(groupId: number, from: number, to: number): number {
  const result = getDb()
    .prepare(`UPDATE entries SET group_id = ? WHERE timestamp >= ? AND timestamp < ?`)
    .run(groupId, from, to)
  return result.changes as number
}
