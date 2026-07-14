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
      is_missing        INTEGER NOT NULL DEFAULT 0,
      content_hash      TEXT,
      import_mode       TEXT    NOT NULL DEFAULT 'copy',
      latitude          REAL,
      longitude         REAL,
      gps_scanned       INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
    CREATE INDEX IF NOT EXISTS idx_entries_group_id  ON entries(group_id);

    CREATE TABLE IF NOT EXISTS volumes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      label           TEXT    NOT NULL,
      volume_serial   TEXT    NOT NULL UNIQUE,
      last_mount_path TEXT,
      last_seen_at    INTEGER,
      created_at      INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT,
      color       TEXT    NOT NULL,
      date_from   INTEGER NOT NULL,
      date_to     INTEGER,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_date_from ON events(date_from);

    CREATE TABLE IF NOT EXISTS listening_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    INTEGER NOT NULL,
      track_name   TEXT,
      artist_name  TEXT,
      album_name   TEXT,
      ms_played    INTEGER NOT NULL,
      media_type   TEXT    NOT NULL DEFAULT 'track' CHECK(media_type IN ('track','episode')),
      spotify_uri  TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_listening_history_timestamp ON listening_history(timestamp);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_history_dedupe ON listening_history(timestamp, spotify_uri, ms_played);
  `)

  applyMigrations(db)
}

function applyMigrations(db: Database.Database): void {
  const entryCols = new Set(
    (db.prepare('PRAGMA table_info(entries)').all() as { name: string }[]).map(r => r.name)
  )
  if (!entryCols.has('is_missing'))   db.exec(`ALTER TABLE entries ADD COLUMN is_missing  INTEGER NOT NULL DEFAULT 0`)
  if (!entryCols.has('content_hash')) db.exec(`ALTER TABLE entries ADD COLUMN content_hash TEXT`)
  if (!entryCols.has('import_mode'))  db.exec(`ALTER TABLE entries ADD COLUMN import_mode  TEXT NOT NULL DEFAULT 'copy'`)
  if (!entryCols.has('latitude'))     db.exec(`ALTER TABLE entries ADD COLUMN latitude  REAL`)
  if (!entryCols.has('longitude'))    db.exec(`ALTER TABLE entries ADD COLUMN longitude REAL`)
  if (!entryCols.has('gps_scanned'))  db.exec(`ALTER TABLE entries ADD COLUMN gps_scanned INTEGER NOT NULL DEFAULT 0`)
  if (!entryCols.has('volume_id'))    db.exec(`ALTER TABLE entries ADD COLUMN volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON entries(content_hash)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_volume_id ON entries(volume_id)`)

  const groupCols = new Set(
    (db.prepare('PRAGMA table_info(groups)').all() as { name: string }[]).map(r => r.name)
  )
  if (!groupCols.has('description')) db.exec(`ALTER TABLE groups ADD COLUMN description TEXT`)
  if (!groupCols.has('date_from'))   db.exec(`ALTER TABLE groups ADD COLUMN date_from INTEGER`)
  if (!groupCols.has('date_to'))     db.exec(`ALTER TABLE groups ADD COLUMN date_to INTEGER`)
}
