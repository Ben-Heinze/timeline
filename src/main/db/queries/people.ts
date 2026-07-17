import { getDb } from '../index'
import type { Person, PersonListItem, NewPerson, Entry } from '../../../shared/types'

// People with their tagged-entry count and avatar thumbnail, for the People tab list.
export function listPeople(): PersonListItem[] {
  return getDb().prepare(`
    SELECT p.*,
           COUNT(ep.entry_id)        AS count,
           av.thumbnail_small        AS avatar_thumb
    FROM people p
    LEFT JOIN entry_people ep ON ep.person_id = p.id
    LEFT JOIN entries av       ON av.id = p.avatar_entry_id
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `).all() as PersonListItem[]
}

export function getPerson(id: number): Person | null {
  return getDb().prepare('SELECT * FROM people WHERE id = ?').get(id) as Person | null
}

export function createPerson(data: NewPerson): Person {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO people
      (kind, name, color, relationship, birthday, notes, email, phone, address, species, breed, avatar_entry_id, created_at)
    VALUES
      (@kind, @name, @color, @relationship, @birthday, @notes, @email, @phone, @address, @species, @breed, @avatar_entry_id, @created_at)
  `).run({
    kind: data.kind,
    name: data.name.trim(),
    color: data.color,
    relationship: data.relationship ?? null,
    birthday: data.birthday ?? null,
    notes: data.notes ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    address: data.address ?? null,
    species: data.species ?? null,
    breed: data.breed ?? null,
    avatar_entry_id: data.avatar_entry_id ?? null,
    created_at: Date.now(),
  })
  return getPerson(result.lastInsertRowid as number)!
}

export function updatePerson(id: number, patch: Partial<Omit<Person, 'id'>>): Person {
  const db = getDb()
  const keys = Object.keys(patch)
  if (keys.length > 0) {
    const fields = keys.map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE people SET ${fields} WHERE id = @id`).run({ ...patch, id })
  }
  return getPerson(id)!
}

export function deletePerson(id: number): void {
  getDb().prepare('DELETE FROM people WHERE id = ?').run(id)
}

// ─── Tagging people in entries ───────────────────────────────────────────────

export function getEntryPeople(entryId: number): Person[] {
  return getDb().prepare(`
    SELECT p.* FROM people p
    JOIN entry_people ep ON ep.person_id = p.id
    WHERE ep.entry_id = ?
    ORDER BY p.name COLLATE NOCASE
  `).all(entryId) as Person[]
}

export function setEntryPeople(entryId: number, personIds: number[]): Person[] {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM entry_people WHERE entry_id = ?').run(entryId)
    const ins = db.prepare('INSERT OR IGNORE INTO entry_people (entry_id, person_id) VALUES (?, ?)')
    for (const pid of personIds) ins.run(entryId, pid)
  })()
  return getEntryPeople(entryId)
}

export function bulkAddPeopleToEntries(entryIds: number[], personIds: number[]): void {
  if (entryIds.length === 0 || personIds.length === 0) return
  const db = getDb()
  const ins = db.prepare('INSERT OR IGNORE INTO entry_people (entry_id, person_id) VALUES (?, ?)')
  db.transaction(() => {
    for (const eid of entryIds) {
      for (const pid of personIds) ins.run(eid, pid)
    }
  })()
}

// Every entry a person is tagged in, newest first — for their profile's media grid.
export function getPersonEntries(personId: number): Entry[] {
  return getDb().prepare(`
    SELECT e.* FROM entries e
    JOIN entry_people ep ON ep.entry_id = e.id
    WHERE ep.person_id = ?
    ORDER BY e.timestamp DESC
  `).all(personId) as Entry[]
}
