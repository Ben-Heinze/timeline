import { registerEntryHandlers } from './entries'
import { registerGroupHandlers } from './groups'
import { registerIngestHandlers } from './ingest'
import { registerTagHandlers } from './tags'
import { registerSettingsHandlers } from './settings'
import { registerFileHandlers } from './files'

export function registerAllHandlers(): void {
  registerEntryHandlers()
  registerFileHandlers()
  registerGroupHandlers()
  registerIngestHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
}
