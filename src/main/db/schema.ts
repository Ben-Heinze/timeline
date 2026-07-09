import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
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

    CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL COLLATE NOCASE UNIQUE
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS group_tags (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
      PRIMARY KEY (group_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_group_tags_tag ON group_tags(tag_id);
  `)
}
