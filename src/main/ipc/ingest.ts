import { ipcMain, dialog, BrowserWindow } from 'electron'
import { ingestFiles } from '../ingest'
import { runSync, scanDuplicates, isCurrentlySyncing } from '../sync'
import { bulkSetEntryTags } from '../db/queries/tags'
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

  ipcMain.handle('ingest:start', async (event, filePaths: string[], tagNames: string[] = []) => {
    const sender = event.sender
    const insertedIds = await ingestFiles(filePaths, (progress: IngestProgressEvent) => {
      if (!sender.isDestroyed()) sender.send('ingest:progress', progress)
    })
    if (tagNames.length > 0 && insertedIds.length > 0) {
      bulkSetEntryTags(insertedIds, tagNames)
    }
  })

  ipcMain.handle('sync:run', async (event) => {
    const sender = event.sender
    await runSync((progress) => {
      if (!sender.isDestroyed()) sender.send('sync:progress', progress)
    })
  })

  ipcMain.handle('sync:isSyncing', () => isCurrentlySyncing())

  ipcMain.handle('sync:scanDuplicates', (_, mode: 'hash' | 'name_size') =>
    scanDuplicates(mode))
}
