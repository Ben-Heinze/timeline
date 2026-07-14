import { app } from 'electron'
import { listMountedVolumes, type DetectedVolume } from './detect'
import { listVolumes, getVolumeBySerial, insertVolume, touchVolume } from '../db/queries/volumes'
import { isPathUnder } from '../library'
import { getSettings, saveSettings } from '../settings'
import type { VolumeStatus } from '../../shared/types'

let cache: DetectedVolume[] = []
let primarySerial: string | null = null

/** Re-probes mounted volumes and refreshes last-seen info for known ones. Does
 * NOT register unrecognized drives — a `volumes` row is only created when the
 * user links a watched folder to it (see findOrCreateVolumeForPath). */
export async function refreshVolumes(): Promise<void> {
  cache = await listMountedVolumes()
  primarySerial = findVolumeForPath(app.getPath('userData'))?.serial ?? null

  const now = Date.now()
  for (const dv of cache) {
    const existing = getVolumeBySerial(dv.serial)
    if (existing) touchVolume(existing.id, dv.mountPath, now)
  }
}

/** The currently mounted volume that most closely encloses absPath (longest mount-path prefix match). */
export function findVolumeForPath(absPath: string): DetectedVolume | null {
  let best: DetectedVolume | null = null
  for (const v of cache) {
    if (isPathUnder(v.mountPath, absPath) && (!best || v.mountPath.length > best.mountPath.length)) {
      best = v
    }
  }
  return best
}

export function getMountPathForSerial(serial: string): string | null {
  return cache.find(v => v.serial === serial)?.mountPath ?? null
}

export function isPrimaryVolume(serial: string): boolean {
  return serial === primarySerial
}

/** DB-known volumes joined against live connectivity, for the renderer. */
export function getVolumeStatuses(): VolumeStatus[] {
  return listVolumes().map(v => {
    const detected = cache.find(dv => dv.serial === v.volume_serial)
    return {
      id: v.id,
      label: v.label,
      volume_serial: v.volume_serial,
      connected: !!detected,
      mountPath: detected?.mountPath ?? null,
    }
  })
}

/** Used when adding a watched folder: identifies which removable volume (if
 * any) it lives on, creating a `volumes` row on first sight. Folders on the
 * primary disk or that don't resolve to any detected volume (e.g. a NAS
 * mount) return a null volumeId — they're tracked as plain folders. */
export function findOrCreateVolumeForPath(absPath: string): { volumeId: number | null; osLabel: string | null } {
  const detected = findVolumeForPath(absPath)
  if (!detected || detected.serial === primarySerial) return { volumeId: null, osLabel: null }

  const existing = getVolumeBySerial(detected.serial)
  if (existing) return { volumeId: existing.id, osLabel: detected.osLabel }

  const now = Date.now()
  const id = insertVolume({
    label: detected.osLabel,
    volume_serial: detected.serial,
    last_mount_path: detected.mountPath,
    last_seen_at: now,
    created_at: now,
  })
  return { volumeId: id, osLabel: detected.osLabel }
}

/**
 * One-time upgrade path: watched folders saved before volume tracking
 * existed have volumeId: null. On the first startup after upgrading, try to
 * match each one to a currently-mounted volume so users don't have to
 * re-add folders they already configured. Call after refreshVolumes().
 */
export function backfillWatchedFolderVolumes(): void {
  const settings = getSettings()
  let changed = false
  const next = settings.watchedFolders.map(f => {
    if (f.volumeId != null) return f
    const { volumeId } = findOrCreateVolumeForPath(f.path)
    if (volumeId == null) return f
    changed = true
    return { ...f, volumeId }
  })
  if (changed) saveSettings({ ...settings, watchedFolders: next })
}
