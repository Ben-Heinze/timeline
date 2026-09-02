import { test, expect } from './fixture'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }
type Pg = import('playwright-core').Page

interface EntryRow {
  id: number
  title: string | null
  import_mode: 'copy' | 'reference'
  file_path: string | null
}
interface ShelfCategoryRow { id: number; kind: string; name: string; folder_name: string }
interface ShelfItemRow { entry_id: number; kind: string; category_id: number | null }
interface MoveResult { marked: number; moved: number; skippedReference: number; failures: { entryId: number; error: string }[] }
interface WatchedFolder { path: string; volumeId: number | null }

const sha256 = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const listAll = (page: Pg) =>
  page.evaluate(() =>
    (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' })
  ) as Promise<EntryRow[]>

const findByTitle = async (page: Pg, title: string) =>
  (await listAll(page)).find(e => e.title === title)

const shelfInfo = (page: Pg, ids: number[]) =>
  page.evaluate((ids) => (window as unknown as AnyApi).api.shelf.forEntries(ids), ids) as Promise<ShelfItemRow[]>

const markEntries = (page: Pg, ids: number[], kind: string, categoryId: number | null) =>
  page.evaluate(
    ([ids, kind, categoryId]) => (window as unknown as AnyApi).api.shelf.markEntries(ids, kind, categoryId),
    [ids, kind, categoryId] as [number[], string, number | null],
  ) as Promise<MoveResult>

/**
 * Books & Recipes ("shelf"): marking copy-mode entries moves their file into
 * files/books/<category>/ or files/recipes/<category>/, while reference-mode
 * entries — the user's own originals — are never touched on disk (the app's
 * file-safety invariant). These tests drive the real IPC paths and assert the
 * on-disk outcomes.
 */
test.describe('Shelf — Books & Recipes', () => {
  let libraryPath: string
  let extDir: string      // "external" folder: files referenced in place
  let srcDir: string      // source folder for copy-mode imports
  const seededIds: number[] = []
  const seededCategoryIds: number[] = []

  test.beforeAll(async ({ appPage: page }) => {
    extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-shelf-ext-'))
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-shelf-src-'))

    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { libraryPath: string; watchedFolders: WatchedFolder[] }
    libraryPath = settings.libraryPath
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }),
      [...settings.watchedFolders, { path: extDir, volumeId: null }],
    )
  })

  test.afterAll(async ({ appPage: page }) => {
    // Specs share one app + library: remove everything this spec created.
    for (const id of seededCategoryIds) {
      await page.evaluate((id) => (window as unknown as AnyApi).api.shelf.deleteCategory(id), id).catch(() => {})
    }
    if (seededIds.length > 0) {
      await page.evaluate((ids) => (window as unknown as AnyApi).api.entries.delete(ids), seededIds).catch(() => {})
    }
    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { watchedFolders: WatchedFolder[] }
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }),
      settings.watchedFolders.filter(f => f.path !== extDir),
    )
    fs.rmSync(extDir, { recursive: true, force: true })
    fs.rmSync(srcDir, { recursive: true, force: true })
  })

  async function importCopyFile(page: Pg, name: string, content: string): Promise<EntryRow> {
    const src = path.join(srcDir, name)
    fs.writeFileSync(src, content)
    await page.evaluate((p) => (window as unknown as AnyApi).api.ingest.start([p]), src)
    const entry = await findByTitle(page, name)
    expect(entry, `${name} should have been imported`).toBeTruthy()
    seededIds.push(entry!.id)
    return entry!
  }

  async function createCategory(page: Pg, kind: string, name: string): Promise<ShelfCategoryRow> {
    const cat = await page.evaluate(
      ([kind, name]) => (window as unknown as AnyApi).api.shelf.createCategory(kind, name),
      [kind, name] as [string, string],
    ) as ShelfCategoryRow
    seededCategoryIds.push(cat.id)
    return cat
  }

  test('marking as book moves copy-mode files into the category folder and never touches referenced originals', async ({ appPage: page }) => {
    const refFile = path.join(extDir, `shelf-ref-${Date.now()}.txt`)
    fs.writeFileSync(refFile, `referenced original ${Date.now()}`)
    const refBefore = sha256(refFile)
    await page.evaluate(() => (window as unknown as AnyApi).api.sync.run())
    const refEntry = await findByTitle(page, path.basename(refFile))
    expect(refEntry).toBeTruthy()
    expect(refEntry!.import_mode).toBe('reference')
    seededIds.push(refEntry!.id)

    const copy1 = await importCopyFile(page, `shelf-copy1-${Date.now()}.txt`, 'copy one')
    const copy2 = await importCopyFile(page, `shelf-copy2-${Date.now()}.txt`, 'copy two')

    const cat = await createCategory(page, 'book', 'Test Cat')
    expect(cat.folder_name).toBe('test_cat')

    const r = await markEntries(page, [copy1.id, copy2.id, refEntry!.id], 'book', cat.id)
    expect(r.marked).toBe(3)
    expect(r.moved).toBe(2)
    expect(r.skippedReference).toBe(1)
    expect(r.failures).toEqual([])

    // Copy files physically live in the category folder, DB paths rewritten.
    for (const e of [copy1, copy2]) {
      const updated = (await listAll(page)).find(x => x.id === e.id)!
      expect(updated.file_path).toBe(`files/books/test_cat/${e.title}`)
      expect(fs.existsSync(path.join(libraryPath, updated.file_path!))).toBe(true)
    }
    // The referenced original is marked in the DB but untouched on disk.
    const refAfter = (await listAll(page)).find(x => x.id === refEntry!.id)!
    expect(refAfter.file_path).toBe(refFile)
    expect(fs.existsSync(refFile)).toBe(true)
    expect(sha256(refFile)).toBe(refBefore)

    const info = await shelfInfo(page, [copy1.id, copy2.id, refEntry!.id])
    expect(info).toHaveLength(3)
    expect(info.every(i => i.kind === 'book' && i.category_id === cat.id)).toBe(true)

    // Re-applying the same category is a no-op, not a duplicate copy.
    const r2 = await markEntries(page, [copy1.id], 'book', cat.id)
    expect(r2.moved).toBe(0)
    expect(fs.readdirSync(path.join(libraryPath, 'files/books/test_cat'))
      .filter(n => n === copy1.title).length).toBe(1)
  })

  test('name collisions in a category get a unique suffix', async ({ appPage: page }) => {
    const cat = await createCategory(page, 'book', 'Collide')
    const sub = path.join(srcDir, 'sub')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(srcDir, 'same-name.txt'), 'first body')
    fs.writeFileSync(path.join(sub, 'same-name.txt'), 'second body — different bytes')
    await page.evaluate((ps) => (window as unknown as AnyApi).api.ingest.start(ps),
      [path.join(srcDir, 'same-name.txt'), path.join(sub, 'same-name.txt')])
    const both = (await listAll(page)).filter(e => e.title === 'same-name.txt')
    expect(both).toHaveLength(2)
    seededIds.push(...both.map(e => e.id))

    const r = await markEntries(page, both.map(e => e.id), 'book', cat.id)
    expect(r.moved).toBe(2)
    const names = fs.readdirSync(path.join(libraryPath, 'files/books/collide')).sort()
    expect(names).toEqual(['same-name (2).txt', 'same-name.txt'])
  })

  test('rename category renames the folder and rewrites paths; delete moves items to the shelf root', async ({ appPage: page }) => {
    const cat = await createCategory(page, 'book', 'Before Name')
    const entry = await importCopyFile(page, `shelf-rename-${Date.now()}.txt`, 'rename victim')
    await markEntries(page, [entry.id], 'book', cat.id)

    const renamed = await page.evaluate(
      ([id, name]) => (window as unknown as AnyApi).api.shelf.renameCategory(id, name),
      [cat.id, 'After Name'] as [number, string],
    ) as ShelfCategoryRow
    expect(renamed.folder_name).toBe('after_name')
    expect(fs.existsSync(path.join(libraryPath, 'files/books/before_name'))).toBe(false)
    let updated = (await listAll(page)).find(x => x.id === entry.id)!
    expect(updated.file_path).toBe(`files/books/after_name/${entry.title}`)
    expect(fs.existsSync(path.join(libraryPath, updated.file_path!))).toBe(true)

    await page.evaluate((id) => (window as unknown as AnyApi).api.shelf.deleteCategory(id), cat.id)
    updated = (await listAll(page)).find(x => x.id === entry.id)!
    expect(updated.file_path).toBe(`files/books/${entry.title}`)
    expect(fs.existsSync(path.join(libraryPath, updated.file_path!))).toBe(true)
    const [info] = await shelfInfo(page, [entry.id])
    expect(info.kind).toBe('book')
    expect(info.category_id).toBeNull()
    expect(fs.existsSync(path.join(libraryPath, 'files/books/after_name'))).toBe(false)
  })

  test('unmarking removes the shelf row but leaves the file where it is', async ({ appPage: page }) => {
    const entry = await importCopyFile(page, `shelf-unmark-${Date.now()}.txt`, 'stays put')
    await markEntries(page, [entry.id], 'recipe', null)
    let updated = (await listAll(page)).find(x => x.id === entry.id)!
    expect(updated.file_path).toBe(`files/recipes/${entry.title}`)

    await page.evaluate((ids) => (window as unknown as AnyApi).api.shelf.unmarkEntries(ids), [entry.id])
    expect(await shelfInfo(page, [entry.id])).toHaveLength(0)
    updated = (await listAll(page)).find(x => x.id === entry.id)!
    expect(updated.file_path).toBe(`files/recipes/${entry.title}`)
    expect(fs.existsSync(path.join(libraryPath, updated.file_path!))).toBe(true)
  })

  test('importBooksFolder indexes a pre-existing books tree in place, idempotently', async ({ appPage: page }) => {
    // Simulate the user's pre-existing library folder: a file on disk under
    // files/books/<subfolder>/ that the database knows nothing about.
    const catDir = path.join(libraryPath, 'files/books/legacy_shelf')
    fs.mkdirSync(catDir, { recursive: true })
    const legacy = path.join(catDir, 'old-book.txt')
    fs.writeFileSync(legacy, `pre-existing book ${Date.now()}`)
    const before = sha256(legacy)

    // (The folder watcher may also notice the new file; the import's path-based
    // marking pass makes the final state identical either way.)
    for (let run = 1; run <= 2; run++) {
      await page.evaluate(() => (window as unknown as AnyApi).api.shelf.importBooksFolder())

      const entries = (await listAll(page)).filter(e => e.title === 'old-book.txt')
      expect(entries, `run ${run}: exactly one entry`).toHaveLength(1)
      expect(entries[0].import_mode).toBe('copy')
      expect(entries[0].file_path).toBe('files/books/legacy_shelf/old-book.txt')

      // Indexed in place: same path, same bytes, nothing copied or moved.
      expect(sha256(legacy)).toBe(before)

      const [info] = await shelfInfo(page, [entries[0].id])
      expect(info, `run ${run}: marked as book`).toBeTruthy()
      expect(info.kind).toBe('book')

      const cats = await page.evaluate(() =>
        (window as unknown as AnyApi).api.shelf.listCategories('book')
      ) as ShelfCategoryRow[]
      const legacyCat = cats.find(c => c.folder_name === 'legacy_shelf')
      expect(legacyCat, `run ${run}: category adopted from folder`).toBeTruthy()
      expect(info.category_id).toBe(legacyCat!.id)
      if (run === 1) seededCategoryIds.push(legacyCat!.id)
      if (run === 1) seededIds.push(entries[0].id)
    }
  })
})
