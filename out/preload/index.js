"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  ingest: {
    pickFiles: () => electron.ipcRenderer.invoke("ingest:pickFiles"),
    start: (filePaths) => electron.ipcRenderer.invoke("ingest:start", filePaths),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      electron.ipcRenderer.on("ingest:progress", handler);
      return () => electron.ipcRenderer.removeListener("ingest:progress", handler);
    }
  },
  entries: {
    histogram: (from, to, bucketMs, groupId) => electron.ipcRenderer.invoke("entries:histogram", from, to, bucketMs, groupId),
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
    assignEntries: (groupId, entryIds) => electron.ipcRenderer.invoke("groups:assignEntries", groupId, entryIds)
  },
  tags: {
    list: () => electron.ipcRenderer.invoke("tags:list"),
    create: (name) => electron.ipcRenderer.invoke("tags:create", name),
    delete: (id) => electron.ipcRenderer.invoke("tags:delete", id),
    forEntry: (entryId) => electron.ipcRenderer.invoke("tags:forEntry", entryId),
    setForEntry: (entryId, names) => electron.ipcRenderer.invoke("tags:setForEntry", entryId, names),
    forGroup: (groupId) => electron.ipcRenderer.invoke("tags:forGroup", groupId),
    setForGroup: (groupId, names) => electron.ipcRenderer.invoke("tags:setForGroup", groupId, names)
  }
});
