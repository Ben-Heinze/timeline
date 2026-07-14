import path from 'path'
import fs from 'fs'
import { getSettings } from './settings'

export function getLibraryPath(): string {
  return getSettings().libraryPath
}

export function getFilesPath(): string {
  return path.join(getLibraryPath(), 'files')
}

export function getThumbnailPath(size: 'small' | 'medium' | 'large'): string {
  return path.join(getLibraryPath(), 'thumbnails', size)
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
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
