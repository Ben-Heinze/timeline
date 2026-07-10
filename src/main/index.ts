import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, normalize } from 'path'
import { ensureLibraryDirs, getLibraryPath } from './library'
import { closeDb } from './db'
import { registerAllHandlers } from './ipc'
import { startWatcher, stopWatcher } from './sync'

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

app.whenReady().then(() => {
  ensureLibraryDirs()
  registerAllHandlers()

  // Serve library files (thumbnails, originals) via timeline:// protocol
  protocol.handle('timeline', (request) => {
    const rel = decodeURIComponent(request.url.slice('timeline:///'.length))
    const filePath = normalize(join(getLibraryPath(), rel))
    return net.fetch(`file://${filePath}`)
  })

  createWindow()
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
