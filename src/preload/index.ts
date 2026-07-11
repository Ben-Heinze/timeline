import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  IngestProgressEvent, IngestDoneEvent, SyncProgressEvent, NewGroup, Group,
  EntryType, SearchFilters, AppSettings, DuplicateGroup, FileInfo,
} from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  ingest: {
    pickFiles: (): Promise<string[]> =>
      ipcRenderer.invoke('ingest:pickFiles'),
    countFiles: (paths: string[]): Promise<number> =>
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
    search: (filters: SearchFilters) =>
      ipcRenderer.invoke('entries:search', filters),
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type' | 'tag'; sortDir: 'asc' | 'desc' }) =>
      ipcRenderer.invoke('entries:listAll', opts),
    get: (id: number) =>
      ipcRenderer.invoke('entries:get', id),
    update: (id: number, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('entries:update', id, patch),
    delete: (ids: number[]) =>
      ipcRenderer.invoke('entries:delete', ids),
    create: (data: { type: EntryType; timestamp: number; title: string | null; rich_text_json: string | null; group_id: number | null }) =>
      ipcRenderer.invoke('entries:create', data),
  },
  groups: {
    list: () =>
      ipcRenderer.invoke('groups:list'),
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
  },
})
