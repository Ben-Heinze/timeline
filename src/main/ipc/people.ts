import { ipcMain } from 'electron'
import * as q from '../db/queries/people'

export function registerPeopleHandlers(): void {
  ipcMain.handle('people:list', () => q.listPeople())
  ipcMain.handle('people:get', (_, id) => q.getPerson(id))
  ipcMain.handle('people:create', (_, data) => q.createPerson(data))
  ipcMain.handle('people:update', (_, id, patch) => q.updatePerson(id, patch))
  ipcMain.handle('people:delete', (_, id) => q.deletePerson(id))
  ipcMain.handle('people:forEntry', (_, entryId) => q.getEntryPeople(entryId))
  ipcMain.handle('people:setForEntry', (_, entryId, personIds) => q.setEntryPeople(entryId, personIds))
  ipcMain.handle('people:addToEntries', (_, entryIds, personIds) => q.bulkAddPeopleToEntries(entryIds, personIds))
  ipcMain.handle('people:entries', (_, personId) => q.getPersonEntries(personId))
}
