import path from 'path'
import { getLibraryPath } from '../library'
import { getVolumeById } from '../db/queries/volumes'
import { getMountPathForSerial } from './index'
import type { Entry } from '../../shared/types'

/**
 * The single place that turns an entry's stored file_path into an absolute
 * path on disk. Three cases, matching Entry.file_path's three storage
 * conventions: library-relative (copy), absolute (reference, no volume),
 * volume-root-relative (reference, volume_id set — resolved against wherever
 * that volume is currently mounted; null if it isn't mounted at all).
 */
export function resolveEntryAbsolutePath(entry: Entry): string | null {
  if (!entry.file_path) return null
  if (entry.import_mode === 'copy') return path.join(getLibraryPath(), entry.file_path)
  if (entry.volume_id == null) return entry.file_path

  const vol = getVolumeById(entry.volume_id)
  if (!vol) return null
  const mountPath = getMountPathForSerial(vol.volume_serial)
  if (!mountPath) return null
  return path.join(mountPath, entry.file_path)
}
