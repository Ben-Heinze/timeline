import { useStore } from '../store/useStore'
import type { VolumeStatus } from '../../shared/types'

export function useVolumeStatus(volumeId: number | null): VolumeStatus | null {
  const volumes = useStore(s => s.volumes)
  if (volumeId == null) return null
  return volumes.find(v => v.id === volumeId) ?? null
}

function volumeTitle(status: VolumeStatus): string {
  return status.connected ? `On drive: ${status.label}` : `On drive: ${status.label} — not connected`
}

/** Small corner dot for thumbnails — subtle when the drive is connected, red when it isn't. */
export function VolumeBadgeDot({ volumeId }: { volumeId: number | null }) {
  const status = useVolumeStatus(volumeId)
  if (!status) return null
  return (
    <div
      title={volumeTitle(status)}
      style={{
        position: 'absolute', top: 3, right: 3,
        width: 9, height: 9, borderRadius: '50%',
        background: status.connected ? 'rgba(0,0,0,0.4)' : '#ef4444',
        border: '1.5px solid #fff',
        boxSizing: 'border-box',
      }}
    />
  )
}

/** Inline text label for metadata panels / list rows. */
export function VolumeBadgeInline({ volumeId }: { volumeId: number | null }) {
  const status = useVolumeStatus(volumeId)
  if (!status) return null
  return (
    <span style={{ fontSize: 11, color: status.connected ? 'var(--text-3)' : '#ef4444' }}>
      {volumeTitle(status)}
    </span>
  )
}
