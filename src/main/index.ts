import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { ensureLibraryDirs, getLibraryPath } from './library'
import { closeDb } from './db'
import { registerAllHandlers } from './ipc'
import { startMediaServer } from './media'
import { startWatcher, stopWatcher } from './sync'
import { refreshVolumes, backfillWatchedFolderVolumes } from './volumes'
import { endExifTool } from './exif'

// Allow timeline:// to be used in img src without CSP issues
protocol.registerSchemesAsPrivileged([
  { scheme: 'timeline', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  ensureLibraryDirs()
  registerAllHandlers()

  // Serve library files (thumbnails, originals) via timeline:// protocol
  protocol.handle('timeline', async (request) => {
    const rel = decodeURIComponent(request.url.slice('timeline:///'.length))
    const filePath = normalize(join(getLibraryPath(), rel))
    // pathToFileURL percent-encodes spaces and other characters — the library
    // path may contain them (e.g. an external drive at "/run/media/.../Hard Drive").
    try {
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      // The library often lives on an external/removable drive. When it's
      // unmounted (or a thumbnail is missing) net.fetch rejects; without this
      // catch every failed request becomes an unhandled net::ERR_FAILED in the
      // main log — a whole map/grid of thumbnails at once floods it. Fail soft
      // with a 404 so the <img> just doesn't render.
      return new Response(null, { status: 404 })
    }
  })

  await refreshVolumes()
  backfillWatchedFolderVolumes()

  startMediaServer().then(createWindow)
  startWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatcher()
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

// Shut the persistent ExifTool child process down cleanly on quit.
app.on('will-quit', () => { void endExifTool() })
