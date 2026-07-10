// Generates SQL and pipes it to sqlite3.
// Run with: nix-shell -p nodejs_22 sqlite --run "node scripts/seed.js"
const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DB = '/home/ben/.config/Electron/library/timeline.db'
const MS_DAY = 86_400_000

const TYPES = ['photo', 'photo', 'photo', 'video', 'video', 'audio', 'document', 'journal']

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function esc(s) { return s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'` }

function titleFor(type, ts) {
  const d = new Date(ts)
  const month = d.toLocaleString('en-US', { month: 'long' })
  const year  = d.getFullYear()
  switch (type) {
    case 'photo':    return pick([`IMG_${rand(1000,9999)}`, `Photo ${month} ${year}`, null])
    case 'video':    return pick([`VID_${rand(1000,9999)}`, `Clip ${rand(1,200)}`, null])
    case 'audio':    return pick([`Recording ${rand(1,500)}`, `Voice memo`, null])
    case 'document': return pick([`Notes ${month} ${year}`, `Scan ${rand(1,200)}`, null])
    case 'journal':  return pick([`${month} ${d.getDate()}, ${year}`, `Thoughts`, null])
    default:         return null
  }
}

const timestamps = []
const bgStart = new Date(2010, 0, 1).getTime()
const bgEnd   = new Date(2026, 5, 1).getTime()

// Sparse background: ~1–3 entries per week, with some empty weeks
for (let t = bgStart; t < bgEnd; t += 7 * MS_DAY) {
  if (Math.random() < 0.25) continue
  const n = rand(1, 3)
  for (let i = 0; i < n; i++) timestamps.push(t + rand(0, 7 * MS_DAY - 1))
}

// Annual summer bursts (July–August) — some years are big trip years
for (let year = 2010; year <= 2025; year++) {
  const start = new Date(year, 6, 1).getTime()
  const len   = 61 * MS_DAY
  const n     = Math.random() < 0.4 ? rand(80, 220) : rand(15, 55)
  for (let i = 0; i < n; i++) timestamps.push(start + rand(0, len - 1))
}

// Holiday clusters (Dec 20 – Jan 1 each year)
for (let year = 2010; year <= 2025; year++) {
  const start = new Date(year, 11, 20).getTime()
  const n     = rand(20, 70)
  for (let i = 0; i < n; i++) timestamps.push(start + rand(0, 12 * MS_DAY - 1))
}

// Specific "big event" weeks
const eventDates = [
  [2012,3,14], [2013,7,3],  [2014,5,20], [2015,1,7],  [2016,9,1],
  [2017,4,15], [2018,2,22], [2019,8,5],  [2020,0,10], [2021,6,18],
  [2022,3,2],  [2023,10,11],[2024,1,29], [2025,5,7],  [2011,8,3],
  [2013,2,17], [2016,5,11], [2019,11,4], [2023,4,20], [2024,7,15],
]
for (const [y,m,d] of eventDates) {
  const base = new Date(y, m, d).getTime()
  const n    = rand(40, 130)
  for (let i = 0; i < n; i++) timestamps.push(base + rand(-2 * MS_DAY, 9 * MS_DAY))
}

// Very dense single days (weddings, concerts, etc.)
const denseDays = [
  [2014,8,13],[2017,5,24],[2019,2,16],[2022,7,6],[2024,9,19],[2015,6,4],[2018,10,3]
]
for (const [y,m,d] of denseDays) {
  const base = new Date(y, m, d).getTime()
  const n    = rand(60, 180)
  for (let i = 0; i < n; i++) timestamps.push(base + rand(0, MS_DAY - 1))
}

// Shuffle
for (let i = timestamps.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [timestamps[i], timestamps[j]] = [timestamps[j], timestamps[i]]
}

// Trim / pad to exactly 5000
const TARGET = 5000
while (timestamps.length < TARGET) timestamps.push(bgStart + rand(0, bgEnd - bgStart))
const final = timestamps.slice(0, TARGET)

// Write SQL file
const now = Date.now()
const lines = ['BEGIN;']
for (const ts of final) {
  const type  = pick(TYPES)
  const title = titleFor(type, ts)
  lines.push(
    `INSERT INTO entries (type,timestamp,title,file_path,thumbnail_small,thumbnail_medium,thumbnail_large,duration_seconds,rich_text_json,group_id,needs_date_review,created_at) VALUES (${esc(type)},${ts},${esc(title)},NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,${now});`
  )
}
lines.push('COMMIT;')

const sqlFile = path.join(os.tmpdir(), 'timeline_seed.sql')
fs.writeFileSync(sqlFile, lines.join('\n'))
console.log(`Generated ${final.length} INSERT statements → ${sqlFile}`)

execSync(`sqlite3 "${DB}" < "${sqlFile}"`)
console.log('Done.')

const result = execSync(`sqlite3 "${DB}" "SELECT COUNT(*) FROM entries;"`).toString().trim()
console.log(`Database now has ${result} total entries.`)

fs.unlinkSync(sqlFile)
