"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const fs$1 = require("fs/promises");
const archiver = require("archiver");
const extractZip = require("extract-zip");
const chokidar = require("chokidar");
const crypto = require("crypto");
const child_process = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const sharp = require("sharp");
const exifr = require("exifr");
const exiftoolVendored = require("exiftool-vendored");
const http = require("http");
const settingsFile = () => path.join(electron.app.getPath("userData"), "settings.json");
let cached = null;
function migrateWatchedFolders(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => typeof f === "string" ? { path: f, volumeId: null } : f);
}
function getSettings() {
  if (cached) return cached;
  const defaultLibrary = path.join(electron.app.getPath("userData"), "library");
  try {
    const raw = fs.readFileSync(settingsFile(), "utf-8");
    const parsed = JSON.parse(raw);
    cached = {
      libraryPath: parsed.libraryPath || defaultLibrary,
      watchedFolders: migrateWatchedFolders(parsed.watchedFolders),
      duplicateScanMode: parsed.duplicateScanMode ?? "hash",
      histogramHeight: parsed.histogramHeight !== void 0 ? parsed.histogramHeight : 420,
      theme: parsed.theme ?? "light",
      heatmapScale: parsed.heatmapScale ?? "log",
      heatmapMaxCount: parsed.heatmapMaxCount ?? null,
      curveTension: parsed.curveTension ?? 1,
      fileBrowserHeight: parsed.fileBrowserHeight ?? parsed.dayViewHeight ?? 240,
      fileBrowserMode: parsed.fileBrowserMode ?? parsed.dayViewMode ?? "medium",
      mapMode: parsed.mapMode ?? "offline",
      groupSidebarWidth: parsed.groupSidebarWidth ?? 220,
      eventsPanelWidth: parsed.eventsPanelWidth ?? 272,
      spotifyPanelWidth: parsed.spotifyPanelWidth ?? 272,
      spotifyHistoryCollapsed: parsed.spotifyHistoryCollapsed ?? false
    };
  } catch {
    cached = { libraryPath: defaultLibrary, watchedFolders: [], duplicateScanMode: "hash", histogramHeight: 420, theme: "light", heatmapScale: "log", heatmapMaxCount: null, curveTension: 1, fileBrowserHeight: 240, fileBrowserMode: "medium", mapMode: "offline", groupSidebarWidth: 220, eventsPanelWidth: 272, spotifyPanelWidth: 272, spotifyHistoryCollapsed: false };
  }
  return cached;
}
function saveSettings(settings) {
  cached = settings;
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf-8");
}
function getLibraryPath() {
  return getSettings().libraryPath;
}
function getFilesPath() {
  return path.join(getLibraryPath(), "files");
}
function getThumbnailPath(size) {
  return path.join(getLibraryPath(), "thumbnails", size);
}
function isPathUnder(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
function ensureLibraryDirs() {
  const dirs = [
    getLibraryPath(),
    getFilesPath(),
    getThumbnailPath("small"),
    getThumbnailPath("medium"),
    getThumbnailPath("large")
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function initSchema(db2) {
  db2.exec(`
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

    -- Precomputed daily rollups of listening_history, keyed by local-calendar-day
    -- (local midnight as a UTC ms, matching bucketExprSql). The timeline's density
    -- ribbon and top-artist queries read these (thousands of rows) instead of
    -- re-aggregating every play with per-row strftime. Rebuilt from scratch on import.
    CREATE TABLE IF NOT EXISTS listening_daily (
      day        INTEGER PRIMARY KEY,
      ms_played  INTEGER NOT NULL,
      play_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listening_artist_daily (
      day         INTEGER NOT NULL,
      artist_name TEXT    NOT NULL,
      ms_played   INTEGER NOT NULL,
      play_count  INTEGER NOT NULL,
      PRIMARY KEY (day, artist_name)
    );

    -- Freshness marker: the listening_history row count the rollups were built from.
    CREATE TABLE IF NOT EXISTS listening_rollup_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  applyMigrations(db2);
}
function applyMigrations(db2) {
  const entryCols = new Set(
    db2.prepare("PRAGMA table_info(entries)").all().map((r) => r.name)
  );
  if (!entryCols.has("is_missing")) db2.exec(`ALTER TABLE entries ADD COLUMN is_missing  INTEGER NOT NULL DEFAULT 0`);
  if (!entryCols.has("content_hash")) db2.exec(`ALTER TABLE entries ADD COLUMN content_hash TEXT`);
  if (!entryCols.has("import_mode")) db2.exec(`ALTER TABLE entries ADD COLUMN import_mode  TEXT NOT NULL DEFAULT 'copy'`);
  if (!entryCols.has("latitude")) db2.exec(`ALTER TABLE entries ADD COLUMN latitude  REAL`);
  if (!entryCols.has("longitude")) db2.exec(`ALTER TABLE entries ADD COLUMN longitude REAL`);
  if (!entryCols.has("gps_scanned")) db2.exec(`ALTER TABLE entries ADD COLUMN gps_scanned INTEGER NOT NULL DEFAULT 0`);
  if (!entryCols.has("volume_id")) db2.exec(`ALTER TABLE entries ADD COLUMN volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL`);
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON entries(content_hash)`);
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_entries_volume_id ON entries(volume_id)`);
  const groupCols = new Set(
    db2.prepare("PRAGMA table_info(groups)").all().map((r) => r.name)
  );
  if (!groupCols.has("description")) db2.exec(`ALTER TABLE groups ADD COLUMN description TEXT`);
  if (!groupCols.has("date_from")) db2.exec(`ALTER TABLE groups ADD COLUMN date_from INTEGER`);
  if (!groupCols.has("date_to")) db2.exec(`ALTER TABLE groups ADD COLUMN date_to INTEGER`);
}
let db = null;
function getDb() {
  if (!db) {
    const dbPath = path.join(getLibraryPath(), "timeline.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
function listGroups() {
  return getDb().prepare("SELECT * FROM groups ORDER BY name").all();
}
function getGroupSubtreeIds(rootId) {
  const rows = getDb().prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM groups WHERE id = ?
      UNION
      SELECT g.id FROM groups g JOIN subtree s ON g.parent_id = s.id
    )
    SELECT id FROM subtree
  `).all(rootId);
  return rows.map((r) => r.id);
}
function getGroupDateRange(groupId) {
  const db2 = getDb();
  const group = db2.prepare("SELECT date_from, date_to FROM groups WHERE id = ?").get(groupId);
  if (group?.date_from != null && group.date_to != null) {
    return { from: group.date_from, to: group.date_to };
  }
  const ids = getGroupSubtreeIds(groupId);
  const row = db2.prepare(
    `SELECT MIN(timestamp) AS min, MAX(timestamp) AS max FROM entries WHERE group_id IN (${ids.join(", ")})`
  ).get();
  if (row.min == null) return null;
  return { from: row.min, to: row.max + 1 };
}
function getGroupStatsForPeriod(from, to) {
  return getDb().prepare(`
    SELECT group_id, COUNT(*) AS count, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
    FROM entries
    WHERE group_id IS NOT NULL AND timestamp >= ? AND timestamp < ?
    GROUP BY group_id
  `).all(from, to);
}
function createGroup(data) {
  const db2 = getDb();
  const result = db2.prepare(`
    INSERT INTO groups (name, parent_id, color, description, date_from, date_to, created_at)
    VALUES (@name, @parent_id, @color, @description, @date_from, @date_to, @created_at)
  `).run({
    name: data.name,
    parent_id: data.parent_id,
    color: data.color,
    description: data.description ?? null,
    date_from: data.date_from ?? null,
    date_to: data.date_to ?? null,
    created_at: Date.now()
  });
  return db2.prepare("SELECT * FROM groups WHERE id = ?").get(result.lastInsertRowid);
}
const AUTO_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
  "#78716c"
];
function autoColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = h * 31 + name.charCodeAt(i) | 0;
  return AUTO_COLORS[Math.abs(h) % AUTO_COLORS.length];
}
function findOrCreateGroupPath(segments) {
  const db2 = getDb();
  let parentId = null;
  for (const name of segments) {
    const existing = parentId === null ? db2.prepare("SELECT id FROM groups WHERE parent_id IS NULL AND name = ? COLLATE NOCASE").get(name) : db2.prepare("SELECT id FROM groups WHERE parent_id = ? AND name = ? COLLATE NOCASE").get(parentId, name);
    if (existing) {
      parentId = existing.id;
    } else {
      const result = db2.prepare(`
        INSERT INTO groups (name, parent_id, color, created_at)
        VALUES (?, ?, ?, ?)
      `).run(name, parentId, autoColor(name), Date.now());
      parentId = result.lastInsertRowid;
    }
  }
  return parentId;
}
function updateGroup(id, patch) {
  const db2 = getDb();
  const fields = Object.keys(patch).map((k) => `${k} = @${k}`).join(", ");
  db2.prepare(`UPDATE groups SET ${fields} WHERE id = @id`).run({ ...patch, id });
  return db2.prepare("SELECT * FROM groups WHERE id = ?").get(id);
}
function deleteGroup(id) {
  getDb().prepare("DELETE FROM groups WHERE id = ?").run(id);
}
function assignEntriesToGroup(groupId, entryIds) {
  if (entryIds.length === 0) return;
  const db2 = getDb();
  const stmt = db2.prepare("UPDATE entries SET group_id = ? WHERE id = ?");
  db2.transaction((ids) => {
    for (const id of ids) stmt.run(groupId, id);
  })(entryIds);
}
function assignEntriesForPeriod(groupId, from, to) {
  const result = getDb().prepare(`UPDATE entries SET group_id = ? WHERE timestamp >= ? AND timestamp < ?`).run(groupId, from, to);
  return result.changes;
}
function bucketExprSql(zoomLevel, column = "timestamp") {
  if (zoomLevel === "year") {
    return `CAST(strftime('%s', strftime('%Y', datetime(${column}/1000, 'unixepoch', 'localtime')) || '-01-01', 'utc') AS INTEGER) * 1000`;
  }
  if (zoomLevel === "month") {
    return `CAST(strftime('%s', strftime('%Y-%m', datetime(${column}/1000, 'unixepoch', 'localtime')) || '-01', 'utc') AS INTEGER) * 1000`;
  }
  return `CAST(strftime('%s', date(datetime(${column}/1000, 'unixepoch', 'localtime')), 'utc') AS INTEGER) * 1000`;
}
function groupFilterSql(groupId) {
  return `group_id IN (${getGroupSubtreeIds(groupId).join(", ")})`;
}
function getHistogram(from, to, zoomLevel, groupId) {
  const bucketExpr = bucketExprSql(zoomLevel);
  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      group_id,
      type,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp >= :from AND timestamp < :to${groupId != null ? ` AND ${groupFilterSql(groupId)}` : ""}
    GROUP BY bucket_start, group_id, type
    ORDER BY bucket_start
  `;
  return getDb().prepare(sql).all({ from, to });
}
function getEntriesForDay(dateMs) {
  const end = dateMs + 864e5;
  return getDb().prepare(`
    SELECT * FROM entries
    WHERE timestamp >= ? AND timestamp < ?
    ORDER BY timestamp
  `).all(dateMs, end);
}
function getEntriesForPeriod(from, to, groupId) {
  if (groupId != null) {
    return getDb().prepare(
      `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? AND ${groupFilterSql(groupId)} ORDER BY timestamp`
    ).all(from, to);
  }
  return getDb().prepare(
    `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`
  ).all(from, to);
}
function getDataExtent() {
  const row = getDb().prepare(`SELECT MIN(timestamp) AS min, MAX(timestamp) AS max FROM entries`).get();
  if (row.min == null) return null;
  return { min: row.min, max: row.max };
}
function getEntry(id) {
  return getDb().prepare("SELECT * FROM entries WHERE id = ?").get(id);
}
function updateEntry(id, patch) {
  const fields = Object.keys(patch).map((k) => `${k} = @${k}`).join(", ");
  getDb().prepare(`UPDATE entries SET ${fields} WHERE id = @id`).run({ ...patch, id });
}
function deleteEntries(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb().prepare(`DELETE FROM entries WHERE id IN (${placeholders})`).run(...ids);
}
function listAllEntries(opts) {
  const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
  const where = opts.groupId != null ? `WHERE e.${groupFilterSql(opts.groupId)}` : "";
  const params = {};
  if (opts.sortBy === "tag") {
    return getDb().prepare(`
      SELECT e.*
      FROM entries e
      LEFT JOIN entry_tags et ON et.entry_id = e.id
      LEFT JOIN tags t ON t.id = et.tag_id
      ${where}
      GROUP BY e.id
      ORDER BY
        CASE WHEN MIN(t.name) IS NULL THEN 1 ELSE 0 END ASC,
        MIN(t.name) ${dir},
        e.timestamp DESC
    `).all(params);
  }
  const col = opts.sortBy === "date" ? "timestamp" : opts.sortBy === "title" ? "title" : "type";
  const tie = opts.sortBy === "date" ? "" : ", timestamp DESC";
  const simpleWhere = opts.groupId != null ? `WHERE ${groupFilterSql(opts.groupId)}` : "";
  return getDb().prepare(`
    SELECT * FROM entries
    ${simpleWhere}
    ORDER BY ${col} ${dir}${tie}
  `).all(params);
}
function searchEntries(filters) {
  const where = [];
  const params = {};
  if (filters.text && filters.text.trim()) {
    where.push("(e.title LIKE @text OR e.file_path LIKE @text OR e.rich_text_json LIKE @text OR g.name LIKE @text)");
    params.text = `%${filters.text.trim()}%`;
  }
  if (filters.fileName && filters.fileName.trim()) {
    where.push("e.file_path LIKE @fileName");
    params.fileName = `%${filters.fileName.trim()}%`;
  }
  if (filters.types && filters.types.length > 0) {
    const keys = filters.types.map((_, i) => `@type${i}`);
    where.push(`e.type IN (${keys.join(", ")})`);
    filters.types.forEach((t, i) => {
      params[`type${i}`] = t;
    });
  }
  if (filters.from != null) {
    where.push("e.timestamp >= @from");
    params.from = filters.from;
  }
  if (filters.to != null) {
    where.push("e.timestamp <= @to");
    params.to = filters.to;
  }
  let tagJoin = "";
  if (filters.tagIds && filters.tagIds.length > 0) {
    const keys = filters.tagIds.map((_, i) => `@tag${i}`);
    filters.tagIds.forEach((id, i) => {
      params[`tag${i}`] = id;
    });
    tagJoin = `
      LEFT JOIN entry_tags et ON et.entry_id = e.id AND et.tag_id IN (${keys.join(", ")})
      LEFT JOIN group_tags gt ON gt.group_id = e.group_id AND gt.tag_id IN (${keys.join(", ")})
    `;
    where.push("(et.tag_id IS NOT NULL OR gt.tag_id IS NOT NULL)");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT DISTINCT e.* FROM entries e
    LEFT JOIN groups g ON g.id = e.group_id
    ${tagJoin}
    ${whereSql}
    ORDER BY e.timestamp DESC
    LIMIT 500
  `;
  return getDb().prepare(sql).all(params);
}
function insertEntry(entry) {
  const result = getDb().prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, volume_id, latitude, longitude, gps_scanned, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review,
       @is_missing, @content_hash, @import_mode, @volume_id, @latitude, @longitude, @gps_scanned, @created_at)
  `).run(entry);
  return result.lastInsertRowid;
}
function getEntriesWithLocation() {
  return getDb().prepare(
    `SELECT * FROM entries WHERE latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY timestamp`
  ).all();
}
function getUnscannedGpsPhotos() {
  return getDb().prepare(
    `SELECT * FROM entries WHERE type = 'photo' AND gps_scanned = 0 AND file_path IS NOT NULL AND is_missing = 0`
  ).all();
}
function getEntriesNeedingBackfill() {
  return getDb().prepare(`
    SELECT * FROM entries
    WHERE file_path IS NOT NULL AND is_missing = 0
      AND (
        type = 'document'
        OR (type = 'photo' AND (thumbnail_small IS NULL OR needs_date_review = 1 OR gps_scanned = 0))
        OR (type = 'video' AND (thumbnail_small IS NULL OR needs_date_review = 1 OR latitude IS NULL))
      )
    ORDER BY id
  `).all();
}
function getEntriesWithFilePathPrefix(prefix) {
  return getDb().prepare(
    `SELECT * FROM entries WHERE file_path LIKE ? AND import_mode = 'reference'`
  ).all(`${prefix}%`);
}
function findEntryByHash(hash) {
  return getDb().prepare("SELECT * FROM entries WHERE content_hash = ? LIMIT 1").get(hash);
}
function getAllEntriesWithFilePaths() {
  return getDb().prepare("SELECT * FROM entries WHERE file_path IS NOT NULL").all();
}
function setEntriesTimestamp(ids, timestamp) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb().prepare(
    `UPDATE entries SET timestamp = ?, needs_date_review = 0 WHERE id IN (${placeholders})`
  ).run(timestamp, ...ids);
}
function shiftEntriesTimestamp(ids, deltaMs) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb().prepare(
    `UPDATE entries SET timestamp = timestamp + ?, needs_date_review = 0 WHERE id IN (${placeholders})`
  ).run(deltaMs, ...ids);
}
function markEntriesMissing(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb().prepare(`UPDATE entries SET is_missing = 1 WHERE id IN (${placeholders})`).run(...ids);
}
function markEntriesFound(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb().prepare(`UPDATE entries SET is_missing = 0 WHERE id IN (${placeholders})`).run(...ids);
}
function findDuplicatesByHash() {
  const rows = getDb().prepare(`
    SELECT content_hash AS key, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM entries
    WHERE content_hash IS NOT NULL
    GROUP BY content_hash
    HAVING COUNT(*) > 1
  `).all();
  return rows.map((r) => ({ key: r.key, count: r.count, entryIds: r.ids.split(",").map(Number) }));
}
function findDuplicatesByNameSize() {
  const rows = getDb().prepare(`
    SELECT title AS key, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM entries
    WHERE title IS NOT NULL
    GROUP BY title
    HAVING COUNT(*) > 1
  `).all();
  return rows.map((r) => ({ key: r.key, count: r.count, entryIds: r.ids.split(",").map(Number) }));
}
function listVolumes() {
  return getDb().prepare("SELECT * FROM volumes ORDER BY label").all();
}
function getVolumeById(id) {
  return getDb().prepare("SELECT * FROM volumes WHERE id = ?").get(id);
}
function getVolumeBySerial(serial) {
  return getDb().prepare("SELECT * FROM volumes WHERE volume_serial = ?").get(serial);
}
function insertVolume(data) {
  const result = getDb().prepare(`
    INSERT INTO volumes (label, volume_serial, last_mount_path, last_seen_at, created_at)
    VALUES (@label, @volume_serial, @last_mount_path, @last_seen_at, @created_at)
  `).run(data);
  return result.lastInsertRowid;
}
function touchVolume(id, mountPath, seenAt) {
  getDb().prepare("UPDATE volumes SET last_mount_path = ?, last_seen_at = ? WHERE id = ?").run(mountPath, seenAt, id);
}
function updateVolumeLabel(id, label) {
  getDb().prepare("UPDATE volumes SET label = ? WHERE id = ?").run(label, id);
}
async function listMountedVolumes() {
  if (process.platform === "win32") return (await Promise.resolve().then(() => require("./windows-G00j6lnD.js"))).detect();
  if (process.platform === "darwin") return (await Promise.resolve().then(() => require("./darwin-BTiGefM7.js"))).detect();
  return (await Promise.resolve().then(() => require("./linux-CvC22Gu_.js"))).detect();
}
let cache = [];
let primarySerial = null;
async function refreshVolumes() {
  cache = await listMountedVolumes();
  primarySerial = findVolumeForPath(electron.app.getPath("userData"))?.serial ?? null;
  const now = Date.now();
  for (const dv of cache) {
    const existing = getVolumeBySerial(dv.serial);
    if (existing) touchVolume(existing.id, dv.mountPath, now);
  }
}
function findVolumeForPath(absPath) {
  let best = null;
  for (const v of cache) {
    if (isPathUnder(v.mountPath, absPath) && (!best || v.mountPath.length > best.mountPath.length)) {
      best = v;
    }
  }
  return best;
}
function getMountPathForSerial(serial) {
  return cache.find((v) => v.serial === serial)?.mountPath ?? null;
}
function getVolumeStatuses() {
  return listVolumes().map((v) => {
    const detected = cache.find((dv) => dv.serial === v.volume_serial);
    return {
      id: v.id,
      label: v.label,
      volume_serial: v.volume_serial,
      connected: !!detected,
      mountPath: detected?.mountPath ?? null
    };
  });
}
function findOrCreateVolumeForPath(absPath) {
  const detected = findVolumeForPath(absPath);
  if (!detected || detected.serial === primarySerial) return { volumeId: null, osLabel: null };
  const existing = getVolumeBySerial(detected.serial);
  if (existing) return { volumeId: existing.id, osLabel: detected.osLabel };
  const now = Date.now();
  const id = insertVolume({
    label: detected.osLabel,
    volume_serial: detected.serial,
    last_mount_path: detected.mountPath,
    last_seen_at: now,
    created_at: now
  });
  return { volumeId: id, osLabel: detected.osLabel };
}
function backfillWatchedFolderVolumes() {
  const settings = getSettings();
  let changed = false;
  const next = settings.watchedFolders.map((f) => {
    if (f.volumeId != null) return f;
    const { volumeId } = findOrCreateVolumeForPath(f.path);
    if (volumeId == null) return f;
    changed = true;
    return { ...f, volumeId };
  });
  if (changed) saveSettings({ ...settings, watchedFolders: next });
}
function resolveEntryAbsolutePath(entry) {
  if (!entry.file_path) return null;
  if (entry.import_mode === "copy") return path.join(getLibraryPath(), entry.file_path);
  if (entry.volume_id == null) return entry.file_path;
  const vol = getVolumeById(entry.volume_id);
  if (!vol) return null;
  const mountPath = getMountPathForSerial(vol.volume_serial);
  if (!mountPath) return null;
  return path.join(mountPath, entry.file_path);
}
let et = null;
function tool() {
  if (!et) et = new exiftoolVendored.ExifTool({ maxProcs: 1 });
  return et;
}
async function endExifTool() {
  if (!et) return;
  const inst = et;
  et = null;
  try {
    await inst.end();
  } catch {
  }
}
const RAW_PREVIEW_TAGS = ["JpgFromRaw", "PreviewImage", "ThumbnailImage"];
async function extractRawPreview(absPath) {
  for (const tag of RAW_PREVIEW_TAGS) {
    try {
      const buf = await tool().extractBinaryTagToBuffer(tag, absPath);
      if (buf && buf.length > 0) return buf;
    } catch {
    }
  }
  return null;
}
async function readRawMetadata(absPath) {
  let tags;
  try {
    tags = await tool().read(absPath);
  } catch {
    return { timestamp: null, gps: null };
  }
  let timestamp = null;
  const dt = tags.DateTimeOriginal ?? tags.CreateDate;
  if (dt instanceof exiftoolVendored.ExifDateTime) {
    const ms = new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTime();
    if (!Number.isNaN(ms)) timestamp = ms;
  }
  return { timestamp, gps: parseGps(tags) };
}
function parseGps(tags) {
  let lat = Number(tags.GPSLatitude);
  let lon = Number(tags.GPSLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (/^S/i.test(String(tags.GPSLatitudeRef ?? ""))) lat = -Math.abs(lat);
  if (/^W/i.test(String(tags.GPSLongitudeRef ?? ""))) lon = -Math.abs(lon);
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}
const VIDEO_DATE_TAGS = ["CreationDate", "DateTimeOriginal", "CreateDate", "MediaCreateDate", "TrackCreateDate"];
async function readVideoMetadata(absPath) {
  let tags;
  try {
    tags = await tool().read(absPath);
  } catch {
    return { timestamp: null, gps: null };
  }
  let timestamp = null;
  for (const tag of VIDEO_DATE_TAGS) {
    const v = tags[tag];
    if (v instanceof exiftoolVendored.ExifDateTime && v.year >= 1971) {
      const ms = v.toMillis();
      if (Number.isFinite(ms)) {
        timestamp = ms;
        break;
      }
    }
  }
  return { timestamp, gps: parseGps(tags) };
}
function pad(n) {
  return String(n).padStart(2, "0");
}
async function writePhotoDate(absPath, timestampMs) {
  const d = new Date(timestampMs);
  const stamp = `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  await tool().write(
    absPath,
    { DateTimeOriginal: stamp, CreateDate: stamp, ModifyDate: stamp },
    { writeArgs: ["-overwrite_original"] }
  );
}
function mountPathForVolumeId(volumeId) {
  const vol = getVolumeById(volumeId);
  return vol ? getMountPathForSerial(vol.volume_serial) : null;
}
const IMAGE_EXTS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".tif",
  ".bmp",
  ".heic",
  ".heif",
  ".avif",
  ".svg"
]);
const RAW_EXTS = /* @__PURE__ */ new Set([
  ".arw",
  ".sr2",
  ".srf",
  // Sony
  ".cr2",
  ".cr3",
  ".crw",
  // Canon
  ".nef",
  ".nrw",
  // Nikon
  ".dng",
  // Adobe / generic
  ".raf",
  // Fujifilm
  ".rw2",
  // Panasonic
  ".orf",
  // Olympus
  ".pef",
  // Pentax
  ".srw"
  // Samsung
]);
const VIDEO_EXTS = /* @__PURE__ */ new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".m4v",
  ".wmv",
  ".mpg",
  ".mpeg"
]);
const AUDIO_EXTS = /* @__PURE__ */ new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
  ".opus"
]);
function detectType(ext) {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e) || RAW_EXTS.has(e)) return "photo";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return "document";
}
async function computeFileHash(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs$1.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(65536);
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}
async function extractExifTimestamp(sourcePath) {
  try {
    const data = await exifr.parse(sourcePath, ["DateTimeOriginal", "CreateDate"]);
    const date = data?.DateTimeOriginal ?? data?.CreateDate;
    if (date instanceof Date && !isNaN(date.getTime())) return date.getTime();
    return null;
  } catch {
    return null;
  }
}
async function extractExifGps(sourcePath) {
  try {
    const gps = await exifr.gps(sourcePath);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && (gps.latitude !== 0 || gps.longitude !== 0)) {
      return { latitude: gps.latitude, longitude: gps.longitude };
    }
    return null;
  } catch {
    return null;
  }
}
async function relinkEntry(entry, sourcePath, relDir, fileName) {
  let storedFilePath;
  if (entry.import_mode === "reference") {
    const mountPath = entry.volume_id != null ? mountPathForVolumeId(entry.volume_id) : null;
    storedFilePath = mountPath ? path.relative(mountPath, sourcePath).split(path.sep).join("/") : sourcePath;
  } else {
    const relToFiles = path.relative(getFilesPath(), sourcePath);
    const alreadyInLibrary = !relToFiles.startsWith("..") && !path.isAbsolute(relToFiles);
    if (alreadyInLibrary) {
      storedFilePath = path.relative(getLibraryPath(), sourcePath).split(path.sep).join("/");
    } else {
      const destDir = path.join(getFilesPath(), relDir);
      await fs$1.mkdir(destDir, { recursive: true });
      const destName = await copyWithUniqueName(sourcePath, destDir, fileName);
      storedFilePath = path.join("files", relDir, destName).split(path.sep).join("/");
    }
  }
  updateEntry(entry.id, { file_path: storedFilePath, is_missing: 0 });
}
async function generateImageThumbnails(source, baseName) {
  const sizes = [
    ["small", 128],
    ["medium", 256],
    ["large", 512]
  ];
  try {
    const out = { small: "", medium: "", large: "" };
    for (const [size, dim] of sizes) {
      const fileName = `${baseName}.webp`;
      const outPath = path.join(getThumbnailPath(size), fileName);
      await sharp(source, { failOn: "none", limitInputPixels: false }).rotate().resize(dim, dim, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(outPath);
      out[size] = `thumbnails/${size}/${fileName}`;
    }
    return out;
  } catch (err) {
    if (typeof source === "string") {
      console.warn(`Thumbnail generation failed for ${source}: ${err.message}`);
    }
    return null;
  }
}
let ffmpegPath;
function resolveFfmpeg() {
  if (ffmpegPath !== void 0) return ffmpegPath;
  const bundled = ffmpegStatic ? ffmpegStatic.replace("app.asar", "app.asar.unpacked") : null;
  const candidates = [process.env.TIMELINE_FFMPEG, "ffmpeg", bundled].filter(Boolean);
  for (const cand of candidates) {
    try {
      if (child_process.spawnSync(cand, ["-version"], { stdio: "ignore" }).status === 0) {
        ffmpegPath = cand;
        return cand;
      }
    } catch {
    }
  }
  ffmpegPath = null;
  console.warn("ffmpeg not found (set TIMELINE_FFMPEG or add it to PATH) — video thumbnails will be skipped");
  return null;
}
function extractVideoFrame(videoPath, seekSeconds) {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return Promise.resolve(null);
  return new Promise((resolve) => {
    const args = [
      "-loglevel",
      "error",
      "-ss",
      String(seekSeconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1"
    ];
    const proc = child_process.spawn(ffmpeg, args);
    const chunks = [];
    let failed = false;
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("error", () => {
      failed = true;
      resolve(null);
    });
    proc.on("close", (code) => {
      if (failed) return;
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 0 ? buf : null);
    });
  });
}
async function generateVideoThumbnails(videoPath, baseName) {
  for (const seek of [1, 0]) {
    const frame = await extractVideoFrame(videoPath, seek);
    if (frame) {
      const thumb = await generateImageThumbnails(frame, baseName);
      if (thumb) return thumb;
    }
  }
  return null;
}
async function copyWithUniqueName(sourcePath, destDir, fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  for (let n = 1; ; n++) {
    const destName = n === 1 ? fileName : `${stem} (${n})${ext}`;
    try {
      await fs$1.copyFile(sourcePath, path.join(destDir, destName), fs$1.constants.COPYFILE_EXCL);
      return destName;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}
const inFlightHashes = /* @__PURE__ */ new Set();
async function ingestOne(sourcePath, relDir, groupPath, mode, volumeId) {
  const fileName = path.basename(sourcePath);
  const ext = path.extname(fileName);
  const type = detectType(ext);
  const contentHash = await computeFileHash(sourcePath);
  const existing = findEntryByHash(contentHash);
  if (existing) {
    if (existing.is_missing && existing.file_path) {
      await relinkEntry(existing, sourcePath, relDir, fileName);
    }
    return { ok: true, skipped: true };
  }
  if (inFlightHashes.has(contentHash)) return { ok: true, skipped: true };
  inFlightHashes.add(contentHash);
  try {
    const groupId = groupPath.length > 0 ? findOrCreateGroupPath(groupPath) : null;
    const baseName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const isReference = mode === "reference";
    let storedFilePath;
    if (isReference) {
      const mountPath = volumeId != null ? mountPathForVolumeId(volumeId) : null;
      storedFilePath = mountPath ? path.relative(mountPath, sourcePath).split(path.sep).join("/") : sourcePath;
    } else {
      const relToFiles = path.relative(getFilesPath(), sourcePath);
      const alreadyInLibrary = !relToFiles.startsWith("..") && !path.isAbsolute(relToFiles);
      if (alreadyInLibrary) {
        storedFilePath = path.relative(getLibraryPath(), sourcePath).split(path.sep).join("/");
      } else {
        const destDir = path.join(getFilesPath(), relDir);
        await fs$1.mkdir(destDir, { recursive: true });
        const destName = await copyWithUniqueName(sourcePath, destDir, fileName);
        storedFilePath = path.join("files", relDir, destName).split(path.sep).join("/");
      }
    }
    const stat = await fs$1.stat(sourcePath);
    let timestamp = stat.mtime.getTime() || Date.now();
    let needsDateReview = 1;
    let thumb = null;
    let gps = null;
    if (type === "photo" && RAW_EXTS.has(ext.toLowerCase())) {
      const meta = await readRawMetadata(sourcePath);
      if (meta.timestamp !== null) {
        timestamp = meta.timestamp;
        needsDateReview = 0;
      }
      gps = meta.gps;
      const preview = await extractRawPreview(sourcePath);
      if (preview) thumb = await generateImageThumbnails(preview, baseName);
    } else if (type === "photo" && ext.toLowerCase() !== ".svg") {
      const exifTimestamp = await extractExifTimestamp(sourcePath);
      if (exifTimestamp !== null) {
        timestamp = exifTimestamp;
        needsDateReview = 0;
      }
      gps = await extractExifGps(sourcePath);
      thumb = await generateImageThumbnails(sourcePath, baseName);
    } else if (type === "video") {
      const meta = await readVideoMetadata(sourcePath);
      if (meta.timestamp !== null) {
        timestamp = meta.timestamp;
        needsDateReview = 0;
      }
      gps = meta.gps;
      thumb = await generateVideoThumbnails(sourcePath, baseName);
    }
    const id = insertEntry({
      type,
      timestamp,
      title: fileName,
      file_path: storedFilePath,
      thumbnail_small: thumb?.small ?? null,
      thumbnail_medium: thumb?.medium ?? null,
      thumbnail_large: thumb?.large ?? null,
      duration_seconds: null,
      rich_text_json: null,
      group_id: groupId,
      needs_date_review: needsDateReview,
      is_missing: 0,
      content_hash: contentHash,
      import_mode: isReference ? "reference" : "copy",
      volume_id: isReference ? volumeId : null,
      latitude: gps?.latitude ?? null,
      longitude: gps?.longitude ?? null,
      gps_scanned: 1,
      created_at: Date.now()
    });
    return { ok: true, id };
  } finally {
    inFlightHashes.delete(contentHash);
  }
}
async function backfillGps() {
  const photos = getUnscannedGpsPhotos();
  let found = 0;
  for (const entry of photos) {
    const absPath = resolveEntryAbsolutePath(entry);
    if (!absPath) continue;
    const gps = RAW_EXTS.has(path.extname(absPath).toLowerCase()) ? (await readRawMetadata(absPath)).gps : await extractExifGps(absPath);
    if (gps) {
      updateEntry(entry.id, { latitude: gps.latitude, longitude: gps.longitude, gps_scanned: 1 });
      found++;
    } else {
      updateEntry(entry.id, { gps_scanned: 1 });
    }
  }
  return found;
}
async function rescanLibrary(onProgress) {
  const candidates = getEntriesNeedingBackfill();
  const result = { scanned: 0, reclassified: 0, thumbnailsAdded: 0, datesUpdated: 0, gpsAdded: 0 };
  const total = candidates.length;
  for (const entry of candidates) {
    onProgress({ processed: result.scanned, total, current: path.basename(entry.file_path ?? "") });
    result.scanned++;
    const absPath = resolveEntryAbsolutePath(entry);
    if (!absPath) continue;
    const ext = path.extname(absPath).toLowerCase();
    if (entry.type === "video") {
      if (!VIDEO_EXTS.has(ext)) continue;
      const patch2 = {};
      if (!entry.thumbnail_small) {
        const baseName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
        const thumb = await generateVideoThumbnails(absPath, baseName);
        if (thumb) {
          patch2.thumbnail_small = thumb.small;
          patch2.thumbnail_medium = thumb.medium;
          patch2.thumbnail_large = thumb.large;
        }
      }
      const needDate2 = entry.needs_date_review === 1;
      const needGps2 = entry.latitude == null;
      if (needDate2 || needGps2) {
        const meta = await readVideoMetadata(absPath);
        if (needDate2 && meta.timestamp !== null) {
          patch2.timestamp = meta.timestamp;
          patch2.needs_date_review = 0;
        }
        if (needGps2 && meta.gps) {
          patch2.latitude = meta.gps.latitude;
          patch2.longitude = meta.gps.longitude;
        }
      }
      if (Object.keys(patch2).length > 0) updateEntry(entry.id, patch2);
      if (patch2.thumbnail_small) result.thumbnailsAdded++;
      if (patch2.needs_date_review === 0) result.datesUpdated++;
      if (patch2.latitude != null) result.gpsAdded++;
      continue;
    }
    const isRaw = RAW_EXTS.has(ext);
    const isImage = IMAGE_EXTS.has(ext);
    if (!isRaw && !isImage) continue;
    const patch = {};
    const wasDocument = entry.type === "document";
    if (wasDocument) patch.type = "photo";
    const needDate = entry.needs_date_review === 1;
    const needGps = entry.gps_scanned === 0 || wasDocument;
    const rawMeta = isRaw && (needDate || needGps) ? await readRawMetadata(absPath) : null;
    if (!entry.thumbnail_small && ext !== ".svg") {
      const baseName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
      const source = isRaw ? await extractRawPreview(absPath) : absPath;
      if (source) {
        const thumb = await generateImageThumbnails(source, baseName);
        if (thumb) {
          patch.thumbnail_small = thumb.small;
          patch.thumbnail_medium = thumb.medium;
          patch.thumbnail_large = thumb.large;
        }
      }
    }
    if (needDate) {
      const ts = isRaw ? rawMeta?.timestamp ?? null : await extractExifTimestamp(absPath);
      if (ts !== null) {
        patch.timestamp = ts;
        patch.needs_date_review = 0;
      }
    }
    if (needGps) {
      const gps = isRaw ? rawMeta?.gps ?? null : await extractExifGps(absPath);
      if (gps) {
        patch.latitude = gps.latitude;
        patch.longitude = gps.longitude;
      }
      patch.gps_scanned = 1;
    }
    if (Object.keys(patch).length > 0) updateEntry(entry.id, patch);
    if (patch.type) result.reclassified++;
    if (patch.thumbnail_small) result.thumbnailsAdded++;
    if (patch.needs_date_review === 0) result.datesUpdated++;
    if (patch.latitude != null) result.gpsAdded++;
  }
  onProgress({ processed: total, total, current: "" });
  return result;
}
async function walkDir(root, rootName, dir, out) {
  const entries = await fs$1.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(root, rootName, full, out);
    } else if (entry.isFile()) {
      const relDir = path.relative(root, dir);
      const groupPath = relDir === "" ? [rootName] : [rootName, ...relDir.split(path.sep)];
      out.push({ filePath: full, relDir, groupPath });
    }
  }
}
async function expandPaths(inputPaths) {
  const out = [];
  for (const p of inputPaths) {
    const stat = await fs$1.stat(p);
    if (stat.isDirectory()) {
      await walkDir(p, path.basename(p), p, out);
    } else {
      out.push({ filePath: p, relDir: "", groupPath: [] });
    }
  }
  return out;
}
const CONCURRENCY = 4;
async function ingestFiles(filePaths, mode, volumeId, onProgress) {
  const files = await expandPaths(filePaths);
  const total = files.length;
  if (total === 0) return { insertedIds: [], failures: [], total: 0 };
  let nextIndex = 0;
  let completed = 0;
  const insertedIds = [];
  const failures = [];
  onProgress({ total, completed: 0, current: path.basename(files[0].filePath) });
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const { filePath: src, relDir, groupPath } = files[i];
      const fileName = path.basename(src);
      let error;
      try {
        const result = await ingestOne(src, relDir, groupPath, mode, volumeId);
        if (result.id != null) insertedIds.push(result.id);
      } catch (e) {
        error = e.message ?? String(e);
        failures.push({ file: src, error });
      }
      completed++;
      onProgress({ total, completed, current: fileName, error });
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, worker);
  await Promise.all(workers);
  return { insertedIds, failures, total };
}
let isSyncing = false;
let watcher = null;
function isCurrentlySyncing() {
  return isSyncing;
}
async function runSync(onProgress) {
  if (isSyncing) return;
  isSyncing = true;
  try {
    await refreshVolumes();
    const settings = getSettings();
    const entries = getAllEntriesWithFilePaths();
    const missingIds = [];
    const recoveredIds = [];
    onProgress({
      phase: "checking",
      checked: 0,
      missing: 0,
      recovered: 0,
      found: 0,
      ingested: 0,
      total: entries.length,
      current: ""
    });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const absPath = resolveEntryAbsolutePath(entry);
      if (absPath == null) {
        onProgress({
          phase: "checking",
          checked: i + 1,
          missing: missingIds.length,
          recovered: recoveredIds.length,
          found: 0,
          ingested: 0,
          total: entries.length,
          current: entry.title ?? ""
        });
        continue;
      }
      let exists = false;
      try {
        await fs$1.access(absPath);
        exists = true;
      } catch {
      }
      if (exists && entry.is_missing) recoveredIds.push(entry.id);
      else if (!exists && !entry.is_missing) missingIds.push(entry.id);
      onProgress({
        phase: "checking",
        checked: i + 1,
        missing: missingIds.length,
        recovered: recoveredIds.length,
        found: 0,
        ingested: 0,
        total: entries.length,
        current: path.basename(absPath)
      });
    }
    if (missingIds.length > 0) markEntriesMissing(missingIds);
    if (recoveredIds.length > 0) markEntriesFound(recoveredIds);
    await backfillGps();
    onProgress({
      phase: "scanning",
      checked: entries.length,
      missing: missingIds.length,
      recovered: recoveredIds.length,
      found: 0,
      ingested: 0,
      total: entries.length,
      current: "Scanning for new files…"
    });
    const existingAbsPaths = new Set(
      entries.map((e) => resolveEntryAbsolutePath(e)).filter((p) => p != null)
    );
    const newLibraryFiles = [];
    await scanFolder(getFilesPath(), existingAbsPaths, newLibraryFiles);
    const newWatchedByFolder = [];
    for (const folder of settings.watchedFolders) {
      const files = [];
      await scanFolder(folder.path, existingAbsPaths, files);
      if (files.length > 0) newWatchedByFolder.push({ volumeId: folder.volumeId, files });
    }
    const newFiles = [...newLibraryFiles, ...newWatchedByFolder.flatMap((f) => f.files)];
    let ingested = 0;
    const reportIngest = (progress) => {
      onProgress({
        phase: "ingesting",
        checked: entries.length,
        missing: missingIds.length,
        recovered: recoveredIds.length,
        found: newFiles.length,
        ingested: ingested + progress.completed,
        total: newFiles.length,
        current: progress.current,
        error: progress.error
      });
    };
    if (newLibraryFiles.length > 0) {
      await ingestFiles(newLibraryFiles, "copy", null, reportIngest);
      ingested += newLibraryFiles.length;
    }
    for (const { volumeId, files } of newWatchedByFolder) {
      await ingestFiles(files, "reference", volumeId, reportIngest);
      ingested += files.length;
    }
    onProgress({
      phase: "done",
      checked: entries.length,
      missing: missingIds.length,
      recovered: recoveredIds.length,
      found: newFiles.length,
      ingested: newFiles.length,
      total: newFiles.length,
      current: ""
    });
  } finally {
    isSyncing = false;
  }
}
async function scanFolder(dir, existingPaths, newFiles) {
  let dirents;
  try {
    dirents = await fs$1.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const fullPath = path.join(dir, d.name);
    if (d.isDirectory()) {
      await scanFolder(fullPath, existingPaths, newFiles);
    } else if (d.isFile() && !existingPaths.has(fullPath)) {
      newFiles.push(fullPath);
    }
  }
}
function scanDuplicates(mode) {
  return mode === "hash" ? findDuplicatesByHash() : findDuplicatesByNameSize();
}
function startWatcher() {
  if (watcher) return;
  const settings = getSettings();
  const dirs = [getFilesPath(), ...settings.watchedFolders.map((f) => f.path)];
  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent: true,
    depth: 99,
    awaitWriteFinish: { stabilityThreshold: 1e3, pollInterval: 500 }
  });
  watcher.on("add", async (filePath) => {
    const wins = electron.BrowserWindow.getAllWindows();
    let mode = "copy";
    let volumeId = null;
    if (!isPathUnder(getFilesPath(), filePath)) {
      mode = "reference";
      const folder = settings.watchedFolders.filter((f) => isPathUnder(f.path, filePath)).sort((a, b) => b.path.length - a.path.length)[0];
      volumeId = folder?.volumeId ?? null;
    }
    await ingestFiles([filePath], mode, volumeId, () => {
    });
    for (const win of wins) {
      if (!win.webContents.isDestroyed()) win.webContents.send("sync:watcherIngest");
    }
  });
}
function stopWatcher() {
  watcher?.close();
  watcher = null;
}
function restartWatcher() {
  stopWatcher();
  startWatcher();
}
const MANIFEST_FORMAT = "timeline-backup";
const FORMAT_VERSION = 1;
const STORED_EXTS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".avif",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".m4v",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".mp3",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  ".zip",
  ".gz",
  ".7z",
  ".rar",
  ".docx",
  ".xlsx",
  ".pptx",
  ".pdf"
]);
async function walkForZip(root, zipPrefix, out) {
  let dirents;
  try {
    dirents = await fs$1.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const abs = path.join(root, d.name);
    const rel = `${zipPrefix}/${d.name}`;
    if (d.isDirectory()) await walkForZip(abs, rel, out);
    else if (d.isFile()) out.push({ abs, rel });
  }
}
function dumpMetadata(db2, exportType) {
  const all = (table) => db2.prepare(`SELECT * FROM ${table}`).all();
  return JSON.stringify(
    {
      format: MANIFEST_FORMAT,
      formatVersion: FORMAT_VERSION,
      exportType,
      exportedAt: Date.now(),
      entries: all("entries"),
      groups: all("groups"),
      tags: all("tags"),
      entry_tags: all("entry_tags"),
      group_tags: all("group_tags"),
      events: all("events")
    },
    null,
    2
  );
}
async function exportBackup(destZip, type, onProgress) {
  if (isCurrentlySyncing()) {
    throw new Error("A library sync is in progress — wait for it to finish before exporting.");
  }
  const libraryPath = getLibraryPath();
  const tmpDir = await fs$1.mkdtemp(path.join(electron.app.getPath("temp"), "timeline-export-"));
  stopWatcher();
  try {
    onProgress({ phase: "preparing", completed: 0, total: 0, current: "Snapshotting database…" });
    const snapshotPath = path.join(tmpDir, "timeline.db");
    await getDb().backup(snapshotPath);
    const snap = new Database(snapshotPath);
    let referencedFiles = [];
    const skippedReferences = [];
    try {
      if (type === "full") {
        const refs = snap.prepare(`SELECT id, file_path FROM entries WHERE import_mode = 'reference' AND file_path IS NOT NULL`).all();
        const rewrite = snap.prepare(
          `UPDATE entries SET file_path = ?, import_mode = 'copy' WHERE id = ?`
        );
        for (const ref of refs) {
          try {
            await fs$1.access(ref.file_path);
          } catch {
            skippedReferences.push(ref.file_path);
            continue;
          }
          const rel = `files/referenced/${ref.id}_${path.basename(ref.file_path)}`;
          rewrite.run(rel, ref.id);
          referencedFiles.push({ abs: ref.file_path, rel });
        }
      }
      const metadataJson = dumpMetadata(snap, type);
      await fs$1.writeFile(path.join(tmpDir, "metadata.json"), metadataJson, "utf-8");
      const count = (table) => snap.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const manifest = {
        format: MANIFEST_FORMAT,
        formatVersion: FORMAT_VERSION,
        exportType: type,
        appVersion: electron.app.getVersion(),
        exportedAt: Date.now(),
        includesFiles: type === "full",
        counts: {
          entries: count("entries"),
          groups: count("groups"),
          tags: count("tags"),
          events: count("events")
        }
      };
      await fs$1.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
      const zipEntries = [
        { abs: path.join(tmpDir, "manifest.json"), rel: "manifest.json" },
        { abs: path.join(tmpDir, "metadata.json"), rel: "metadata.json" },
        { abs: snapshotPath, rel: "timeline.db" }
      ];
      await walkForZip(path.join(libraryPath, "thumbnails"), "thumbnails", zipEntries);
      if (type === "full") {
        await walkForZip(path.join(libraryPath, "files"), "files", zipEntries);
        zipEntries.push(...referencedFiles);
      }
      await writeZip(destZip, zipEntries, onProgress);
      onProgress({ phase: "done", completed: zipEntries.length, total: zipEntries.length, current: "" });
      return {
        entries: manifest.counts.entries,
        filesIncluded: type === "full" ? zipEntries.length - 3 : 0,
        skippedReferences
      };
    } finally {
      snap.close();
    }
  } catch (err) {
    await fs$1.rm(destZip, { force: true }).catch(() => {
    });
    throw err;
  } finally {
    await fs$1.rm(tmpDir, { recursive: true, force: true }).catch(() => {
    });
    startWatcher();
  }
}
function writeZip(destZip, entries, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver("zip", { zlib: { level: 6 } });
    let completed = 0;
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("entry", (entry) => {
      completed++;
      onProgress({ phase: "archiving", completed, total: entries.length, current: entry.name });
    });
    archive.pipe(output);
    for (const e of entries) {
      const store = STORED_EXTS.has(path.extname(e.rel).toLowerCase());
      archive.file(e.abs, { name: e.rel, store });
    }
    archive.finalize();
  });
}
async function importBackup(zipPath, destDir, onProgress) {
  if (isCurrentlySyncing()) {
    throw new Error("A library sync is in progress — wait for it to finish before importing.");
  }
  await fs$1.mkdir(destDir, { recursive: true });
  if ((await fs$1.readdir(destDir)).length > 0) {
    throw new Error("The destination folder must be empty.");
  }
  let extracted = 0;
  await extractZip(zipPath, {
    dir: destDir,
    onEntry: (entry, zipfile) => {
      extracted++;
      onProgress({ phase: "extracting", completed: extracted, total: zipfile.entryCount, current: entry.fileName });
    }
  });
  let manifest;
  try {
    manifest = JSON.parse(await fs$1.readFile(path.join(destDir, "manifest.json"), "utf-8"));
    if (manifest.format !== MANIFEST_FORMAT) throw new Error("bad format");
    if (manifest.formatVersion > FORMAT_VERSION) {
      throw new Error("This backup was created by a newer version of the app.");
    }
    await fs$1.access(path.join(destDir, "timeline.db"));
  } catch (err) {
    for (const name of await fs$1.readdir(destDir)) {
      await fs$1.rm(path.join(destDir, name), { recursive: true, force: true });
    }
    const detail = err instanceof Error && err.message.includes("newer version") ? ` ${err.message}` : "";
    throw new Error(`This file is not a valid Timeline backup archive.${detail}`);
  }
  stopWatcher();
  closeDb();
  saveSettings({ ...getSettings(), libraryPath: destDir });
  ensureLibraryDirs();
  getDb();
  const entries = getAllEntriesWithFilePaths();
  const missingIds = [];
  const foundIds = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const abs = entry.import_mode === "reference" ? entry.file_path : path.join(destDir, entry.file_path);
    try {
      await fs$1.access(abs);
      foundIds.push(entry.id);
    } catch {
      missingIds.push(entry.id);
    }
    if (i % 50 === 0 || i === entries.length - 1) {
      onProgress({ phase: "checking", completed: i + 1, total: entries.length, current: path.basename(entry.file_path) });
    }
  }
  markEntriesFound(foundIds);
  markEntriesMissing(missingIds);
  startWatcher();
  onProgress({ phase: "done", completed: entries.length, total: entries.length, current: "" });
  return {
    libraryPath: destDir,
    exportType: manifest.exportType,
    entries: manifest.counts.entries,
    missingFiles: missingIds.length
  };
}
function progressSender(sender) {
  return (e) => {
    if (!sender.isDestroyed()) sender.send("backup:progress", e);
  };
}
function registerBackupHandlers() {
  electron.ipcMain.handle("backup:export", async (event, type) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender) ?? electron.BrowserWindow.getAllWindows()[0];
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const result = await electron.dialog.showSaveDialog(win, {
      title: type === "full" ? "Export full backup" : "Export metadata-only backup",
      defaultPath: `timeline-${type === "full" ? "backup" : "metadata"}-${date}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const summary = await exportBackup(result.filePath, type, progressSender(event.sender));
    return { canceled: false, path: result.filePath, ...summary };
  });
  electron.ipcMain.handle("backup:pickArchive", async (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender) ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Select backup archive",
      filters: [{ name: "Timeline backup", extensions: ["zip"] }],
      properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  electron.ipcMain.handle("backup:import", async (event, zipPath, destDir) => {
    return importBackup(zipPath, destDir, progressSender(event.sender));
  });
}
function registerEntryHandlers() {
  electron.ipcMain.handle("entries:histogram", (_, from, to, zoomLevel, groupId) => getHistogram(from, to, zoomLevel, groupId ?? void 0));
  electron.ipcMain.handle("entries:forDay", (_, dateMs) => getEntriesForDay(dateMs));
  electron.ipcMain.handle("entries:forPeriod", (_, from, to, groupId) => getEntriesForPeriod(from, to, groupId ?? void 0));
  electron.ipcMain.handle("entries:extent", () => getDataExtent());
  electron.ipcMain.handle("entries:locations", () => getEntriesWithLocation());
  electron.ipcMain.handle("entries:search", (_, filters) => searchEntries(filters ?? {}));
  electron.ipcMain.handle("entries:listAll", (_, opts) => listAllEntries(opts));
  electron.ipcMain.handle("entries:get", (_, id) => getEntry(id));
  electron.ipcMain.handle("entries:update", (_, id, patch) => updateEntry(id, patch));
  electron.ipcMain.handle("entries:setDate", async (_, params) => {
    const { ids, mode, value, writeExif } = params;
    if (mode === "set") setEntriesTimestamp(ids, value);
    else shiftEntriesTimestamp(ids, value);
    const result = { updated: ids.length, exifWritten: 0, exifSkipped: 0, exifFailed: 0 };
    if (!writeExif) return result;
    for (const id of ids) {
      const entry = getEntry(id);
      const writable = entry && (entry.type === "photo" || entry.type === "video") && entry.import_mode === "copy" && !entry.is_missing;
      const abs = writable ? resolveEntryAbsolutePath(entry) : null;
      if (!abs) {
        result.exifSkipped++;
        continue;
      }
      try {
        await writePhotoDate(abs, entry.timestamp);
        const hash = await computeFileHash(abs);
        updateEntry(id, { content_hash: hash });
        result.exifWritten++;
      } catch {
        result.exifFailed++;
      }
    }
    return result;
  });
  electron.ipcMain.handle("library:rescan", async (event) => {
    const sender = event.sender;
    return rescanLibrary((evt) => {
      if (!sender.isDestroyed()) sender.send("library:rescanProgress", evt);
    });
  });
  electron.ipcMain.handle("entries:delete", async (_, ids) => {
    const entries = ids.map((id) => getEntry(id)).filter(Boolean);
    deleteEntries(ids);
    const libraryPath = getLibraryPath();
    for (const entry of entries) {
      for (const key of ["thumbnail_small", "thumbnail_medium", "thumbnail_large"]) {
        const rel = entry[key];
        if (!rel) continue;
        try {
          await fs$1.unlink(path.join(libraryPath, rel));
        } catch {
        }
      }
      if (entry.import_mode === "copy" && entry.file_path) {
        try {
          await electron.shell.trashItem(path.join(libraryPath, entry.file_path));
        } catch {
        }
      }
    }
  });
  electron.ipcMain.handle("entries:create", (_, data) => insertEntry({
    type: data.type,
    timestamp: data.timestamp,
    title: data.title ?? null,
    file_path: null,
    thumbnail_small: null,
    thumbnail_medium: null,
    thumbnail_large: null,
    duration_seconds: null,
    rich_text_json: data.rich_text_json ?? null,
    group_id: data.group_id ?? null,
    needs_date_review: 0,
    is_missing: 0,
    content_hash: null,
    import_mode: "copy",
    volume_id: null,
    latitude: null,
    longitude: null,
    gps_scanned: 0,
    created_at: Date.now()
  }));
}
function listEvents() {
  return getDb().prepare("SELECT * FROM events ORDER BY date_from, title").all();
}
function createEvent(data) {
  const db2 = getDb();
  const result = db2.prepare(`
    INSERT INTO events (title, description, color, date_from, date_to, created_at)
    VALUES (@title, @description, @color, @date_from, @date_to, @created_at)
  `).run({
    title: data.title,
    description: data.description ?? null,
    color: data.color,
    date_from: data.date_from,
    date_to: data.date_to ?? null,
    created_at: Date.now()
  });
  return db2.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
}
function updateEvent(id, patch) {
  const db2 = getDb();
  const fields = Object.keys(patch).map((k) => `${k} = @${k}`).join(", ");
  db2.prepare(`UPDATE events SET ${fields} WHERE id = @id`).run({ ...patch, id });
  return db2.prepare("SELECT * FROM events WHERE id = ?").get(id);
}
function deleteEvent(id) {
  getDb().prepare("DELETE FROM events WHERE id = ?").run(id);
}
function registerEventHandlers() {
  electron.ipcMain.handle("events:list", () => listEvents());
  electron.ipcMain.handle("events:create", (_, data) => createEvent(data));
  electron.ipcMain.handle("events:update", (_, id, patch) => updateEvent(id, patch));
  electron.ipcMain.handle("events:delete", (_, id) => deleteEvent(id));
}
function registerGroupHandlers() {
  electron.ipcMain.handle("groups:list", () => listGroups());
  electron.ipcMain.handle("groups:statsForPeriod", (_, from, to) => getGroupStatsForPeriod(from, to));
  electron.ipcMain.handle("groups:dateRange", (_, groupId) => getGroupDateRange(groupId));
  electron.ipcMain.handle("groups:create", (_, data) => createGroup(data));
  electron.ipcMain.handle("groups:update", (_, id, patch) => updateGroup(id, patch));
  electron.ipcMain.handle("groups:delete", (_, id) => deleteGroup(id));
  electron.ipcMain.handle("groups:assignEntries", (_, groupId, entryIds) => assignEntriesToGroup(groupId, entryIds));
  electron.ipcMain.handle("groups:assignEntriesForPeriod", (_, groupId, from, to) => assignEntriesForPeriod(groupId, from, to));
}
function listTags() {
  return getDb().prepare("SELECT * FROM tags ORDER BY name").all();
}
function getOrCreateTag(name) {
  const db2 = getDb();
  const trimmed = name.trim();
  const existing = db2.prepare("SELECT * FROM tags WHERE name = ?").get(trimmed);
  if (existing) return existing;
  const result = db2.prepare("INSERT INTO tags (name) VALUES (?)").run(trimmed);
  return db2.prepare("SELECT * FROM tags WHERE id = ?").get(result.lastInsertRowid);
}
function createTag(name) {
  return getOrCreateTag(name);
}
function deleteTag(id) {
  getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
}
function getEntryTags(entryId) {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    JOIN entry_tags et ON et.tag_id = t.id
    WHERE et.entry_id = ?
    ORDER BY t.name
  `).all(entryId);
}
function setEntryTags(entryId, tagNames) {
  const db2 = getDb();
  const tags = tagNames.map((n) => n.trim()).filter(Boolean).map(getOrCreateTag);
  db2.transaction(() => {
    db2.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(entryId);
    const ins = db2.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
    for (const t of tags) ins.run(entryId, t.id);
  })();
  return getEntryTags(entryId);
}
function getGroupTags(groupId) {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    JOIN group_tags gt ON gt.tag_id = t.id
    WHERE gt.group_id = ?
    ORDER BY t.name
  `).all(groupId);
}
function setGroupTags(groupId, tagNames) {
  const db2 = getDb();
  const tags = tagNames.map((n) => n.trim()).filter(Boolean).map(getOrCreateTag);
  db2.transaction(() => {
    db2.prepare("DELETE FROM group_tags WHERE group_id = ?").run(groupId);
    const ins = db2.prepare("INSERT OR IGNORE INTO group_tags (group_id, tag_id) VALUES (?, ?)");
    for (const t of tags) ins.run(groupId, t.id);
  })();
  return getGroupTags(groupId);
}
function bulkSetEntryTags(entryIds, tagNames) {
  if (entryIds.length === 0 || tagNames.length === 0) return;
  const db2 = getDb();
  const tags = tagNames.map((n) => n.trim()).filter(Boolean).map(getOrCreateTag);
  if (tags.length === 0) return;
  const ins = db2.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
  db2.transaction(() => {
    for (const id of entryIds) {
      for (const t of tags) ins.run(id, t.id);
    }
  })();
}
async function writeImportErrorLog(failures) {
  try {
    const logPath = path.join(electron.app.getPath("userData"), "import-errors.log");
    const lines = [
      `[${(/* @__PURE__ */ new Date()).toISOString()}] ${failures.length} file(s) failed to import:`,
      ...failures.map((f) => `  ${f.file} — ${f.error}`),
      "",
      ""
    ];
    await fs$1.appendFile(logPath, lines.join("\n"), "utf8");
    return logPath;
  } catch {
    return null;
  }
}
function registerIngestHandlers() {
  electron.ipcMain.handle("ingest:pickFiles", async (_event, mode = "files") => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, mode === "folder" ? {
      title: "Import folder",
      properties: ["openDirectory", "multiSelections"]
    } : {
      title: "Import files",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "All files", extensions: ["*"] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  electron.ipcMain.handle("ingest:countFiles", async (_, paths) => {
    const files = await expandPaths(paths);
    return files.length;
  });
  electron.ipcMain.handle("ingest:start", async (event, filePaths, tagNames = []) => {
    const sender = event.sender;
    const send = (channel, data) => {
      if (!sender.isDestroyed()) sender.send(channel, data);
    };
    try {
      const { insertedIds, failures, total } = await ingestFiles(filePaths, "copy", null, (progress) => {
        send("ingest:progress", progress);
      });
      if (tagNames.length > 0 && insertedIds.length > 0) {
        bulkSetEntryTags(insertedIds, tagNames);
      }
      if (total === 0) return;
      const logPath = failures.length > 0 ? await writeImportErrorLog(failures) : null;
      const done = { total, imported: total - failures.length, failures, logPath };
      send("ingest:done", done);
    } catch (e) {
      const failures = [{ file: filePaths.join(", "), error: e.message ?? String(e) }];
      const logPath = await writeImportErrorLog(failures);
      const done = { total: filePaths.length, imported: 0, failures, logPath };
      send("ingest:done", done);
    }
  });
  electron.ipcMain.handle("sync:run", async (event) => {
    const sender = event.sender;
    await runSync((progress) => {
      if (!sender.isDestroyed()) sender.send("sync:progress", progress);
    });
  });
  electron.ipcMain.handle("sync:isSyncing", () => isCurrentlySyncing());
  electron.ipcMain.handle("sync:scanDuplicates", (_, mode) => scanDuplicates(mode));
}
const LAYERS = {
  countries: {
    file: "ne_10m_admin_0_countries.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
  },
  states: {
    file: "ne_10m_admin_1_states_provinces_lines.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson"
  },
  places: {
    file: "ne_10m_populated_places_simple.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson"
  }
};
const mapDir = () => path.join(getLibraryPath(), "map");
async function allDownloaded() {
  for (const { file } of Object.values(LAYERS)) {
    try {
      await fs$1.access(path.join(mapDir(), file));
    } catch {
      return false;
    }
  }
  return true;
}
async function contentLength(url) {
  const res = await fetch(url, { method: "HEAD" });
  return Number(res.headers.get("content-length") ?? 0);
}
async function downloadTo(url, dest, onChunk) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const chunks = [];
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    onChunk(value.byteLength);
  }
  const tmp = `${dest}.download`;
  await fs$1.writeFile(tmp, Buffer.concat(chunks));
  await fs$1.rename(tmp, dest);
}
let downloading = false;
function registerMapHandlers() {
  electron.ipcMain.handle("map:hiresStatus", async () => ({
    downloaded: await allDownloaded(),
    downloading
  }));
  electron.ipcMain.handle("map:getLayer", async (_, layer) => {
    const def = LAYERS[layer];
    if (!def) return null;
    try {
      return await fs$1.readFile(path.join(mapDir(), def.file), "utf-8");
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("map:downloadHires", async (event) => {
    if (downloading) return;
    downloading = true;
    const sender = event.sender;
    try {
      await fs$1.mkdir(mapDir(), { recursive: true });
      const defs = Object.values(LAYERS);
      const sizes = await Promise.all(defs.map((d) => contentLength(d.url)));
      const total = sizes.reduce((a, b) => a + b, 0);
      let received = 0;
      let lastSent = 0;
      for (const def of defs) {
        await downloadTo(def.url, path.join(mapDir(), def.file), (bytes) => {
          received += bytes;
          if (received - lastSent >= 256 * 1024 || received === total) {
            lastSent = received;
            if (!sender.isDestroyed()) {
              sender.send("map:downloadProgress", { received, total, file: def.file });
            }
          }
        });
      }
    } finally {
      downloading = false;
    }
  });
}
function registerTagHandlers() {
  electron.ipcMain.handle("tags:list", () => listTags());
  electron.ipcMain.handle("tags:create", (_, name) => createTag(name));
  electron.ipcMain.handle("tags:delete", (_, id) => deleteTag(id));
  electron.ipcMain.handle("tags:forEntry", (_, entryId) => getEntryTags(entryId));
  electron.ipcMain.handle("tags:setForEntry", (_, entryId, names) => setEntryTags(entryId, names));
  electron.ipcMain.handle("tags:addToEntries", (_, entryIds, names) => bulkSetEntryTags(entryIds, names));
  electron.ipcMain.handle("tags:forGroup", (_, groupId) => getGroupTags(groupId));
  electron.ipcMain.handle("tags:setForGroup", (_, groupId, names) => setGroupTags(groupId, names));
}
const TOTAL_FILES = 1e3;
const DENSE_DAYS = 3;
const DENSE_MIN = 25;
const DENSE_MAX = 45;
const SPARSE_YEARS = 5;
const TEST_DIR = "test-data";
const MS_DAY = 864e5;
const GENERAL_TAGS = ["friends", "holidays", "pets", "birthday"];
const HOME_TAGS = ["work", "school", "family"];
const TRAVEL_TAGS = ["travel", "vacation", "nature", "beach", "hiking"];
const TEST_TAGS = [...GENERAL_TAGS, ...HOME_TAGS, ...TRAVEL_TAGS];
const TEST_EXTS = [
  ".jpg",
  ".jpg",
  ".jpg",
  ".jpeg",
  ".png",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".mp4",
  ".mp4",
  ".mov",
  ".mkv",
  ".mp3",
  ".wav",
  ".m4a",
  ".pdf",
  ".pdf",
  ".txt",
  ".docx"
];
const WORLD_LOCATIONS = [
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Cape Town", lat: -33.9249, lng: 18.4241 },
  { name: "Rio de Janeiro", lat: -22.9068, lng: -43.1729 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { name: "Reykjavik", lat: 64.1466, lng: -21.9426 },
  { name: "Banff", lat: 51.1784, lng: -115.5708 }
];
const LOCATION_RATE = 0.35;
const OUTLIER_RATE = 0.08;
const JITTER_DEG = 0.12;
const GROUP_THEMES = [
  { name: "Paris Trip", color: "#3b82f6", location: WORLD_LOCATIONS[1], tagBias: ["travel", "vacation"] },
  { name: "Tokyo Trip", color: "#ef4444", location: WORLD_LOCATIONS[2], tagBias: ["travel", "vacation"] },
  { name: "Rio Carnival", color: "#f59e0b", location: WORLD_LOCATIONS[5], tagBias: ["travel", "friends"] },
  { name: "Banff Camping", color: "#22c55e", location: WORLD_LOCATIONS[9], tagBias: ["nature", "hiking"] },
  { name: "Cape Town Safari", color: "#84cc16", location: WORLD_LOCATIONS[4], tagBias: ["travel", "nature"] },
  { name: "Ben's Birthday", color: "#ec4899", tagBias: ["birthday", "family"] },
  { name: "Family Reunion", color: "#8b5cf6", tagBias: ["family", "friends"] },
  { name: "Graduation Day", color: "#06b6d4", tagBias: ["family", "friends"] },
  { name: "Wedding Weekend", color: "#f97316", tagBias: ["friends", "family"] },
  { name: "Company Retreat", color: "#6b7280", tagBias: ["work", "friends"] }
];
const GROUP_DAY_MIN = 4;
const GROUP_DAY_MAX = 9;
const GROUP_ASSIGN_MIN = 0.55;
const GROUP_ASSIGN_MAX = 1;
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randFloat = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function randomTimeInDay(dayStartMs) {
  return dayStartMs + randInt(8, 21) * 36e5 + randInt(0, 3599999);
}
function jitteredLocation(center) {
  return {
    latitude: center.lat + randFloat(-JITTER_DEG, JITTER_DEG),
    longitude: center.lng + randFloat(-JITTER_DEG, JITTER_DEG)
  };
}
function randomWorldLocation() {
  return { latitude: randFloat(-60, 70), longitude: randFloat(-180, 180) };
}
function decideLocation(type, theme) {
  if (type !== "photo" && type !== "video") return { latitude: null, longitude: null };
  if (theme?.location && Math.random() < 0.9) return jitteredLocation(theme.location);
  if (Math.random() < LOCATION_RATE) {
    const loc = Math.random() < OUTLIER_RATE ? randomWorldLocation() : jitteredLocation(pick(WORLD_LOCATIONS));
    return loc;
  }
  return { latitude: null, longitude: null };
}
function tagPoolFor(theme, hasLocation) {
  const bias = theme?.tagBias ?? (hasLocation ? TRAVEL_TAGS : HOME_TAGS);
  return [...TEST_TAGS, ...bias, ...bias];
}
function pickTags(pool, count) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const out = [];
  for (const t of shuffled) {
    if (!out.includes(t)) out.push(t);
    if (out.length === count) break;
  }
  return out;
}
function buildTimestamps() {
  const now = /* @__PURE__ */ new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const slots = [];
  const usedDays = /* @__PURE__ */ new Set();
  for (let d = 0; d < DENSE_DAYS; d++) {
    let dayStart;
    do {
      dayStart = today - randInt(30, 2 * 365) * MS_DAY;
    } while (usedDays.has(dayStart));
    usedDays.add(dayStart);
    const count = randInt(DENSE_MIN, DENSE_MAX);
    for (let i = 0; i < count && slots.length < TOTAL_FILES; i++) {
      slots.push({ ts: randomTimeInDay(dayStart), theme: null });
    }
  }
  const themeDayStart = /* @__PURE__ */ new Map();
  for (const theme of GROUP_THEMES) {
    let dayStart;
    do {
      dayStart = today - randInt(14, 4 * 365) * MS_DAY;
    } while (usedDays.has(dayStart));
    usedDays.add(dayStart);
    themeDayStart.set(theme, dayStart);
    const count = randInt(GROUP_DAY_MIN, GROUP_DAY_MAX);
    for (let i = 0; i < count && slots.length < TOTAL_FILES; i++) {
      slots.push({ ts: randomTimeInDay(dayStart), theme });
    }
  }
  while (slots.length < TOTAL_FILES) {
    const dayStart = today - randInt(0, SPARSE_YEARS * 365) * MS_DAY;
    slots.push({ ts: randomTimeInDay(dayStart), theme: null });
  }
  return { slots, themeDayStart };
}
async function generateTestData() {
  ensureLibraryDirs();
  const destDir = path.join(getFilesPath(), TEST_DIR);
  await fs$1.mkdir(destDir, { recursive: true });
  const { slots, themeDayStart } = buildTimestamps();
  const runId = crypto.randomBytes(4).toString("hex");
  const pending = [];
  const WRITE_BATCH = 50;
  for (let start = 0; start < slots.length; start += WRITE_BATCH) {
    const batch = slots.slice(start, start + WRITE_BATCH);
    await Promise.all(batch.map(async (slot, j) => {
      const n = start + j;
      const ext = pick(TEST_EXTS);
      const type = detectType(ext);
      const fileName = `test_${runId}_${String(n + 1).padStart(4, "0")}${ext}`;
      const content = `timeline test file ${runId} ${n + 1}
`;
      await fs$1.writeFile(path.join(destDir, fileName), content);
      const { latitude, longitude } = decideLocation(type, slot.theme);
      pending.push({
        fileName,
        relPath: ["files", TEST_DIR, fileName].join("/"),
        timestamp: slot.ts,
        contentHash: crypto.createHash("sha256").update(content).digest("hex"),
        type,
        theme: slot.theme,
        latitude,
        longitude
      });
    }));
  }
  const db2 = getDb();
  const insertEntry2 = db2.prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, latitude, longitude, gps_scanned, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0,
       @content_hash, 'copy', @latitude, @longitude, @gps_scanned, @created_at)
  `);
  const insertTag = db2.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  const getTagId = db2.prepare("SELECT id FROM tags WHERE name = ?");
  const insertEntryTag = db2.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
  const insertGroup = db2.prepare(`
    INSERT INTO groups (name, parent_id, color, description, date_from, date_to, created_at)
    VALUES (@name, NULL, @color, NULL, @date_from, @date_to, @created_at)
  `);
  const assignGroup = db2.prepare("UPDATE entries SET group_id = ? WHERE id = ?");
  const groupsMade = db2.transaction(() => {
    const tagIdByName = /* @__PURE__ */ new Map();
    for (const name of TEST_TAGS) {
      insertTag.run(name);
      tagIdByName.set(name, getTagId.get(name).id);
    }
    const createdAt = Date.now();
    const groupEntries = /* @__PURE__ */ new Map();
    for (const p of pending) {
      const result = insertEntry2.run({
        type: p.type,
        timestamp: p.timestamp,
        title: p.fileName,
        file_path: p.relPath,
        content_hash: p.contentHash,
        latitude: p.latitude,
        longitude: p.longitude,
        gps_scanned: p.type === "photo" || p.type === "video" ? 1 : 0,
        created_at: createdAt
      });
      const entryId = result.lastInsertRowid;
      if (p.theme) {
        const arr = groupEntries.get(p.theme) ?? [];
        arr.push(entryId);
        groupEntries.set(p.theme, arr);
      }
      if (Math.random() < 0.6) {
        const pool = tagPoolFor(p.theme, p.latitude !== null);
        const count = randInt(1, 3);
        for (const name of pickTags(pool, count)) {
          insertEntryTag.run(entryId, tagIdByName.get(name));
        }
      }
    }
    let made = 0;
    for (const [theme, entryIds] of groupEntries) {
      if (entryIds.length < GROUP_DAY_MIN) continue;
      const dayStart = themeDayStart.get(theme);
      const result = insertGroup.run({
        name: theme.name,
        color: theme.color,
        date_from: dayStart,
        date_to: dayStart + MS_DAY,
        created_at: createdAt
      });
      const groupId = result.lastInsertRowid;
      made++;
      const shuffled = [...entryIds].sort(() => Math.random() - 0.5);
      const takeCount = Math.max(2, Math.round(entryIds.length * randFloat(GROUP_ASSIGN_MIN, GROUP_ASSIGN_MAX)));
      for (const id of shuffled.slice(0, takeCount)) assignGroup.run(groupId, id);
    }
    return made;
  })();
  return {
    entries: pending.length,
    tags: TEST_TAGS.length,
    denseDays: DENSE_DAYS,
    located: pending.filter((p) => p.latitude !== null).length,
    groups: groupsMade
  };
}
async function pathExists(p) {
  try {
    await fs$1.access(p);
    return true;
  } catch {
    return false;
  }
}
function registerSettingsHandlers() {
  electron.ipcMain.handle("settings:get", () => getSettings());
  electron.ipcMain.handle("settings:set", (_, patch) => {
    saveSettings({ ...getSettings(), ...patch });
    if ("watchedFolders" in patch) restartWatcher();
  });
  electron.ipcMain.handle("settings:pickFolder", async () => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Select folder",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  electron.ipcMain.handle("settings:getLibraryFileCount", async () => {
    try {
      const files = await fs$1.readdir(getFilesPath());
      return files.length;
    } catch {
      return 0;
    }
  });
  electron.ipcMain.handle("settings:checkPaths", async () => {
    const s = getSettings();
    const libraryExists = await pathExists(s.libraryPath);
    const watchedFolders = await Promise.all(
      s.watchedFolders.map(async (f) => ({ path: f.path, exists: await pathExists(f.path) }))
    );
    return { libraryExists, watchedFolders };
  });
  electron.ipcMain.handle("settings:resolveWatchedFolder", async (_, oldPath, newPath) => {
    const entries = getEntriesWithFilePathPrefix(oldPath);
    const foundIds = [];
    const missingIds = [];
    for (const entry of entries) {
      const relPart = entry.file_path.slice(oldPath.length);
      const newFilePath = path.join(newPath, relPart);
      const exists = await pathExists(newFilePath);
      updateEntry(entry.id, { file_path: newFilePath });
      if (exists) foundIds.push(entry.id);
      else missingIds.push(entry.id);
    }
    if (foundIds.length > 0) markEntriesFound(foundIds);
    if (missingIds.length > 0) markEntriesMissing(missingIds);
    const s = getSettings();
    saveSettings({
      ...s,
      watchedFolders: s.watchedFolders.map((f) => f.path === oldPath ? { ...f, path: newPath } : f)
    });
    restartWatcher();
    return { found: foundIds.length, total: entries.length };
  });
  electron.ipcMain.handle("settings:relocateLibrary", async (_, newPath) => {
    const entries = getAllEntriesWithFilePaths().filter((e) => e.import_mode === "copy");
    const foundIds = [];
    const missingIds = [];
    for (const entry of entries) {
      const absPath = path.join(newPath, entry.file_path);
      const exists = await pathExists(absPath);
      if (exists) foundIds.push(entry.id);
      else missingIds.push(entry.id);
    }
    if (foundIds.length > 0) markEntriesFound(foundIds);
    if (missingIds.length > 0) markEntriesMissing(missingIds);
    const s = getSettings();
    saveSettings({ ...s, libraryPath: newPath });
    ensureLibraryDirs();
    restartWatcher();
    return { found: foundIds.length, total: entries.length };
  });
  electron.ipcMain.handle("settings:generateTestData", () => generateTestData());
  electron.ipcMain.handle("settings:resetLibrary", async () => {
    closeDb();
    const libPath = getLibraryPath();
    await fs$1.rm(path.join(libPath, "timeline.db"), { force: true });
    await fs$1.rm(path.join(libPath, "timeline.db-wal"), { force: true });
    await fs$1.rm(path.join(libPath, "timeline.db-shm"), { force: true });
    await fs$1.rm(getFilesPath(), { recursive: true, force: true });
    await fs$1.rm(path.join(libPath, "thumbnails"), { recursive: true, force: true });
    ensureLibraryDirs();
    restartWatcher();
    return { success: true };
  });
  electron.ipcMain.handle("settings:migrateLibrary", async (_, newPath) => {
    const current = getSettings();
    const oldPath = current.libraryPath;
    if (oldPath === newPath) return { success: true };
    closeDb();
    try {
      await fs$1.rename(oldPath, newPath);
    } catch (e) {
      if (e.code === "EXDEV") {
        await fs$1.cp(oldPath, newPath, { recursive: true });
        await fs$1.rm(oldPath, { recursive: true, force: true });
      } else {
        throw e;
      }
    }
    saveSettings({ ...current, libraryPath: newPath });
    ensureLibraryDirs();
    return { success: true };
  });
}
const MEDIA_MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".flac": "audio/flac"
};
function resolveEntryFilePath(entryId) {
  const entry = getEntry(entryId);
  if (!entry) return null;
  return resolveEntryAbsolutePath(entry);
}
let serverPort = 0;
const serverToken = crypto.randomBytes(16).toString("hex");
function getMediaUrl(entryId) {
  if (!serverPort || !resolveEntryFilePath(entryId)) return null;
  return `http://127.0.0.1:${serverPort}/media/${entryId}?token=${serverToken}`;
}
function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(/^\/media\/(\d+)$/);
  if (req.method !== "GET" || !match || url.searchParams.get("token") !== serverToken) {
    res.writeHead(403).end();
    return;
  }
  const abs = resolveEntryFilePath(Number(match[1]));
  let size;
  try {
    size = fs.statSync(abs).size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const mime = MEDIA_MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  let start = 0;
  let end = size - 1;
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    ...range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}
  });
  const stream = fs.createReadStream(abs, { start, end });
  stream.pipe(res);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
}
function startMediaServer() {
  const server = http.createServer(handleRequest);
  server.unref();
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}
function registerFileHandlers() {
  electron.ipcMain.handle("files:getMediaUrl", (_, entryId) => getMediaUrl(entryId));
  electron.ipcMain.handle("files:getFileInfo", async (_, entryId) => {
    const abs = resolveEntryFilePath(entryId);
    if (!abs) return null;
    let stat;
    try {
      stat = await fs$1.stat(abs);
    } catch {
      return null;
    }
    let width = null;
    let height = null;
    if (IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      try {
        const meta = await sharp(abs).metadata();
        const swap = (meta.orientation ?? 1) >= 5;
        width = (swap ? meta.height : meta.width) ?? null;
        height = (swap ? meta.width : meta.height) ?? null;
      } catch {
      }
    }
    return { absolutePath: abs, sizeBytes: stat.size, modifiedMs: stat.mtimeMs, width, height };
  });
  electron.ipcMain.handle("files:showInFolder", (_, entryId) => {
    const abs = resolveEntryFilePath(entryId);
    if (abs) electron.shell.showItemInFolder(abs);
  });
  electron.ipcMain.handle("files:openDefault", async (_, entryId) => {
    const abs = resolveEntryFilePath(entryId);
    if (!abs) return "No file attached";
    return electron.shell.openPath(abs);
  });
  electron.ipcMain.handle("files:openWith", async (e, entryId) => {
    const abs = resolveEntryFilePath(entryId);
    if (!abs) return "No file attached";
    if (process.platform === "win32") {
      child_process.spawn("rundll32", ["shell32.dll,OpenAs_RunDLL", abs], { detached: true, stdio: "ignore" }).unref();
      return "";
    }
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    const isMac = process.platform === "darwin";
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Choose an application",
      defaultPath: isMac ? "/Applications" : "/usr/bin",
      properties: ["openFile"],
      filters: isMac ? [{ name: "Applications", extensions: ["app"] }] : []
    });
    if (result.canceled || result.filePaths.length === 0) return "";
    const app = result.filePaths[0];
    try {
      const child = isMac ? child_process.spawn("open", ["-a", app, abs], { detached: true, stdio: "ignore" }) : child_process.spawn(app, [abs], { detached: true, stdio: "ignore" });
      child.unref();
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  });
}
const FILE_PATTERN = /Streaming_History_(Audio|Video)_.*\.json$/i;
async function expandSpotifyPaths(inputPaths) {
  const files = [];
  for (const p of inputPaths) {
    const st = await fs$1.stat(p);
    if (st.isDirectory()) {
      const entries = await fs$1.readdir(p, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && FILE_PATTERN.test(e.name)) files.push(path.join(p, e.name));
      }
    } else if (/\.json$/i.test(p)) {
      files.push(p);
    }
  }
  return files;
}
async function parseSpotifyFile(filePath) {
  const raw = await fs$1.readFile(filePath, "utf-8");
  const data = JSON.parse(raw);
  const plays = [];
  for (const entry of data) {
    if (!entry.ts) continue;
    const timestamp = Date.parse(entry.ts);
    if (Number.isNaN(timestamp)) continue;
    const isEpisode = !!entry.spotify_episode_uri;
    const trackName = isEpisode ? entry.episode_name : entry.master_metadata_track_name;
    if (!trackName) continue;
    plays.push({
      timestamp,
      track_name: trackName,
      artist_name: isEpisode ? entry.episode_show_name : entry.master_metadata_album_artist_name,
      album_name: isEpisode ? null : entry.master_metadata_album_album_name,
      ms_played: entry.ms_played ?? 0,
      media_type: isEpisode ? "episode" : "track",
      spotify_uri: isEpisode ? entry.spotify_episode_uri : entry.spotify_track_uri
    });
  }
  return plays;
}
let yearlySummariesCache = null;
const DAY_EXPR = bucketExprSql("day");
let rollupsEnsured = false;
function ensureRollups() {
  if (rollupsEnsured) return;
  const db2 = getDb();
  const count = db2.prepare("SELECT COUNT(*) AS c FROM listening_history").get().c;
  const marker = db2.prepare(`SELECT value FROM listening_rollup_meta WHERE key = 'source_count'`).get();
  if (!marker || Number(marker.value) !== count) rebuildRollups(count);
  rollupsEnsured = true;
}
function rebuildRollups(count) {
  const db2 = getDb();
  db2.transaction(() => {
    db2.prepare("DELETE FROM listening_daily").run();
    db2.prepare(`
      INSERT INTO listening_daily (day, ms_played, play_count)
      SELECT ${DAY_EXPR} AS day, SUM(ms_played), COUNT(*)
      FROM listening_history GROUP BY day
    `).run();
    db2.prepare("DELETE FROM listening_artist_daily").run();
    db2.prepare(`
      INSERT INTO listening_artist_daily (day, artist_name, ms_played, play_count)
      SELECT ${DAY_EXPR} AS day, artist_name, SUM(ms_played), COUNT(*)
      FROM listening_history
      WHERE media_type = 'track' AND artist_name IS NOT NULL
      GROUP BY day, artist_name
    `).run();
    db2.prepare(`INSERT OR REPLACE INTO listening_rollup_meta (key, value) VALUES ('source_count', ?)`).run(String(count));
  })();
}
function insertPlays(plays) {
  const db2 = getDb();
  const now = Date.now();
  const stmt = db2.prepare(`
    INSERT OR IGNORE INTO listening_history
      (timestamp, track_name, artist_name, album_name, ms_played, media_type, spotify_uri, created_at)
    VALUES
      (@timestamp, @track_name, @artist_name, @album_name, @ms_played, @media_type, @spotify_uri, @created_at)
  `);
  const insertMany = db2.transaction((rows) => {
    let inserted2 = 0;
    for (const row of rows) {
      const info = stmt.run({ ...row, created_at: now });
      if (info.changes > 0) inserted2++;
    }
    return inserted2;
  });
  const inserted = insertMany(plays);
  if (inserted > 0) {
    yearlySummariesCache = null;
    rollupsEnsured = false;
  }
  return inserted;
}
function getPlaysForPeriod(from, to) {
  return getDb().prepare(
    `SELECT * FROM listening_history WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`
  ).all(from, to);
}
function getTopArtists(from, to, limit) {
  ensureRollups();
  return getDb().prepare(`
    SELECT artist_name, SUM(ms_played) AS ms_played, SUM(play_count) AS play_count
    FROM listening_artist_daily
    WHERE day >= ? AND day < ?
    GROUP BY artist_name
    ORDER BY ms_played DESC
    LIMIT ?
  `).all(from, to, limit);
}
function getListeningHistogram(from, to, zoomLevel) {
  ensureRollups();
  const rows = getDb().prepare(
    `SELECT day, ms_played FROM listening_daily WHERE day >= ? AND day < ? ORDER BY day`
  ).all(from, to);
  if (zoomLevel === "day") {
    return rows.map((r) => ({ bucket_start: r.day, ms_played: r.ms_played }));
  }
  const totals = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const d = new Date(r.day);
    const bucket = zoomLevel === "year" ? new Date(d.getFullYear(), 0, 1).getTime() : new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    totals.set(bucket, (totals.get(bucket) ?? 0) + r.ms_played);
  }
  return [...totals.entries()].map(([bucket_start, ms_played]) => ({ bucket_start, ms_played })).sort((a, b) => a.bucket_start - b.bucket_start);
}
function getYearlySummaries() {
  if (yearlySummariesCache !== null) return yearlySummariesCache;
  const db2 = getDb();
  const yearExpr = `CAST(strftime('%Y', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER)`;
  const totals = db2.prepare(`
    SELECT ${yearExpr} AS year, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    GROUP BY year
  `).all();
  const topArtistRows = db2.prepare(`
    WITH by_artist_year AS (
      SELECT ${yearExpr} AS year, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
      FROM listening_history
      WHERE media_type = 'track' AND artist_name IS NOT NULL
      GROUP BY year, artist_name
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY year ORDER BY ms_played DESC) AS rnk
      FROM by_artist_year
    )
    SELECT year, artist_name, ms_played, play_count FROM ranked WHERE rnk <= 5 ORDER BY year, rnk
  `).all();
  const topTrackRows = db2.prepare(`
    WITH by_track_year AS (
      SELECT ${yearExpr} AS year, track_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
      FROM listening_history
      WHERE media_type = 'track' AND track_name IS NOT NULL
      GROUP BY year, track_name, artist_name
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY year ORDER BY ms_played DESC) AS rnk
      FROM by_track_year
    )
    SELECT year, track_name, artist_name, ms_played, play_count FROM ranked WHERE rnk = 1
  `).all();
  const monthlyRows = db2.prepare(`
    SELECT ${yearExpr} AS year,
           CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history
    GROUP BY year, month
  `).all();
  const artistsByYear = /* @__PURE__ */ new Map();
  for (const r of topArtistRows) {
    const arr = artistsByYear.get(r.year) ?? [];
    arr.push({ artist_name: r.artist_name, ms_played: r.ms_played, play_count: r.play_count });
    artistsByYear.set(r.year, arr);
  }
  const trackByYear = /* @__PURE__ */ new Map();
  for (const r of topTrackRows) {
    trackByYear.set(r.year, { track_name: r.track_name, artist_name: r.artist_name, ms_played: r.ms_played, play_count: r.play_count });
  }
  const monthlyByYear = /* @__PURE__ */ new Map();
  for (const r of monthlyRows) {
    let arr = monthlyByYear.get(r.year);
    if (!arr) {
      arr = new Array(12).fill(0);
      monthlyByYear.set(r.year, arr);
    }
    arr[r.month - 1] = r.ms_played;
  }
  yearlySummariesCache = totals.sort((a, b) => b.year - a.year).map((t) => ({
    year: t.year,
    msPlayed: t.ms_played,
    playCount: t.play_count,
    topArtists: artistsByYear.get(t.year) ?? [],
    topTrack: trackByYear.get(t.year) ?? null,
    monthly: monthlyByYear.get(t.year) ?? new Array(12).fill(0)
  }));
  return yearlySummariesCache;
}
function getYearDetail(year) {
  const db2 = getDb();
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const totals = db2.prepare(`
    SELECT SUM(ms_played) AS ms_played, COUNT(*) AS play_count,
           MIN(timestamp) AS first_play, MAX(timestamp) AS last_play
    FROM listening_history WHERE timestamp >= ? AND timestamp < ?
  `).get(from, to);
  if (!totals.play_count) return null;
  const uniqueCounts = db2.prepare(`
    SELECT COUNT(DISTINCT artist_name) AS artists, COUNT(DISTINCT track_name) AS tracks, COUNT(DISTINCT album_name) AS albums
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track'
  `).get(from, to);
  const topArtists = db2.prepare(`
    SELECT artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND artist_name IS NOT NULL
    GROUP BY artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to);
  const topTracks = db2.prepare(`
    SELECT track_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND track_name IS NOT NULL
    GROUP BY track_name, artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to);
  const topAlbums = db2.prepare(`
    SELECT album_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND album_name IS NOT NULL
    GROUP BY album_name, artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to);
  const monthlyRows = db2.prepare(`
    SELECT CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY month
  `).all(from, to);
  const monthly = new Array(12).fill(0);
  for (const r of monthlyRows) monthly[r.month - 1] = r.ms_played;
  const dowRows = db2.prepare(`
    SELECT CAST(strftime('%w', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS dow,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY dow
  `).all(from, to);
  const dayOfWeek = new Array(7).fill(0);
  for (const r of dowRows) dayOfWeek[r.dow] = r.ms_played;
  const hourRows = db2.prepare(`
    SELECT CAST(strftime('%H', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS hour,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY hour
  `).all(from, to);
  const hourOfDay = new Array(24).fill(0);
  for (const r of hourRows) hourOfDay[r.hour] = r.ms_played;
  return {
    year,
    msPlayed: totals.ms_played ?? 0,
    playCount: totals.play_count,
    uniqueArtists: uniqueCounts.artists,
    uniqueTracks: uniqueCounts.tracks,
    uniqueAlbums: uniqueCounts.albums,
    firstPlay: totals.first_play,
    lastPlay: totals.last_play,
    topArtists,
    topTracks,
    topAlbums,
    monthly,
    dayOfWeek,
    hourOfDay
  };
}
function getArtistMonthlyForYear(year, artistName) {
  const db2 = getDb();
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const rows = db2.prepare(`
    SELECT CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND artist_name = ?
    GROUP BY month
  `).all(from, to, artistName);
  const monthly = new Array(12).fill(0);
  for (const r of rows) monthly[r.month - 1] = r.ms_played;
  return monthly;
}
function registerSpotifyHandlers() {
  electron.ipcMain.handle("spotify:pickExport", async (_event, mode = "files") => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, mode === "folder" ? {
      title: 'Select your Spotify "Extended streaming history" export folder',
      properties: ["openDirectory"]
    } : {
      title: "Select your Spotify Streaming_History_*.json files",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  electron.ipcMain.handle("spotify:import", async (event, paths) => {
    const sender = event.sender;
    const files = await expandSpotifyPaths(paths);
    let imported = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const plays = await parseSpotifyFile(file);
      imported += insertPlays(plays);
      if (!sender.isDestroyed()) {
        const evt = {
          processedFiles: i + 1,
          totalFiles: files.length,
          current: path.basename(file)
        };
        sender.send("spotify:progress", evt);
      }
    }
    return { imported, totalFiles: files.length };
  });
  electron.ipcMain.handle("spotify:forPeriod", (_, from, to) => getPlaysForPeriod(from, to));
  electron.ipcMain.handle("spotify:topArtists", (_, from, to, limit = 50) => getTopArtists(from, to, limit));
  electron.ipcMain.handle("spotify:histogram", (_, from, to, zoomLevel) => getListeningHistogram(from, to, zoomLevel));
  electron.ipcMain.handle("spotify:yearlySummaries", () => getYearlySummaries());
  electron.ipcMain.handle("spotify:yearDetail", (_, year) => getYearDetail(year));
  electron.ipcMain.handle("spotify:artistMonthlyForYear", (_, year, artistName) => getArtistMonthlyForYear(year, artistName));
}
function registerVolumeHandlers() {
  electron.ipcMain.handle("volumes:list", () => getVolumeStatuses());
  electron.ipcMain.handle("volumes:refresh", async () => {
    await refreshVolumes();
    return getVolumeStatuses();
  });
  electron.ipcMain.handle("volumes:matchPath", (_, p) => findOrCreateVolumeForPath(p));
  electron.ipcMain.handle("volumes:setLabel", (_, id, label) => {
    updateVolumeLabel(id, label);
  });
}
function registerAllHandlers() {
  registerBackupHandlers();
  registerEntryHandlers();
  registerEventHandlers();
  registerFileHandlers();
  registerGroupHandlers();
  registerIngestHandlers();
  registerMapHandlers();
  registerTagHandlers();
  registerSettingsHandlers();
  registerSpotifyHandlers();
  registerVolumeHandlers();
}
electron.protocol.registerSchemesAsPrivileged([
  { scheme: "timeline", privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
]);
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  win.on("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(async () => {
  ensureLibraryDirs();
  registerAllHandlers();
  electron.protocol.handle("timeline", (request) => {
    const rel = decodeURIComponent(request.url.slice("timeline:///".length));
    const filePath = path.normalize(path.join(getLibraryPath(), rel));
    return electron.net.fetch(`file://${filePath}`);
  });
  await refreshVolumes();
  backfillWatchedFolderVolumes();
  startMediaServer().then(createWindow);
  startWatcher();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  stopWatcher();
  closeDb();
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("will-quit", () => {
  void endExifTool();
});
