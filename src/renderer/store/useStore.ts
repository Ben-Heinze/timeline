import { create } from 'zustand'
import type { AppSettings, Bucket, Group, IngestProgress, Entry, ZoomLevel, Tag, SyncProgressEvent, LifeEvent, VolumeStatus, YearlySpotifySummary, SearchFilters } from '../../shared/types'

interface TimelineStore {
  tags: Tag[]
  setTags: (tags: Tag[]) => void
  volumes: VolumeStatus[]
  setVolumes: (volumes: VolumeStatus[]) => void
  // The active search's filters, not its results — SearchResults fetches its own
  // paged results so a search matching huge numbers of entries doesn't hold them
  // all in the store at once.
  searchFilters: SearchFilters | null
  setSearchFilters: (filters: SearchFilters | null) => void
  visibleRange: [number, number]
  zoomLevel: ZoomLevel
  activeView: 'timeline' | 'calendar' | 'map' | 'files' | 'spotify' | 'settings'
  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
  histogramBuckets: Bucket[]
  groups: Group[]
  selectedIds: Set<number>
  lastSelectedId: number | null
  activeEntryId: number | null
  selectedPeriod: [number, number] | null
  selectedLocation: Entry[] | null
  fileBrowserOpen: boolean
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
  setActiveView: (view: 'timeline' | 'calendar' | 'map' | 'files' | 'spotify' | 'settings') => void
  setHistogramBuckets: (buckets: Bucket[]) => void
  setGroups: (groups: Group[]) => void
  setSelection: (ids: Set<number>, lastId: number | null) => void
  setActiveEntryId: (id: number | null) => void
  setSelectedPeriod: (period: [number, number] | null) => void
  setSelectedLocation: (entries: Entry[] | null) => void
  setFileBrowserOpen: (open: boolean) => void
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

  events: LifeEvent[]
  setEvents: (events: LifeEvent[]) => void
  eventsPanelOpen: boolean
  setEventsPanelOpen: (open: boolean) => void
  spotifyPanelOpen: boolean
  setSpotifyPanelOpen: (open: boolean) => void
  // Cached yearly recaps so the Spotify tab doesn't refetch (and re-run the heavy
  // main-process aggregation) every time it remounts. spotifySummariesKey records the
  // refreshKey the cache was built at, so an import (which bumps refreshKey) refreshes it.
  spotifySummaries: YearlySpotifySummary[] | null
  spotifySummariesKey: number | null
  setSpotifySummaries: (summaries: YearlySpotifySummary[], key: number) => void
  selectedSpotifyYear: number | null
  setSelectedSpotifyYear: (year: number | null) => void
  groupSidebarOpen: boolean
  setGroupSidebarOpen: (open: boolean) => void
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  eventModalOpen: boolean
  eventEditEvent: LifeEvent | null
  eventModalDefaults: [number, number] | null   // [from, to) prefill for a new event
  openEventModal: (event?: LifeEvent | null, defaults?: [number, number] | null) => void
  closeEventModal: () => void
}

const now = Date.now()
const fiveYearsAgo = now - 5 * 365.25 * 24 * 60 * 60 * 1000

export const useStore = create<TimelineStore>((set) => ({
  visibleRange: [fiveYearsAgo, now],
  zoomLevel: 'year' as ZoomLevel,
  activeView: 'timeline' as 'timeline' | 'calendar' | 'map' | 'files' | 'spotify' | 'settings',
  settings: null,
  histogramBuckets: [],
  groups: [],
  selectedIds: new Set(),
  lastSelectedId: null,
  activeEntryId: null,
  selectedPeriod: null,
  selectedLocation: null,
  fileBrowserOpen: false,
  selectedGroupId: null,
  dataExtent: null,
  ingestProgress: null,
  syncProgress: null,
  refreshKey: 0,
  tags: [],
  volumes: [],
  searchFilters: null,
  rangeSelectMode: false,
  dateRangeSelection: null,
  pendingDateRange: null,
  setTags: (tags) => set({ tags }),
  setVolumes: (volumes) => set({ volumes }),
  setSearchFilters: (filters) => set({ searchFilters: filters }),

  setVisibleRange: (range) => set({ visibleRange: range }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setActiveView: (view) => set({ activeView: view }),
  setSettings: (s) => set({ settings: s }),
  setHistogramBuckets: (buckets) => set({ histogramBuckets: buckets }),
  setGroups: (groups) => set({ groups }),
  setSelection: (ids, lastId) => set({ selectedIds: ids, lastSelectedId: lastId }),
  setActiveEntryId: (id) => set({ activeEntryId: id }),
  setSelectedPeriod: (period) => set(period !== null ? { selectedPeriod: period, selectedLocation: null } : { selectedPeriod: period }),
  setSelectedLocation: (entries) => set(entries !== null ? { selectedLocation: entries, selectedPeriod: null } : { selectedLocation: entries }),
  setFileBrowserOpen: (open) => set({ fileBrowserOpen: open }),
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

  events: [],
  setEvents: (events) => set({ events }),
  eventsPanelOpen: true,
  setEventsPanelOpen: (open) => set({ eventsPanelOpen: open }),
  spotifyPanelOpen: false,
  setSpotifyPanelOpen: (open) => set({ spotifyPanelOpen: open }),
  spotifySummaries: null,
  spotifySummariesKey: null,
  setSpotifySummaries: (summaries, key) => set({ spotifySummaries: summaries, spotifySummariesKey: key }),
  selectedSpotifyYear: null,
  setSelectedSpotifyYear: (year) => set({ selectedSpotifyYear: year }),
  groupSidebarOpen: true,
  setGroupSidebarOpen: (open) => set({ groupSidebarOpen: open }),
  focusedEventId: null,
  setFocusedEventId: (id) => set({ focusedEventId: id }),
  eventModalOpen: false,
  eventEditEvent: null,
  eventModalDefaults: null,
  openEventModal: (event, defaults) => set({ eventModalOpen: true, eventEditEvent: event ?? null, eventModalDefaults: defaults ?? null }),
  closeEventModal: () => set({ eventModalOpen: false, eventEditEvent: null, eventModalDefaults: null }),
}))
