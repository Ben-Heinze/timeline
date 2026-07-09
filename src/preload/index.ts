import { contextBridge, ipcRenderer } from 'electron'
import type { IngestProgressEvent, NewGroup, Group, EntryType, SearchFilters } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  ingest: {
    pickFiles: (): Promise<string[]> =>
      ipcRenderer.invoke('ingest:pickFiles'),
    start: (filePaths: string[]) =>
      ipcRenderer.invoke('ingest:start', filePaths),
    onProgress: (cb: (event: IngestProgressEvent) => void) => {
      const handler = (_: unknown, data: IngestProgressEvent) => cb(data)
      ipcRenderer.on('ingest:progress', handler)
      return () => ipcRenderer.removeListener('ingest:progress', handler)
    },
  },
  entries: {
    histogram: (from: number, to: number, bucketMs: number, groupId?: number) =>
      ipcRenderer.invoke('entries:histogram', from, to, bucketMs, groupId),
    forDay: (dateMs: number) =>
      ipcRenderer.invoke('entries:forDay', dateMs),
    forPeriod: (from: number, to: number, groupId?: number) =>
      ipcRenderer.invoke('entries:forPeriod', from, to, groupId),
    extent: () =>
      ipcRenderer.invoke('entries:extent'),
    search: (filters: SearchFilters) =>
      ipcRenderer.invoke('entries:search', filters),
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type'; sortDir: 'asc' | 'desc' }) =>
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
    forGroup: (groupId: number) =>
      ipcRenderer.invoke('tags:forGroup', groupId),
    setForGroup: (groupId: number, names: string[]) =>
      ipcRenderer.invoke('tags:setForGroup', groupId, names),
  },
})
