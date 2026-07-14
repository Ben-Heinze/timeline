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
  test.beforeAll(async ({ appPage: page }) => {
    await seedManyEntries(page, N)
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    // Go to the Files view and switch to list mode (densest, most rows on screen).
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await page.waitForSelector('[data-entry-id]', { timeout: 20_000 })
  })

  test(`renders ${N} entries in the list`, async ({ appPage: page }) => {
    const count = await page.locator('[data-entry-id]').count()
    expect(count).toBeGreaterThan(N * 0.9)
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

/** Seed `count` journal entries spread across time via the renderer API. */
async function seedManyEntries(page: Page, count: number): Promise<void> {
  await page.evaluate(async (count: number) => {
    const api = (window as unknown as {
      api: { entries: { create: (d: Record<string, unknown>) => Promise<number> } }
    }).api
    const base = Date.now()
    const DAY = 86_400_000
    for (let i = 0; i < count; i++) {
      await api.entries.create({
        type: 'journal',
        timestamp: base - i * DAY,
        title: `Perf Entry ${i + 1}`,
        rich_text_json: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `body ${i}` }] }],
        }),
        group_id: null,
      })
    }
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
