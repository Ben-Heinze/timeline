import { test, expect, seedJournalEntries } from './fixture'
import path from 'path'
import fs from 'fs'
import os from 'os'
import extractZip from 'extract-zip'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }

test.describe('Backup & restore', () => {
  let workDir: string

  test.beforeAll(async ({ appPage: page }) => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-backup-e2e-'))
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await seedJournalEntries(page, 2)
  })

  test.afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('settings shows the backup section', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Backup & restore')).toBeVisible()
    await expect(page.getByText('Full backup')).toBeVisible()
    await expect(page.getByText('Metadata-only backup')).toBeVisible()
    await expect(page.getByText('Restore from backup')).toBeVisible()
  })

  test('metadata export produces a valid archive', async ({ appPage: page, electronApp }) => {
    const zipPath = path.join(workDir, 'backup.zip')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, zipPath)

    const result = await page.evaluate(() =>
      (window as unknown as AnyApi).api.backup.export('metadata')
    ) as { canceled: boolean; path?: string; entries?: number }

    expect(result.canceled).toBe(false)
    expect(result.entries).toBeGreaterThanOrEqual(2)
    expect(fs.existsSync(zipPath)).toBe(true)

    const unpackDir = path.join(workDir, 'unpacked')
    await extractZip(zipPath, { dir: unpackDir })

    const manifest = JSON.parse(fs.readFileSync(path.join(unpackDir, 'manifest.json'), 'utf-8'))
    expect(manifest.format).toBe('timeline-backup')
    expect(manifest.exportType).toBe('metadata')
    expect(manifest.includesFiles).toBe(false)
    expect(manifest.counts.entries).toBeGreaterThanOrEqual(2)

    const metadata = JSON.parse(fs.readFileSync(path.join(unpackDir, 'metadata.json'), 'utf-8'))
    expect(metadata.entries.length).toBeGreaterThanOrEqual(2)
    expect(metadata.entries.some((e: { title: string }) => e.title === 'Test Journal 1')).toBe(true)

    expect(fs.existsSync(path.join(unpackDir, 'timeline.db'))).toBe(true)
  })

  test('import restores the archive into a new library', async ({ appPage: page }) => {
    const zipPath = path.join(workDir, 'backup.zip')
    const destDir = path.join(workDir, 'restored-library')

    const result = await page.evaluate(([zip, dest]) =>
      (window as unknown as AnyApi).api.backup.import(zip, dest),
      [zipPath, destDir],
    ) as { libraryPath: string; exportType: string; entries: number }

    expect(result.libraryPath).toBe(destDir)
    expect(result.exportType).toBe('metadata')
    expect(result.entries).toBeGreaterThanOrEqual(2)
    expect(fs.existsSync(path.join(destDir, 'timeline.db'))).toBe(true)

    // The app now runs against the restored library — the seeded journal
    // entries must still be there after a reload.
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    const extent = await page.evaluate(() =>
      (window as unknown as AnyApi).api.entries.extent()
    )
    expect(extent).not.toBeNull()
  })

  test('import into a non-empty folder is rejected', async ({ appPage: page }) => {
    const zipPath = path.join(workDir, 'backup.zip')
    const occupied = path.join(workDir, 'occupied')
    fs.mkdirSync(occupied)
    fs.writeFileSync(path.join(occupied, 'something.txt'), 'x')

    const error = await page.evaluate(([zip, dest]) =>
      (window as unknown as AnyApi).api.backup.import(zip, dest).then(() => null, (e: Error) => e.message),
      [zipPath, occupied],
    )
    expect(error).toContain('must be empty')
  })

  test('full export includes media; metadata restore relinks files by hash', async ({ appPage: page, electronApp }) => {
    // Ingest a real file into the (restored) library
    const srcFile = path.join(workDir, 'vacation-notes.txt')
    fs.writeFileSync(srcFile, `unique backup e2e content ${Date.now()}`)
    await page.evaluate((p) =>
      (window as unknown as AnyApi).api.ingest.start([p]), srcFile,
    )

    const listEntries = () => page.evaluate(() =>
      (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' })
    ) as Promise<Array<{ title: string; is_missing: number; file_path: string | null }>>

    let entries = await listEntries()
    const countBefore = entries.length
    expect(entries.some(e => e.title === 'vacation-notes.txt' && !e.is_missing)).toBe(true)

    // Full export must contain the media file itself
    const fullZip = path.join(workDir, 'full.zip')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, fullZip)
    await page.evaluate(() => (window as unknown as AnyApi).api.backup.export('full'))
    const fullUnpacked = path.join(workDir, 'full-unpacked')
    await extractZip(fullZip, { dir: fullUnpacked })
    const stored = entries.find(e => e.title === 'vacation-notes.txt')!.file_path!
    expect(fs.readFileSync(path.join(fullUnpacked, stored), 'utf-8'))
      .toBe(fs.readFileSync(srcFile, 'utf-8'))

    // Metadata-only export, restored elsewhere: entry is flagged missing…
    const metaZip = path.join(workDir, 'meta2.zip')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, metaZip)
    await page.evaluate(() => (window as unknown as AnyApi).api.backup.export('metadata'))

    const dest2 = path.join(workDir, 'restored-2')
    const importResult = await page.evaluate(([zip, dest]) =>
      (window as unknown as AnyApi).api.backup.import(zip, dest),
      [metaZip, dest2],
    ) as { missingFiles: number }
    expect(importResult.missingFiles).toBeGreaterThanOrEqual(1)

    entries = await listEntries()
    expect(entries.find(e => e.title === 'vacation-notes.txt')!.is_missing).toBe(1)

    // …and re-importing the same file relinks it instead of duplicating
    await page.evaluate((p) =>
      (window as unknown as AnyApi).api.ingest.start([p]), srcFile,
    )
    entries = await listEntries()
    expect(entries.length).toBe(countBefore)
    const relinked = entries.find(e => e.title === 'vacation-notes.txt')!
    expect(relinked.is_missing).toBe(0)
    expect(fs.existsSync(path.join(dest2, relinked.file_path!))).toBe(true)
  })

  test('importing a non-backup zip is rejected and cleaned up', async ({ appPage: page }) => {
    const bogusZip = path.join(workDir, 'bogus.zip')
    // Minimal empty zip (end-of-central-directory record only)
    fs.writeFileSync(bogusZip, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'))
    const dest = path.join(workDir, 'bogus-dest')

    const error = await page.evaluate(([zip, destDir]) =>
      (window as unknown as AnyApi).api.backup.import(zip, destDir).then(() => null, (e: Error) => e.message),
      [bogusZip, dest],
    )
    expect(error).toContain('not a valid Timeline backup')
    expect(fs.readdirSync(dest)).toHaveLength(0)
  })
})
