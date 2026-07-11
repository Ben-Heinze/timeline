import { ipcMain } from 'electron'
import * as q from '../db/queries/tags'

export function registerTagHandlers(): void {
  ipcMain.handle('tags:list', () => q.listTags())
  ipcMain.handle('tags:create', (_, name) => q.createTag(name))
  ipcMain.handle('tags:delete', (_, id) => q.deleteTag(id))
  ipcMain.handle('tags:forEntry', (_, entryId) => q.getEntryTags(entryId))
  ipcMain.handle('tags:setForEntry', (_, entryId, names) => q.setEntryTags(entryId, names))
  ipcMain.handle('tags:addToEntries', (_, entryIds, names) => q.bulkSetEntryTags(entryIds, names))
  ipcMain.handle('tags:forGroup', (_, groupId) => q.getGroupTags(groupId))
  ipcMain.handle('tags:setForGroup', (_, groupId, names) => q.setGroupTags(groupId, names))
}
