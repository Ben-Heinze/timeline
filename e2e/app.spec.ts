import { test, expect } from './fixture'

test.describe('App launch and navigation', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
  })

  test('shows Timeline heading in header', async ({ appPage: page }) => {
    await expect(page.locator('h1')).toContainText('Timeline')
  })

  test('shows all four view tabs', async ({ appPage: page }) => {
    await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  })

  test('shows action buttons in header', async ({ appPage: page }) => {
    await expect(page.getByRole('button', { name: '+ Journal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sync' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Import' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import folder…' })).toBeVisible()
  })

  test('shows sidebar with Groups label and All entries row', async ({ appPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
    await expect(page.getByText('All entries')).toBeVisible()
  })

  test('Timeline tab is active by default', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline' }).click()
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('switches to Calendar view', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Calendar' }).click()
    await expect(page.getByText('January')).toBeVisible()
    await expect(page.getByText('December')).toBeVisible()
  })

  test('switches to Files view', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Files' }).click()
    await expect(page.getByText(/Sort/i).first()).toBeVisible()
  })

  test('switches to Settings view and hides action buttons', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('button', { name: '+ Journal' })).not.toBeVisible()
    await expect(page.getByText(/library location/i).first()).toBeVisible()
  })

  test('returns to Timeline view from Settings', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline' }).click()
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Journal' })).toBeVisible()
  })
})
