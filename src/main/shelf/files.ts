import path from 'path'
import { promises as fs } from 'fs'
import fsc from 'fs'
import { getFilesPath, getLibraryPath } from '../library'
import { getEntry, updateEntry } from '../db/queries/entries'
import { rewriteCopyFilePathPrefix } from '../db/queries/shelf'
import type { ShelfCategory, ShelfKind, ShelfMoveResult } from '../../shared/types'

// On-disk shelf roots. Lowercase on purpose: the library can live on a
// case-insensitive filesystem and files/books/ already exists — creating
// files/Books/ there would silently resolve to the same directory.
export function shelfFolderName(kind: ShelfKind): string {
  return kind === 'book' ? 'books' : 'recipes'
}

export function shelfRootDir(kind: ShelfKind): string {
  return path.join(getFilesPath(), shelfFolderName(kind))
}

/**
 * Deterministic category-name → folder-name mapping. Always lowercase (see
 * shelfFolderName) and filesystem-safe on every platform. Throws on names
 * with no usable characters.
 */
export function sanitizeCategoryFolderName(name: string): string {
  let s = name.normalize('NFC').trim().toLowerCase()
  s = s.replace(/[^a-z0-9._-]+/g, '_')
  s = s.replace(/^[._-]+|[._-]+$/g, '')
  s = s.slice(0, 64)
  if (s === '' || s === '.' || s === '..') {
    throw new Error('Category name must contain a letter or digit')
  }
  return s
}

/**
 * Move into destDir keeping the file name, appending " (2)", " (3)", … on
 * collision. Probe-then-rename: shelf moves run sequentially with the folder
 * watcher stopped, so nothing else claims names in destDir concurrently.
 * (No COPYFILE_EXCL-style atomic claim exists for rename, and hard-link
 * tricks are unreliable on external exFAT/NTFS drives.)
 */
export async function renameWithUniqueName(sourceAbs: string, destDir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName)
  const stem = path.basename(fileName, ext)
  for (let n = 1; ; n++) {
    const destName = n === 1 ? fileName : `${stem} (${n})${ext}`
    const destPath = path.join(destDir, destName)
    try {
      await fs.access(destPath)
      continue // name taken → next suffix
    } catch { /* free */ }
    try {
      await fs.rename(sourceAbs, destPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      // Different device (symlinked subfolder): copy, verify, then remove the
      // source — never the other way around.
      await fs.copyFile(sourceAbs, destPath, fsc.constants.COPYFILE_EXCL)
      const [src, dst] = await Promise.all([fs.stat(sourceAbs), fs.stat(destPath)])
      if (src.size !== dst.size) {
        await fs.unlink(destPath)
        throw new Error('copy verification failed (size mismatch)')
      }
      await fs.unlink(sourceAbs)
    }
    return destName
  }
}

/**
 * Physically move copy-mode entries into their shelf folder and rewrite
 * entries.file_path. Reference-mode entries are never touched on disk — the
 * file-safety invariant. Callers must hold the watcher stopped.
 *
 * Metadata-first: shelf_items rows are written before this runs; each
 * successful move updates file_path immediately, so a failure mid-batch
 * leaves no DB↔disk divergence and re-applying the category retries only
 * the stragglers (already-home files are skipped).
 */
export async function moveEntriesIntoShelf(
  entryIds: number[],
  kind: ShelfKind,
  category: ShelfCategory | null,
): Promise<Omit<ShelfMoveResult, 'marked'>> {
  const destDir = category ? path.join(shelfRootDir(kind), category.folder_name) : shelfRootDir(kind)
  const result: Omit<ShelfMoveResult, 'marked'> = { moved: 0, skippedReference: 0, failures: [] }

  for (const id of entryIds) {
    const entry = getEntry(id)
    if (!entry || !entry.file_path) continue
    if (entry.import_mode !== 'copy') {
      result.skippedReference++
      continue
    }
    if (entry.is_missing) continue

    const currentAbs = path.join(getLibraryPath(), entry.file_path)
    if (path.dirname(currentAbs) === destDir) continue // already home

    try {
      await fs.mkdir(destDir, { recursive: true })
      const destName = await renameWithUniqueName(currentAbs, destDir, path.basename(currentAbs))
      const newRel = path
        .join('files', shelfFolderName(kind), category ? category.folder_name : '', destName)
        .split(path.sep).join('/')
      updateEntry(id, { file_path: newRel })
      result.moved++
    } catch (err) {
      result.failures.push({ entryId: id, error: (err as Error).message })
    }
  }
  return result
}

/** Case-insensitive lookup of a child directory's real on-disk name. */
async function realCasedChild(parentDir: string, name: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.readdir(parentDir)
  } catch {
    return null
  }
  const lower = name.toLowerCase()
  return names.find(n => n.toLowerCase() === lower) ?? null
}

/** Remove a directory only if it is empty; never an error if it isn't. */
export async function rmdirIfEmpty(dir: string): Promise<void> {
  try {
    await fs.rmdir(dir) // non-recursive: fails on non-empty, which is the safety
  } catch { /* not empty, doesn't exist, … — all fine */ }
}

/**
 * Rename a category's on-disk folder and repoint the file_path of every
 * copy-mode entry under it. Returns the per-file fallback ids when the target
 * folder already exists (caller then moves items individually).
 * Callers must hold the watcher stopped.
 */
export async function renameCategoryFolder(
  kind: ShelfKind,
  oldFolderName: string,
  newFolderName: string,
): Promise<{ needsPerFileMove: boolean }> {
  if (oldFolderName === newFolderName) return { needsPerFileMove: false }
  const root = shelfRootDir(kind)
  const oldDir = path.join(root, oldFolderName)
  const newDir = path.join(root, newFolderName)

  const oldExists = (await realCasedChild(root, oldFolderName)) !== null
  if (!oldExists) return { needsPerFileMove: false } // nothing ever moved there — DB-only rename

  // On a case-insensitive FS fs.rename onto an existing directory can clobber
  // or merge unpredictably, so probe with a real-cased readdir first.
  const newExists = (await realCasedChild(root, newFolderName)) !== null
  if (newExists) return { needsPerFileMove: true }

  await fs.rename(oldDir, newDir)
  const prefix = (f: string) => `files/${shelfFolderName(kind)}/${f}/`
  rewriteCopyFilePathPrefix(prefix(oldFolderName), prefix(newFolderName))
  return { needsPerFileMove: false }
}
