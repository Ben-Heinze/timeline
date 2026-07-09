import { _electron as electron } from 'playwright-core'
import { mkdir } from 'fs/promises'
await mkdir('/tmp/shots', { recursive: true })

const app = await electron.launch({
  args: ['/home/ben/projects/timeline/out/main/index.js'],
  env: { ...process.env, DISPLAY: ':99' },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await new Promise(r => setTimeout(r, 2500))

// 1. Year view (default)
await win.screenshot({ path: '/tmp/shots/z1-year.png' })

// 2. Click Month tab
await win.locator('button:has-text("Month")').first().click()
await new Promise(r => setTimeout(r, 500))
await win.screenshot({ path: '/tmp/shots/z2-month.png' })

// 3. Click Week tab
await win.locator('button:has-text("Week")').first().click()
await new Promise(r => setTimeout(r, 500))
await win.screenshot({ path: '/tmp/shots/z3-week.png' })

// 4. Click Day tab
await win.locator('button:has-text("Day")').first().click()
await new Promise(r => setTimeout(r, 500))
await win.screenshot({ path: '/tmp/shots/z4-day.png' })

// 5. Switch to Calendar tab
await win.locator('button:has-text("Calendar")').click()
await new Promise(r => setTimeout(r, 800))
await win.screenshot({ path: '/tmp/shots/z5-calendar.png' })

// 6. Navigate to 2022 which should have more entries
await win.locator('button:has-text("←")').first().click()
await new Promise(r => setTimeout(r, 300))
await win.locator('button:has-text("←")').first().click()
await new Promise(r => setTimeout(r, 300))
await win.locator('button:has-text("←")').first().click()
await new Promise(r => setTimeout(r, 300))
await win.locator('button:has-text("←")').first().click()
await new Promise(r => setTimeout(r, 400))
await win.screenshot({ path: '/tmp/shots/z6-calendar-2022.png' })

await app.close()
console.log('done')
