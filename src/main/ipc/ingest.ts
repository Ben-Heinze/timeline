import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { ingestFiles, expandPaths } from '../ingest'
import { runSync, scanDuplicates, isCurrentlySyncing } from '../sync'
import { bulkSetEntryTags } from '../db/queries/tags'
import type { IngestProgressEvent, IngestDoneEvent, IngestFailure } from '../../shared/types'

async function writeImportErrorLog(failures: IngestFailure[]): Promise<string | null> {
  try {
    const logPath = path.join(app.getPath('userData'), 'import-errors.log')
    const lines = [
      `[${new Date().toISOString()}] ${failures.length} file(s) failed to import:`,
      ...failures.map(f => `  ${f.file} — ${f.error}`),
      '',
      '',
    ]
    await fs.appendFile(logPath, lines.join('\n'), 'utf8')
    return logPath
  } catch {
    return null
  }
}

export function registerIngestHandlers(): void {
  ipcMain.handle('ingest:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Import files or folders',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'All files', extensions: ['*'] }],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('ingest:countFiles', async (_, paths: string[]) => {
    const files = await expandPaths(paths)
    return files.length
  })

  ipcMain.handle('ingest:start', async (event, filePaths: string[], tagNames: string[] = []) => {
    const sender = event.sender
    const send = (channel: string, data: unknown) => {
      if (!sender.isDestroyed()) sender.send(channel, data)
    }
    try {
      const { insertedIds, failures, total } = await ingestFiles(filePaths, (progress: IngestProgressEvent) => {
        send('ingest:progress', progress)
      })
      if (tagNames.length > 0 && insertedIds.length > 0) {
        bulkSetEntryTags(insertedIds, tagNames)
      }
      if (total === 0) return
      const logPath = failures.length > 0 ? await writeImportErrorLog(failures) : null
      const done: IngestDoneEvent = { total, imported: total - failures.length, failures, logPath }
      send('ingest:done', done)
    } catch (e) {
      // Import aborted before per-file processing (e.g. a path failed to stat)
      const failures: IngestFailure[] = [{ file: filePaths.join(', '), error: (e as Error).message ?? String(e) }]
      const logPath = await writeImportErrorLog(failures)
      const done: IngestDoneEvent = { total: filePaths.length, imported: 0, failures, logPath }
      send('ingest:done', done)
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
