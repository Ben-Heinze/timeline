import { ipcMain, dialog, BrowserWindow } from 'electron'
import { exportBackup, importBackup } from '../backup'
import type { BackupExportType, BackupExportResult, BackupImportResult, BackupProgressEvent } from '../../shared/types'

function progressSender(sender: Electron.WebContents): (e: BackupProgressEvent) => void {
  return (e) => {
    if (!sender.isDestroyed()) sender.send('backup:progress', e)
  }
}

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:export', async (event, type: BackupExportType): Promise<BackupExportResult> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0]
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win, {
      title: type === 'full' ? 'Export full backup' : 'Export metadata-only backup',
      defaultPath: `timeline-${type === 'full' ? 'backup' : 'metadata'}-${date}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    const summary = await exportBackup(result.filePath, type, progressSender(event.sender))
    return { canceled: false, path: result.filePath, ...summary }
  })

  ipcMain.handle('backup:pickArchive', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select backup archive',
      filters: [{ name: 'Timeline backup', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('backup:import', async (event, zipPath: string, destDir: string): Promise<BackupImportResult> => {
    return importBackup(zipPath, destDir, progressSender(event.sender))
  })
}
