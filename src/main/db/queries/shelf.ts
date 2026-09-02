import { getDb } from '../index'
import type { Entry, ShelfCategory, ShelfItemInfo, ShelfKind } from '../../../shared/types'

// ─── Categories ──────────────────────────────────────────────────────────────

export function listCategories(kind: ShelfKind): ShelfCategory[] {
  return getDb().prepare(`
    SELECT c.*, COUNT(si.entry_id) AS count
    FROM shelf_categories c
    LEFT JOIN shelf_items si ON si.category_id = c.id
    WHERE c.kind = ?
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all(kind) as ShelfCategory[]
}

export function getCategory(id: number): ShelfCategory | null {
  return getDb().prepare('SELECT * FROM shelf_categories WHERE id = ?').get(id) as ShelfCategory | null
}

export function createCategory(kind: ShelfKind, name: string, folderName: string): ShelfCategory {
  const result = getDb().prepare(`
    INSERT INTO shelf_categories (kind, name, folder_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(kind, name.trim(), folderName, Date.now())
  return getCategory(result.lastInsertRowid as number)!
}

export function renameCategory(id: number, name: string, folderName: string): ShelfCategory {
  getDb().prepare('UPDATE shelf_categories SET name = ?, folder_name = ? WHERE id = ?')
    .run(name.trim(), folderName, id)
  return getCategory(id)!
}

export function deleteCategory(id: number): void {
  // shelf_items.category_id has ON DELETE SET NULL — items become uncategorized.
  getDb().prepare('DELETE FROM shelf_categories WHERE id = ?').run(id)
}

// Used by the books-folder import: adopts an on-disk folder name verbatim as
// both the display name and folder_name.
export function findOrCreateCategoryByFolder(kind: ShelfKind, folderName: string): ShelfCategory {
  const existing = getDb()
    .prepare('SELECT * FROM shelf_categories WHERE kind = ? AND folder_name = ?')
    .get(kind, folderName) as ShelfCategory | undefined
  if (existing) return existing
  return createCategory(kind, folderName, folderName)
}

// ─── Items ───────────────────────────────────────────────────────────────────

// Mark entries as a book/recipe (or recategorize). Upsert: an entry already on
// the other shelf switches kind; its category always becomes the given one.
export function upsertShelfItems(entryIds: number[], kind: ShelfKind, categoryId: number | null): void {
  if (entryIds.length === 0) return
  const db = getDb()
  const ins = db.prepare(`
    INSERT INTO shelf_items (entry_id, kind, category_id, added_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET kind = excluded.kind, category_id = excluded.category_id
  `)
  const now = Date.now()
  db.transaction(() => {
    for (const id of entryIds) ins.run(id, kind, categoryId, now)
  })()
}

// Import-time marking: never clobbers an existing shelf row, so re-running the
// books-folder import can't undo the user's manual recategorization.
export function markIfUnmarked(entryIds: number[], kind: ShelfKind, categoryId: number | null): number {
  if (entryIds.length === 0) return 0
  const db = getDb()
  const ins = db.prepare(`
    INSERT OR IGNORE INTO shelf_items (entry_id, kind, category_id, added_at)
    VALUES (?, ?, ?, ?)
  `)
  const now = Date.now()
  let inserted = 0
  db.transaction(() => {
    for (const id of entryIds) inserted += ins.run(id, kind, categoryId, now).changes
  })()
  return inserted
}

export function unmarkEntries(entryIds: number[]): void {
  if (entryIds.length === 0) return
  const db = getDb()
  const del = db.prepare('DELETE FROM shelf_items WHERE entry_id = ?')
  db.transaction(() => {
    for (const id of entryIds) del.run(id)
  })()
}

export type ShelfEntryFilter = number | 'all' | 'uncategorized'

export function listShelfEntries(kind: ShelfKind, filter: ShelfEntryFilter): (Entry & { category_id: number | null })[] {
  const where =
    filter === 'all' ? '' :
    filter === 'uncategorized' ? 'AND si.category_id IS NULL' :
    'AND si.category_id = @categoryId'
  return getDb().prepare(`
    SELECT e.*, si.category_id AS category_id
    FROM entries e
    JOIN shelf_items si ON si.entry_id = e.id
    WHERE si.kind = @kind ${where}
    ORDER BY e.title COLLATE NOCASE, e.timestamp
  `).all({ kind, categoryId: typeof filter === 'number' ? filter : null }) as (Entry & { category_id: number | null })[]
}

export function getShelfInfoForEntries(entryIds: number[]): ShelfItemInfo[] {
  if (entryIds.length === 0) return []
  const placeholders = entryIds.map(() => '?').join(',')
  return getDb().prepare(`
    SELECT entry_id, kind, category_id FROM shelf_items WHERE entry_id IN (${placeholders})
  `).all(...entryIds) as ShelfItemInfo[]
}

// Entry ids in a category / uncategorized on a shelf — inputs to file moves.
export function listItemIdsInCategory(categoryId: number): number[] {
  return (getDb().prepare('SELECT entry_id FROM shelf_items WHERE category_id = ?')
    .all(categoryId) as { entry_id: number }[]).map(r => r.entry_id)
}

export function listUncategorizedItemIds(kind: ShelfKind): number[] {
  return (getDb().prepare('SELECT entry_id FROM shelf_items WHERE kind = ? AND category_id IS NULL')
    .all(kind) as { entry_id: number }[]).map(r => r.entry_id)
}

// Copy-mode entries whose file lives under a library-relative directory
// prefix (e.g. 'files/books/'). Used by the books-folder import's marking
// pass. Callers should re-check startsWith: LIKE treats '_' as a wildcard.
export function listCopyEntryPathsUnder(prefixDir: string): { id: number; file_path: string }[] {
  return getDb().prepare(`
    SELECT id, file_path FROM entries
    WHERE import_mode = 'copy' AND file_path LIKE ?
  `).all(prefixDir + '%') as { id: number; file_path: string }[]
}

// Repoint every copy-mode entry under a shelf category folder after the folder
// itself was renamed on disk (single fs.rename; the files didn't move relative
// to their folder). Prefixes are library-relative POSIX, e.g. 'files/books/math/'.
export function rewriteCopyFilePathPrefix(oldPrefix: string, newPrefix: string): number {
  return getDb().prepare(`
    UPDATE entries
    SET file_path = ? || substr(file_path, ?)
    WHERE import_mode = 'copy' AND file_path LIKE ? ESCAPE '\\'
  `).run(
    newPrefix,
    oldPrefix.length + 1,
    oldPrefix.replace(/[\\%_]/g, c => '\\' + c) + '%',
  ).changes
}
