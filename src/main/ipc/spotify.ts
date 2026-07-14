import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'path'
import { expandSpotifyPaths, parseSpotifyFile } from '../spotify'
import { insertPlays, getPlaysForPeriod, getTopArtists } from '../db/queries/listeningHistory'
import type { SpotifyImportProgressEvent, SpotifyImportResult } from '../../shared/types'

export function registerSpotifyHandlers(): void {
  ipcMain.handle('spotify:pickExport', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select your Spotify extended streaming history folder or JSON files',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('spotify:import', async (event, paths: string[]): Promise<SpotifyImportResult> => {
    const sender = event.sender
    const files = await expandSpotifyPaths(paths)
    let imported = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const plays = await parseSpotifyFile(file)
      imported += insertPlays(plays)
      if (!sender.isDestroyed()) {
        const evt: SpotifyImportProgressEvent = {
          processedFiles: i + 1,
          totalFiles: files.length,
          current: path.basename(file),
        }
        sender.send('spotify:progress', evt)
      }
    }
    return { imported, totalFiles: files.length }
  })

  ipcMain.handle('spotify:forPeriod', (_, from: number, to: number) => getPlaysForPeriod(from, to))

  ipcMain.handle('spotify:topArtists', (_, from: number, to: number, limit: number = 50) =>
    getTopArtists(from, to, limit))
}
