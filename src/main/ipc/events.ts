import { ipcMain } from 'electron'
import * as q from '../db/queries/events'

export function registerEventHandlers(): void {
  ipcMain.handle('events:list', () => q.listEvents())
  ipcMain.handle('events:create', (_, data) => q.createEvent(data))
  ipcMain.handle('events:update', (_, id, patch) => q.updateEvent(id, patch))
  ipcMain.handle('events:delete', (_, id) => q.deleteEvent(id))
}
