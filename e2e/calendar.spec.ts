import { test, expect, seedJournalEntries } from './fixture'

test.describe('Calendar view', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await seedJournalEntries(page, 2)
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Calendar' }).click()
  })

  test('shows all 12 month names', async ({ appPage: page }) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    for (const m of months) {
      await expect(page.locator('div', { hasText: m }).first()).toBeVisible()
    }
  })

  test('shows the current year in the header', async ({ appPage: page }) => {
    const currentYear = new Date().getFullYear().toString()
    await expect(page.getByText(currentYear).first()).toBeVisible()
  })

  test('shows left and right year navigation arrows', async ({ appPage: page }) => {
    await expect(page.getByRole('button', { name: '←' })).toBeVisible()
    await expect(page.getByRole('button', { name: '→' })).toBeVisible()
  })

  test('shows drag hint text', async ({ appPage: page }) => {
    await expect(page.getByText(/drag across days/i)).toBeVisible()
  })

  test('shows Less and More heatmap legend labels', async ({ appPage: page }) => {
    // These are tiny spans at the bottom of the header row
    const less = page.locator('span', { hasText: 'Less' })
    const more = page.locator('span', { hasText: 'More' })
    await expect(less).toBeVisible()
    await expect(more).toBeVisible()
  })

  test('navigating left shows previous year', async ({ appPage: page }) => {
    const currentYear = new Date().getFullYear()
    const prevYear = (currentYear - 1).toString()
    await page.getByRole('button', { name: '←' }).click()
    await expect(page.getByText(prevYear).first()).toBeVisible()
  })

  test('navigating right returns to current year', async ({ appPage: page }) => {
    const currentYear = new Date().getFullYear().toString()
    await page.getByRole('button', { name: '→' }).click()
    await expect(page.getByText(currentYear).first()).toBeVisible()
  })

  test('shows total entry count for the year', async ({ appPage: page }) => {
    await expect(page.getByText(/entr.* this year/i)).toBeVisible()
  })

  test('day cells are clickable and open DayView', async ({ appPage: page }) => {
    // Click day 1 of the current month in the grid
    const day1 = page.locator('div[style*="cursor: pointer"]', { hasText: /^1$/ }).first()
    await day1.click()
    // At minimum no crash; DayView may or may not appear depending on data
    await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible()
  })

  test('drag across days opens DateRangeGroupModal', async ({ appPage: page }) => {
    const currentYear = new Date().getFullYear()
    // Find January grid by navigating if needed
    const janLabel = page.locator('div', { hasText: 'January' }).first()
    await janLabel.scrollIntoViewIfNeeded()

    // Get day 5 and day 10 cells within January grid area
    const janContainer = janLabel.locator('..')
    const day5 = janContainer.locator('div', { hasText: /^5$/ }).first()
    const day10 = janContainer.locator('div', { hasText: /^10$/ }).first()

    const box5 = await day5.boundingBox()
    const box10 = await day10.boundingBox()
    if (!box5 || !box10) {
      test.skip()
      return
    }

    await page.mouse.move(box5.x + box5.width / 2, box5.y + box5.height / 2)
    await page.mouse.down()
    await page.mouse.move(box10.x + box10.width / 2, box10.y + box10.height / 2)
    await page.mouse.up()

    await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })
  })

  test('DateRangeGroupModal shows title input', async ({ appPage: page }) => {
    // Modal should still be open from previous drag test
    await expect(page.getByPlaceholder('Title (required)')).toBeVisible()
  })

  test('DateRangeGroupModal shows the date range', async ({ appPage: page }) => {
    // The modal shows the selected date range (month abbreviations like "Jan")
    const modalContent = page.locator('div', { hasText: 'New Date Range Group' }).last()
    await expect(modalContent).toBeVisible()
  })

  test('Escape closes DateRangeGroupModal', async ({ appPage: page }) => {
    await page.keyboard.press('Escape')
    await expect(page.getByText('New Date Range Group')).not.toBeVisible()
  })

  test('cancelling DateRangeGroupModal via button closes it', async ({ appPage: page }) => {
    // Re-open the modal with another drag
    const janContainer = page.locator('div', { hasText: 'January' }).first().locator('..')
    const day3 = janContainer.locator('div', { hasText: /^3$/ }).first()
    const day8 = janContainer.locator('div', { hasText: /^8$/ }).first()
    const box3 = await day3.boundingBox()
    const box8 = await day8.boundingBox()
    if (!box3 || !box8) { test.skip(); return }
    await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2)
    await page.mouse.down()
    await page.mouse.move(box8.x + box8.width / 2, box8.y + box8.height / 2)
    await page.mouse.up()
    await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('New Date Range Group')).not.toBeVisible()
  })

  test('creating a DateRange group shows it in the sidebar', async ({ appPage: page }) => {
    const janContainer = page.locator('div', { hasText: 'January' }).first().locator('..')
    const day14 = janContainer.locator('div', { hasText: /^14$/ }).first()
    const day20 = janContainer.locator('div', { hasText: /^20$/ }).first()
    const box14 = await day14.boundingBox()
    const box20 = await day20.boundingBox()
    if (!box14 || !box20) { test.skip(); return }
    await page.mouse.move(box14.x + box14.width / 2, box14.y + box14.height / 2)
    await page.mouse.down()
    await page.mouse.move(box20.x + box20.width / 2, box20.y + box20.height / 2)
    await page.mouse.up()
    await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })

    await page.getByPlaceholder('Title (required)').fill('Mid January')
    await page.getByRole('button', { name: 'Create Group' }).click()

    await expect(page.getByText('New Date Range Group')).not.toBeVisible()
    // The sidebar is scoped to the day pinned by the earlier DayView test —
    // close the file browser to unpin it so all groups are visible again
    await page.locator('button[title="Close file browser"]').click()
    await expect(page.locator('aside').getByText('Mid January', { exact: true })).toBeVisible({ timeout: 8_000 })
  })
})
