import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  listProfiles, createProfileNew, addExistingProfile,
  switchProfile, renameProfile, removeProfile,
} from '../profiles'
import { closeDb } from '../db'
import { ensureLibraryDirs } from '../library'
import { invalidateSettingsCache } from '../settings'
import { restartWatcher, isCurrentlySyncing } from '../sync'
import type { Profile, ProfileList } from '../../shared/types'

// Point the whole app at a different library folder: close the old DB, forget the
// old profile's cached settings, make sure the new folder has the expected layout,
// and restart the file watcher. The renderer reloads afterwards so every view
// re-reads from the newly active library.
function activate(): void {
  closeDb()
  invalidateSettingsCache()
  ensureLibraryDirs()   // creates timeline.db's parent dirs for a brand-new library
  restartWatcher()
}

export function registerProfileHandlers(): void {
  ipcMain.handle('profiles:list', (): ProfileList => listProfiles())

  ipcMain.handle('profiles:createNew', (_, name: string): Profile => {
    return createProfileNew(name)
  })

  // Register (and name) an existing folder as a Timeline. The folder may be empty
  // — it becomes a fresh library on first switch — or already contain a timeline.db.
  ipcMain.handle('profiles:addExisting', async (_, name: string): Promise<Profile | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select a Timeline folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return addExistingProfile(name, result.filePaths[0])
  })

  ipcMain.handle('profiles:switch', (_, id: string): Profile => {
    if (isCurrentlySyncing()) {
      throw new Error('A library sync is in progress — wait for it to finish before switching.')
    }
    const profile = switchProfile(id)
    activate()
    return profile
  })

  ipcMain.handle('profiles:rename', (_, id: string, name: string): ProfileList => {
    renameProfile(id, name)
    return listProfiles()
  })

  ipcMain.handle('profiles:remove', (_, id: string): ProfileList => {
    removeProfile(id)
    return listProfiles()
  })
}
