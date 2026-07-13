# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> App launch and navigation >> shows all four view tabs
- Location: e2e/app.spec.ts:13:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Files' })
Expected: visible
Error: strict mode violation: getByRole('button', { name: 'Files' }) resolved to 2 elements:
    1) <button>Files</button> aka getByRole('button', { name: 'Files', exact: true })
    2) <button title="Show the files within the current view">☰ Files</button> aka getByRole('button', { name: '☰ Files' })

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('button', { name: 'Files' })

```

# Test source

```ts
  1  | import { test, expect } from './fixture'
  2  | 
  3  | test.describe('App launch and navigation', () => {
  4  |   test.beforeAll(async ({ appPage: page }) => {
  5  |     await page.evaluate(() => window.location.reload())
  6  |     await page.waitForSelector('button:has-text("+ Journal")', { timeout: 20_000 })
  7  |   })
  8  | 
  9  |   test('shows Timeline heading in header', async ({ appPage: page }) => {
  10 |     await expect(page.locator('h1')).toContainText('Timeline')
  11 |   })
  12 | 
  13 |   test('shows all four view tabs', async ({ appPage: page }) => {
  14 |     await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible()
  15 |     await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible()
> 16 |     await expect(page.getByRole('button', { name: 'Files' })).toBeVisible()
     |                                                               ^ Error: expect(locator).toBeVisible() failed
  17 |     await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  18 |   })
  19 | 
  20 |   test('shows action buttons in header', async ({ appPage: page }) => {
  21 |     await expect(page.getByRole('button', { name: '+ Journal' })).toBeVisible()
  22 |     await expect(page.getByRole('button', { name: 'Sync' })).toBeVisible()
  23 |     await expect(page.getByRole('button', { name: '+ Import' })).toBeVisible()
  24 |   })
  25 | 
  26 |   test('shows sidebar with Groups label and All entries row', async ({ appPage: page }) => {
  27 |     await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
  28 |     await expect(page.getByText('All entries')).toBeVisible()
  29 |   })
  30 | 
  31 |   test('Timeline tab is active by default', async ({ appPage: page }) => {
  32 |     await page.getByRole('button', { name: 'Timeline' }).click()
  33 |     await expect(page.locator('canvas')).toBeVisible()
  34 |   })
  35 | 
  36 |   test('switches to Calendar view', async ({ appPage: page }) => {
  37 |     await page.getByRole('button', { name: 'Calendar' }).click()
  38 |     await expect(page.getByText('January')).toBeVisible()
  39 |     await expect(page.getByText('December')).toBeVisible()
  40 |   })
  41 | 
  42 |   test('switches to Files view', async ({ appPage: page }) => {
  43 |     await page.getByRole('button', { name: 'Files' }).click()
  44 |     await expect(page.getByText(/Sort/i).first()).toBeVisible()
  45 |   })
  46 | 
  47 |   test('switches to Settings view and hides action buttons', async ({ appPage: page }) => {
  48 |     await page.getByRole('button', { name: 'Settings' }).click()
  49 |     await expect(page.getByRole('button', { name: '+ Journal' })).not.toBeVisible()
  50 |     await expect(page.getByText(/import mode/i).first()).toBeVisible()
  51 |   })
  52 | 
  53 |   test('returns to Timeline view from Settings', async ({ appPage: page }) => {
  54 |     await page.getByRole('button', { name: 'Timeline' }).click()
  55 |     await expect(page.locator('canvas')).toBeVisible()
  56 |     await expect(page.getByRole('button', { name: '+ Journal' })).toBeVisible()
  57 |   })
  58 | })
  59 | 
```