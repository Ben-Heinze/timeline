import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

const dbPath = path.join(os.homedir(), '.config', 'timeline', 'library', 'timeline.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    parent_id  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    color      TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    type              TEXT    NOT NULL CHECK(type IN ('photo','video','audio','document','journal')),
    timestamp         INTEGER NOT NULL,
    title             TEXT,
    file_path         TEXT,
    thumbnail_small   TEXT,
    thumbnail_medium  TEXT,
    thumbnail_large   TEXT,
    duration_seconds  INTEGER,
    rich_text_json    TEXT,
    group_id          INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    needs_date_review INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
  CREATE INDEX IF NOT EXISTS idx_entries_group_id  ON entries(group_id);
`)

const insert = db.prepare(`
  INSERT INTO entries
    (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
     thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review, created_at)
  VALUES
    (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
     @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review, @created_at)
`)

// Scatter 30 docs randomly between 2015-01-01 and 2025-12-31
const start = new Date('2015-01-01').getTime()
const end   = new Date('2025-12-31').getTime()
const now   = Date.now()

const insertMany = db.transaction(() => {
  for (let i = 1; i <= 30; i++) {
    const ts = Math.floor(start + Math.random() * (end - start))
    insert.run({
      type: 'document',
      timestamp: ts,
      title: `Test Document ${i}`,
      file_path: null,
      thumbnail_small: null,
      thumbnail_medium: null,
      thumbnail_large: null,
      duration_seconds: null,
      rich_text_json: null,
      group_id: null,
      needs_date_review: 0,
      created_at: now,
    })
    console.log(`Inserted doc ${i}: ${new Date(ts).toISOString().slice(0, 10)}`)
  }
})

insertMany()
console.log('\nDone — 30 seed documents inserted.')
db.close()
