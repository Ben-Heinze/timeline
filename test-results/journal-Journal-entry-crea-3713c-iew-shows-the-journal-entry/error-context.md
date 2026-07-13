# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journal.spec.ts >> Journal entry creation and editing >> files view shows the journal entry
- Location: e2e/journal.spec.ts:48:7

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Files' }) resolved to 2 elements:
    1) <button>Files</button> aka getByRole('button', { name: 'Files', exact: true })
    2) <button title="Show the files within the current view">☰ Files</button> aka getByRole('button', { name: '☰ Files' })

Call log:
  - waiting for getByRole('button', { name: 'Files' })

```

# Test source

```ts
  1  | import { test, expect } from './fixture'
  2  | 
  3  | test.describe('Journal entry creation and editing', () => {
  4  |   test.beforeAll(async ({ appPage: page }) => {
  5  |     await page.evaluate(() => window.location.reload())
  6  |     await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
  7  |     await page.getByRole('button', { name: 'Timeline' }).click()
  8  |   })
  9  | 
  10 |   test('clicking + Journal opens the modal', async ({ appPage: page }) => {
  11 |     await page.getByRole('button', { name: '+ Journal' }).click()
  12 |     await expect(page.getByPlaceholder('Title (optional)')).toBeVisible()
  13 |     await expect(page.locator('input[type="datetime-local"]')).toBeVisible()
  14 |     await expect(page.getByText('New Entry')).toBeVisible()
  15 |   })
  16 | 
  17 |   test('modal has Tiptap editor area', async ({ appPage: page }) => {
  18 |     await expect(page.locator('.ProseMirror')).toBeVisible()
  19 |   })
  20 | 
  21 |   test('modal has formatting toolbar buttons', async ({ appPage: page }) => {
  22 |     await expect(page.locator('button[title="Bold"]')).toBeVisible()
  23 |     await expect(page.locator('button[title="Italic"]')).toBeVisible()
  24 |   })
  25 | 
  26 |   test('Escape closes the modal', async ({ appPage: page }) => {
  27 |     await page.keyboard.press('Escape')
  28 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  29 |   })
  30 | 
  31 |   test('saves a journal entry with title and body', async ({ appPage: page }) => {
  32 |     await page.getByRole('button', { name: '+ Journal' }).click()
  33 |     await page.getByPlaceholder('Title (optional)').fill('My First Journal Entry')
  34 |     await page.locator('input[type="datetime-local"]').fill('2023-06-15T10:00')
  35 |     await page.locator('.ProseMirror').click()
  36 |     await page.keyboard.type('This is the journal body text.')
  37 |     // New entries use "Create" button
  38 |     await page.getByRole('button', { name: 'Create' }).click()
  39 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  40 |   })
  41 | 
  42 |   test('timeline shows histogram bar after entry creation', async ({ appPage: page }) => {
  43 |     await page.getByRole('button', { name: 'Timeline' }).click()
  44 |     await expect(page.locator('canvas')).toBeVisible()
  45 |     await expect(page.getByText('No entries yet')).not.toBeVisible()
  46 |   })
  47 | 
  48 |   test('files view shows the journal entry', async ({ appPage: page }) => {
> 49 |     await page.getByRole('button', { name: 'Files' }).click()
     |                                                       ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Files' }) resolved to 2 elements:
  50 |     await expect(page.getByText('My First Journal Entry')).toBeVisible()
  51 |   })
  52 | 
  53 |   test('saves a second journal entry', async ({ appPage: page }) => {
  54 |     await page.getByRole('button', { name: 'Timeline' }).click()
  55 |     await page.getByRole('button', { name: '+ Journal' }).click()
  56 |     await page.getByPlaceholder('Title (optional)').fill('Second Journal Entry')
  57 |     await page.locator('input[type="datetime-local"]').fill('2022-03-10T14:30')
  58 |     await page.locator('.ProseMirror').click()
  59 |     await page.keyboard.type('Second body text.')
  60 |     await page.getByRole('button', { name: 'Create' }).click()
  61 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  62 |   })
  63 | 
  64 |   test('editing a journal entry updates its title', async ({ appPage: page }) => {
  65 |     await page.getByRole('button', { name: 'Files' }).click()
  66 |     await page.getByText('My First Journal Entry').dblclick()
  67 |     // Double-click opens EntryModal (not JournalModal) — click its Edit button to enter edit mode
  68 |     await page.getByRole('button', { name: 'Edit' }).click()
  69 |     await expect(page.getByText('Edit Entry')).toBeVisible()
  70 |     const titleInput = page.getByPlaceholder('Title (optional)')
  71 |     await titleInput.clear()
  72 |     await titleInput.fill('My Updated Journal Entry')
  73 |     // Edit mode uses "Save" button
  74 |     await page.getByRole('button', { name: 'Save' }).click()
  75 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  76 |     await expect(page.getByText('My Updated Journal Entry')).toBeVisible()
  77 |   })
  78 | 
  79 |   test('Cancel button closes the modal without saving', async ({ appPage: page }) => {
  80 |     await page.getByRole('button', { name: 'Timeline' }).click()
  81 |     await page.getByRole('button', { name: '+ Journal' }).click()
  82 |     await page.getByPlaceholder('Title (optional)').fill('Should Not Be Saved')
  83 |     await page.getByRole('button', { name: 'Cancel' }).click()
  84 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  85 |   })
  86 | 
  87 |   test('clicking backdrop closes the journal modal', async ({ appPage: page }) => {
  88 |     await page.getByRole('button', { name: '+ Journal' }).click()
  89 |     await expect(page.getByPlaceholder('Title (optional)')).toBeVisible()
  90 |     // Click far left edge of the backdrop (outside the 660px modal centered on screen)
  91 |     await page.mouse.click(10, 400)
  92 |     await expect(page.getByPlaceholder('Title (optional)')).not.toBeVisible()
  93 |   })
  94 | })
  95 | 
```