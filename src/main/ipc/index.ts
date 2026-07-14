import { registerBackupHandlers } from './backup'
import { registerEntryHandlers } from './entries'
import { registerEventHandlers } from './events'
import { registerGroupHandlers } from './groups'
import { registerIngestHandlers } from './ingest'
import { registerMapHandlers } from './map'
import { registerTagHandlers } from './tags'
import { registerSettingsHandlers } from './settings'
import { registerFileHandlers } from './files'

export function registerAllHandlers(): void {
  registerBackupHandlers()
  registerEntryHandlers()
  registerEventHandlers()
  registerFileHandlers()
  registerGroupHandlers()
  registerIngestHandlers()
  registerMapHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
}
