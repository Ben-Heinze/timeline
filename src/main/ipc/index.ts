import { registerEntryHandlers } from './entries'
import { registerGroupHandlers } from './groups'
import { registerIngestHandlers } from './ingest'
import { registerTagHandlers } from './tags'

export function registerAllHandlers(): void {
  registerEntryHandlers()
  registerGroupHandlers()
  registerIngestHandlers()
  registerTagHandlers()
}
