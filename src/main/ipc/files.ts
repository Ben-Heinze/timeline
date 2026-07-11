import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { resolveEntryFilePath, getMediaUrl } from '../media'
import { IMAGE_EXTS } from '../ingest'
import type { FileInfo } from '../../shared/types'

export function registerFileHandlers(): void {
  ipcMain.handle('files:getMediaUrl', (_, entryId: number) =>
    getMediaUrl(entryId))

  ipcMain.handle('files:getFileInfo', async (_, entryId: number): Promise<FileInfo | null> => {
    const abs = resolveEntryFilePath(entryId)
    if (!abs) return null

    let stat
    try { stat = await fs.stat(abs) } catch { return null }

    let width: number | null = null
    let height: number | null = null
    if (IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      try {
        const meta = await sharp(abs).metadata()
        // EXIF orientations 5-8 rotate 90°, so the stored dimensions are swapped
        const swap = (meta.orientation ?? 1) >= 5
        width = (swap ? meta.height : meta.width) ?? null
        height = (swap ? meta.width : meta.height) ?? null
      } catch { /* dimensions stay unknown */ }
    }

    return { absolutePath: abs, sizeBytes: stat.size, modifiedMs: stat.mtimeMs, width, height }
  })

  ipcMain.handle('files:showInFolder', (_, entryId: number) => {
    const abs = resolveEntryFilePath(entryId)
    if (abs) shell.showItemInFolder(abs)
  })

  ipcMain.handle('files:openDefault', async (_, entryId: number): Promise<string> => {
    const abs = resolveEntryFilePath(entryId)
    if (!abs) return 'No file attached'
    return shell.openPath(abs) // resolves to '' on success, error message otherwise
  })

  ipcMain.handle('files:openWith', async (e, entryId: number): Promise<string> => {
    const abs = resolveEntryFilePath(entryId)
    if (!abs) return 'No file attached'

    if (process.platform === 'win32') {
      spawn('rundll32', ['shell32.dll,OpenAs_RunDLL', abs], { detached: true, stdio: 'ignore' }).unref()
      return ''
    }

    // macOS and Linux have no native "open with" prompt we can invoke, so ask
    // the user to pick the application themselves.
    const win = BrowserWindow.fromWebContents(e.sender)
    const isMac = process.platform === 'darwin'
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose an application',
      defaultPath: isMac ? '/Applications' : '/usr/bin',
      properties: ['openFile'],
      filters: isMac ? [{ name: 'Applications', extensions: ['app'] }] : [],
    })
    if (result.canceled || result.filePaths.length === 0) return ''

    const app = result.filePaths[0]
    try {
      const child = isMac
        ? spawn('open', ['-a', app, abs], { detached: true, stdio: 'ignore' })
        : spawn(app, [abs], { detached: true, stdio: 'ignore' })
      child.unref()
      return ''
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })
}
