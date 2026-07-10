import { registerEntryHandlers } from './entries'
import { registerGroupHandlers } from './groups'
import { registerIngestHandlers } from './ingest'
import { registerTagHandlers } from './tags'
import { registerSettingsHandlers } from './settings'

export function registerAllHandlers(): void {
  registerEntryHandlers()
  registerGroupHandlers()
  registerIngestHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
}
