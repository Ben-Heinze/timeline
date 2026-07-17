import path from 'path'
import { test, expect } from './fixture'

const FIXTURE = path.resolve(__dirname, '../examples/Streaming_History_Audio_2024-2025_0.json')

test.describe('Spotify view', () => {
  test.beforeAll(async ({ appPage: page }) => {
    // Import directly via window.api — spotify:import takes file paths, no dialog needed.
    await page.evaluate(async (filePath: string) => {
      const api = (window as unknown as {
        api: { spotify: { import: (paths: string[]) => Promise<{ imported: number; totalFiles: number }> } }
      }).api
      const result = await api.spotify.import([filePath])
      if (result.imported === 0) throw new Error('fixture import inserted 0 plays')
    }, FIXTURE)
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
  })

  test('Spotify tab shows yearly recap cards after import', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Spotify', exact: true }).click()
    await expect(page.getByText('2024')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Top artists').first()).toBeVisible()
  })

  test('clicking a year card opens the year-detail drilldown', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Spotify', exact: true }).click()
    await page.getByText('2024').first().click()
    await expect(page.getByText('← All years')).toBeVisible({ timeout: 10_000 })
  })

  test('back button returns to the yearly recap list', async ({ appPage: page }) => {
    await page.getByText('← All years').click()
    await expect(page.getByText('Top artists').first()).toBeVisible()
  })

  test('Timeline Spotify panel toggle shows the listening ribbon', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await page.getByRole('button', { name: 'Year' }).click()
    await page.getByRole('button', { name: '♫ Spotify' }).click()
    // The panel scopes its heading to the visible range/period, whether or not it found plays
    await expect(page.getByText(/visible range|during/).first()).toBeVisible({ timeout: 10_000 })
  })
})
