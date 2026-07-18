---
name: verify
description: Build, launch, and drive the Timeline Electron app headlessly to verify UI changes at runtime.
---

# Verifying Timeline changes

Electron + React app; all tooling runs through nix-shell (no node/npm on PATH).

## Build & launch

```bash
nix-shell shell.nix --run "npm run build"        # outputs to out/ (tracked in git)
Xvfb :99 -screen 0 1600x1000x24 &                # system Xvfb; display :0 is the user's real session — never use it
```

Drive with playwright-core (already a dependency). The driver script **must live in the
repo root** (ESM resolution needs the project's node_modules), e.g. `_verify-x.mjs`;
delete it afterwards. Launch pattern (matches `e2e/fixture.ts`):

```js
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',  // symlink to nix store
  args: ['--no-sandbox', `--user-data-dir=${tmpDir}`, '.'],
  env: { ...process.env, DISPLAY: ':99' },
})
const win = await app.firstWindow()
await win.waitForSelector('button:has-text("+ Journal")')  // React mounted
```

Run it: `nix-shell shell.nix --run "node _verify-x.mjs"`.

## Gotchas

- **Seeding:** create entries via `win.evaluate(() => window.api.entries.create({...}))`
  (see `e2e/fixture.ts` seedJournalEntries), then `win.reload()` — the app only refreshes
  its data extent on ingest events or reload.
- **Opening DayView:** canvas clicks drill down year → month → week → day; only a click
  at day zoom opens the bottom panel. Click the "Year" tab first (re-fits to extent + 4%
  pad), then click at the x-fraction of the target date within each stage's visible range:
  year = [Jan 1, Jan 1+1y], month = [1st, 1st+1mo], week = [Sunday, +7d] (local time).
- **Settings persistence:** `${userDataDir}/settings.json` — read it to assert persisted
  values (histogramHeight, dayViewHeight, dayViewMode, …).
- No data-testids; locate elements by text or inline style
  (e.g. resize handles: `[...document.querySelectorAll('div')].find(d => d.style.cursor === 'ns-resize')`).
- Pre-existing, not a regression: tsc reports missing types for `d3-time`
  (TimelineCanvas.tsx).
- Day periods are **local** calendar days: SQL buckets by local date, and both
  TimelineCanvas and CalendarHeatmap snap clicks to local midnights.
