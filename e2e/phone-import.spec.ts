import { test, expect } from './fixture'

// window.api is untyped inside page.evaluate
type AnyApi = { api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }

interface PhoneStartResult { port: number; token: string; lanIps: string[] }
interface EntryRow { id: number; title: string | null }

// Minimal valid 1x1 PNG — exercises the real photo path (sharp thumbnails, exifr).
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

async function entriesTitled(page: import('playwright-core').Page, title: string): Promise<EntryRow[]> {
  const all = await page.evaluate(() =>
    (window as unknown as AnyApi).api.entries.listAll({ sortBy: 'date', sortDir: 'desc' }),
  ) as EntryRow[]
  return all.filter(e => e.title === title)
}

test.describe('Import from phone', () => {
  const fileName = `phone-e2e-${Date.now()}.png`
  let server: PhoneStartResult

  test.beforeAll(async ({ appPage: page }) => {
    server = await page.evaluate(() =>
      (window as unknown as AnyApi).api.phone.start(),
    ) as PhoneStartResult
  })

  test.afterAll(async ({ appPage: page }) => {
    // Stop the server and delete any entries this spec created so it doesn't
    // pollute later specs sharing this worker's app/library.
    const rows = await entriesTitled(page, fileName)
    if (rows.length) {
      await page.evaluate((ids) =>
        (window as unknown as AnyApi).api.entries.delete(ids), rows.map(r => r.id),
      )
    }
    await page.evaluate(() => (window as unknown as AnyApi).api.phone.stop())
  })

  test('start returns a port, token, and LAN address list', () => {
    expect(server.port).toBeGreaterThan(0)
    expect(server.token).toMatch(/^[0-9a-f]{32}$/)
    expect(Array.isArray(server.lanIps)).toBe(true)
  })

  test('the upload page requires the token', async () => {
    const denied = await fetch(`http://127.0.0.1:${server.port}/`)
    expect(denied.status).toBe(403)

    const ok = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('Send to Timeline')
  })

  test('a POST with a bad token is rejected', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from(PNG_1x1_B64, 'base64')], { type: 'image/png' }), fileName)
    const res = await fetch(`http://127.0.0.1:${server.port}/upload?token=wrong`, { method: 'POST', body: fd })
    expect(res.status).toBe(403)
  })

  test('an uploaded photo is ingested into the library', async ({ appPage: page }) => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from(PNG_1x1_B64, 'base64')], { type: 'image/png' }), fileName)
    const res = await fetch(`http://127.0.0.1:${server.port}/upload?token=${server.token}`, { method: 'POST', body: fd })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, received: 1 })

    // Ingest runs asynchronously after the response, so poll for the entry.
    await expect.poll(async () => (await entriesTitled(page, fileName)).length, { timeout: 15_000 })
      .toBe(1)
  })

  test('re-uploading identical bytes does not create a duplicate', async ({ appPage: page }) => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from(PNG_1x1_B64, 'base64')], { type: 'image/png' }), fileName)
    const res = await fetch(`http://127.0.0.1:${server.port}/upload?token=${server.token}`, { method: 'POST', body: fd })
    expect(res.status).toBe(200)

    // Give the second ingest time to run, then confirm hash-dedup kept it at one row.
    await page.waitForTimeout(3000)
    expect((await entriesTitled(page, fileName)).length).toBe(1)
  })
})
