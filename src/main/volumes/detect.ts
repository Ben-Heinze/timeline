export interface DetectedVolume {
  serial: string       // OS-level identifier (filesystem UUID / Windows UniqueId) — used for matching
  mountPath: string
  osLabel: string
}

/**
 * Probes currently mounted volumes by shelling out to platform tools
 * (lsblk / PowerShell Get-Volume / diskutil) rather than a native module —
 * this project already carries the NixOS native-rebuild tax for
 * better-sqlite3 and sharp and deliberately avoids a third such dependency.
 */
export async function listMountedVolumes(): Promise<DetectedVolume[]> {
  if (process.platform === 'win32') return (await import('./windows')).detect()
  if (process.platform === 'darwin') return (await import('./darwin')).detect()
  return (await import('./linux')).detect()
}
