import { test, expect } from './fixture'
import type { Page } from 'playwright-core'

// How many entries to stress the histogram query with, spread across ~15 years so
// a Year-zoom click queries the largest possible range (see yearViewRange).
const N = 8000
const YEARS = 15

// Budget (ms) from clicking "Year" to the canvas settling on its final draw. The
// debounce fix adds ~180ms of intentional delay before the query fires, so the
// budget accounts for that plus one IPC round trip + query + draw.
const MAX_YEAR_CLICK_MS = 1500

// Budget (ms) from triggering a reload to the timeline canvas settling on real data.
const MAX_RELOAD_MS = 2500

// Budget (ms) for a full 20-mousemove drag gesture plus settle. Measured empirically:
// ~2840ms with the debounce reverted (20 serialized full-extent queries on the
// single-threaded main process) vs. ~990ms with it in place — this budget sits
// comfortably above the debounced case and well below the un-debounced one.
const MAX_DRAG_MS = 1800

test.describe('Timeline histogram performance', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await seedManyEntries(page, N, YEARS)
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await page.waitForSelector('canvas', { timeout: 20_000 })
  })

  test('panning the timeline does not fire one query per mouse-move', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Year', exact: true }).click()
    await waitForCanvasSettle(page) // let the initial debounced fetch resolve first

    await installDebounceSpy(page)
    const t0 = Date.now()
    await simulateDrag(page)
    await waitForCanvasSettle(page)
    const ms = Date.now() - t0
    const fires = await readDebounceFires(page)
    await restoreSetTimeout(page)

    console.log(`[perf] drag (20 moves) + settle: ${ms}ms, debounce timers fired: ${fires}`)
    // The real assertion is wall-clock time, not the fire count: without any debounce
    // at all there's no setTimeout(fn, 180) to spy on (the fetch fires directly), so
    // a fire count alone can't distinguish "debounced" from "debounce removed
    // entirely" — verified empirically (reverting the debounce fix drops the fire
    // count to 0 *and* the count assertion would have kept passing). Wall-clock time
    // catches both cases: un-debounced, N mousemove events serialize N full-extent
    // queries on the single-threaded main process (measured ~2840ms for N=8000);
    // debounced, one drag gesture collapses to ~1-2 real queries (measured ~990ms).
    expect(ms).toBeLessThan(MAX_DRAG_MS)
  })

  test('reload settles to real data under budget', async ({ appPage: page }) => {
    const ms = await measureReload(page)
    console.log(`[perf] reload → year-view canvas settled: ${ms.toFixed(1)}ms (N=${N} across ${YEARS} years)`)
    expect(ms).toBeLessThan(MAX_RELOAD_MS)
  })

  test('clicking Year stays under budget with a large multi-year dataset', async ({ appPage: page }) => {
    // Start from Month so the Year click does real work re-fitting to the full extent.
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await waitForCanvasSettle(page)

    const t0 = Date.now()
    await page.getByRole('button', { name: 'Year', exact: true }).click()
    await waitForCanvasSettle(page)
    const ms = Date.now() - t0

    console.log(`[perf] Year click → canvas settled: ${ms.toFixed(1)}ms (N=${N} across ${YEARS} years)`)
    expect(ms).toBeLessThan(MAX_YEAR_CLICK_MS)
  })
})

/** Seed `count` journal entries spread across `years` years via the renderer API. */
async function seedManyEntries(page: Page, count: number, years: number): Promise<void> {
  await page.evaluate(async ({ count, years }: { count: number; years: number }) => {
    const api = (window as unknown as {
      api: { entries: { create: (d: Record<string, unknown>) => Promise<number> } }
    }).api
    const base = Date.now()
    const spanMs = years * 365 * 86_400_000
    for (let i = 0; i < count; i++) {
      const ts = base - Math.floor((i / count) * spanMs)
      await api.entries.create({
        type: 'journal',
        timestamp: ts,
        title: `Perf Entry ${i + 1}`,
        rich_text_json: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `body ${i}` }] }],
        }),
        group_id: null,
      })
    }
  }, { count, years })
}

/**
 * Patches window.setTimeout to count callbacks scheduled with the debounce's exact
 * 180ms delay that actually run to completion (as opposed to being cleared by a
 * subsequent effect cleanup, which is what the debounce fix relies on to collapse
 * rapid pan events). window.setTimeout is a normal writable global — unlike
 * window.api, it isn't frozen by contextBridge, so this works from the page context.
 */
async function installDebounceSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __debounceFires: number; __origSetTimeout: typeof setTimeout }
    w.__debounceFires = 0
    w.__origSetTimeout = window.setTimeout
    window.setTimeout = ((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 180 && typeof fn === 'function') {
        return w.__origSetTimeout(() => { w.__debounceFires++; fn() }, delay)
      }
      return w.__origSetTimeout(fn as never, delay, ...args)
    }) as typeof setTimeout
  })
}

async function readDebounceFires(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __debounceFires: number }).__debounceFires)
}

async function restoreSetTimeout(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __origSetTimeout: typeof setTimeout }
    window.setTimeout = w.__origSetTimeout
  })
}

/**
 * Simulates a drag-pan on the canvas via real CDP-level input (page.mouse), not
 * in-page `dispatchEvent`. React's synthetic event system here does not reliably
 * pick up synthetic `canvas.dispatchEvent(new MouseEvent(...))` calls made from
 * inside the page (verified empirically — onMouseDown never even fires), so this
 * drives the OS/CDP-level input path real user interaction goes through instead.
 */
async function simulateDrag(page: Page): Promise<void> {
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not found')
  const startX = box.x + box.width * 0.7
  const y = box.y + box.height * 0.5

  await page.mouse.move(startX, y)
  await page.mouse.down()
  // 20 mousemove events over a drag — without the debounce this would be ~20 fetches.
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(startX - i * 4, y)
    await page.waitForTimeout(5)
  }
  await page.mouse.up()
}

/**
 * Polls canvas.toDataURL() until it stops changing for `quietMs`, as a black-box
 * signal that the draw effect has finished painting the final (data-complete) frame
 * — regardless of how many intermediate re-draws happened while data was loading.
 */
async function waitForCanvasSettle(page: Page, quietMs = 150, timeoutMs = 8000): Promise<void> {
  await page.evaluate(async ({ quietMs, timeoutMs }) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) throw new Error('canvas not found')
    let last = canvas.toDataURL()
    let lastChange = performance.now()
    const start = performance.now()
    while (performance.now() - start < timeoutMs) {
      await new Promise(r => requestAnimationFrame(r))
      const cur = canvas.toDataURL()
      if (cur !== last) { last = cur; lastChange = performance.now() }
      else if (performance.now() - lastChange > quietMs) return
    }
  }, { quietMs, timeoutMs })
}

/**
 * Wall-clock time (Node-side, since performance.now() resets across navigation and
 * can't be compared before/after a reload) from triggering a reload to the timeline
 * canvas settling on the real, post-extent year view.
 */
async function measureReload(page: Page): Promise<number> {
  const t0 = Date.now()
  await page.evaluate(() => window.location.reload())
  await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await waitForCanvasSettle(page)
  return Date.now() - t0
}
