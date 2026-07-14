import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DetectedVolume } from './detect'

const execFileAsync = promisify(execFile)

interface LsblkNode {
  uuid: string | null
  label: string | null
  mountpoint: string | null
  children?: LsblkNode[]
}

export async function detect(): Promise<DetectedVolume[]> {
  try {
    const { stdout } = await execFileAsync('lsblk', ['-o', 'UUID,LABEL,MOUNTPOINT', '-J'])
    const { blockdevices } = JSON.parse(stdout) as { blockdevices: LsblkNode[] }
    const out: DetectedVolume[] = []
    const walk = (nodes: LsblkNode[]) => {
      for (const n of nodes) {
        // Only real, mounted filesystems — excludes swap ("[SWAP]") and unmounted partitions
        if (n.uuid && n.mountpoint && n.mountpoint.startsWith('/')) {
          out.push({ serial: n.uuid, mountPath: n.mountpoint, osLabel: n.label ?? n.mountpoint })
        }
        if (n.children) walk(n.children)
      }
    }
    walk(blockdevices)
    return out
  } catch {
    return []
  }
}
