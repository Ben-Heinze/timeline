import { test, expect } from './fixture'
import path from 'path'
import fs from 'fs'
import os from 'os'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }

interface EntryRow {
  id: number
  title: string | null
  import_mode: 'copy' | 'reference'
  file_path: string | null
  volume_id: number | null
}
interface WatchedFolder { path: string; volumeId: number | null }

test.describe('Import mode', () => {
  let watchDir: string
  let manualDir: string

  test.beforeAll(() => {
    watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-watch-e2e-'))
    manualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-manual-e2e-'))
  })

  test.afterAll(async ({ appPage: page }) => {
    // Un-register the watched folder so later specs sharing this worker's
    // app instance aren't affected by it.
    const settings = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { watchedFolders: WatchedFolder[] }
    const next = settings.watchedFolders.filter(f => f.path !== watchDir)
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }), next,
    )
    fs.rmSync(watchDir, { recursive: true, force: true })
    fs.rmSync(manualDir, { recursive: true, force: true })
  })

  test('watched folder files are referenced in place; manual imports are copied', async ({ appPage: page }) => {
    // Register the temp dir as a watched folder — not on any detected
    // removable volume, so volumeId stays null (plain reference mode).
    const settingsBefore = await page.evaluate(() =>
      (window as unknown as AnyApi).api.settings.get()
    ) as { watchedFolders: WatchedFolder[] }
    const nextFolders = [...settingsBefore.watchedFolders, { path: watchDir, volumeId: null }]
    await page.evaluate((wf) =>
      (window as unknown as AnyApi).api.settings.set({ watchedFolders: wf }), nextFolders,
    )

    const watchedFile = path.join(watchDir, `watched-${Date.now()}.txt`)
    fs.writeFileSync(watchedFile, `watched content ${Date.now()}`)

    // Drives the on-demand scan; also covers the watcher racing to ingest
    // the same file first — both paths dedupe by content hash to one entry.
    await page.evaluate(() => (window as unknown as AnyApi).api.sync.run())

    const manualFile = path.join(manualDir, `manual-${Date.now()}.txt`)
    fs.writeFileSync(manualFile, `manual content ${Date.now()}`)
    await page.evaluate((p) =>
      (window as unknown as AnyApi).api.ingest.start([p]), manualFile,
    )

    const entries = await page.evaluate(() =>
      (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' })
    ) as EntryRow[]

    const watchedEntry = entries.find(e => e.title === path.basename(watchedFile))
    expect(watchedEntry).toBeTruthy()
    expect(watchedEntry!.import_mode).toBe('reference')
    expect(watchedEntry!.file_path).toBe(watchedFile)
    expect(watchedEntry!.volume_id).toBeNull()

    const manualEntry = entries.find(e => e.title === path.basename(manualFile))
    expect(manualEntry).toBeTruthy()
    expect(manualEntry!.import_mode).toBe('copy')
    expect(manualEntry!.file_path).not.toBeNull()
    expect(path.isAbsolute(manualEntry!.file_path!)).toBe(false)
    expect(manualEntry!.volume_id).toBeNull()
  })

  test('settings shows both library location and watched folders unconditionally', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Library location')).toBeVisible()
    await expect(page.getByText('Watched folders')).toBeVisible()
    await expect(page.getByText('Import mode')).not.toBeVisible()
    await page.getByRole('button', { name: 'Timeline' }).click()
  })
})
