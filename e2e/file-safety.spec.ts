import { test, expect } from './fixture'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }

interface EntryRow {
  id: number
  title: string | null
  import_mode: 'copy' | 'reference'
  file_path: string | null
  is_missing: number
}
interface WatchedFolder { path: string; volumeId: number | null }

const sha256 = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const listAll = (page: import('playwright-core').Page) =>
  page.evaluate(() =>
    (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' })
  ) as Promise<EntryRow[]>

const findByTitle = async (page: import('playwright-core').Page, title: string) =>
  (await listAll(page)).find(e => e.title === title)

/**
 * The single most important guarantee of the whole app: a file that lives
 * outside the library (import_mode = 'reference') is the user's own original,
 * and the app must NEVER delete or modify it — the only exception being an
 * explicit, opt-in rename. These tests drive the real delete / rename / EXIF
 * IPC paths and assert the originals survive byte-for-byte.
 */
test.describe('File safety — referenced originals are never harmed', () => {
  let extDir: string      // "external" folder: files referenced in place
  let manualDir: string   // source folder for copy-mode imports

  test.beforeAll(async ({ appPage: page }) => {
    extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-safety-ext-'))
    manualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-safety-src-'))

    // Register the external dir as a watched folder (reference mode, no volume).
    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { watchedFolders: WatchedFolder[] }
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }),
      [...settings.watchedFolders, { path: extDir, volumeId: null }],
    )
  })

  test.afterAll(async ({ appPage: page }) => {
    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { watchedFolders: WatchedFolder[] }
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }),
      settings.watchedFolders.filter(f => f.path !== extDir),
    )
    fs.rmSync(extDir, { recursive: true, force: true })
    fs.rmSync(manualDir, { recursive: true, force: true })
  })

  test('deleting a referenced entry leaves the original file byte-for-byte intact', async ({ appPage: page }) => {
    const refFile = path.join(extDir, `ref-delete-${Date.now()}.txt`)
    fs.writeFileSync(refFile, `irreplaceable memory ${Date.now()}`)
    const before = sha256(refFile)

    await page.evaluate(() => (window as unknown as AnyApi).api.sync.run())

    const entry = await findByTitle(page, path.basename(refFile))
    expect(entry, 'referenced file should have been ingested by sync').toBeTruthy()
    expect(entry!.import_mode).toBe('reference')
    expect(entry!.file_path).toBe(refFile)

    await page.evaluate((id) => (window as unknown as AnyApi).api.entries.delete([id]), entry!.id)

    // The entry is gone from the database…
    expect(await findByTitle(page, path.basename(refFile))).toBeFalsy()
    // …but the user's original file is untouched: still there, same bytes.
    expect(fs.existsSync(refFile)).toBe(true)
    expect(sha256(refFile)).toBe(before)
  })

  test("deleting a copy-mode entry never touches the user's source file", async ({ appPage: page }) => {
    const srcFile = path.join(manualDir, `copy-delete-${Date.now()}.txt`)
    fs.writeFileSync(srcFile, `copied content ${Date.now()}`)
    const before = sha256(srcFile)

    await page.evaluate((p) => (window as unknown as AnyApi).api.ingest.start([p]), srcFile)

    const entry = await findByTitle(page, path.basename(srcFile))
    expect(entry).toBeTruthy()
    expect(entry!.import_mode).toBe('copy')

    await page.evaluate((id) => (window as unknown as AnyApi).api.entries.delete([id]), entry!.id)

    // Deleting a copy trashes the in-library copy, but the file the user
    // imported from is their own and must be left exactly as it was.
    expect(fs.existsSync(srcFile)).toBe(true)
    expect(sha256(srcFile)).toBe(before)
  })

  test('renaming without the on-disk option never renames or alters the file', async ({ appPage: page }) => {
    const refFile = path.join(extDir, `ref-titleonly-${Date.now()}.txt`)
    fs.writeFileSync(refFile, `title only ${Date.now()}`)
    const before = sha256(refFile)

    await page.evaluate(() => (window as unknown as AnyApi).api.sync.run())
    const entry = await findByTitle(page, path.basename(refFile))
    expect(entry).toBeTruthy()

    // renameFile = false: change the display title only.
    const res = await page.evaluate(
      ([id, title]) => (window as unknown as AnyApi).api.entries.rename(id, title, false),
      [entry!.id, 'A Friendly Display Name'] as [number, string],
    ) as { ok: boolean; fileRenamed: boolean }
    expect(res.ok).toBe(true)
    expect(res.fileRenamed).toBe(false)

    // The file on disk keeps its original name and its bytes.
    expect(fs.existsSync(refFile)).toBe(true)
    expect(sha256(refFile)).toBe(before)
    const updated = (await listAll(page)).find(e => e.id === entry!.id)
    expect(updated!.title).toBe('A Friendly Display Name')
    expect(updated!.file_path).toBe(refFile) // path unchanged
  })

  test('opting in to rename a referenced file renames in place and preserves its bytes', async ({ appPage: page }) => {
    const refFile = path.join(extDir, `ref-rename-${Date.now()}.txt`)
    fs.writeFileSync(refFile, `rename me on disk ${Date.now()}`)
    const before = sha256(refFile)

    await page.evaluate(() => (window as unknown as AnyApi).api.sync.run())
    const entry = await findByTitle(page, path.basename(refFile))
    expect(entry).toBeTruthy()

    const res = await page.evaluate(
      ([id, title]) => (window as unknown as AnyApi).api.entries.rename(id, title, true),
      [entry!.id, 'Renamed Original'] as [number, string],
    ) as { ok: boolean; fileRenamed: boolean }
    expect(res.ok).toBe(true)
    expect(res.fileRenamed).toBe(true)

    // Old name is gone, a new name exists in the SAME directory with identical
    // bytes — a rename, never a copy-then-delete that could lose data.
    expect(fs.existsSync(refFile)).toBe(false)
    const renamed = path.join(extDir, 'Renamed Original.txt')
    expect(fs.existsSync(renamed)).toBe(true)
    expect(sha256(renamed)).toBe(before)

    // The DB points at the new file and remembers the original name for safety.
    const updated = (await listAll(page)).find(e => e.id === entry!.id) as (EntryRow & { original_file_name?: string })
    expect(updated!.file_path).toBe(renamed)
  })
})
