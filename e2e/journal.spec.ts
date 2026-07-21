import { test, expect } from './fixture'

test.describe('Journal entry creation and editing', () => {
  test.beforeAll(async ({ appPage: page }) => {
    await page.evaluate(() => window.location.reload())
    await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  })

  test('clicking + Journal opens the modal', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Journal' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).toBeVisible()
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible()
    await expect(page.getByText('New Entry')).toBeVisible()
  })

  test('modal has Tiptap editor area', async ({ appPage: page }) => {
    await expect(page.locator('.ProseMirror')).toBeVisible()
  })

  test('modal has formatting toolbar buttons', async ({ appPage: page }) => {
    await expect(page.locator('button[title="Bold"]')).toBeVisible()
    await expect(page.locator('button[title="Italic"]')).toBeVisible()
  })

  test('Escape closes the modal', async ({ appPage: page }) => {
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  })

  test('saves a journal entry with title and body', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Journal' }).click()
    await page.getByPlaceholder('Title (optional)').fill('My First Journal Entry')
    await page.locator('input[type="datetime-local"]').fill('2023-06-15T10:00')
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('This is the journal body text.')
    // New entries use "Create" button
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  })

  test('timeline shows histogram bar after entry creation', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByText('No entries yet')).not.toBeVisible()
  })

  test('files view shows the journal entry', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await expect(page.getByText('My First Journal Entry')).toBeVisible()
  })

  test('saves a second journal entry', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await page.getByRole('button', { name: '+ Journal' }).click()
    await page.getByPlaceholder('Title (optional)').fill('Second Journal Entry')
    await page.locator('input[type="datetime-local"]').fill('2022-03-10T14:30')
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('Second body text.')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  })

  test('editing a journal entry updates its title', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await page.getByText('My First Journal Entry').dblclick()
    // Double-click opens EntryModal (not JournalModal) — click its Edit button to enter edit mode
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByText('Edit Entry')).toBeVisible()
    const titleInput = page.getByPlaceholder('Title (optional)')
    await titleInput.clear()
    await titleInput.fill('My Updated Journal Entry')
    // Edit mode uses "Save" button
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
    await expect(page.getByText('My Updated Journal Entry')).toBeVisible()
  })

  test('Cancel button closes the modal without saving', async ({ appPage: page }) => {
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await page.getByRole('button', { name: '+ Journal' }).click()
    await page.getByPlaceholder('Title (optional)').fill('Should Not Be Saved')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  })

  test('clicking backdrop closes the journal modal', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '+ Journal' }).click()
    await expect(page.getByPlaceholder('Title (optional)')).toBeVisible()
    // Click far left edge of the backdrop (outside the 660px modal centered on screen)
    await page.mouse.click(10, 400)
    await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  })
})
