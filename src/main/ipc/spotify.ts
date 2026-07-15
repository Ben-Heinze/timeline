import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'path'
import { expandSpotifyPaths, parseSpotifyFile } from '../spotify'
import { insertPlays, getPlaysForPeriod, getTopArtists, getListeningHistogram, getYearlySummaries, getYearDetail, getArtistMonthlyForYear } from '../db/queries/listeningHistory'
import type { SpotifyImportProgressEvent, SpotifyImportResult } from '../../shared/types'

export function registerSpotifyHandlers(): void {
  ipcMain.handle('spotify:pickExport', async (_event, mode: 'files' | 'folder' = 'files') => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    // openFile and openDirectory can't be combined in one dialog: on Linux (GTK) that
    // combination disables double-click-to-enter for folders, since the dialog can't
    // tell whether a folder double-click means "select it" or "open it". Keeping the
    // two modes in separate dialogs preserves normal folder navigation for file pickers.
    const result = await dialog.showOpenDialog(win, mode === 'folder'
      ? {
          title: 'Select your Spotify "Extended streaming history" export folder',
          properties: ['openDirectory'],
        }
      : {
          title: 'Select your Spotify Streaming_History_*.json files',
          properties: ['openFile', 'multiSelections'],
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

  ipcMain.handle('spotify:histogram', (_, from: number, to: number, zoomLevel: string) =>
    getListeningHistogram(from, to, zoomLevel))

  ipcMain.handle('spotify:yearlySummaries', () => getYearlySummaries())

  ipcMain.handle('spotify:yearDetail', (_, year: number) => getYearDetail(year))

  ipcMain.handle('spotify:artistMonthlyForYear', (_, year: number, artistName: string) =>
    getArtistMonthlyForYear(year, artistName))
}
