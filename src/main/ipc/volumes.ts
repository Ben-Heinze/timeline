import { ipcMain } from 'electron'
import { refreshVolumes, getVolumeStatuses, findOrCreateVolumeForPath } from '../volumes'
import { updateVolumeLabel } from '../db/queries/volumes'

export function registerVolumeHandlers(): void {
  ipcMain.handle('volumes:list', () => getVolumeStatuses())

  ipcMain.handle('volumes:refresh', async () => {
    await refreshVolumes()
    return getVolumeStatuses()
  })

  ipcMain.handle('volumes:matchPath', (_, p: string) => findOrCreateVolumeForPath(p))

  ipcMain.handle('volumes:setLabel', (_, id: number, label: string) => {
    updateVolumeLabel(id, label)
  })
}
