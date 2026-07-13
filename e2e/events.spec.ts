import { test, expect } from './fixture'

// Dates must fall inside the default visible range (last ~5 years) for the
// panel, which scopes its list to the visible timeline window.
const FROM = '2025-01-05'
const TO = '2025-03-15'

test.describe('Life events', () => {
  test.beforeAll(async ({ appPage: page }) => {
    // Specs share one worker and database — clear events left by other specs
    await page.evaluate(async () => {
      const api = (window as unknown as { api: { events: { list: () => Promise<{ id: number }[]>; delete: (id: number) => Promise<void> } } }).api
      for (const ev of await api.events.list()) await api.events.delete(ev.id)
    })
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Timeline' }).click()
  })

  test('events panel is open by default with an empty state', async ({ appPage: page }) => {
    await expect(page.getByText('Events', { exact: true })).toBeVisible()
    await expect(page.getByText('No events yet.', { exact: false })).toBeVisible()
  })

  test('creates an event with a date range and description', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Add' }).click()
    await expect(page.getByText('New Event')).toBeVisible()
    await page.getByPlaceholder(/Title \(required\)/).fill('E2E College Year')
    await page.getByPlaceholder('Description (optional)').fill('Freshman dorm life')
    await page.locator('input[type="date"]').first().fill(FROM)
    await page.locator('input[type="date"]').nth(1).fill(TO)
    await page.getByRole('button', { name: 'Create Event' }).click()
    await expect(page.getByText('New Event')).not.toBeVisible()
    await expect(page.getByText('E2E College Year')).toBeVisible()
    await expect(page.getByText('Jan 5, 2025 – Mar 15, 2025')).toBeVisible()
  })

  test('clicking an event expands its description', async ({ appPage: page }) => {
    await expect(page.getByText('Freshman dorm life')).not.toBeVisible()
    await page.getByText('E2E College Year').click()
    await expect(page.getByText('Freshman dorm life')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('overlapping events are allowed', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Add' }).click()
    await page.getByPlaceholder(/Title \(required\)/).fill('E2E Part-time Job')
    await page.locator('input[type="date"]').first().fill('2025-02-01')
    await page.locator('input[type="date"]').nth(1).fill('2025-06-30')
    await page.getByRole('button', { name: 'Create Event' }).click()
    await expect(page.getByText('E2E College Year')).toBeVisible()
    await expect(page.getByText('E2E Part-time Job')).toBeVisible()
  })

  test('ongoing checkbox disables the end date and shows "present"', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Add' }).click()
    await page.getByPlaceholder(/Title \(required\)/).fill('E2E Current Home')
    await page.locator('input[type="date"]').first().fill('2025-05-01')
    await page.getByText('Ongoing (no end date)').click()
    await expect(page.locator('input[type="date"]').nth(1)).toBeDisabled()
    await page.getByRole('button', { name: 'Create Event' }).click()
    await expect(page.getByText('May 1, 2025 – present')).toBeVisible()
  })

  test('edits an event title', async ({ appPage: page }) => {
    await page.getByText('E2E College Year').click()  // collapse from earlier test
    await page.getByText('E2E College Year').click()  // re-expand
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByText('Edit Event')).toBeVisible()
    const title = page.getByPlaceholder(/Title \(required\)/)
    await title.clear()
    await title.fill('E2E Sophomore Year')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Edit Event')).not.toBeVisible()
    await expect(page.getByText('E2E Sophomore Year')).toBeVisible()
    await expect(page.getByText('E2E College Year')).not.toBeVisible()
  })

  test('events persist across a reload', async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await expect(page.getByText('E2E Sophomore Year')).toBeVisible()
    await expect(page.getByText('E2E Part-time Job')).toBeVisible()
  })

  test('deletes an event after confirming', async ({ appPage: page }) => {
    await page.getByText('E2E Part-time Job').click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm delete' }).click()
    await expect(page.getByText('E2E Part-time Job')).not.toBeVisible()
  })

  test('panel can be closed and reopened from the toolbar', async ({ appPage: page }) => {
    await page.locator('aside button[title="Close panel"]').click()
    await expect(page.getByText('E2E Sophomore Year')).not.toBeVisible()
    await page.getByRole('button', { name: '◨ Events' }).click()
    await expect(page.getByText('E2E Sophomore Year')).toBeVisible()
  })

  test('groups sidebar can be toggled from the toolbar', async ({ appPage: page }) => {
    await expect(page.locator('aside button[title="New group"]')).toBeVisible()
    await page.getByRole('button', { name: '◧ Groups' }).click()
    await expect(page.locator('aside button[title="New group"]')).not.toBeVisible()
    await page.getByRole('button', { name: '◧ Groups' }).click()
    await expect(page.locator('aside button[title="New group"]')).toBeVisible()
  })
})
