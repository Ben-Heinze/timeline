export type EntryType = 'photo' | 'video' | 'audio' | 'document' | 'journal'
export type ZoomLevel = 'year' | 'month' | 'day'

export interface Entry {
  id: number
  type: EntryType
  timestamp: number            // Unix ms
  title: string | null
  file_path: string | null     // Relative to library root (copy mode) or absolute path (reference mode)
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
  created_at: number
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

export interface AppSettings {
  importMode: 'copy' | 'reference'
  libraryPath: string
  watchedFolders: string[]
  duplicateScanMode: 'hash' | 'name_size'
  histogramHeight: number | null   // null = fullscreen (fills screen)
  theme: string
  heatmapScale: 'log' | 'linear'
  heatmapMaxCount: number | null   // null = auto (uses max from current year's data)
  curveTension: number             // 0 = angular, 1 = fully smooth (quadratic bezier midpoint)
  fileBrowserHeight: number
  fileBrowserMode: FileViewMode
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
