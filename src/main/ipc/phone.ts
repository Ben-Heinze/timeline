import { ipcMain } from 'electron'
import { startPhoneServer, stopPhoneServer } from '../phone/server'

export function registerPhoneHandlers(): void {
  ipcMain.handle('phone:start', (event) => startPhoneServer(event.sender))
  ipcMain.handle('phone:stop', () => stopPhoneServer())
}
