"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  ingest: {
    pickFiles: () => electron.ipcRenderer.invoke("ingest:pickFiles"),
    countFiles: (paths) => electron.ipcRenderer.invoke("ingest:countFiles", paths),
    start: (filePaths, tagNames) => electron.ipcRenderer.invoke("ingest:start", filePaths, tagNames ?? []),
    getPathForFile: (file) => electron.webUtils.getPathForFile(file),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("ingest:progress", handler);
      return () => electron.ipcRenderer.removeListener("ingest:progress", handler);
    },
    onDone: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("ingest:done", handler);
      return () => electron.ipcRenderer.removeListener("ingest:done", handler);
    }
  },
  sync: {
    run: () => electron.ipcRenderer.invoke("sync:run"),
    isSyncing: () => electron.ipcRenderer.invoke("sync:isSyncing"),
    scanDuplicates: (mode) => electron.ipcRenderer.invoke("sync:scanDuplicates", mode),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("sync:progress", handler);
      return () => electron.ipcRenderer.removeListener("sync:progress", handler);
    },
    onWatcherIngest: (cb) => {
      const handler = () => cb();
      electron.ipcRenderer.on("sync:watcherIngest", handler);
      return () => electron.ipcRenderer.removeListener("sync:watcherIngest", handler);
    }
  },
  entries: {
    histogram: (from, to, zoomLevel, groupId) => electron.ipcRenderer.invoke("entries:histogram", from, to, zoomLevel, groupId),
    forDay: (dateMs) => electron.ipcRenderer.invoke("entries:forDay", dateMs),
    forPeriod: (from, to, groupId) => electron.ipcRenderer.invoke("entries:forPeriod", from, to, groupId),
    extent: () => electron.ipcRenderer.invoke("entries:extent"),
    locations: () => electron.ipcRenderer.invoke("entries:locations"),
    search: (filters) => electron.ipcRenderer.invoke("entries:search", filters),
    listAll: (opts) => electron.ipcRenderer.invoke("entries:listAll", opts),
    get: (id) => electron.ipcRenderer.invoke("entries:get", id),
    update: (id, patch) => electron.ipcRenderer.invoke("entries:update", id, patch),
    setDate: (params) => electron.ipcRenderer.invoke("entries:setDate", params),
    delete: (ids) => electron.ipcRenderer.invoke("entries:delete", ids),
    create: (data) => electron.ipcRenderer.invoke("entries:create", data)
  },
  map: {
    hiresStatus: () => electron.ipcRenderer.invoke("map:hiresStatus"),
    getLayer: (layer) => electron.ipcRenderer.invoke("map:getLayer", layer),
    downloadHires: () => electron.ipcRenderer.invoke("map:downloadHires"),
    onDownloadProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("map:downloadProgress", handler);
      return () => electron.ipcRenderer.removeListener("map:downloadProgress", handler);
    }
  },
  groups: {
    list: () => electron.ipcRenderer.invoke("groups:list"),
    statsForPeriod: (from, to) => electron.ipcRenderer.invoke("groups:statsForPeriod", from, to),
    create: (data) => electron.ipcRenderer.invoke("groups:create", data),
    update: (id, patch) => electron.ipcRenderer.invoke("groups:update", id, patch),
    delete: (id) => electron.ipcRenderer.invoke("groups:delete", id),
    assignEntries: (groupId, entryIds) => electron.ipcRenderer.invoke("groups:assignEntries", groupId, entryIds),
    assignEntriesForPeriod: (groupId, from, to) => electron.ipcRenderer.invoke("groups:assignEntriesForPeriod", groupId, from, to)
  },
  events: {
    list: () => electron.ipcRenderer.invoke("events:list"),
    create: (data) => electron.ipcRenderer.invoke("events:create", data),
    update: (id, patch) => electron.ipcRenderer.invoke("events:update", id, patch),
    delete: (id) => electron.ipcRenderer.invoke("events:delete", id)
  },
  tags: {
    list: () => electron.ipcRenderer.invoke("tags:list"),
    create: (name) => electron.ipcRenderer.invoke("tags:create", name),
    delete: (id) => electron.ipcRenderer.invoke("tags:delete", id),
    forEntry: (entryId) => electron.ipcRenderer.invoke("tags:forEntry", entryId),
    setForEntry: (entryId, names) => electron.ipcRenderer.invoke("tags:setForEntry", entryId, names),
    addToEntries: (entryIds, names) => electron.ipcRenderer.invoke("tags:addToEntries", entryIds, names),
    forGroup: (groupId) => electron.ipcRenderer.invoke("tags:forGroup", groupId),
    setForGroup: (groupId, names) => electron.ipcRenderer.invoke("tags:setForGroup", groupId, names)
  },
  files: {
    getMediaUrl: (entryId) => electron.ipcRenderer.invoke("files:getMediaUrl", entryId),
    getFileInfo: (entryId) => electron.ipcRenderer.invoke("files:getFileInfo", entryId),
    showInFolder: (entryId) => electron.ipcRenderer.invoke("files:showInFolder", entryId),
    openDefault: (entryId) => electron.ipcRenderer.invoke("files:openDefault", entryId),
    openWith: (entryId) => electron.ipcRenderer.invoke("files:openWith", entryId)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    set: (patch) => electron.ipcRenderer.invoke("settings:set", patch),
    pickFolder: () => electron.ipcRenderer.invoke("settings:pickFolder"),
    getLibraryFileCount: () => electron.ipcRenderer.invoke("settings:getLibraryFileCount"),
    migrateLibrary: (newPath) => electron.ipcRenderer.invoke("settings:migrateLibrary", newPath),
    checkPaths: () => electron.ipcRenderer.invoke("settings:checkPaths"),
    resolveWatchedFolder: (oldPath, newPath) => electron.ipcRenderer.invoke("settings:resolveWatchedFolder", oldPath, newPath),
    relocateLibrary: (newPath) => electron.ipcRenderer.invoke("settings:relocateLibrary", newPath),
    resetLibrary: () => electron.ipcRenderer.invoke("settings:resetLibrary"),
    generateTestData: () => electron.ipcRenderer.invoke("settings:generateTestData")
  },
  backup: {
    export: (type) => electron.ipcRenderer.invoke("backup:export", type),
    pickArchive: () => electron.ipcRenderer.invoke("backup:pickArchive"),
    import: (zipPath, destDir) => electron.ipcRenderer.invoke("backup:import", zipPath, destDir),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("backup:progress", handler);
      return () => electron.ipcRenderer.removeListener("backup:progress", handler);
    }
  },
  spotify: {
    pickExport: (mode) => electron.ipcRenderer.invoke("spotify:pickExport", mode),
    import: (paths) => electron.ipcRenderer.invoke("spotify:import", paths),
    forPeriod: (from, to) => electron.ipcRenderer.invoke("spotify:forPeriod", from, to),
    topArtists: (from, to, limit) => electron.ipcRenderer.invoke("spotify:topArtists", from, to, limit ?? 50),
    histogram: (from, to, zoomLevel) => electron.ipcRenderer.invoke("spotify:histogram", from, to, zoomLevel),
    yearlySummaries: () => electron.ipcRenderer.invoke("spotify:yearlySummaries"),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("spotify:progress", handler);
      return () => electron.ipcRenderer.removeListener("spotify:progress", handler);
    }
  },
  library: {
    rescan: () => electron.ipcRenderer.invoke("library:rescan"),
    onRescanProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("library:rescanProgress", handler);
      return () => electron.ipcRenderer.removeListener("library:rescanProgress", handler);
    }
  },
  volumes: {
    list: () => electron.ipcRenderer.invoke("volumes:list"),
    refresh: () => electron.ipcRenderer.invoke("volumes:refresh"),
    matchPath: (path) => electron.ipcRenderer.invoke("volumes:matchPath", path),
    setLabel: (id, label) => electron.ipcRenderer.invoke("volumes:setLabel", id, label)
  }
});
