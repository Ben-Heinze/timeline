import { getDb } from '../index'
import type { Tag } from '../../../shared/types'

export function listTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
}

function getOrCreateTag(name: string): Tag {
  const db = getDb()
  const trimmed = name.trim()
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(trimmed) as Tag | undefined
  if (existing) return existing
  const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed)
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid) as Tag
}

export function createTag(name: string): Tag {
  return getOrCreateTag(name)
}

export function deleteTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function getEntryTags(entryId: number): Tag[] {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    JOIN entry_tags et ON et.tag_id = t.id
    WHERE et.entry_id = ?
    ORDER BY t.name
  `).all(entryId) as Tag[]
}

export function setEntryTags(entryId: number, tagNames: string[]): Tag[] {
  const db = getDb()
  const tags = tagNames.map(n => n.trim()).filter(Boolean).map(getOrCreateTag)
  db.transaction(() => {
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId)
    const ins = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')
    for (const t of tags) ins.run(entryId, t.id)
  })()
  return getEntryTags(entryId)
}

export function getGroupTags(groupId: number): Tag[] {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    JOIN group_tags gt ON gt.tag_id = t.id
    WHERE gt.group_id = ?
    ORDER BY t.name
  `).all(groupId) as Tag[]
}

export function setGroupTags(groupId: number, tagNames: string[]): Tag[] {
  const db = getDb()
  const tags = tagNames.map(n => n.trim()).filter(Boolean).map(getOrCreateTag)
  db.transaction(() => {
    db.prepare('DELETE FROM group_tags WHERE group_id = ?').run(groupId)
    const ins = db.prepare('INSERT OR IGNORE INTO group_tags (group_id, tag_id) VALUES (?, ?)')
    for (const t of tags) ins.run(groupId, t.id)
  })()
  return getGroupTags(groupId)
}
