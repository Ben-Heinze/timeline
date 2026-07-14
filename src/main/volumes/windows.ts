import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DetectedVolume } from './detect'

const execFileAsync = promisify(execFile)

interface PsVolume {
  DriveLetter: string | null
  FileSystemLabel: string | null
  UniqueId: string | null
}

export async function detect(): Promise<DetectedVolume[]> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Volume | Select-Object DriveLetter,FileSystemLabel,UniqueId | ConvertTo-Json',
    ])
    const parsed: PsVolume | PsVolume[] = JSON.parse(stdout)
    const volumes = Array.isArray(parsed) ? parsed : [parsed]
    return volumes
      .filter((v): v is PsVolume & { DriveLetter: string; UniqueId: string } => !!v.DriveLetter && !!v.UniqueId)
      .map(v => ({
        serial: v.UniqueId,
        mountPath: `${v.DriveLetter}:\\`,
        osLabel: v.FileSystemLabel || `${v.DriveLetter}:`,
      }))
  } catch {
    return []
  }
}
