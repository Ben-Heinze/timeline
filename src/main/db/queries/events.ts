import { getDb } from '../index'
import type { LifeEvent, NewLifeEvent } from '../../../shared/types'

export function listEvents(): LifeEvent[] {
  return getDb().prepare('SELECT * FROM events ORDER BY date_from, title').all() as LifeEvent[]
}

export function createEvent(data: NewLifeEvent): LifeEvent {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO events (title, description, color, date_from, date_to, created_at)
    VALUES (@title, @description, @color, @date_from, @date_to, @created_at)
  `).run({
    title: data.title,
    description: data.description ?? null,
    color: data.color,
    date_from: data.date_from,
    date_to: data.date_to ?? null,
    created_at: Date.now(),
  })
  return db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as LifeEvent
}

export function updateEvent(id: number, patch: Partial<Omit<LifeEvent, 'id'>>): LifeEvent {
  const db = getDb()
  const fields = Object.keys(patch).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE events SET ${fields} WHERE id = @id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as LifeEvent
}

export function deleteEvent(id: number): void {
  getDb().prepare('DELETE FROM events WHERE id = ?').run(id)
}
