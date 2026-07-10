import { test as base, expect } from '@playwright/test'
import { _electron as electron } from 'playwright-core'
import type { ElectronApplication, Page } from 'playwright-core'
import path from 'path'
import fs from 'fs'
import os from 'os'

const APP_DIR = path.resolve(__dirname, '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules/electron/dist/electron')

// Worker-scoped fixtures — shared across all tests in a single spec file
interface WorkerFixtures {
  dataDir: string
  electronApp: ElectronApplication
  // 'appPage' instead of 'page' to avoid conflicting with the base test-scoped page fixture
  appPage: Page
}

export const test = base.extend<{}, WorkerFixtures>({
  dataDir: [async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-e2e-'))
    await use(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }, { scope: 'worker' }],

  electronApp: [async ({ dataDir }, use) => {
    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['--no-sandbox', `--user-data-dir=${dataDir}`, APP_DIR],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
      },
      timeout: 30_000,
    })
    await use(app)
    await app.close().catch(() => {})
  }, { scope: 'worker' }],

  appPage: [async ({ electronApp }, use) => {
    const win = electronApp.windows().find(w => !w.url().startsWith('devtools://'))
      ?? await electronApp.firstWindow()
    // Wait for the React app to mount — "+ Journal" always appears in the header
    await win.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await use(win)
  }, { scope: 'worker' }],
})

export { expect }

type Api = typeof window extends { api: infer T } ? T : never

/** Seed journal entries directly via the renderer's window.api */
export async function seedJournalEntries(appPage: Page, count = 3): Promise<void> {
  const now = Date.now()
  const MS_YEAR = 365 * 86_400_000
  for (let i = 0; i < count; i++) {
    const ts = now - i * MS_YEAR
    await appPage.evaluate(
      ({ ts, i }: { ts: number; i: number }) => {
        const api = (window as unknown as { api: { entries: { create: (d: Record<string, unknown>) => Promise<number> } } }).api
        return api.entries.create({
          type: 'journal',
          timestamp: ts,
          title: `Test Journal ${i + 1}`,
          rich_text_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Entry body ${i + 1}` }] }] }),
          group_id: null,
        })
      },
      { ts, i },
    )
  }
}
