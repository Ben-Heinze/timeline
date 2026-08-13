import { _electron as electron } from 'playwright-core'
import path from 'path'
import fs from 'fs'

const APP_DIR = '/home/ben/projects/timeline'
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules/electron/dist/electron')
const SHOT_DIR = '/tmp/claude-1000/-home-ben-projects-timeline/fd6a9e1a-f853-4769-ace3-534f1812c65b/scratchpad'
const dataDir = fs.mkdtempSync('/tmp/timeline-verify-catppuccin-')

const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: ['--no-sandbox', `--user-data-dir=${dataDir}`, APP_DIR],
  env: { ...process.env, DISPLAY: ':99' },
  timeout: 30_000,
})
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
console.log('launched')

function clickButtonWithText(text, exact = false) {
  return page.evaluate(({ text, exact }) => {
    const btns = [...document.querySelectorAll('button')]
    const btn = exact ? btns.find(b => b.textContent?.trim() === text) : btns.find(b => b.textContent?.includes(text))
    if (!btn) return 'NOT_FOUND'
    btn.click()
    return 'OK'
  }, { text, exact })
}

console.log('Settings click:', await clickButtonWithText('Settings', true))
await page.waitForTimeout(500)

for (const label of ['Latte', 'Frappé', 'Macchiato', 'Mocha']) {
  console.log(`${label} click:`, await clickButtonWithText(label, true))
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOT_DIR, `catppuccin-${label.toLowerCase().replace(/[^a-z]/g, '')}.png`) })
}

console.log('errors:', errors.length ? errors : 'none')
await app.close().catch(() => {})
fs.rmSync(dataDir, { recursive: true, force: true })
console.log('done')
