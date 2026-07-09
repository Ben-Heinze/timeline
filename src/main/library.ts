import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let libraryPath: string | null = null

export function getLibraryPath(): string {
  if (!libraryPath) {
    libraryPath = path.join(app.getPath('userData'), 'library')
  }
  return libraryPath
}

export function getFilesPath(): string {
  return path.join(getLibraryPath(), 'files')
}

export function getThumbnailPath(size: 'small' | 'medium' | 'large'): string {
  return path.join(getLibraryPath(), 'thumbnails', size)
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
