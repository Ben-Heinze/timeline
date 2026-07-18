import path from 'path'
import fs from 'fs'
import { getActiveLibraryPath } from './profiles'

export function getLibraryPath(): string {
  return getActiveLibraryPath()
}

export function getFilesPath(): string {
  return path.join(getLibraryPath(), 'files')
}

export function getThumbnailPath(size: 'small' | 'medium' | 'large'): string {
  return path.join(getLibraryPath(), 'thumbnails', size)
}

// Raw Spotify "Extended streaming history" exports are copied here on import so
// the source data is preserved in the library alongside media, even though the
// parsed plays already live in the DB.
export function getSpotifyPath(): string {
  return path.join(getLibraryPath(), 'spotify')
}

/** True if `target` is inside (or equal to) `root`. */
export function isPathUnder(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function ensureLibraryDirs(): void {
  const dirs = [
    getLibraryPath(),
    getFilesPath(),
    getThumbnailPath('small'),
    getThumbnailPath('medium'),
    getThumbnailPath('large'),
    getSpotifyPath(),
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
