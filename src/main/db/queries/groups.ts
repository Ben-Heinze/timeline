import { getDb } from '../index'
import type { Group, NewGroup } from '../../../shared/types'

export function listGroups(): Group[] {
  return getDb().prepare('SELECT * FROM groups ORDER BY name').all() as Group[]
}

export function createGroup(data: NewGroup): Group {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO groups (name, parent_id, color, created_at)
    VALUES (@name, @parent_id, @color, @created_at)
  `).run({ ...data, created_at: Date.now() })
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
