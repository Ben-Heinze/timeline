import { getDb } from '../index'
import type { Volume } from '../../../shared/types'

export function listVolumes(): Volume[] {
  return getDb().prepare('SELECT * FROM volumes ORDER BY label').all() as Volume[]
}

export function getVolumeById(id: number): Volume | null {
  return getDb().prepare('SELECT * FROM volumes WHERE id = ?').get(id) as Volume | null
}

export function getVolumeBySerial(serial: string): Volume | null {
  return getDb().prepare('SELECT * FROM volumes WHERE volume_serial = ?').get(serial) as Volume | null
}

export function insertVolume(data: Omit<Volume, 'id'>): number {
  const result = getDb().prepare(`
    INSERT INTO volumes (label, volume_serial, last_mount_path, last_seen_at, created_at)
    VALUES (@label, @volume_serial, @last_mount_path, @last_seen_at, @created_at)
  `).run(data)
  return result.lastInsertRowid as number
}

export function touchVolume(id: number, mountPath: string, seenAt: number): void {
  getDb().prepare('UPDATE volumes SET last_mount_path = ?, last_seen_at = ? WHERE id = ?').run(mountPath, seenAt, id)
}

export function updateVolumeLabel(id: number, label: string): void {
  getDb().prepare('UPDATE volumes SET label = ? WHERE id = ?').run(label, id)
}
