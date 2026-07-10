/// <reference types="vite/client" />

import type {
  IngestProgressEvent, SyncProgressEvent, Bucket, Group, Entry, NewGroup,
  EntryType, Tag, SearchFilters, AppSettings, DuplicateGroup,
} from '../shared/types'

interface Api {
  ingest: {
    pickFiles: () => Promise<string[]>
    start: (filePaths: string[], tagNames?: string[]) => Promise<void>
    onProgress: (cb: (event: IngestProgressEvent) => void) => () => void
  }
  sync: {
    run: () => Promise<void>
    isSyncing: () => Promise<boolean>
    scanDuplicates: (mode: 'hash' | 'name_size') => Promise<DuplicateGroup[]>
    onProgress: (cb: (event: SyncProgressEvent) => void) => () => void
    onWatcherIngest: (cb: () => void) => () => void
  }
  entries: {
    histogram: (from: number, to: number, zoomLevel: string, groupId?: number) => Promise<Bucket[]>
    forDay: (dateMs: number) => Promise<Entry[]>
    forPeriod: (from: number, to: number, groupId?: number) => Promise<Entry[]>
    extent: () => Promise<{ min: number; max: number } | null>
    search: (filters: SearchFilters) => Promise<Entry[]>
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type' | 'tag'; sortDir: 'asc' | 'desc' }) => Promise<Entry[]>
    get: (id: number) => Promise<Entry | null>
    update: (id: number, patch: Record<string, unknown>) => Promise<void>
    delete: (ids: number[]) => Promise<void>
    create: (data: { type: EntryType; timestamp: number; title: string | null; rich_text_json: string | null; group_id: number | null }) => Promise<number>
  }
  groups: {
    list: () => Promise<Group[]>
    create: (data: NewGroup) => Promise<Group>
    update: (id: number, patch: Partial<Omit<Group, 'id'>>) => Promise<Group>
    delete: (id: number) => Promise<void>
    assignEntries: (groupId: number | null, entryIds: number[]) => Promise<void>
    assignEntriesForPeriod: (groupId: number, from: number, to: number) => Promise<number>
  }
  tags: {
    list: () => Promise<Tag[]>
    create: (name: string) => Promise<Tag>
    delete: (id: number) => Promise<void>
    forEntry: (entryId: number) => Promise<Tag[]>
    setForEntry: (entryId: number, names: string[]) => Promise<Tag[]>
    forGroup: (groupId: number) => Promise<Tag[]>
    setForGroup: (groupId: number, names: string[]) => Promise<Tag[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<Omit<AppSettings, 'libraryPath'>>) => Promise<void>
    pickFolder: () => Promise<string | null>
    getLibraryFileCount: () => Promise<number>
    migrateLibrary: (newPath: string) => Promise<{ success: boolean }>
    checkPaths: () => Promise<{ libraryExists: boolean; watchedFolders: { path: string; exists: boolean }[] }>
    resolveWatchedFolder: (oldPath: string, newPath: string) => Promise<{ found: number; total: number }>
    relocateLibrary: (newPath: string) => Promise<{ found: number; total: number }>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
