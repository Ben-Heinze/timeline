import { test, expect } from './fixture'
import type { Page } from 'playwright-core'

// How many entries to stress the file list with.
const N = 1200
// Upper bound (ms) from click to the DOM reflecting the new selection. This
// spans React's re-render plus one paint frame, so anything close to a single
// frame (~16ms) is snappy; the pre-optimization baseline was ~100ms because
// every one of the N rows re-rendered on each click.
const MAX_SELECT_MS = 45

test.describe('File list selection performance', () => {
  // IDs of the entries this spec seeds, so afterAll can remove them. All specs
  // in a run share one Electron app + library (worker-scoped fixtures), so
  // leaving 1200 rows behind would bury later specs' entries in the (virtualized)
  // Files list and skew their timings. This spec cleans up after itself.
  let seededIds: number[] = []

  test.beforeAll(async ({ appPage: page }) => {
    seededIds = await seedManyEntries(page, N)
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    // Go to the Files view and switch to list mode (densest, most rows on screen).
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await page.waitForSelector('[data-entry-id]', { timeout: 20_000 })
  })

  test.afterAll(async ({ appPage: page }) => {
    // Journal entries have no files on disk, so this only removes DB rows.
    await page.evaluate((ids) =>
      (window as unknown as { api: { entries: { delete: (i: number[]) => Promise<void> } } })
        .api.entries.delete(ids), seededIds)
  })

  test(`loads ${N} entries and virtualizes the list`, async ({ appPage: page }) => {
    // The count query must see at least the N entries we seeded. (Other specs
    // sharing this worker's library may have added a handful more, so this is a
    // lower bound, not an equality.)
    const total = await page.evaluate(() =>
      (window as unknown as { api: { entries: { listAllCount: (o: object) => Promise<number> } } })
        .api.entries.listAllCount({})
    )
    expect(total).toBeGreaterThanOrEqual(N)

    // The list is virtualized: only a bounded window of rows is in the DOM
    // (visible range + overscan), never all N. Both properties matter — the full
    // count proves the data loaded, the small DOM proves we don't pay to render
    // thousands of offscreen rows.
    const count = await page.locator('[data-entry-id]').count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(N / 2)
  })

  test('single-click selection stays under budget', async ({ appPage: page }) => {
    const timings = await measureClicks(page, 12)
    const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)]
    const worst = Math.max(...timings)
    console.log(`[perf] single-click select — median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms over ${timings.length} clicks (N=${N})`)
    expect(median).toBeLessThan(MAX_SELECT_MS)
  })

  test('double-click selection cost stays under budget', async ({ appPage: page }) => {
    // Two rapid clicks on the same row (the JS a double-click puts through the
    // selection path) must also stay cheap.
    const timings = await measureClicks(page, 12, /* clicksPerSample */ 2)
    const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)]
    console.log(`[perf] double-click select — median ${median.toFixed(1)}ms (N=${N})`)
    expect(median).toBeLessThan(MAX_SELECT_MS * 2)
  })
})

/** Seed `count` journal entries spread across time via the renderer API. Returns
 *  the created ids so the caller can delete them again. */
async function seedManyEntries(page: Page, count: number): Promise<number[]> {
  return page.evaluate(async (count: number) => {
    const api = (window as unknown as {
      api: { entries: { create: (d: Record<string, unknown>) => Promise<number> } }
    }).api
    const base = Date.now()
    const DAY = 86_400_000
    const ids: number[] = []
    for (let i = 0; i < count; i++) {
      ids.push(await api.entries.create({
        type: 'journal',
        timestamp: base - i * DAY,
        title: `Perf Entry ${i + 1}`,
        rich_text_json: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `body ${i}` }] }],
        }),
        group_id: null,
      }))
    }
    return ids
  }, count)
}

/**
 * Click `samples` different rows and return, for each, the time (ms) from the
 * click until the row's DOM reflects the new selection. React batches the
 * state update into a task, so this end-to-end latency — not the synchronous
 * dispatch time — is what the user actually perceives as lag.
 * `clicksPerSample` simulates a double-click.
 */
async function measureClicks(page: Page, samples: number, clicksPerSample = 1): Promise<number[]> {
  return page.evaluate(async ({ samples, clicksPerSample }) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-entry-id]'))
    if (rows.length < samples) throw new Error(`only ${rows.length} rows on screen`)
    const step = Math.floor(rows.length / (samples + 1))
    const times: number[] = []
    for (let s = 1; s <= samples; s++) {
      const row = rows[s * step]
      // Reset selection to a different row so this row starts unselected.
      const other = rows[(s * step + 1) % rows.length]
      other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await waitSelected(other)

      const t0 = performance.now()
      for (let c = 0; c < clicksPerSample; c++) {
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      await waitSelected(row)
      times.push(performance.now() - t0)
    }
    return times

    function waitSelected(el: Element): Promise<void> {
      return new Promise(resolve => {
        let frames = 0
        const check = () => {
          if (el.getAttribute('data-selected') === '1' || frames > 240) resolve()
          else { frames++; requestAnimationFrame(check) }
        }
        requestAnimationFrame(check)
      })
    }
  }, { samples, clicksPerSample })
}
