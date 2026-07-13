# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar.spec.ts >> Calendar view >> creating a DateRange group shows it in the sidebar
- Location: e2e/calendar.spec.ts:129:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('aside').getByText('Mid January', { exact: true })
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for locator('aside').getByText('Mid January', { exact: true })

```

```yaml
- complementary:
  - heading "Groups" [level=2]
  - button "+"
  - text: Thursday, January 1, 2026
  - combobox "Sort groups":
    - option "Name" [selected]
    - option "Date"
    - option "Size"
  - button "↑"
  - textbox "Filter groups…"
  - text: All entries
  - paragraph: No groups in this period
- main:
  - heading "Timeline" [level=1]
  - button "Timeline"
  - button "Calendar"
  - button "Files"
  - button "Settings"
  - text: ⌕
  - textbox "Search…"
  - button "Filter"
  - button "+ Journal"
  - button "Sync"
  - button "+ Import"
  - button "←"
  - text: "2026"
  - button "→"
  - text: 1 entry this year · drag across days to create a group Mid January Less More January ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 February ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 March ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 April ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 May ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 June ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 July ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 August ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 September ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 October ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 November ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 December ↗ Su Mo Tu We Th Fr Sa 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 Thursday, January 1, 2026 0 items
  - button "≡"
  - button "small"
  - button "medium"
  - button "large"
  - button "✕"
  - text: No entries for this period
```

# Test source

```ts
  46  |     const currentYear = new Date().getFullYear()
  47  |     const prevYear = (currentYear - 1).toString()
  48  |     await page.getByRole('button', { name: '←' }).click()
  49  |     await expect(page.getByText(prevYear).first()).toBeVisible()
  50  |   })
  51  | 
  52  |   test('navigating right returns to current year', async ({ appPage: page }) => {
  53  |     const currentYear = new Date().getFullYear().toString()
  54  |     await page.getByRole('button', { name: '→' }).click()
  55  |     await expect(page.getByText(currentYear).first()).toBeVisible()
  56  |   })
  57  | 
  58  |   test('shows total entry count for the year', async ({ appPage: page }) => {
  59  |     await expect(page.getByText(/entr.* this year/i)).toBeVisible()
  60  |   })
  61  | 
  62  |   test('day cells are clickable and open DayView', async ({ appPage: page }) => {
  63  |     // Click day 1 of the current month in the grid
  64  |     const day1 = page.locator('div[style*="cursor: pointer"]', { hasText: /^1$/ }).first()
  65  |     await day1.click()
  66  |     // At minimum no crash; DayView may or may not appear depending on data
  67  |     await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible()
  68  |   })
  69  | 
  70  |   test('drag across days opens DateRangeGroupModal', async ({ appPage: page }) => {
  71  |     const currentYear = new Date().getFullYear()
  72  |     // Find January grid by navigating if needed
  73  |     const janLabel = page.locator('div', { hasText: 'January' }).first()
  74  |     await janLabel.scrollIntoViewIfNeeded()
  75  | 
  76  |     // Get day 5 and day 10 cells within January grid area
  77  |     const janContainer = janLabel.locator('..')
  78  |     const day5 = janContainer.locator('div', { hasText: /^5$/ }).first()
  79  |     const day10 = janContainer.locator('div', { hasText: /^10$/ }).first()
  80  | 
  81  |     const box5 = await day5.boundingBox()
  82  |     const box10 = await day10.boundingBox()
  83  |     if (!box5 || !box10) {
  84  |       test.skip()
  85  |       return
  86  |     }
  87  | 
  88  |     await page.mouse.move(box5.x + box5.width / 2, box5.y + box5.height / 2)
  89  |     await page.mouse.down()
  90  |     await page.mouse.move(box10.x + box10.width / 2, box10.y + box10.height / 2)
  91  |     await page.mouse.up()
  92  | 
  93  |     await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })
  94  |   })
  95  | 
  96  |   test('DateRangeGroupModal shows title input', async ({ appPage: page }) => {
  97  |     // Modal should still be open from previous drag test
  98  |     await expect(page.getByPlaceholder('Title (required)')).toBeVisible()
  99  |   })
  100 | 
  101 |   test('DateRangeGroupModal shows the date range', async ({ appPage: page }) => {
  102 |     // The modal shows the selected date range (month abbreviations like "Jan")
  103 |     const modalContent = page.locator('div', { hasText: 'New Date Range Group' }).last()
  104 |     await expect(modalContent).toBeVisible()
  105 |   })
  106 | 
  107 |   test('Escape closes DateRangeGroupModal', async ({ appPage: page }) => {
  108 |     await page.keyboard.press('Escape')
  109 |     await expect(page.getByText('New Date Range Group')).not.toBeVisible()
  110 |   })
  111 | 
  112 |   test('cancelling DateRangeGroupModal via button closes it', async ({ appPage: page }) => {
  113 |     // Re-open the modal with another drag
  114 |     const janContainer = page.locator('div', { hasText: 'January' }).first().locator('..')
  115 |     const day3 = janContainer.locator('div', { hasText: /^3$/ }).first()
  116 |     const day8 = janContainer.locator('div', { hasText: /^8$/ }).first()
  117 |     const box3 = await day3.boundingBox()
  118 |     const box8 = await day8.boundingBox()
  119 |     if (!box3 || !box8) { test.skip(); return }
  120 |     await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2)
  121 |     await page.mouse.down()
  122 |     await page.mouse.move(box8.x + box8.width / 2, box8.y + box8.height / 2)
  123 |     await page.mouse.up()
  124 |     await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })
  125 |     await page.getByRole('button', { name: 'Cancel' }).click()
  126 |     await expect(page.getByText('New Date Range Group')).not.toBeVisible()
  127 |   })
  128 | 
  129 |   test('creating a DateRange group shows it in the sidebar', async ({ appPage: page }) => {
  130 |     const janContainer = page.locator('div', { hasText: 'January' }).first().locator('..')
  131 |     const day14 = janContainer.locator('div', { hasText: /^14$/ }).first()
  132 |     const day20 = janContainer.locator('div', { hasText: /^20$/ }).first()
  133 |     const box14 = await day14.boundingBox()
  134 |     const box20 = await day20.boundingBox()
  135 |     if (!box14 || !box20) { test.skip(); return }
  136 |     await page.mouse.move(box14.x + box14.width / 2, box14.y + box14.height / 2)
  137 |     await page.mouse.down()
  138 |     await page.mouse.move(box20.x + box20.width / 2, box20.y + box20.height / 2)
  139 |     await page.mouse.up()
  140 |     await expect(page.getByText('New Date Range Group')).toBeVisible({ timeout: 5_000 })
  141 | 
  142 |     await page.getByPlaceholder('Title (required)').fill('Mid January')
  143 |     await page.getByRole('button', { name: 'Create Group' }).click()
  144 | 
  145 |     await expect(page.getByText('New Date Range Group')).not.toBeVisible()
> 146 |     await expect(page.locator('aside').getByText('Mid January', { exact: true })).toBeVisible({ timeout: 8_000 })
      |                                                                                   ^ Error: expect(locator).toBeVisible() failed
  147 |   })
  148 | })
  149 | 
```