"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  ingest: {
    pickFiles: () => electron.ipcRenderer.invoke("ingest:pickFiles"),
    start: (filePaths, tagNames) => electron.ipcRenderer.invoke("ingest:start", filePaths, tagNames ?? []),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("ingest:progress", handler);
      return () => electron.ipcRenderer.removeListener("ingest:progress", handler);
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
    search: (filters) => electron.ipcRenderer.invoke("entries:search", filters),
    listAll: (opts) => electron.ipcRenderer.invoke("entries:listAll", opts),
    get: (id) => electron.ipcRenderer.invoke("entries:get", id),
    update: (id, patch) => electron.ipcRenderer.invoke("entries:update", id, patch),
    delete: (ids) => electron.ipcRenderer.invoke("entries:delete", ids),
    create: (data) => electron.ipcRenderer.invoke("entries:create", data)
  },
  groups: {
    list: () => electron.ipcRenderer.invoke("groups:list"),
    create: (data) => electron.ipcRenderer.invoke("groups:create", data),
    update: (id, patch) => electron.ipcRenderer.invoke("groups:update", id, patch),
    delete: (id) => electron.ipcRenderer.invoke("groups:delete", id),
    assignEntries: (groupId, entryIds) => electron.ipcRenderer.invoke("groups:assignEntries", groupId, entryIds),
    assignEntriesForPeriod: (groupId, from, to) => electron.ipcRenderer.invoke("groups:assignEntriesForPeriod", groupId, from, to)
  },
  tags: {
    list: () => electron.ipcRenderer.invoke("tags:list"),
    create: (name) => electron.ipcRenderer.invoke("tags:create", name),
    delete: (id) => electron.ipcRenderer.invoke("tags:delete", id),
    forEntry: (entryId) => electron.ipcRenderer.invoke("tags:forEntry", entryId),
    setForEntry: (entryId, names) => electron.ipcRenderer.invoke("tags:setForEntry", entryId, names),
    forGroup: (groupId) => electron.ipcRenderer.invoke("tags:forGroup", groupId),
    setForGroup: (groupId, names) => electron.ipcRenderer.invoke("tags:setForGroup", groupId, names)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    set: (patch) => electron.ipcRenderer.invoke("settings:set", patch),
    pickFolder: () => electron.ipcRenderer.invoke("settings:pickFolder"),
    getLibraryFileCount: () => electron.ipcRenderer.invoke("settings:getLibraryFileCount"),
    migrateLibrary: (newPath) => electron.ipcRenderer.invoke("settings:migrateLibrary", newPath),
    checkPaths: () => electron.ipcRenderer.invoke("settings:checkPaths"),
    resolveWatchedFolder: (oldPath, newPath) => electron.ipcRenderer.invoke("settings:resolveWatchedFolder", oldPath, newPath),
    relocateLibrary: (newPath) => electron.ipcRenderer.invoke("settings:relocateLibrary", newPath)
  }
});
