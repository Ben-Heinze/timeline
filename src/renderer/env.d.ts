/// <reference types="vite/client" />

import type {
  IngestProgressEvent, IngestDoneEvent, SyncProgressEvent, Bucket, Group, GroupStats, Entry, NewGroup,
  EntryType, Tag, SearchFilters, AppSettings, DuplicateGroup, FileInfo,
  LifeEvent, NewLifeEvent,
  BackupExportType, BackupExportResult, BackupImportResult, BackupProgressEvent,
  MapHiresLayer, MapDownloadProgressEvent,
  SpotifyPlay, SpotifyImportProgressEvent, SpotifyImportResult, ArtistPlaytime,
  ListeningBucket, YearlySpotifySummary, YearDetail, VolumeStatus,
  SetDateParams, SetDateResult, RescanProgressEvent, RescanResult,
} from '../shared/types'

interface Api {
  ingest: {
    pickFiles: (mode?: 'files' | 'folder') => Promise<string[]>
    countFiles: (paths: string[]) => Promise<number>
    start: (filePaths: string[], tagNames?: string[]) => Promise<void>
    getPathForFile: (file: File) => string
    onProgress: (cb: (event: IngestProgressEvent) => void) => () => void
    onDone: (cb: (event: IngestDoneEvent) => void) => () => void
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
    locations: () => Promise<Entry[]>
    search: (filters: SearchFilters) => Promise<Entry[]>
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type' | 'tag'; sortDir: 'asc' | 'desc' }) => Promise<Entry[]>
    get: (id: number) => Promise<Entry | null>
    update: (id: number, patch: Record<string, unknown>) => Promise<void>
    setDate: (params: SetDateParams) => Promise<SetDateResult>
    delete: (ids: number[]) => Promise<void>
    create: (data: { type: EntryType; timestamp: number; title: string | null; rich_text_json: string | null; group_id: number | null }) => Promise<number>
  }
  map: {
    hiresStatus: () => Promise<{ downloaded: boolean; downloading: boolean }>
    getLayer: (layer: MapHiresLayer) => Promise<string | null>
    downloadHires: () => Promise<void>
    onDownloadProgress: (cb: (event: MapDownloadProgressEvent) => void) => () => void
  }
  groups: {
    list: () => Promise<Group[]>
    statsForPeriod: (from: number, to: number) => Promise<GroupStats[]>
    dateRange: (groupId: number) => Promise<{ from: number; to: number } | null>
    create: (data: NewGroup) => Promise<Group>
    update: (id: number, patch: Partial<Omit<Group, 'id'>>) => Promise<Group>
    delete: (id: number) => Promise<void>
    assignEntries: (groupId: number | null, entryIds: number[]) => Promise<void>
    assignEntriesForPeriod: (groupId: number, from: number, to: number) => Promise<number>
  }
  events: {
    list: () => Promise<LifeEvent[]>
    create: (data: NewLifeEvent) => Promise<LifeEvent>
    update: (id: number, patch: Partial<Omit<LifeEvent, 'id'>>) => Promise<LifeEvent>
    delete: (id: number) => Promise<void>
  }
  tags: {
    list: () => Promise<Tag[]>
    create: (name: string) => Promise<Tag>
    delete: (id: number) => Promise<void>
    forEntry: (entryId: number) => Promise<Tag[]>
    setForEntry: (entryId: number, names: string[]) => Promise<Tag[]>
    addToEntries: (entryIds: number[], names: string[]) => Promise<void>
    forGroup: (groupId: number) => Promise<Tag[]>
    setForGroup: (groupId: number, names: string[]) => Promise<Tag[]>
  }
  files: {
    getMediaUrl: (entryId: number) => Promise<string | null>
    getFileInfo: (entryId: number) => Promise<FileInfo | null>
    showInFolder: (entryId: number) => Promise<void>
    openDefault: (entryId: number) => Promise<string>
    openWith: (entryId: number) => Promise<string>
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
    resetLibrary: () => Promise<{ success: boolean }>
    generateTestData: () => Promise<{ entries: number; tags: number; denseDays: number; located: number; groups: number }>
  }
  backup: {
    export: (type: BackupExportType) => Promise<BackupExportResult>
    pickArchive: () => Promise<string | null>
    import: (zipPath: string, destDir: string) => Promise<BackupImportResult>
    onProgress: (cb: (event: BackupProgressEvent) => void) => () => void
  }
  library: {
    rescan: () => Promise<RescanResult>
    onRescanProgress: (cb: (event: RescanProgressEvent) => void) => () => void
  }
  spotify: {
    pickExport: (mode?: 'files' | 'folder') => Promise<string[]>
    import: (paths: string[]) => Promise<SpotifyImportResult>
    forPeriod: (from: number, to: number) => Promise<SpotifyPlay[]>
    topArtists: (from: number, to: number, limit?: number) => Promise<ArtistPlaytime[]>
    histogram: (from: number, to: number, zoomLevel: string) => Promise<ListeningBucket[]>
    yearlySummaries: () => Promise<YearlySpotifySummary[]>
    yearDetail: (year: number) => Promise<YearDetail | null>
    artistMonthlyForYear: (year: number, artistName: string) => Promise<number[]>
    onProgress: (cb: (event: SpotifyImportProgressEvent) => void) => () => void
  }
  volumes: {
    list: () => Promise<VolumeStatus[]>
    refresh: () => Promise<VolumeStatus[]>
    matchPath: (path: string) => Promise<{ volumeId: number | null; osLabel: string | null }>
    setLabel: (id: number, label: string) => Promise<void>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
