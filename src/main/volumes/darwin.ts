import type { DetectedVolume } from './detect'

// Not implemented yet — macOS support is planned. The intended approach:
// `diskutil list -plist` to enumerate mounted volumes, then
// `diskutil info -plist /Volumes/<name>` per volume (parsed via a plist
// parser or `plutil -convert json -o - -`) to read the Volume UUID and name.
// Kept as a same-shape adapter so wiring it up is additive, not a rewrite.
export async function detect(): Promise<DetectedVolume[]> {
  return []
}
