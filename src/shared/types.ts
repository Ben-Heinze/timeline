export type EntryType = 'photo' | 'video' | 'audio' | 'document' | 'journal'
export type ZoomLevel = 'year' | 'month' | 'week' | 'day'

export interface Entry {
  id: number
  type: EntryType
  timestamp: number            // Unix ms
  title: string | null
  file_path: string | null     // Relative to library/files/
  thumbnail_small: string | null
  thumbnail_medium: string | null
  thumbnail_large: string | null
  duration_seconds: number | null
  rich_text_json: string | null
  group_id: number | null
  needs_date_review: number    // 0 | 1
  created_at: number
}

export interface Group {
  id: number
  name: string
  parent_id: number | null
  color: string                // hex, e.g. '#E67E22'
  created_at: number
}

export interface Bucket {
  bucket_start: number         // Unix ms
  group_id: number | null
  count: number
}

export interface NewGroup {
  name: string
  parent_id: number | null
  color: string
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

export interface IngestProgress {
  total: number
  completed: number
  current: string
  errors: string[]
}

export interface IngestProgressEvent {
  total: number
  completed: number
  current: string
  error?: string
}
