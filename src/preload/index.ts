import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  IngestProgressEvent, IngestDoneEvent, SyncProgressEvent, NewGroup, Group,
  EntryType, SearchFilters, AppSettings, DuplicateGroup, FileInfo,
  LifeEvent, NewLifeEvent,
  BackupExportType, BackupExportResult, BackupImportResult, BackupProgressEvent,
  MapHiresLayer, MapDownloadProgressEvent,
  SpotifyPlay, SpotifyImportProgressEvent, SpotifyImportResult, ArtistPlaytime,
  ListeningBucket, YearlySpotifySummary, YearDetail, VolumeStatus,
  SetDateParams, RescanProgressEvent, RescanResult, ImportPreview, PageParams, MonthBucket, Entry,
} from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  ingest: {
    pickFiles: (mode?: 'files' | 'folder'): Promise<string[]> =>
      ipcRenderer.invoke('ingest:pickFiles', mode),
    countFiles: (paths: string[]): Promise<ImportPreview> =>
      ipcRenderer.invoke('ingest:countFiles', paths),
    start: (filePaths: string[], tagNames?: string[]) =>
      ipcRenderer.invoke('ingest:start', filePaths, tagNames ?? []),
    getPathForFile: (file: File): string =>
      webUtils.getPathForFile(file),
    onProgress: (cb: (event: IngestProgressEvent) => void) => {
      const handler = (_: unknown, data: IngestProgressEvent) => cb(data)
      ipcRenderer.on('ingest:progress', handler)
      return () => ipcRenderer.removeListener('ingest:progress', handler)
    },
    onDone: (cb: (event: IngestDoneEvent) => void) => {
      const handler = (_: unknown, data: IngestDoneEvent) => cb(data)
      ipcRenderer.on('ingest:done', handler)
      return () => ipcRenderer.removeListener('ingest:done', handler)
    },
  },
  sync: {
    run: (): Promise<void> =>
      ipcRenderer.invoke('sync:run'),
    isSyncing: (): Promise<boolean> =>
      ipcRenderer.invoke('sync:isSyncing'),
    scanDuplicates: (mode: 'hash' | 'name_size'): Promise<DuplicateGroup[]> =>
      ipcRenderer.invoke('sync:scanDuplicates', mode),
    onProgress: (cb: (event: SyncProgressEvent) => void) => {
      const handler = (_: unknown, data: SyncProgressEvent) => cb(data)
      ipcRenderer.on('sync:progress', handler)
      return () => ipcRenderer.removeListener('sync:progress', handler)
    },
    onWatcherIngest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('sync:watcherIngest', handler)
      return () => ipcRenderer.removeListener('sync:watcherIngest', handler)
    },
  },
  entries: {
    histogram: (from: number, to: number, zoomLevel: string, groupId?: number) =>
      ipcRenderer.invoke('entries:histogram', from, to, zoomLevel, groupId),
    forDay: (dateMs: number) =>
      ipcRenderer.invoke('entries:forDay', dateMs),
    forPeriod: (from: number, to: number, groupId?: number) =>
      ipcRenderer.invoke('entries:forPeriod', from, to, groupId),
    extent: () =>
      ipcRenderer.invoke('entries:extent'),
    locations: () =>
      ipcRenderer.invoke('entries:locations'),
    search: (filters: SearchFilters, page: PageParams): Promise<Entry[]> =>
      ipcRenderer.invoke('entries:search', filters, page),
    searchCount: (filters: SearchFilters): Promise<number> =>
      ipcRenderer.invoke('entries:searchCount', filters),
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type' | 'tag'; sortDir: 'asc' | 'desc' } & PageParams): Promise<Entry[]> =>
      ipcRenderer.invoke('entries:listAll', opts),
    listAllCount: (opts: { groupId?: number }): Promise<number> =>
      ipcRenderer.invoke('entries:listAllCount', opts),
    monthBuckets: (opts: { groupId?: number; sortDir: 'asc' | 'desc' }): Promise<MonthBucket[]> =>
      ipcRenderer.invoke('entries:monthBuckets', opts),
    get: (id: number) =>
      ipcRenderer.invoke('entries:get', id),
    update: (id: number, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('entries:update', id, patch),
    setDate: (params: SetDateParams) =>
      ipcRenderer.invoke('entries:setDate', params),
    delete: (ids: number[]) =>
      ipcRenderer.invoke('entries:delete', ids),
    create: (data: { type: EntryType; timestamp: number; title: string | null; rich_text_json: string | null; group_id: number | null }) =>
      ipcRenderer.invoke('entries:create', data),
  },
  map: {
    hiresStatus: (): Promise<{ downloaded: boolean; downloading: boolean }> =>
      ipcRenderer.invoke('map:hiresStatus'),
    getLayer: (layer: MapHiresLayer): Promise<string | null> =>
      ipcRenderer.invoke('map:getLayer', layer),
    downloadHires: (): Promise<void> =>
      ipcRenderer.invoke('map:downloadHires'),
    onDownloadProgress: (cb: (event: MapDownloadProgressEvent) => void) => {
      const handler = (_: unknown, data: MapDownloadProgressEvent) => cb(data)
      ipcRenderer.on('map:downloadProgress', handler)
      return () => ipcRenderer.removeListener('map:downloadProgress', handler)
    },
  },
  groups: {
    list: () =>
      ipcRenderer.invoke('groups:list'),
    statsForPeriod: (from: number, to: number) =>
      ipcRenderer.invoke('groups:statsForPeriod', from, to),
    dateRange: (groupId: number): Promise<{ from: number; to: number } | null> =>
      ipcRenderer.invoke('groups:dateRange', groupId),
    create: (data: NewGroup) =>
      ipcRenderer.invoke('groups:create', data),
    update: (id: number, patch: Partial<Omit<Group, 'id'>>) =>
      ipcRenderer.invoke('groups:update', id, patch),
    delete: (id: number) =>
      ipcRenderer.invoke('groups:delete', id),
    assignEntries: (groupId: number | null, entryIds: number[]) =>
      ipcRenderer.invoke('groups:assignEntries', groupId, entryIds),
    assignEntriesForPeriod: (groupId: number, from: number, to: number): Promise<number> =>
      ipcRenderer.invoke('groups:assignEntriesForPeriod', groupId, from, to),
  },
  events: {
    list: (): Promise<LifeEvent[]> =>
      ipcRenderer.invoke('events:list'),
    create: (data: NewLifeEvent): Promise<LifeEvent> =>
      ipcRenderer.invoke('events:create', data),
    update: (id: number, patch: Partial<Omit<LifeEvent, 'id'>>): Promise<LifeEvent> =>
      ipcRenderer.invoke('events:update', id, patch),
    delete: (id: number): Promise<void> =>
      ipcRenderer.invoke('events:delete', id),
  },
  tags: {
    list: () =>
      ipcRenderer.invoke('tags:list'),
    create: (name: string) =>
      ipcRenderer.invoke('tags:create', name),
    delete: (id: number) =>
      ipcRenderer.invoke('tags:delete', id),
    forEntry: (entryId: number) =>
      ipcRenderer.invoke('tags:forEntry', entryId),
    setForEntry: (entryId: number, names: string[]) =>
      ipcRenderer.invoke('tags:setForEntry', entryId, names),
    addToEntries: (entryIds: number[], names: string[]) =>
      ipcRenderer.invoke('tags:addToEntries', entryIds, names),
    forGroup: (groupId: number) =>
      ipcRenderer.invoke('tags:forGroup', groupId),
    setForGroup: (groupId: number, names: string[]) =>
      ipcRenderer.invoke('tags:setForGroup', groupId, names),
  },
  files: {
    getMediaUrl: (entryId: number): Promise<string | null> =>
      ipcRenderer.invoke('files:getMediaUrl', entryId),
    getFileInfo: (entryId: number): Promise<FileInfo | null> =>
      ipcRenderer.invoke('files:getFileInfo', entryId),
    showInFolder: (entryId: number): Promise<void> =>
      ipcRenderer.invoke('files:showInFolder', entryId),
    openDefault: (entryId: number): Promise<string> =>
      ipcRenderer.invoke('files:openDefault', entryId),
    openWith: (entryId: number): Promise<string> =>
      ipcRenderer.invoke('files:openWith', entryId),
  },
  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Omit<AppSettings, 'libraryPath'>>) =>
      ipcRenderer.invoke('settings:set', patch),
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('settings:pickFolder'),
    getLibraryFileCount: (): Promise<number> =>
      ipcRenderer.invoke('settings:getLibraryFileCount'),
    migrateLibrary: (newPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('settings:migrateLibrary', newPath),
    checkPaths: (): Promise<{ libraryExists: boolean; watchedFolders: { path: string; exists: boolean }[] }> =>
      ipcRenderer.invoke('settings:checkPaths'),
    resolveWatchedFolder: (oldPath: string, newPath: string): Promise<{ found: number; total: number }> =>
      ipcRenderer.invoke('settings:resolveWatchedFolder', oldPath, newPath),
    relocateLibrary: (newPath: string): Promise<{ found: number; total: number }> =>
      ipcRenderer.invoke('settings:relocateLibrary', newPath),
    resetLibrary: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('settings:resetLibrary'),
    generateTestData: (): Promise<{ entries: number; tags: number; denseDays: number; located: number; groups: number }> =>
      ipcRenderer.invoke('settings:generateTestData'),
  },
  backup: {
    export: (type: BackupExportType): Promise<BackupExportResult> =>
      ipcRenderer.invoke('backup:export', type),
    pickArchive: (): Promise<string | null> =>
      ipcRenderer.invoke('backup:pickArchive'),
    import: (zipPath: string, destDir: string): Promise<BackupImportResult> =>
      ipcRenderer.invoke('backup:import', zipPath, destDir),
    onProgress: (cb: (event: BackupProgressEvent) => void) => {
      const handler = (_: unknown, data: BackupProgressEvent) => cb(data)
      ipcRenderer.on('backup:progress', handler)
      return () => ipcRenderer.removeListener('backup:progress', handler)
    },
  },
  spotify: {
    pickExport: (mode?: 'files' | 'folder'): Promise<string[]> =>
      ipcRenderer.invoke('spotify:pickExport', mode),
    import: (paths: string[]): Promise<SpotifyImportResult> =>
      ipcRenderer.invoke('spotify:import', paths),
    forPeriod: (from: number, to: number): Promise<SpotifyPlay[]> =>
      ipcRenderer.invoke('spotify:forPeriod', from, to),
    topArtists: (from: number, to: number, limit?: number): Promise<ArtistPlaytime[]> =>
      ipcRenderer.invoke('spotify:topArtists', from, to, limit ?? 50),
    histogram: (from: number, to: number, zoomLevel: string): Promise<ListeningBucket[]> =>
      ipcRenderer.invoke('spotify:histogram', from, to, zoomLevel),
    yearlySummaries: (): Promise<YearlySpotifySummary[]> =>
      ipcRenderer.invoke('spotify:yearlySummaries'),
    yearDetail: (year: number): Promise<YearDetail | null> =>
      ipcRenderer.invoke('spotify:yearDetail', year),
    artistMonthlyForYear: (year: number, artistName: string): Promise<number[]> =>
      ipcRenderer.invoke('spotify:artistMonthlyForYear', year, artistName),
    onProgress: (cb: (event: SpotifyImportProgressEvent) => void) => {
      const handler = (_: unknown, data: SpotifyImportProgressEvent) => cb(data)
      ipcRenderer.on('spotify:progress', handler)
      return () => ipcRenderer.removeListener('spotify:progress', handler)
    },
  },
  library: {
    rescan: (): Promise<RescanResult> =>
      ipcRenderer.invoke('library:rescan'),
    onRescanProgress: (cb: (event: RescanProgressEvent) => void) => {
      const handler = (_: unknown, data: RescanProgressEvent) => cb(data)
      ipcRenderer.on('library:rescanProgress', handler)
      return () => ipcRenderer.removeListener('library:rescanProgress', handler)
    },
  },
  volumes: {
    list: (): Promise<VolumeStatus[]> =>
      ipcRenderer.invoke('volumes:list'),
    refresh: (): Promise<VolumeStatus[]> =>
      ipcRenderer.invoke('volumes:refresh'),
    matchPath: (path: string): Promise<{ volumeId: number | null; osLabel: string | null }> =>
      ipcRenderer.invoke('volumes:matchPath', path),
    setLabel: (id: number, label: string): Promise<void> =>
      ipcRenderer.invoke('volumes:setLabel', id, label),
  },
})
