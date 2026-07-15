export type EntryType = 'photo' | 'video' | 'audio' | 'document' | 'journal'
export type ZoomLevel = 'year' | 'month' | 'day'

export interface Entry {
  id: number
  type: EntryType
  timestamp: number            // Unix ms
  title: string | null
  // Relative to library root (copy mode); absolute path (reference mode, no volume);
  // or relative to the volume's mount root (reference mode, volume_id set)
  file_path: string | null
  thumbnail_small: string | null
  thumbnail_medium: string | null
  thumbnail_large: string | null
  duration_seconds: number | null
  rich_text_json: string | null
  group_id: number | null
  needs_date_review: number    // 0 | 1
  is_missing: number           // 0 | 1
  content_hash: string | null
  import_mode: 'copy' | 'reference'
  volume_id: number | null          // set for reference-mode files tracked on a removable/external drive
  latitude: number | null           // decimal degrees, from photo EXIF GPS
  longitude: number | null
  gps_scanned: number               // 0 | 1 — file has been checked for GPS EXIF
  created_at: number
}

// Bulk date-correction of one or more entries.
export interface SetDateParams {
  ids: number[]
  // 'set' → `value` is an absolute epoch-ms timestamp applied to all entries.
  // 'shift' → `value` is a signed delta in ms added to each entry's timestamp.
  mode: 'set' | 'shift'
  value: number
  writeExif: boolean           // also write the date into copy-mode photo/video files
}

export interface SetDateResult {
  updated: number              // entries whose in-app date changed
  exifWritten: number          // files successfully rewritten on disk
  exifSkipped: number          // not eligible (referenced original, non-photo, missing…)
  exifFailed: number           // eligible but the write errored
}

export interface RescanProgressEvent {
  processed: number
  total: number
  current: string
}

// Result of a library rescan: a retroactive pass that backfills data for entries
// imported before newer ingest features (RAW thumbnails, RAW date/GPS reading).
export interface RescanResult {
  scanned: number         // entries examined
  reclassified: number    // documents re-typed as photos (e.g. RAW files)
  thumbnailsAdded: number // entries that gained thumbnails
  datesUpdated: number    // unconfirmed dates filled from EXIF
  gpsAdded: number        // entries that gained GPS coordinates
}

export interface WatchedFolder {
  path: string
  volumeId: number | null      // null = folder lives on the primary/always-available disk
}

export interface Volume {
  id: number
  label: string                     // user-editable, cosmetic only — not used for matching
  volume_serial: string             // OS-level identifier (filesystem UUID / Windows UniqueId) — matching key
  last_mount_path: string | null
  last_seen_at: number | null
  created_at: number
}

export interface VolumeStatus {
  id: number
  label: string
  volume_serial: string
  connected: boolean
  mountPath: string | null
}

export interface Group {
  id: number
  name: string
  parent_id: number | null
  color: string                // hex, e.g. '#E67E22'
  description: string | null
  date_from: number | null     // Unix ms — set for date-range groups
  date_to: number | null       // Unix ms exclusive — set for date-range groups
  created_at: number
}

export interface Bucket {
  bucket_start: number         // Unix ms
  group_id: number | null
  type: EntryType
  count: number
}

export interface GroupStats {
  group_id: number
  count: number                // entries in the requested period
  first_ts: number             // earliest entry timestamp in the period
  last_ts: number              // latest entry timestamp in the period
}

export interface NewGroup {
  name: string
  parent_id: number | null
  color: string
  description?: string | null
  date_from?: number | null
  date_to?: number | null
}

export interface LifeEvent {
  id: number
  title: string
  description: string | null
  color: string                // hex, e.g. '#6366f1'
  date_from: number            // Unix ms — start of first day
  date_to: number | null       // Unix ms exclusive — null = ongoing
  created_at: number
}

export interface NewLifeEvent {
  title: string
  description?: string | null
  color: string
  date_from: number
  date_to?: number | null
}

export interface Tag {
  id: number
  name: string
}

export interface SearchFilters {
  text?: string
  types?: EntryType[]
  from?: number | null
  to?: number | null
  fileName?: string
  tagIds?: number[]
}

export type FileViewMode = 'list' | 'small' | 'medium' | 'large'

// offline = bundled low-res world map (no network); online = OpenStreetMap tiles;
// hires = downloaded Natural Earth 10m data rendered locally
export type MapMode = 'offline' | 'online' | 'hires'
export type MapHiresLayer = 'countries' | 'states' | 'places'

export interface MapDownloadProgressEvent {
  received: number   // bytes downloaded so far, across all layer files
  total: number      // total bytes expected
  file: string       // file currently downloading
}

export interface AppSettings {
  libraryPath: string
  watchedFolders: WatchedFolder[]
  duplicateScanMode: 'hash' | 'name_size'
  histogramHeight: number | null   // null = fullscreen (fills screen)
  theme: string
  heatmapScale: 'log' | 'linear'
  heatmapMaxCount: number | null   // null = auto (uses max from current year's data)
  curveTension: number             // 0 = angular, 1 = fully smooth (quadratic bezier midpoint)
  fileBrowserHeight: number
  fileBrowserMode: FileViewMode
  mapMode: MapMode
}

export interface FileInfo {
  absolutePath: string
  sizeBytes: number
  modifiedMs: number
  width: number | null    // photos only
  height: number | null   // photos only
}

export interface IngestFailure {
  file: string
  error: string
}

export interface IngestProgress {
  total: number
  completed: number
  current: string
  errors: IngestFailure[]
  done: boolean
  logPath: string | null
}

export interface IngestProgressEvent {
  total: number
  completed: number
  current: string
  error?: string
}

export interface IngestDoneEvent {
  total: number
  imported: number
  failures: IngestFailure[]
  logPath: string | null
}

export interface SyncProgressEvent {
  phase: 'checking' | 'scanning' | 'ingesting' | 'done'
  checked: number
  missing: number
  recovered: number
  found: number
  ingested: number
  total: number
  current: string
  error?: string
}

export interface DuplicateGroup {
  key: string        // hash or title
  count: number
  entryIds: number[]
}

export type BackupExportType = 'full' | 'metadata'

export interface BackupManifest {
  format: 'timeline-backup'
  formatVersion: 1
  exportType: BackupExportType
  appVersion: string
  exportedAt: number           // Unix ms
  includesFiles: boolean
  counts: { entries: number; groups: number; tags: number; events: number }
}

export interface BackupProgressEvent {
  phase: 'preparing' | 'archiving' | 'extracting' | 'checking' | 'done'
  completed: number
  total: number
  current: string
}

export interface BackupExportResult {
  canceled: boolean
  path?: string
  entries?: number
  filesIncluded?: number
  skippedReferences?: string[] // absolute paths of referenced files that could not be read
}

export interface BackupImportResult {
  libraryPath: string
  exportType: BackupExportType
  entries: number
  missingFiles: number         // entries whose file is not present yet (re-sync to relink)
}

export interface SpotifyPlay {
  id: number
  timestamp: number            // Unix ms, from the play's `ts` field
  track_name: string | null
  artist_name: string | null
  album_name: string | null
  ms_played: number
  media_type: 'track' | 'episode'
  spotify_uri: string | null
  created_at: number
}

export interface SpotifyImportProgressEvent {
  processedFiles: number
  totalFiles: number
  current: string
}

export interface SpotifyImportResult {
  imported: number
  totalFiles: number
}

export interface ArtistPlaytime {
  artist_name: string
  ms_played: number
  play_count: number
}

export interface TrackPlaytime {
  track_name: string
  artist_name: string | null
  ms_played: number
  play_count: number
}

export interface ListeningBucket {
  bucket_start: number         // Unix ms, same calendar alignment as Bucket
  ms_played: number
}

export interface YearlySpotifySummary {
  year: number
  msPlayed: number
  playCount: number
  topArtists: ArtistPlaytime[] // up to 5, highest first
  topTrack: TrackPlaytime | null
  monthly: number[]            // length 12, ms_played per calendar month (Jan..Dec)
}
