import { test, expect } from './fixture'

test.describe('Group management', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Timeline' }).click()
  })

  test('clicking + opens the new group form', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await expect(page.getByText('New Group')).toBeVisible()
    await expect(page.getByPlaceholder('Group name')).toBeVisible()
  })

  test('cancelling the form hides it', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await expect(page.getByPlaceholder('Group name')).toBeVisible()
    await page.locator('aside').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
  })

  test('pressing Escape in name field hides the form', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await page.getByPlaceholder('Group name').press('Escape')
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
  })

  test('Create button is disabled when name is empty', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await expect(page.locator('aside').getByRole('button', { name: 'Create' })).toBeDisabled()
    // Close form before next test
    await page.getByPlaceholder('Group name').press('Escape')
  })

  test('creates a group and shows it in the sidebar', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await page.getByPlaceholder('Group name').fill('E2E Group Alpha')
    await page.locator('aside').getByRole('button', { name: 'Create' }).click()
    // Wait for form to close before checking — the open form has a parent <select> that
    // would also match 'E2E Group Alpha' as an <option>, causing strict-mode violation.
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
    await expect(page.locator('aside').getByText('E2E Group Alpha', { exact: true })).toBeVisible()
  })

  test('clicking a group row selects it', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Alpha', { exact: true }).click()
    await expect(page.getByText('All entries')).toBeVisible()
  })

  test('hovering group row shows edit and delete buttons', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Alpha', { exact: true }).hover()
    await expect(page.locator('aside button[title="Edit"]')).toBeVisible()
    await expect(page.locator('aside button[title="Delete"]')).toBeVisible()
  })

  test('editing a group updates its name in the sidebar', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Alpha', { exact: true }).hover()
    await page.locator('aside button[title="Edit"]').click()
    await expect(page.getByText('Edit Group')).toBeVisible()
    const input = page.getByPlaceholder('Group name')
    await input.clear()
    await input.fill('E2E Group Alpha Renamed')
    await page.locator('aside').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
    await expect(page.locator('aside').getByText('E2E Group Alpha Renamed', { exact: true })).toBeVisible()
    await expect(page.locator('aside').getByText('E2E Group Alpha', { exact: true })).not.toBeVisible()
  })

  test('pressing Enter in the edit form saves the group', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Alpha Renamed', { exact: true }).hover()
    await page.locator('aside button[title="Edit"]').click()
    const input = page.getByPlaceholder('Group name')
    await input.clear()
    await input.fill('E2E Group Enter Saved')
    await input.press('Enter')
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
    await expect(page.locator('aside').getByText('E2E Group Enter Saved', { exact: true })).toBeVisible()
  })

  test('creates a second group', async ({ appPage: page }) => {
    await page.locator('aside button[title="New group"]').click()
    await page.getByPlaceholder('Group name').fill('E2E Group Beta')
    await page.locator('aside').getByRole('button', { name: 'Create' }).click()
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
    await expect(page.locator('aside').getByText('E2E Group Beta', { exact: true })).toBeVisible()
  })

  test('deletes a group after confirming the dialog', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Beta', { exact: true }).hover()
    page.once('dialog', d => d.accept())
    await page.locator('aside button[title="Delete"]').click()
    await expect(page.locator('aside').getByText('E2E Group Beta', { exact: true })).not.toBeVisible()
  })

  test('clicking All entries deselects any group', async ({ appPage: page }) => {
    await page.locator('aside').getByText('E2E Group Enter Saved', { exact: true }).click()
    await page.getByText('All entries').click()
    await expect(page.getByText('All entries')).toBeVisible()
  })
})
