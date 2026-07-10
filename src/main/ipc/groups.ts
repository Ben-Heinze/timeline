import { ipcMain } from 'electron'
import * as q from '../db/queries/groups'

export function registerGroupHandlers(): void {
  ipcMain.handle('groups:list', () => q.listGroups())
  ipcMain.handle('groups:create', (_, data) => q.createGroup(data))
  ipcMain.handle('groups:update', (_, id, patch) => q.updateGroup(id, patch))
  ipcMain.handle('groups:delete', (_, id) => q.deleteGroup(id))
  ipcMain.handle('groups:assignEntries', (_, groupId, entryIds) =>
    q.assignEntriesToGroup(groupId, entryIds))
  ipcMain.handle('groups:assignEntriesForPeriod', (_, groupId, from, to) =>
    q.assignEntriesForPeriod(groupId, from, to))
}
