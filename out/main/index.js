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
const sharp = require("sharp");
const child_process = require("child_process");
const http = require("http");
const settingsFile = () => path.join(electron.app.getPath("userData"), "settings.json");
let cached = null;
function getSettings() {
  if (cached) return cached;
  const defaultLibrary = path.join(electron.app.getPath("userData"), "library");
  try {
    const raw = fs.readFileSync(settingsFile(), "utf-8");
    const parsed = JSON.parse(raw);
    cached = {
      importMode: parsed.importMode ?? "copy",
      libraryPath: parsed.libraryPath || defaultLibrary,
      watchedFolders: Array.isArray(parsed.watchedFolders) ? parsed.watchedFolders : [],
      duplicateScanMode: parsed.duplicateScanMode ?? "hash",
      histogramHeight: parsed.histogramHeight !== void 0 ? parsed.histogramHeight : 420,
      theme: parsed.theme ?? "light",
      heatmapScale: parsed.heatmapScale ?? "log",
      heatmapMaxCount: parsed.heatmapMaxCount ?? null,
      curveTension: parsed.curveTension ?? 1,
      fileBrowserHeight: parsed.fileBrowserHeight ?? parsed.dayViewHeight ?? 240,
      fileBrowserMode: parsed.fileBrowserMode ?? parsed.dayViewMode ?? "medium"
    };
  } catch {
    cached = { importMode: "copy", libraryPath: defaultLibrary, watchedFolders: [], duplicateScanMode: "hash", histogramHeight: 420, theme: "light", heatmapScale: "log", heatmapMaxCount: null, curveTension: 1, fileBrowserHeight: 240, fileBrowserMode: "medium" };
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
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON entries(content_hash)`);
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
function getHistogram(from, to, zoomLevel, groupId) {
  let bucketExpr;
  if (zoomLevel === "year") {
    bucketExpr = `CAST(strftime('%s', strftime('%Y', datetime(timestamp/1000, 'unixepoch', 'localtime')) || '-01-01', 'utc') AS INTEGER) * 1000`;
  } else if (zoomLevel === "month") {
    bucketExpr = `CAST(strftime('%s', strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) || '-01', 'utc') AS INTEGER) * 1000`;
  } else {
    bucketExpr = `CAST(strftime('%s', date(datetime(timestamp/1000, 'unixepoch', 'localtime')), 'utc') AS INTEGER) * 1000`;
  }
  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      group_id,
      type,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp >= :from AND timestamp < :to${groupId != null ? " AND group_id = :groupId" : ""}
    GROUP BY bucket_start, group_id, type
    ORDER BY bucket_start
  `;
  const params = { from, to };
  if (groupId != null) params.groupId = groupId;
  return getDb().prepare(sql).all(params);
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
      `SELECT * FROM entries WHERE timestamp >= ? AND timestamp < ? AND group_id = ? ORDER BY timestamp`
    ).all(from, to, groupId);
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
  const where = opts.groupId != null ? "WHERE e.group_id = @groupId" : "";
  const params = {};
  if (opts.groupId != null) params.groupId = opts.groupId;
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
  const simpleWhere = opts.groupId != null ? "WHERE group_id = @groupId" : "";
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
       is_missing, content_hash, import_mode, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review,
       @is_missing, @content_hash, @import_mode, @created_at)
  `).run(entry);
  return result.lastInsertRowid;
}
function getEntriesWithFilePathPrefix(prefix) {
  return getDb().prepare(
    `SELECT * FROM entries WHERE file_path LIKE ? AND import_mode = 'reference'`
  ).all(`${prefix}%`);
}
function findEntryByHash(hash) {
  return getDb().prepare("SELECT * FROM entries WHERE content_hash = ? LIMIT 1").get(hash);
}
function findEntryByTitle(title) {
  return getDb().prepare("SELECT * FROM entries WHERE title = ? LIMIT 1").get(title);
}
function getAllEntriesWithFilePaths() {
  return getDb().prepare("SELECT * FROM entries WHERE file_path IS NOT NULL").all();
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
const HASH_THRESHOLD = 100 * 1024 * 1024;
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
  if (IMAGE_EXTS.has(e)) return "photo";
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
async function findExistingEntry(sourcePath, fileName) {
  const stat = await fs$1.stat(sourcePath);
  if (stat.size < HASH_THRESHOLD) {
    const hash = await computeFileHash(sourcePath);
    return findEntryByHash(hash);
  }
  return findEntryByTitle(fileName);
}
async function relinkEntry(entry, sourcePath, relDir, fileName) {
  let storedFilePath;
  if (entry.import_mode === "reference") {
    storedFilePath = sourcePath;
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
async function generateImageThumbnails(sourcePath, baseName) {
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
      await sharp(sourcePath).rotate().resize(dim, dim, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(outPath);
      out[size] = `thumbnails/${size}/${fileName}`;
    }
    return out;
  } catch {
    return null;
  }
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
async function ingestOne(sourcePath, relDir) {
  const fileName = path.basename(sourcePath);
  const ext = path.extname(fileName);
  const type = detectType(ext);
  const existing = await findExistingEntry(sourcePath, fileName);
  if (existing) {
    if (existing.is_missing && existing.file_path) {
      await relinkEntry(existing, sourcePath, relDir, fileName);
    }
    return { ok: true, skipped: true };
  }
  const baseName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const settings = getSettings();
  const isReference = settings.importMode === "reference";
  let storedFilePath;
  let contentHash = null;
  if (isReference) {
    storedFilePath = sourcePath;
  } else {
    const destDir = path.join(getFilesPath(), relDir);
    await fs$1.mkdir(destDir, { recursive: true });
    const destName = await copyWithUniqueName(sourcePath, destDir, fileName);
    storedFilePath = path.join("files", relDir, destName).split(path.sep).join("/");
  }
  const stat = await fs$1.stat(sourcePath);
  const timestamp = stat.mtime.getTime() || Date.now();
  if (stat.size < HASH_THRESHOLD) {
    contentHash = await computeFileHash(sourcePath);
  }
  let thumb = null;
  if (type === "photo" && ext.toLowerCase() !== ".svg") {
    thumb = await generateImageThumbnails(sourcePath, baseName);
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
    group_id: null,
    needs_date_review: 1,
    is_missing: 0,
    content_hash: contentHash,
    import_mode: isReference ? "reference" : "copy",
    created_at: Date.now()
  });
  return { ok: true, id };
}
async function walkDir(root, dir, out) {
  const entries = await fs$1.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(root, full, out);
    } else if (entry.isFile()) {
      out.push({ filePath: full, relDir: path.relative(root, dir) });
    }
  }
}
async function expandPaths(inputPaths) {
  const out = [];
  for (const p of inputPaths) {
    const stat = await fs$1.stat(p);
    if (stat.isDirectory()) {
      await walkDir(p, p, out);
    } else {
      out.push({ filePath: p, relDir: "" });
    }
  }
  return out;
}
const CONCURRENCY = 4;
async function ingestFiles(filePaths, onProgress) {
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
      const { filePath: src, relDir } = files[i];
      const fileName = path.basename(src);
      let error;
      try {
        const result = await ingestOne(src, relDir);
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
    const settings = getSettings();
    const libraryPath = settings.libraryPath;
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
      const absPath = entry.import_mode === "reference" ? entry.file_path : path.join(libraryPath, entry.file_path);
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
    const foldersToScan = settings.importMode === "copy" ? [getFilesPath()] : settings.watchedFolders;
    const existingAbsPaths = new Set(
      entries.filter((e) => e.file_path != null).map(
        (e) => e.import_mode === "reference" ? e.file_path : path.join(libraryPath, e.file_path)
      )
    );
    const newFiles = [];
    for (const folder of foldersToScan) {
      await scanFolder(folder, existingAbsPaths, newFiles);
    }
    if (newFiles.length > 0) {
      await ingestFiles(newFiles, (progress) => {
        onProgress({
          phase: "ingesting",
          checked: entries.length,
          missing: missingIds.length,
          recovered: recoveredIds.length,
          found: newFiles.length,
          ingested: progress.completed,
          total: newFiles.length,
          current: progress.current,
          error: progress.error
        });
      });
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
  const dirs = settings.importMode === "copy" ? [getFilesPath()] : settings.watchedFolders;
  if (dirs.length === 0) return;
  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent: true,
    depth: 99,
    awaitWriteFinish: { stabilityThreshold: 1e3, pollInterval: 500 }
  });
  watcher.on("add", async (filePath) => {
    const wins = electron.BrowserWindow.getAllWindows();
    await ingestFiles([filePath], () => {
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
  electron.ipcMain.handle("entries:search", (_, filters) => searchEntries(filters ?? {}));
  electron.ipcMain.handle("entries:listAll", (_, opts) => listAllEntries(opts));
  electron.ipcMain.handle("entries:get", (_, id) => getEntry(id));
  electron.ipcMain.handle("entries:update", (_, id, patch) => updateEntry(id, patch));
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
function listGroups() {
  return getDb().prepare("SELECT * FROM groups ORDER BY name").all();
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
function registerGroupHandlers() {
  electron.ipcMain.handle("groups:list", () => listGroups());
  electron.ipcMain.handle("groups:statsForPeriod", (_, from, to) => getGroupStatsForPeriod(from, to));
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
  electron.ipcMain.handle("ingest:pickFiles", async () => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Import files or folders",
      properties: ["openFile", "openDirectory", "multiSelections"],
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
      const { insertedIds, failures, total } = await ingestFiles(filePaths, (progress) => {
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
const TEST_TAGS = [
  "family",
  "vacation",
  "friends",
  "work",
  "school",
  "holidays",
  "pets",
  "nature",
  "birthday",
  "travel"
];
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
const MS_DAY = 864e5;
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function randomTimeInDay(dayStartMs) {
  return dayStartMs + randInt(8, 21) * 36e5 + randInt(0, 3599999);
}
function buildTimestamps() {
  const now = /* @__PURE__ */ new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const timestamps = [];
  const usedDays = /* @__PURE__ */ new Set();
  for (let d = 0; d < DENSE_DAYS; d++) {
    let dayStart;
    do {
      dayStart = today - randInt(30, 2 * 365) * MS_DAY;
    } while (usedDays.has(dayStart));
    usedDays.add(dayStart);
    const count = randInt(DENSE_MIN, DENSE_MAX);
    for (let i = 0; i < count && timestamps.length < TOTAL_FILES; i++) {
      timestamps.push(randomTimeInDay(dayStart));
    }
  }
  while (timestamps.length < TOTAL_FILES) {
    const dayStart = today - randInt(0, SPARSE_YEARS * 365) * MS_DAY;
    timestamps.push(randomTimeInDay(dayStart));
  }
  return timestamps;
}
async function generateTestData() {
  ensureLibraryDirs();
  const destDir = path.join(getFilesPath(), TEST_DIR);
  await fs$1.mkdir(destDir, { recursive: true });
  const timestamps = buildTimestamps();
  const runId = crypto.randomBytes(4).toString("hex");
  const pending = [];
  const WRITE_BATCH = 50;
  for (let start = 0; start < timestamps.length; start += WRITE_BATCH) {
    const batch = timestamps.slice(start, start + WRITE_BATCH);
    await Promise.all(batch.map(async (timestamp, j) => {
      const n = start + j;
      const ext = pick(TEST_EXTS);
      const fileName = `test_${runId}_${String(n + 1).padStart(4, "0")}${ext}`;
      const content = `timeline test file ${runId} ${n + 1}
`;
      await fs$1.writeFile(path.join(destDir, fileName), content);
      pending.push({
        fileName,
        relPath: ["files", TEST_DIR, fileName].join("/"),
        timestamp,
        contentHash: crypto.createHash("sha256").update(content).digest("hex")
      });
    }));
  }
  const db2 = getDb();
  const insertEntry2 = db2.prepare(`
    INSERT INTO entries
      (type, timestamp, title, file_path, thumbnail_small, thumbnail_medium,
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review,
       is_missing, content_hash, import_mode, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0,
       @content_hash, 'copy', @created_at)
  `);
  const insertTag = db2.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  const getTagId = db2.prepare("SELECT id FROM tags WHERE name = ?");
  const insertEntryTag = db2.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
  db2.transaction(() => {
    const tagIds = TEST_TAGS.map((name) => {
      insertTag.run(name);
      return getTagId.get(name).id;
    });
    const createdAt = Date.now();
    for (const p of pending) {
      const result = insertEntry2.run({
        type: detectType(path.extname(p.fileName)),
        timestamp: p.timestamp,
        title: p.fileName,
        file_path: p.relPath,
        content_hash: p.contentHash,
        created_at: createdAt
      });
      const entryId = result.lastInsertRowid;
      if (Math.random() < 0.6) {
        const count = randInt(1, 3);
        const shuffled = [...tagIds].sort(() => Math.random() - 0.5);
        for (let t = 0; t < count; t++) insertEntryTag.run(entryId, shuffled[t]);
      }
    }
  })();
  return { entries: pending.length, tags: TEST_TAGS.length, denseDays: DENSE_DAYS };
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
    if ("importMode" in patch || "watchedFolders" in patch) restartWatcher();
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
      s.watchedFolders.map(async (f) => ({ path: f, exists: await pathExists(f) }))
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
    saveSettings({ ...s, watchedFolders: s.watchedFolders.map((f) => f === oldPath ? newPath : f) });
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
  if (!entry?.file_path) return null;
  return entry.import_mode === "reference" ? entry.file_path : path.join(getLibraryPath(), entry.file_path);
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
function registerAllHandlers() {
  registerBackupHandlers();
  registerEntryHandlers();
  registerEventHandlers();
  registerFileHandlers();
  registerGroupHandlers();
  registerIngestHandlers();
  registerTagHandlers();
  registerSettingsHandlers();
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
electron.app.whenReady().then(() => {
  ensureLibraryDirs();
  registerAllHandlers();
  electron.protocol.handle("timeline", (request) => {
    const rel = decodeURIComponent(request.url.slice("timeline:///".length));
    const filePath = path.normalize(path.join(getLibraryPath(), rel));
    return electron.net.fetch(`file://${filePath}`);
  });
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
