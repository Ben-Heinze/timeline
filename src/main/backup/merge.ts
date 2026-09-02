import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import extractZip from 'extract-zip'
import { getDb } from '../db'
import { initSchema } from '../db/schema'
import { readAndValidateManifest } from './index'
import { getFilesPath, getThumbnailPath, getSpotifyPath } from '../library'
import { stopWatcher, startWatcher, isCurrentlySyncing } from '../sync'
import { insertEntry, updateEntry, getEntry } from '../db/queries/entries'
import { getVolumeBySerial, insertVolume } from '../db/queries/volumes'
import { insertPlays, type SpotifyPlayInsert } from '../db/queries/listeningHistory'
import { copyWithUniqueName } from '../ingest'
import { syncJournalFile } from '../journalExport'
import type {
  Entry, Group, Volume, BackupManifest, BackupProgressEvent, MergePreview, MergeResult,
} from '../../shared/types'

// Merging another library's full backup into the active one. Every primary key
// in the schema is an auto-increment integer, so nothing can be copied across
// by id: entries/groups/people/events get fresh ids with an old→new map, and
// every foreign key (group_id, volume_id, avatar_entry_id, the join tables) is
// rewritten through that map. Tags match by their NOCASE-unique name, volumes
// by volume_serial, Spotify plays by the (timestamp, uri, ms_played) index.
//
// Entries dedupe by content_hash — the same key the ingest pipeline uses — so
// re-merging the same archive is a no-op. Journals additionally require a
// matching timestamp: their hash is derived from rendered plain text, and two
// distinct journals with identical text (e.g. both empty) must not collapse.

interface PlannedEntry {
  src: Entry
  action: 'new' | 'duplicate' | 'dup-of-new' | 'relink'
  existingId?: number       // duplicate/relink: the dest entry this maps to
  dupOfSrcId?: number       // dup-of-new: earlier src entry with the same content
  archivePath: string | null // absolute path of the file inside the extracted zip
  // Filled while copying:
  destFilePath?: string | null
  destThumbs?: { small: string | null; medium: string | null; large: string | null }
}

interface MergeSession {
  zipPath: string
  tmpDir: string
  srcDb: Database.Database
  manifest: BackupManifest
  plan: PlannedEntry[]
}

// One extract-and-analyze session at a time, shared between the preview
// (prepareMerge) and the commit (executeMerge) so the zip is extracted once.
let session: MergeSession | null = null

async function disposeSession(): Promise<void> {
  if (!session) return
  const s = session
  session = null
  try { s.srcDb.close() } catch { /* already closed */ }
  await fs.rm(s.tmpDir, { recursive: true, force: true }).catch(() => {})
}

export async function cancelMerge(): Promise<void> {
  await disposeSession()
}

export async function prepareMerge(
  zipPath: string,
  onProgress: (e: BackupProgressEvent) => void,
): Promise<MergePreview> {
  if (isCurrentlySyncing()) {
    throw new Error('A library sync is in progress — wait for it to finish before merging.')
  }
  await disposeSession()

  const tmpDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'timeline-merge-'))
  try {
    let extracted = 0
    await extractZip(zipPath, {
      dir: tmpDir,
      onEntry: (entry, zipfile) => {
        extracted++
        onProgress({ phase: 'extracting', completed: extracted, total: zipfile.entryCount, current: entry.fileName })
      },
    })

    const manifest = await readAndValidateManifest(tmpDir)
    if (manifest.exportType !== 'full') {
      throw new Error("Only full backups can be merged — use 'Export full backup' on the other machine.")
    }

    // The extracted snapshot is scratch data, so it can be migrated in place —
    // an older-version source then exposes the same columns as the live schema.
    const srcDb = new Database(path.join(tmpDir, 'timeline.db'))
    initSchema(srcDb)

    session = { zipPath, tmpDir, srcDb, manifest, plan: [] }
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    session = null
    throw err
  }

  return analyze(session, onProgress)
}

/**
 * Classify every source entry against the destination and count what the other
 * passes would create. Read-only on both databases; safe to re-run (executeMerge
 * repeats it so the plan reflects the destination at commit time).
 */
async function analyze(s: MergeSession, onProgress: (e: BackupProgressEvent) => void): Promise<MergePreview> {
  const dest = getDb()
  const src = s.srcDb

  const findByHash = dest.prepare('SELECT * FROM entries WHERE content_hash = ? LIMIT 1')
  const findJournal = dest.prepare(
    `SELECT * FROM entries WHERE content_hash = ? AND type = 'journal' AND timestamp = ? LIMIT 1`
  )
  const findByShape = dest.prepare('SELECT * FROM entries WHERE type = ? AND timestamp = ? AND title IS ? LIMIT 1')

  const srcEntries = src.prepare('SELECT * FROM entries ORDER BY id').all() as Entry[]
  const plan: PlannedEntry[] = []
  const newByKey = new Map<string, number>() // dedup key → src id already planned as new
  let entriesNew = 0, entriesDuplicate = 0, entriesMissingFile = 0

  for (let i = 0; i < srcEntries.length; i++) {
    const e = srcEntries[i]
    // Full backups materialize reference-mode files into the archive as copy
    // mode; rows still marked reference are the ones whose file was unreadable
    // at export time, so they can't be in the zip.
    let archivePath: string | null = null
    if (e.file_path && e.import_mode === 'copy') {
      const cand = path.join(s.tmpDir, e.file_path)
      try { await fs.access(cand); archivePath = cand } catch { /* not in archive */ }
    }

    const key = e.content_hash == null
      ? null
      : e.type === 'journal' ? `${e.content_hash}@${e.timestamp}` : e.content_hash
    const existing = e.content_hash
      ? (e.type === 'journal'
          ? findJournal.get(e.content_hash, e.timestamp)
          : findByHash.get(e.content_hash)) as Entry | undefined
      : findByShape.get(e.type, e.timestamp, e.title) as Entry | undefined

    if (existing) {
      // A missing dest twin whose bytes are in the archive gets its file back —
      // same recovery the watcher's relink-by-hash performs.
      const canRelink = !!existing.is_missing && existing.import_mode === 'copy' && archivePath !== null
      plan.push({ src: e, action: canRelink ? 'relink' : 'duplicate', existingId: existing.id, archivePath })
      entriesDuplicate++
    } else if (key != null && newByKey.has(key)) {
      plan.push({ src: e, action: 'dup-of-new', dupOfSrcId: newByKey.get(key), archivePath })
      entriesDuplicate++
    } else {
      if (key != null) newByKey.set(key, e.id)
      plan.push({ src: e, action: 'new', archivePath })
      entriesNew++
      if (e.file_path && !archivePath) entriesMissingFile++
    }

    if (i % 100 === 0 || i === srcEntries.length - 1) {
      onProgress({ phase: 'analyzing', completed: i + 1, total: srcEntries.length, current: e.title ?? '' })
    }
  }
  s.plan = plan

  const destTag = dest.prepare('SELECT id FROM tags WHERE name = ?')
  const tagsNew = (src.prepare('SELECT name FROM tags').all() as { name: string }[])
    .filter(t => !destTag.get(t.name)).length

  // A group whose (mapped) parent chain exists here is "existing" when a dest
  // group of the same name hangs off the same parent — the identity rule
  // findOrCreateGroupPath uses. A group under a new parent is necessarily new.
  const destRootGroup = dest.prepare('SELECT id FROM groups WHERE parent_id IS NULL AND name = ? COLLATE NOCASE')
  const destChildGroup = dest.prepare('SELECT id FROM groups WHERE parent_id = ? AND name = ? COLLATE NOCASE')
  const srcGroups = src.prepare('SELECT * FROM groups ORDER BY id').all() as Group[]
  let groupsNew = 0
  {
    const mapped = new Map<number, number | 'new'>()
    let pending = [...srcGroups]
    while (pending.length > 0) {
      const next: Group[] = []
      for (const g of pending) {
        const parent = g.parent_id == null ? null : mapped.get(g.parent_id)
        if (g.parent_id != null && parent === undefined) { next.push(g); continue }
        if (parent === 'new') { mapped.set(g.id, 'new'); groupsNew++; continue }
        const hit = (parent == null ? destRootGroup.get(g.name) : destChildGroup.get(parent, g.name)) as { id: number } | undefined
        if (hit) mapped.set(g.id, hit.id)
        else { mapped.set(g.id, 'new'); groupsNew++ }
      }
      if (next.length === pending.length) break // orphaned parent_id — treat rest as new
      pending = next
    }
  }

  const destPerson = dest.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND kind = ?')
  const peopleNew = (src.prepare('SELECT name, kind FROM people').all() as { name: string; kind: string }[])
    .filter(p => !destPerson.get(p.name, p.kind)).length

  const volumesNew = (src.prepare('SELECT volume_serial FROM volumes').all() as { volume_serial: string }[])
    .filter(v => !getVolumeBySerial(v.volume_serial)).length

  const destEvent = dest.prepare('SELECT id FROM events WHERE title = ? AND date_from = ? AND date_to IS ?')
  const eventsNew = (src.prepare('SELECT title, date_from, date_to FROM events').all() as
    { title: string; date_from: number; date_to: number | null }[])
    .filter(ev => !destEvent.get(ev.title, ev.date_from, ev.date_to)).length

  const destPlay = dest.prepare('SELECT 1 FROM listening_history WHERE timestamp = ? AND spotify_uri IS ? AND ms_played = ?')
  const playsNew = (src.prepare('SELECT timestamp, spotify_uri, ms_played FROM listening_history').all() as
    { timestamp: number; spotify_uri: string | null; ms_played: number }[])
    .filter(p => !destPlay.get(p.timestamp, p.spotify_uri, p.ms_played)).length

  // Shelf categories match by (kind, name); items count as new when the entry
  // they mark either lands as a new entry here or maps onto a dest entry that
  // has no shelf row yet (dest's row wins on conflict, mirroring the commit).
  const destShelfCat = dest.prepare('SELECT id FROM shelf_categories WHERE kind = ? AND name = ? COLLATE NOCASE')
  const shelfCategoriesNew = (src.prepare('SELECT kind, name FROM shelf_categories').all() as
    { kind: string; name: string }[])
    .filter(c => !destShelfCat.get(c.kind, c.name)).length

  const planBySrcId = new Map(plan.map(p => [p.src.id, p]))
  const destShelfItem = dest.prepare('SELECT 1 FROM shelf_items WHERE entry_id = ?')
  let shelfItemsNew = 0
  for (const r of src.prepare('SELECT entry_id FROM shelf_items').all() as { entry_id: number }[]) {
    const p = planBySrcId.get(r.entry_id)
    if (!p) continue
    if (p.action === 'new' || p.action === 'dup-of-new') shelfItemsNew++
    else if (!destShelfItem.get(p.existingId!)) shelfItemsNew++
  }

  return {
    zipPath: s.zipPath,
    exportedAt: s.manifest.exportedAt,
    appVersion: s.manifest.appVersion,
    entriesNew, entriesDuplicate, entriesMissingFile,
    tagsNew, groupsNew, peopleNew, eventsNew, playsNew, volumesNew,
    shelfCategoriesNew, shelfItemsNew,
  }
}

export async function executeMerge(onProgress: (e: BackupProgressEvent) => void): Promise<MergeResult> {
  if (!session) throw new Error('No merge in progress — pick a backup archive first.')
  if (isCurrentlySyncing()) {
    throw new Error('A library sync is in progress — wait for it to finish before merging.')
  }

  const s = session
  const copiedFiles: string[] = []
  stopWatcher() // the copies below land inside the watched files/ tree

  try {
    // The destination may have changed since the preview (the app stayed live),
    // so the plan is rebuilt now, inside the stopped-watcher window.
    await analyze(s, onProgress)

    // ── Phase A: bring the files over (async, before the DB transaction) ────
    const toCopy = s.plan.filter(p => (p.action === 'new' || p.action === 'relink') && p.archivePath !== null)
    for (let i = 0; i < toCopy.length; i++) {
      const p = toCopy[i]
      const fileName = path.basename(p.src.file_path!)
      // Mirror the source library's layout (file_path is 'files/<relDir>/<name>')
      const relDir = path.posix.dirname(p.src.file_path!).replace(/^files\/?/, '')
      const destDir = path.join(getFilesPath(), relDir)
      await fs.mkdir(destDir, { recursive: true })
      const destName = await copyWithUniqueName(p.archivePath!, destDir, fileName)
      const destAbs = path.join(destDir, destName)
      copiedFiles.push(destAbs)
      p.destFilePath = path.join('files', relDir, destName).split(path.sep).join('/')

      if (p.action === 'new') {
        // Thumbnails travel too — regenerating them would redo work the source
        // machine already did. New stem per entry (same recipe as ingest), since
        // the source's stems can collide with ours.
        const stem = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
        const thumbs: { small: string | null; medium: string | null; large: string | null } =
          { small: null, medium: null, large: null }
        for (const size of ['small', 'medium', 'large'] as const) {
          const srcThumb = p.src[`thumbnail_${size}`]
          if (!srcThumb) continue
          const srcAbs = path.join(s.tmpDir, srcThumb)
          const ext = path.extname(srcThumb) || '.webp'
          const destThumbAbs = path.join(getThumbnailPath(size), `${stem}${ext}`)
          try {
            await fs.copyFile(srcAbs, destThumbAbs, fs.constants.COPYFILE_EXCL)
            copiedFiles.push(destThumbAbs)
            thumbs[size] = `thumbnails/${size}/${stem}${ext}`
          } catch { /* thumb absent from archive — a rescan can regenerate it */ }
        }
        p.destThumbs = thumbs
      }

      if (i % 20 === 0 || i === toCopy.length - 1) {
        onProgress({ phase: 'copying', completed: i + 1, total: toCopy.length, current: fileName })
      }
    }

    // ── Phase B: all DB changes in one transaction ──────────────────────────
    const result = getDb().transaction(() => runMergeTransaction(s, onProgress))()

    // ── Phase C: post-commit extras (best-effort; DB is already consistent) ─
    // Raw Spotify exports: same-named files are the same export, so EEXIST is fine.
    try {
      const spotifySrc = path.join(s.tmpDir, 'spotify')
      for (const name of await fs.readdir(spotifySrc).catch(() => [] as string[])) {
        await fs.copyFile(path.join(spotifySrc, name), path.join(getSpotifyPath(), name), fs.constants.COPYFILE_EXCL)
          .catch(() => {})
      }
    } catch { /* nothing to copy */ }

    // Journals that never had an on-disk export in the source get one here,
    // which also sets their content_hash so future merges dedupe them.
    for (const id of result.journalIdsNeedingFile) {
      await syncJournalFile(id).catch(() => {})
    }

    onProgress({ phase: 'done', completed: 1, total: 1, current: '' })
    return result.summary
  } catch (err) {
    // The transaction rolled back on its own; undo the file copies so a failed
    // merge leaves the library exactly as it was.
    for (const f of copiedFiles) await fs.rm(f, { force: true }).catch(() => {})
    throw err
  } finally {
    startWatcher()
    await disposeSession()
  }
}

function runMergeTransaction(
  s: MergeSession,
  onProgress: (e: BackupProgressEvent) => void,
): { summary: MergeResult; journalIdsNeedingFile: number[] } {
  const dest = getDb()
  const src = s.srcDb

  // 1. Volumes — matched by serial, the key the volume watcher itself uses.
  const volumeMap = new Map<number, number>()
  for (const v of src.prepare('SELECT * FROM volumes').all() as Volume[]) {
    const existing = getVolumeBySerial(v.volume_serial)
    if (existing) volumeMap.set(v.id, existing.id)
    else {
      volumeMap.set(v.id, insertVolume({
        label: v.label, volume_serial: v.volume_serial,
        last_mount_path: v.last_mount_path, last_seen_at: v.last_seen_at, created_at: v.created_at,
      }))
    }
  }

  // 2. Tags — the NOCASE-unique name is the identity.
  const tagMap = new Map<number, number>()
  let tagsCreated = 0
  const destTag = dest.prepare('SELECT id FROM tags WHERE name = ?')
  const insTag = dest.prepare('INSERT INTO tags (name) VALUES (?)')
  for (const t of src.prepare('SELECT * FROM tags').all() as { id: number; name: string }[]) {
    const hit = destTag.get(t.name) as { id: number } | undefined
    if (hit) tagMap.set(t.id, hit.id)
    else { tagMap.set(t.id, insTag.run(t.name).lastInsertRowid as number); tagsCreated++ }
  }

  // 3. Groups — parents-first so parent_id can be mapped before the children.
  // Same-name groups under the same parent merge (findOrCreateGroupPath's rule),
  // so a folder imported on both machines lands in one group.
  const groupMap = new Map<number, number>()
  let groupsCreated = 0
  const destRootGroup = dest.prepare('SELECT * FROM groups WHERE parent_id IS NULL AND name = ? COLLATE NOCASE')
  const destChildGroup = dest.prepare('SELECT * FROM groups WHERE parent_id = ? AND name = ? COLLATE NOCASE')
  const insGroup = dest.prepare(`
    INSERT INTO groups (name, parent_id, color, description, date_from, date_to, created_at)
    VALUES (@name, @parent_id, @color, @description, @date_from, @date_to, @created_at)
  `)
  const fillGroup = dest.prepare(`
    UPDATE groups SET
      description = COALESCE(description, @description),
      date_from   = COALESCE(date_from, @date_from),
      date_to     = COALESCE(date_to, @date_to)
    WHERE id = @id
  `)
  let pendingGroups = src.prepare('SELECT * FROM groups ORDER BY id').all() as Group[]
  while (pendingGroups.length > 0) {
    const next: Group[] = []
    for (const g of pendingGroups) {
      if (g.parent_id != null && !groupMap.has(g.parent_id)) { next.push(g); continue }
      const parentId = g.parent_id == null ? null : groupMap.get(g.parent_id)!
      const hit = (parentId == null ? destRootGroup.get(g.name) : destChildGroup.get(parentId, g.name)) as Group | undefined
      if (hit) {
        groupMap.set(g.id, hit.id)
        fillGroup.run({ id: hit.id, description: g.description, date_from: g.date_from, date_to: g.date_to })
      } else {
        groupMap.set(g.id, insGroup.run({
          name: g.name, parent_id: parentId, color: g.color,
          description: g.description, date_from: g.date_from, date_to: g.date_to, created_at: g.created_at,
        }).lastInsertRowid as number)
        groupsCreated++
      }
    }
    if (next.length === pendingGroups.length) break // orphaned parent_id (shouldn't happen) — drop them
    pendingGroups = next
  }

  // 4. People — matched on (name, kind); avatars are backfilled in pass 8 once
  // the entries they point at exist.
  interface PersonRow {
    id: number; kind: string; name: string; color: string
    relationship: string | null; birthday: string | null; notes: string | null
    email: string | null; phone: string | null; address: string | null
    species: string | null; breed: string | null
    avatar_entry_id: number | null; created_at: number
  }
  const peopleMap = new Map<number, number>()
  let peopleCreated = 0
  const destPerson = dest.prepare('SELECT * FROM people WHERE name = ? COLLATE NOCASE AND kind = ?')
  const insPerson = dest.prepare(`
    INSERT INTO people (kind, name, color, relationship, birthday, notes, email, phone, address, species, breed, avatar_entry_id, created_at)
    VALUES (@kind, @name, @color, @relationship, @birthday, @notes, @email, @phone, @address, @species, @breed, NULL, @created_at)
  `)
  const fillPerson = dest.prepare(`
    UPDATE people SET
      relationship = COALESCE(relationship, @relationship),
      birthday     = COALESCE(birthday, @birthday),
      notes        = COALESCE(notes, @notes),
      email        = COALESCE(email, @email),
      phone        = COALESCE(phone, @phone),
      address      = COALESCE(address, @address),
      species      = COALESCE(species, @species),
      breed        = COALESCE(breed, @breed)
    WHERE id = @id
  `)
  const srcPeople = src.prepare('SELECT * FROM people').all() as PersonRow[]
  for (const p of srcPeople) {
    const hit = destPerson.get(p.name, p.kind) as PersonRow | undefined
    if (hit) {
      peopleMap.set(p.id, hit.id)
      fillPerson.run({ id: hit.id, relationship: p.relationship, birthday: p.birthday, notes: p.notes,
        email: p.email, phone: p.phone, address: p.address, species: p.species, breed: p.breed })
    } else {
      peopleMap.set(p.id, insPerson.run({
        kind: p.kind, name: p.name, color: p.color, relationship: p.relationship,
        birthday: p.birthday, notes: p.notes, email: p.email, phone: p.phone,
        address: p.address, species: p.species, breed: p.breed, created_at: p.created_at,
      }).lastInsertRowid as number)
      peopleCreated++
    }
  }

  // 5. Entries — fresh ids for new ones; duplicates map onto their dest twin.
  const entryMap = new Map<number, number>()
  const journalIdsNeedingFile: number[] = []
  let entriesImported = 0, duplicatesSkipped = 0, missingFiles = 0
  for (let i = 0; i < s.plan.length; i++) {
    const p = s.plan[i]
    const e = p.src
    if (p.action === 'duplicate' || p.action === 'relink') {
      entryMap.set(e.id, p.existingId!)
      duplicatesSkipped++
      const destEntry = getEntry(p.existingId!)
      if (destEntry) {
        const patch: Partial<Omit<Entry, 'id'>> = {}
        if (destEntry.latitude == null && e.latitude != null) {
          patch.latitude = e.latitude
          patch.longitude = e.longitude
          patch.gps_scanned = 1
        }
        if (destEntry.group_id == null && e.group_id != null && groupMap.has(e.group_id)) {
          patch.group_id = groupMap.get(e.group_id)!
        }
        if (p.action === 'relink' && p.destFilePath) {
          patch.file_path = p.destFilePath
          patch.is_missing = 0
        }
        if (Object.keys(patch).length > 0) updateEntry(p.existingId!, patch)
      }
    } else if (p.action === 'dup-of-new') {
      // Same content as an earlier archive entry (processed already — the plan
      // is in src-id order), so it maps wherever that one landed.
      const mapped = entryMap.get(p.dupOfSrcId!)
      if (mapped != null) entryMap.set(e.id, mapped)
      duplicatesSkipped++
    } else {
      const fileMissing = e.file_path != null && p.destFilePath == null
      if (fileMissing) missingFiles++
      const newId = insertEntry({
        type: e.type,
        timestamp: e.timestamp,
        title: e.title,
        // Missing from the archive: keep the source path so relink-by-hash can
        // recover it later (e.g. when the drive it lives on is attached here).
        file_path: p.destFilePath ?? e.file_path,
        thumbnail_small: p.destThumbs?.small ?? null,
        thumbnail_medium: p.destThumbs?.medium ?? null,
        thumbnail_large: p.destThumbs?.large ?? null,
        duration_seconds: e.duration_seconds,
        rich_text_json: e.rich_text_json,
        group_id: e.group_id != null ? groupMap.get(e.group_id) ?? null : null,
        needs_date_review: e.needs_date_review,
        is_missing: fileMissing ? 1 : 0,
        content_hash: e.content_hash,
        original_file_name: e.original_file_name,
        import_mode: e.import_mode,
        volume_id: e.volume_id != null ? volumeMap.get(e.volume_id) ?? null : null,
        latitude: e.latitude,
        longitude: e.longitude,
        gps_scanned: e.gps_scanned,
        created_at: e.created_at, // when it was really added — just on the other machine
      })
      entryMap.set(e.id, newId)
      entriesImported++
      if (e.type === 'journal' && e.file_path == null) journalIdsNeedingFile.push(newId)
    }
    if (i % 100 === 0 || i === s.plan.length - 1) {
      onProgress({ phase: 'merging', completed: i + 1, total: s.plan.length, current: e.title ?? '' })
    }
  }

  // 6. Join tables — OR IGNORE + composite PKs make unions onto deduped
  // entries/groups automatic.
  const insEntryTag = dest.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')
  for (const r of src.prepare('SELECT * FROM entry_tags').all() as { entry_id: number; tag_id: number }[]) {
    const eId = entryMap.get(r.entry_id); const tId = tagMap.get(r.tag_id)
    if (eId != null && tId != null) insEntryTag.run(eId, tId)
  }
  const insEntryPerson = dest.prepare('INSERT OR IGNORE INTO entry_people (entry_id, person_id) VALUES (?, ?)')
  for (const r of src.prepare('SELECT * FROM entry_people').all() as { entry_id: number; person_id: number }[]) {
    const eId = entryMap.get(r.entry_id); const pId = peopleMap.get(r.person_id)
    if (eId != null && pId != null) insEntryPerson.run(eId, pId)
  }
  const insGroupTag = dest.prepare('INSERT OR IGNORE INTO group_tags (group_id, tag_id) VALUES (?, ?)')
  for (const r of src.prepare('SELECT * FROM group_tags').all() as { group_id: number; tag_id: number }[]) {
    const gId = groupMap.get(r.group_id); const tId = tagMap.get(r.tag_id)
    if (gId != null && tId != null) insGroupTag.run(gId, tId)
  }

  // 6b. Shelf (Books & Recipes) — categories match by (kind, name) like tags;
  // a missing one is created, reusing the source folder_name when it's free
  // and suffixing it otherwise. Items copy with OR IGNORE so a dest entry
  // already on a shelf keeps its kind/category (local wins). Files aren't
  // moved here: entries new to this library land wherever the merge copied
  // them, and recategorizing later moves them into the shelf folder.
  const shelfCatMap = new Map<number, number>()
  let shelfCategoriesCreated = 0
  const destShelfCat = dest.prepare('SELECT id FROM shelf_categories WHERE kind = ? AND name = ? COLLATE NOCASE')
  const destShelfCatByFolder = dest.prepare('SELECT id FROM shelf_categories WHERE kind = ? AND folder_name = ? COLLATE NOCASE')
  const insShelfCat = dest.prepare(`
    INSERT INTO shelf_categories (kind, name, folder_name, created_at) VALUES (?, ?, ?, ?)
  `)
  for (const c of src.prepare('SELECT * FROM shelf_categories').all() as
    { id: number; kind: string; name: string; folder_name: string; created_at: number }[]) {
    const hit = destShelfCat.get(c.kind, c.name) as { id: number } | undefined
    if (hit) { shelfCatMap.set(c.id, hit.id); continue }
    let folderName = c.folder_name
    for (let n = 2; destShelfCatByFolder.get(c.kind, folderName); n++) folderName = `${c.folder_name}_${n}`
    shelfCatMap.set(c.id, insShelfCat.run(c.kind, c.name, folderName, c.created_at).lastInsertRowid as number)
    shelfCategoriesCreated++
  }
  let shelfItemsImported = 0
  const insShelfItem = dest.prepare(`
    INSERT OR IGNORE INTO shelf_items (entry_id, kind, category_id, added_at) VALUES (?, ?, ?, ?)
  `)
  for (const r of src.prepare('SELECT * FROM shelf_items').all() as
    { entry_id: number; kind: string; category_id: number | null; added_at: number }[]) {
    const eId = entryMap.get(r.entry_id)
    if (eId == null) continue
    const cId = r.category_id != null ? shelfCatMap.get(r.category_id) ?? null : null
    shelfItemsImported += insShelfItem.run(eId, r.kind, cId, r.added_at).changes
  }

  // 7. Cross-entry references. Dedup can collapse two source entries onto one
  // destination entry, which would produce a self-reference — drop those.
  const insRef = dest.prepare('INSERT OR IGNORE INTO entry_references (entry_id, ref_entry_id) VALUES (?, ?)')
  for (const r of src.prepare('SELECT * FROM entry_references').all() as { entry_id: number; ref_entry_id: number }[]) {
    const a = entryMap.get(r.entry_id); const b = entryMap.get(r.ref_entry_id)
    if (a != null && b != null && a !== b) insRef.run(a, b)
  }

  // 8. Avatars — now that the entries they point at have ids here.
  const setAvatar = dest.prepare('UPDATE people SET avatar_entry_id = ? WHERE id = ? AND avatar_entry_id IS NULL')
  for (const p of srcPeople) {
    if (p.avatar_entry_id == null) continue
    const avatarId = entryMap.get(p.avatar_entry_id)
    const personId = peopleMap.get(p.id)
    if (avatarId != null && personId != null) setAvatar.run(avatarId, personId)
  }

  // 9. Events — no natural key, so an exact (title, date range) twin counts as
  // the same event.
  let eventsCreated = 0
  const destEvent = dest.prepare('SELECT id FROM events WHERE title = ? AND date_from = ? AND date_to IS ?')
  const insEvent = dest.prepare(`
    INSERT INTO events (title, description, color, date_from, date_to, created_at)
    VALUES (@title, @description, @color, @date_from, @date_to, @created_at)
  `)
  for (const ev of src.prepare('SELECT title, description, color, date_from, date_to, created_at FROM events').all() as
    { title: string; description: string | null; color: string; date_from: number; date_to: number | null; created_at: number }[]) {
    if (destEvent.get(ev.title, ev.date_from, ev.date_to)) continue
    insEvent.run(ev)
    eventsCreated++
  }

  // 10. Spotify plays — insertPlays already dedupes on the unique index and
  // invalidates the rollup caches; its transaction nests as a savepoint here.
  const srcPlays = src.prepare(`
    SELECT timestamp, track_name, artist_name, album_name, ms_played, media_type, spotify_uri
    FROM listening_history
  `).all() as SpotifyPlayInsert[]
  const playsInserted = srcPlays.length > 0 ? insertPlays(srcPlays) : 0

  return {
    summary: {
      entriesImported, duplicatesSkipped, missingFiles,
      tagsCreated, groupsCreated, peopleCreated, eventsCreated, playsInserted,
      shelfCategoriesCreated, shelfItemsImported,
    },
    journalIdsNeedingFile,
  }
}
