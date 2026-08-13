import { test, expect, seedJournalEntries } from './fixture'
import path from 'path'
import fs from 'fs'
import os from 'os'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<any>>> }

test.describe('Merge from another library', () => {
  let workDir: string

  const listEntries = (page: import('playwright-core').Page) => page.evaluate(() =>
    (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' })
  ) as Promise<Array<{ id: number; title: string | null; type: string; is_missing: number; file_path: string | null }>>

  const exportZip = async (
    page: import('playwright-core').Page,
    electronApp: import('playwright-core').ElectronApplication,
    zipPath: string,
    type: 'full' | 'metadata',
  ) => {
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, zipPath)
    const res = await page.evaluate((t) =>
      (window as unknown as AnyApi).api.backup.export(t), type,
    ) as { canceled: boolean }
    expect(res.canceled).toBe(false)
  }

  test.beforeAll(async ({ appPage: page }) => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-merge-e2e-'))
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await seedJournalEntries(page, 2)
    // A real media file so the merge has bytes to carry across
    const srcFile = path.join(workDir, 'merge-notes.txt')
    fs.writeFileSync(srcFile, `merge e2e content ${Date.now()}`)
    await page.evaluate((p) =>
      (window as unknown as AnyApi).api.ingest.start([p]), srcFile,
    )
  })

  test.afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('settings shows the merge row', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Merge from another library')).toBeVisible()
  })

  test('re-merging a backup of this library is a no-op', async ({ appPage: page, electronApp }) => {
    const before = await listEntries(page)
    expect(before.length).toBeGreaterThanOrEqual(3)

    const zipPath = path.join(workDir, 'self.zip')
    await exportZip(page, electronApp, zipPath, 'full')

    const preview = await page.evaluate((zip) =>
      (window as unknown as AnyApi).api.backup.prepareMerge(zip), zipPath,
    ) as { entriesNew: number; entriesDuplicate: number; tagsNew: number; groupsNew: number; peopleNew: number }
    expect(preview.entriesNew).toBe(0)
    expect(preview.entriesDuplicate).toBe(before.length)
    expect(preview.tagsNew).toBe(0)
    expect(preview.groupsNew).toBe(0)
    expect(preview.peopleNew).toBe(0)

    const result = await page.evaluate(() =>
      (window as unknown as AnyApi).api.backup.executeMerge(),
    ) as { entriesImported: number; duplicatesSkipped: number; tagsCreated: number; groupsCreated: number }
    expect(result.entriesImported).toBe(0)
    expect(result.duplicatesSkipped).toBe(before.length)
    expect(result.tagsCreated).toBe(0)
    expect(result.groupsCreated).toBe(0)

    const after = await listEntries(page)
    expect(after.length).toBe(before.length)
  })

  test('restores entries deleted since the backup, with file and tag union', async ({ appPage: page, electronApp }) => {
    // Tag the media entry, back everything up, then diverge: untag it and
    // delete a journal — as if this machine never had them.
    let entries = await listEntries(page)
    const media = entries.find(e => e.title === 'merge-notes.txt')!
    await page.evaluate((id) =>
      (window as unknown as AnyApi).api.tags.setForEntry(id, ['from-laptop']), media.id,
    )

    const zipPath = path.join(workDir, 'diverged.zip')
    await exportZip(page, electronApp, zipPath, 'full')

    await page.evaluate((id) =>
      (window as unknown as AnyApi).api.tags.setForEntry(id, []), media.id,
    )
    const journal = entries.find(e => e.title === 'Test Journal 1')!
    await page.evaluate((id) =>
      (window as unknown as AnyApi).api.entries.delete([id]), journal.id,
    )
    expect((await listEntries(page)).length).toBe(entries.length - 1)

    const preview = await page.evaluate((zip) =>
      (window as unknown as AnyApi).api.backup.prepareMerge(zip), zipPath,
    ) as { entriesNew: number; entriesDuplicate: number }
    expect(preview.entriesNew).toBe(1)
    expect(preview.entriesDuplicate).toBe(entries.length - 1)

    const result = await page.evaluate(() =>
      (window as unknown as AnyApi).api.backup.executeMerge(),
    ) as { entriesImported: number; duplicatesSkipped: number; missingFiles: number }
    expect(result.entriesImported).toBe(1)
    expect(result.duplicatesSkipped).toBe(entries.length - 1)
    expect(result.missingFiles).toBe(0)

    // The deleted journal is back, with its text file on disk
    entries = await listEntries(page)
    const restored = entries.find(e => e.title === 'Test Journal 1')
    expect(restored).toBeTruthy()
    expect(restored!.type).toBe('journal')
    expect(restored!.is_missing).toBe(0)
    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get(),
    ) as { libraryPath: string }
    expect(fs.existsSync(path.join(settings.libraryPath, restored!.file_path!))).toBe(true)

    // The tag removed here but present in the backup is unioned back on
    const tags = await page.evaluate((id) =>
      (window as unknown as AnyApi).api.tags.forEntry(id), media.id,
    ) as Array<{ name: string }>
    expect(tags.map(t => t.name)).toContain('from-laptop')
  })

  test('metadata-only backups are rejected with a pointer to full export', async ({ appPage: page, electronApp }) => {
    const zipPath = path.join(workDir, 'meta.zip')
    await exportZip(page, electronApp, zipPath, 'metadata')

    const error = await page.evaluate((zip) =>
      (window as unknown as AnyApi).api.backup.prepareMerge(zip).then(() => null, (e: Error) => e.message),
      zipPath,
    )
    expect(error).toContain('Only full backups can be merged')
  })

  test('executeMerge without a prepared session is rejected', async ({ appPage: page }) => {
    await page.evaluate(() => (window as unknown as AnyApi).api.backup.cancelMerge())
    const error = await page.evaluate(() =>
      (window as unknown as AnyApi).api.backup.executeMerge().then(() => null, (e: Error) => e.message),
    )
    expect(error).toContain('No merge in progress')
  })
})
