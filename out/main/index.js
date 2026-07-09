"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const fs$1 = require("fs/promises");
const crypto = require("crypto");
const sharp = require("sharp");
let libraryPath = null;
function getLibraryPath() {
  if (!libraryPath) {
    libraryPath = path.join(electron.app.getPath("userData"), "library");
  }
  return libraryPath;
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
  `);
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
function getHistogram(from, to, bucketMs, groupId) {
  const sql = `
    SELECT
      CAST(timestamp / :bucket AS INTEGER) * :bucket AS bucket_start,
      group_id,
      COUNT(*) AS count
    FROM entries
    WHERE timestamp BETWEEN :from AND :to${groupId != null ? " AND group_id = :groupId" : ""}
    GROUP BY bucket_start, group_id
    ORDER BY bucket_start
  `;
  const params = { bucket: bucketMs, from, to };
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
  const col = opts.sortBy === "date" ? "timestamp" : opts.sortBy === "title" ? "title" : "type";
  const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
  const tie = opts.sortBy === "date" ? "" : ", timestamp DESC";
  const where = opts.groupId != null ? "WHERE group_id = @groupId" : "";
  const params = {};
  if (opts.groupId != null) params.groupId = opts.groupId;
  return getDb().prepare(`
    SELECT * FROM entries
    ${where}
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
       thumbnail_large, duration_seconds, rich_text_json, group_id, needs_date_review, created_at)
    VALUES
      (@type, @timestamp, @title, @file_path, @thumbnail_small, @thumbnail_medium,
       @thumbnail_large, @duration_seconds, @rich_text_json, @group_id, @needs_date_review, @created_at)
  `).run(entry);
  return result.lastInsertRowid;
}
function registerEntryHandlers() {
  electron.ipcMain.handle("entries:histogram", (_, from, to, bucketMs, groupId) => getHistogram(from, to, bucketMs, groupId ?? void 0));
  electron.ipcMain.handle("entries:forDay", (_, dateMs) => getEntriesForDay(dateMs));
  electron.ipcMain.handle("entries:forPeriod", (_, from, to, groupId) => getEntriesForPeriod(from, to, groupId ?? void 0));
  electron.ipcMain.handle("entries:extent", () => getDataExtent());
  electron.ipcMain.handle("entries:search", (_, filters) => searchEntries(filters ?? {}));
  electron.ipcMain.handle("entries:listAll", (_, opts) => listAllEntries(opts));
  electron.ipcMain.handle("entries:get", (_, id) => getEntry(id));
  electron.ipcMain.handle("entries:update", (_, id, patch) => updateEntry(id, patch));
  electron.ipcMain.handle("entries:delete", (_, ids) => deleteEntries(ids));
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
    created_at: Date.now()
  }));
}
function listGroups() {
  return getDb().prepare("SELECT * FROM groups ORDER BY name").all();
}
function createGroup(data) {
  const db2 = getDb();
  const result = db2.prepare(`
    INSERT INTO groups (name, parent_id, color, created_at)
    VALUES (@name, @parent_id, @color, @created_at)
  `).run({ ...data, created_at: Date.now() });
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
function registerGroupHandlers() {
  electron.ipcMain.handle("groups:list", () => listGroups());
  electron.ipcMain.handle("groups:create", (_, data) => createGroup(data));
  electron.ipcMain.handle("groups:update", (_, id, patch) => updateGroup(id, patch));
  electron.ipcMain.handle("groups:delete", (_, id) => deleteGroup(id));
  electron.ipcMain.handle("groups:assignEntries", (_, groupId, entryIds) => assignEntriesToGroup(groupId, entryIds));
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
async function ingestOne(sourcePath) {
  const fileName = path.basename(sourcePath);
  const ext = path.extname(fileName);
  const type = detectType(ext);
  const hash = crypto.randomBytes(6).toString("hex");
  const baseName = `${Date.now()}_${hash}`;
  const destName = `${baseName}${ext}`;
  const destPath = path.join(getFilesPath(), destName);
  await fs$1.copyFile(sourcePath, destPath);
  const stat = await fs$1.stat(sourcePath);
  const timestamp = stat.mtime.getTime() || Date.now();
  let thumb = null;
  if (type === "photo" && ext.toLowerCase() !== ".svg") {
    thumb = await generateImageThumbnails(sourcePath, baseName);
  }
  insertEntry({
    type,
    timestamp,
    title: fileName,
    file_path: `files/${destName}`,
    thumbnail_small: thumb?.small ?? null,
    thumbnail_medium: thumb?.medium ?? null,
    thumbnail_large: thumb?.large ?? null,
    duration_seconds: null,
    rich_text_json: null,
    group_id: null,
    needs_date_review: 1,
    created_at: Date.now()
  });
  return { ok: true };
}
const CONCURRENCY = 4;
async function ingestFiles(filePaths, onProgress) {
  const total = filePaths.length;
  if (total === 0) return;
  let nextIndex = 0;
  let completed = 0;
  onProgress({ total, completed: 0, current: path.basename(filePaths[0]) });
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const src = filePaths[i];
      const fileName = path.basename(src);
      let error;
      try {
        await ingestOne(src);
      } catch (e) {
        error = e.message ?? String(e);
      }
      completed++;
      onProgress({ total, completed, current: fileName, error });
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, worker);
  await Promise.all(workers);
}
function registerIngestHandlers() {
  electron.ipcMain.handle("ingest:pickFiles", async () => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Import files",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "All files", extensions: ["*"] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  electron.ipcMain.handle("ingest:start", async (event, filePaths) => {
    const sender = event.sender;
    await ingestFiles(filePaths, (progress) => {
      if (!sender.isDestroyed()) sender.send("ingest:progress", progress);
    });
  });
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
function registerTagHandlers() {
  electron.ipcMain.handle("tags:list", () => listTags());
  electron.ipcMain.handle("tags:create", (_, name) => createTag(name));
  electron.ipcMain.handle("tags:delete", (_, id) => deleteTag(id));
  electron.ipcMain.handle("tags:forEntry", (_, entryId) => getEntryTags(entryId));
  electron.ipcMain.handle("tags:setForEntry", (_, entryId, names) => setEntryTags(entryId, names));
  electron.ipcMain.handle("tags:forGroup", (_, groupId) => getGroupTags(groupId));
  electron.ipcMain.handle("tags:setForGroup", (_, groupId, names) => setGroupTags(groupId, names));
}
function registerAllHandlers() {
  registerEntryHandlers();
  registerGroupHandlers();
  registerIngestHandlers();
  registerTagHandlers();
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
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") electron.app.quit();
});
