import { test, expect } from './fixture'
import type { Page } from 'playwright-core'

// Create entries straight through the renderer bridge and return their ids.
async function createEntries(appPage: Page, timestamps: number[]): Promise<number[]> {
  return appPage.evaluate(async (tss: number[]) => {
    const api = (window as unknown as {
      api: { entries: { create: (d: Record<string, unknown>) => Promise<number> } }
    }).api
    const ids: number[] = []
    for (let i = 0; i < tss.length; i++) {
      ids.push(await api.entries.create({
        type: 'photo',
        timestamp: tss[i],
        title: `Change-date ${i}`,
        rich_text_json: null,
        group_id: null,
      }))
    }
    return ids
  }, timestamps)
}

async function timestampsOf(appPage: Page, ids: number[]): Promise<(number | null)[]> {
  return appPage.evaluate(async (ids: number[]) => {
    const api = (window as unknown as {
      api: { entries: { get: (id: number) => Promise<{ timestamp: number } | null> } }
    }).api
    return Promise.all(ids.map(async id => (await api.entries.get(id))?.timestamp ?? null))
  }, ids)
}

test('set mode assigns one absolute date to every selected entry', async ({ appPage }) => {
  const ids = await createEntries(appPage, [1_000_000_000_000, 1_100_000_000_000])
  const target = Date.UTC(2019, 5, 15, 12, 0, 0) // 2019-06-15T12:00:00Z

  const result = await appPage.evaluate(
    ({ ids, target }) => (window as unknown as {
      api: { entries: { setDate: (p: unknown) => Promise<{ updated: number; exifWritten: number }> } }
    }).api.entries.setDate({ ids, mode: 'set', value: target, writeExif: false }),
    { ids, target },
  )

  expect(result.updated).toBe(2)
  expect(result.exifWritten).toBe(0)
  expect(await timestampsOf(appPage, ids)).toEqual([target, target])
})

test('shift mode offsets each entry by the delta', async ({ appPage }) => {
  const base = 1_500_000_000_000
  const ids = await createEntries(appPage, [base, base + 60_000])
  const delta = 3 * 3_600_000 // +3 hours

  await appPage.evaluate(
    ({ ids, delta }) => (window as unknown as {
      api: { entries: { setDate: (p: unknown) => Promise<unknown> } }
    }).api.entries.setDate({ ids, mode: 'shift', value: delta, writeExif: false }),
    { ids, delta },
  )

  expect(await timestampsOf(appPage, ids)).toEqual([base + delta, base + 60_000 + delta])
})

test('single-entry set clears any needs-date-review flag', async ({ appPage }) => {
  const [id] = await createEntries(appPage, [900_000_000_000])
  const target = Date.UTC(2021, 0, 1, 0, 0, 0)

  const flag = await appPage.evaluate(async ({ id, target }) => {
    const api = (window as unknown as {
      api: {
        entries: {
          setDate: (p: unknown) => Promise<unknown>
          get: (id: number) => Promise<{ needs_date_review: number } | null>
        }
      }
    }).api
    await api.entries.setDate({ ids: [id], mode: 'set', value: target, writeExif: false })
    return (await api.entries.get(id))?.needs_date_review
  }, { id, target })

  expect(flag).toBe(0)
})
