/// <reference types="vite/client" />

import type { IngestProgressEvent, Bucket, Group, Entry, NewGroup, EntryType, Tag, SearchFilters } from '../shared/types'

interface Api {
  ingest: {
    pickFiles: () => Promise<string[]>
    start: (filePaths: string[]) => Promise<void>
    onProgress: (cb: (event: IngestProgressEvent) => void) => () => void
  }
  entries: {
    histogram: (from: number, to: number, bucketMs: number, groupId?: number) => Promise<Bucket[]>
    forDay: (dateMs: number) => Promise<Entry[]>
    forPeriod: (from: number, to: number, groupId?: number) => Promise<Entry[]>
    extent: () => Promise<{ min: number; max: number } | null>
    search: (filters: SearchFilters) => Promise<Entry[]>
    listAll: (opts: { groupId?: number; sortBy: 'date' | 'title' | 'type'; sortDir: 'asc' | 'desc' }) => Promise<Entry[]>
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
}

declare global {
  interface Window {
    api: Api
  }
}
