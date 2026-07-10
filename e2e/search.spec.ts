import { test, expect, seedJournalEntries } from './fixture'

test.describe('Search and filter', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await seedJournalEntries(page, 3)
    // Reload to apply seeded entries to the UI
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Timeline' }).click()
  })

  test('search box is visible in header', async ({ appPage: page }) => {
    await expect(page.getByPlaceholder('Search…')).toBeVisible()
  })

  test('Filter button is visible', async ({ appPage: page }) => {
    await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible()
  })

  test('typing and pressing Enter shows search results', async ({ appPage: page }) => {
    await page.getByPlaceholder('Search…').fill('Test Journal')
    await page.getByPlaceholder('Search…').press('Enter')
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8_000 })
  })

  test('search results contain matching entries', async ({ appPage: page }) => {
    // Use .first() — multiple runs of seedJournalEntries can create duplicate titles
    await expect(page.getByText('Test Journal 1').first()).toBeVisible()
  })

  test('clear button (✕) dismisses search results', async ({ appPage: page }) => {
    // Re-run search so we know results are active and the Clear button is visible
    await page.getByPlaceholder('Search…').fill('Test Journal')
    await page.getByPlaceholder('Search…').press('Enter')
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8_000 })
    await page.getByTitle('Clear').click()
    await expect(page.getByText(/result/i).first()).not.toBeVisible({ timeout: 5_000 })
  })

  test('pressing Escape in search box clears and closes results', async ({ appPage: page }) => {
    await page.getByPlaceholder('Search…').fill('Test Journal')
    await page.getByPlaceholder('Search…').press('Enter')
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8_000 })
    await page.getByPlaceholder('Search…').press('Escape')
    await expect(page.getByText(/result/i).first()).not.toBeVisible({ timeout: 5_000 })
  })

  test('clicking Filter button opens the filter panel', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByText('File type')).toBeVisible()
    await expect(page.getByText('Date range')).toBeVisible()
    await expect(page.getByText('File name')).toBeVisible()
    // Use exact match — 'Tags' is also a substring of 'No tags yet'
    await expect(page.getByText('Tags', { exact: true })).toBeVisible()
    // Close the panel before next test
    await page.locator('h1').click()
    await expect(page.getByText('File type')).not.toBeVisible()
  })

  test('filter panel has type chips', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByRole('button', { name: 'Photos' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Videos' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Journals' })).toBeVisible()
    await page.locator('h1').click()
    await expect(page.getByText('File type')).not.toBeVisible()
  })

  test('selecting Journal type filter and applying shows journal results', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('button', { name: 'Journals' }).click()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8_000 })
  })

  test('clicking outside filter panel closes it', async ({ appPage: page }) => {
    // Clear any active results then open the panel
    const clearBtn = page.getByTitle('Clear')
    if (await clearBtn.isVisible().catch(() => false)) await clearBtn.click()
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByText('File type')).toBeVisible()
    // Click somewhere outside the panel
    await page.locator('h1').click()
    await expect(page.getByText('File type')).not.toBeVisible()
  })

  test('Clear button in filter panel resets all filters', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('button', { name: 'Journals' }).click()
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText(/result/i).first()).not.toBeVisible({ timeout: 5_000 })
    // Clear doesn't close the panel — click outside to close before next test
    await page.locator('h1').click()
    await expect(page.getByText('File type')).not.toBeVisible()
  })

  test('filter by date range shows entries in range', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.locator('input[type="date"]').first().fill('2023-01-01')
    await page.locator('input[type="date"]').last().fill('2023-12-31')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 8_000 })
    // Clean up
    await page.getByTitle('Clear').click()
  })
})
