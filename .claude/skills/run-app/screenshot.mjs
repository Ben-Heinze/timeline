import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '../../..')
const SHOT_DIR = '/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron')

console.log('Launching app...')
const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env },
  timeout: 30_000,
})

console.log('Waiting for window...')
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
console.log('Page loaded. Waiting for IPC data...')
await new Promise(r => setTimeout(r, 5_000))

console.log('Windows:', app.windows().map(w => w.url()))

// Screenshot 1: histogram before any click
const f1 = path.join(SHOT_DIR, '01-histogram.png')
await page.screenshot({ path: f1 })
console.log('screenshot:', f1)

// Click roughly on the first visible bar (around 35% from left)
const box = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  if (!canvas) return null
  const r = canvas.getBoundingClientRect()
  return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.5, w: r.width, h: r.height }
})
if (box) {
  console.log('Clicking canvas at', box.x, box.y)
  await page.mouse.click(box.x, box.y)
  await new Promise(r => setTimeout(r, 1000))
}

// Screenshot 2: after clicking a bar
const f2 = path.join(SHOT_DIR, '02-dayview.png')
await page.screenshot({ path: f2 })
console.log('screenshot:', f2)

// Double-click the first entry card to open modal
const card = await page.evaluate(() => {
  const cards = document.querySelectorAll('[style*="border-radius: 8px"]')
  if (!cards.length) return null
  const r = cards[0].getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
if (card) {
  console.log('Double-clicking first entry card')
  await page.mouse.dblclick(card.x, card.y)
  await new Promise(r => setTimeout(r, 800))
}

// Screenshot 3: modal open
const f3 = path.join(SHOT_DIR, '03-modal.png')
await page.screenshot({ path: f3 })
console.log('screenshot:', f3)

await app.close()
console.log('done')
