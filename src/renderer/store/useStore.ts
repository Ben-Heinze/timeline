import { create } from 'zustand'
import type { AppSettings, Bucket, Group, IngestProgress, Entry, ZoomLevel, Tag, SyncProgressEvent } from '../../shared/types'

interface TimelineStore {
  tags: Tag[]
  setTags: (tags: Tag[]) => void
  searchResults: Entry[] | null
  setSearchResults: (results: Entry[] | null) => void
  visibleRange: [number, number]
  zoomLevel: ZoomLevel
  activeView: 'timeline' | 'calendar' | 'files' | 'settings'
  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
  histogramBuckets: Bucket[]
  groups: Group[]
  selectedIds: Set<number>
  lastSelectedId: number | null
  activeEntryId: number | null
  selectedPeriod: [number, number] | null
  selectedGroupId: number | null
  dataExtent: [number, number] | null
  ingestProgress: IngestProgress | null
  syncProgress: SyncProgressEvent | null
  refreshKey: number

  rangeSelectMode: boolean
  dateRangeSelection: [number, number] | null
  pendingDateRange: [number, number] | null

  setVisibleRange: (range: [number, number]) => void
  setZoomLevel: (level: ZoomLevel) => void
  setActiveView: (view: 'timeline' | 'calendar' | 'files' | 'settings') => void
  setHistogramBuckets: (buckets: Bucket[]) => void
  setGroups: (groups: Group[]) => void
  setSelection: (ids: Set<number>, lastId: number | null) => void
  setActiveEntryId: (id: number | null) => void
  setSelectedPeriod: (period: [number, number] | null) => void
  setSelectedGroupId: (id: number | null) => void
  setDataExtent: (extent: [number, number] | null) => void
  setIngestProgress: (progress: IngestProgress | null) => void
  setSyncProgress: (progress: SyncProgressEvent | null) => void
  bumpRefreshKey: () => void
  setRangeSelectMode: (on: boolean) => void
  setDateRangeSelection: (r: [number, number] | null) => void
  setPendingDateRange: (r: [number, number] | null) => void
  journalModalOpen: boolean
  journalEditEntry: Entry | null
  openJournalModal: (entry?: Entry | null) => void
  closeJournalModal: () => void
}

const now = Date.now()
const fiveYearsAgo = now - 5 * 365.25 * 24 * 60 * 60 * 1000

export const useStore = create<TimelineStore>((set) => ({
  visibleRange: [fiveYearsAgo, now],
  zoomLevel: 'year' as ZoomLevel,
  activeView: 'timeline' as 'timeline' | 'calendar' | 'files' | 'settings',
  settings: null,
  histogramBuckets: [],
  groups: [],
  selectedIds: new Set(),
  lastSelectedId: null,
  activeEntryId: null,
  selectedPeriod: null,
  selectedGroupId: null,
  dataExtent: null,
  ingestProgress: null,
  syncProgress: null,
  refreshKey: 0,
  tags: [],
  searchResults: null,
  rangeSelectMode: false,
  dateRangeSelection: null,
  pendingDateRange: null,
  setTags: (tags) => set({ tags }),
  setSearchResults: (results) => set({ searchResults: results }),

  setVisibleRange: (range) => set({ visibleRange: range }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setActiveView: (view) => set({ activeView: view }),
  setSettings: (s) => set({ settings: s }),
  setHistogramBuckets: (buckets) => set({ histogramBuckets: buckets }),
  setGroups: (groups) => set({ groups }),
  setSelection: (ids, lastId) => set({ selectedIds: ids, lastSelectedId: lastId }),
  setActiveEntryId: (id) => set({ activeEntryId: id }),
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),
  setDataExtent: (extent) => set({ dataExtent: extent }),
  setIngestProgress: (progress) => set({ ingestProgress: progress }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  bumpRefreshKey: () => set(s => ({ refreshKey: s.refreshKey + 1 })),
  setRangeSelectMode: (on) => set({ rangeSelectMode: on }),
  setDateRangeSelection: (r) => set({ dateRangeSelection: r }),
  setPendingDateRange: (r) => set({ pendingDateRange: r }),
  journalModalOpen: false,
  journalEditEntry: null,
  openJournalModal: (entry) => set({ journalModalOpen: true, journalEditEntry: entry ?? null }),
  closeJournalModal: () => set({ journalModalOpen: false, journalEditEntry: null }),
}))
