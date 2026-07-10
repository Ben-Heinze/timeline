// Run with: nix-shell -p nodejs_22 sqlite --run "node scripts/seed-groups-tags.js"
const { execSync } = require('child_process')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const DB = '/home/ben/.config/Electron/library/timeline.db'
const MS_DAY = 86_400_000

function sql(query) {
  return execSync(`sqlite3 "${DB}" "${query.replace(/"/g, '\\"')}"`)
    .toString().trim().split('\n').filter(Boolean)
}

function runFile(content) {
  const f = path.join(os.tmpdir(), `tl_${Date.now()}.sql`)
  fs.writeFileSync(f, content)
  try { execSync(`sqlite3 "${DB}" < "${f}"`, { stdio: 'inherit' }) }
  finally { fs.unlinkSync(f) }
}

// ── 1. Apply missing schema (migrations the app normally handles) ─────────────
runFile(`
  -- New columns on entries
  ALTER TABLE entries ADD COLUMN is_missing   INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE entries ADD COLUMN content_hash TEXT;
  ALTER TABLE entries ADD COLUMN import_mode  TEXT    NOT NULL DEFAULT 'copy';

  -- New columns on groups
  ALTER TABLE groups ADD COLUMN description TEXT;
  ALTER TABLE groups ADD COLUMN date_from   INTEGER;
  ALTER TABLE groups ADD COLUMN date_to     INTEGER;

  -- Tags tables
  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS group_tags (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (group_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON entries(content_hash);
  CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_group_tags_tag ON group_tags(tag_id);
`)
console.log('Schema up to date.')

// ── 2. Define the dense days and their event metadata ─────────────────────────
const now = Date.now()

const events = [
  {
    date:  new Date(2014, 8, 13),  // Sep 13 2014
    group: { name: 'Wedding Day',       color: '#ec4899' },
    tags:  ['wedding', 'family', 'celebration', 'ceremony'],
  },
  {
    date:  new Date(2017, 5, 24),  // Jun 24 2017
    group: { name: 'Summer Concert',    color: '#8b5cf6' },
    tags:  ['music', 'concert', 'friends', 'nightlife'],
  },
  {
    date:  new Date(2019, 2, 16),  // Mar 16 2019
    group: { name: 'Birthday Party',    color: '#f59e0b' },
    tags:  ['birthday', 'party', 'celebration', 'friends'],
  },
  {
    date:  new Date(2022, 7, 6),   // Aug 6 2022
    group: { name: 'Beach Weekend',     color: '#06b6d4' },
    tags:  ['beach', 'summer', 'vacation', 'outdoors'],
  },
  {
    date:  new Date(2024, 9, 19),  // Oct 19 2024
    group: { name: 'Halloween Party',   color: '#f97316' },
    tags:  ['halloween', 'party', 'costumes', 'celebration'],
  },
  {
    date:  new Date(2015, 6, 4),   // Jul 4 2015
    group: { name: '4th of July',       color: '#ef4444' },
    tags:  ['holiday', 'fireworks', 'family', 'celebration'],
  },
  {
    date:  new Date(2018, 10, 3),  // Nov 3 2018
    group: { name: 'Thanksgiving Trip', color: '#84cc16' },
    tags:  ['thanksgiving', 'holiday', 'family', 'travel'],
  },
]

// ── 3. Insert groups, tags, and wire them up ──────────────────────────────────
const lines = ['BEGIN;']

for (const ev of events) {
  const from = ev.date.getTime()
  const to   = from + MS_DAY          // entries spanning the single day

  // Insert group
  lines.push(
    `INSERT OR IGNORE INTO groups (name, color, created_at) VALUES ('${ev.group.name}', '${ev.group.color}', ${now});`
  )

  // Insert tags
  for (const tag of ev.tags) {
    lines.push(`INSERT OR IGNORE INTO tags (name) VALUES ('${tag}');`)
  }

  // Assign entries from this day to the group
  lines.push(`
UPDATE entries
SET group_id = (SELECT id FROM groups WHERE name = '${ev.group.name}' ORDER BY id DESC LIMIT 1)
WHERE timestamp >= ${from} AND timestamp < ${to + MS_DAY};
  `.trim())

  // Attach all tags to every entry in the day window via entry_tags
  for (const tag of ev.tags) {
    lines.push(`
INSERT OR IGNORE INTO entry_tags (entry_id, tag_id)
SELECT e.id, t.id
FROM entries e, tags t
WHERE e.timestamp >= ${from} AND e.timestamp < ${to + MS_DAY}
  AND t.name = '${tag}';
    `.trim())
  }

  // Also attach tags to the group via group_tags
  for (const tag of ev.tags) {
    lines.push(`
INSERT OR IGNORE INTO group_tags (group_id, tag_id)
SELECT g.id, t.id
FROM groups g, tags t
WHERE g.name = '${ev.group.name}' AND t.name = '${tag}'
ORDER BY g.id DESC LIMIT 1;
    `.trim())
  }
}

lines.push('COMMIT;')
runFile(lines.join('\n'))
console.log('Groups and tags applied.')

// ── 4. Summary ────────────────────────────────────────────────────────────────
const groups  = sql('SELECT COUNT(*) FROM groups')[0]
const tags    = sql('SELECT COUNT(*) FROM tags')[0]
const etLinks = sql('SELECT COUNT(*) FROM entry_tags')[0]
console.log(`Groups: ${groups}  |  Tags: ${tags}  |  entry_tag links: ${etLinks}`)

for (const ev of events) {
  const count = sql(
    `SELECT COUNT(*) FROM entries WHERE timestamp >= ${ev.date.getTime()} AND timestamp < ${ev.date.getTime() + 2*MS_DAY}`
  )[0]
  console.log(`  ${ev.group.name} (${ev.date.toDateString()}): ${count} entries`)
}
