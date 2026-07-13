import { getDb } from '../index'
import type { Group, GroupStats, NewGroup } from '../../../shared/types'

export function listGroups(): Group[] {
  return getDb().prepare('SELECT * FROM groups ORDER BY name').all() as Group[]
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
