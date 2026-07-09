import { ipcMain, dialog, BrowserWindow } from 'electron'
import { ingestFiles } from '../ingest'
import type { IngestProgressEvent } from '../../shared/types'

export function registerIngestHandlers(): void {
  ipcMain.handle('ingest:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Import files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All files', extensions: ['*'] }],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('ingest:start', async (event, filePaths: string[]) => {
    const sender = event.sender
    await ingestFiles(filePaths, (progress: IngestProgressEvent) => {
      if (!sender.isDestroyed()) sender.send('ingest:progress', progress)
    })
  })
}
