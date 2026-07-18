import { ExifTool, ExifDateTime } from 'exiftool-vendored'

// ExifTool runs as a persistent child process (Perl + the exiftool script).
// Spawning one per write would be painfully slow, so we keep a single lazily
// created instance for the whole app and shut it down on quit.
let et: ExifTool | null = null

function tool(): ExifTool {
  if (!et) et = new ExifTool({ maxProcs: 1 })
  return et
}

export async function endExifTool(): Promise<void> {
  if (!et) return
  const inst = et
  et = null
  try { await inst.end() } catch {}
}

// Camera RAW files (Sony .ARW, Canon .CR2/.CR3, …) can't be decoded by sharp/libvips,
// but they embed a JPEG preview. We pull the largest one out so the ingest pipeline can
// resize it into the app's webp thumbnails. Tags are tried largest-first: JpgFromRaw and
// PreviewImage are typically near/at full resolution; ThumbnailImage is a small last resort.
const RAW_PREVIEW_TAGS = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage']

/** Embedded JPEG preview from a RAW file, or null if none of the preview tags are present. */
export async function extractRawPreview(absPath: string): Promise<Buffer | null> {
  for (const tag of RAW_PREVIEW_TAGS) {
    try {
      const buf = await tool().extractBinaryTagToBuffer(tag, absPath)
      if (buf && buf.length > 0) return buf
    } catch {
      // Tag not present on this file — try the next one.
    }
  }
  return null
}

export interface RawMetadata {
  timestamp: number | null
  gps: { latitude: number; longitude: number } | null
}

/**
 * Read capture date and GPS from a RAW file via ExifTool. exifr can't reliably
 * parse newer RAW containers (notably Canon CR3), so RAW ingest routes through
 * ExifTool — which reads every format — instead.
 */
export async function readRawMetadata(absPath: string): Promise<RawMetadata> {
  let tags
  try {
    tags = await tool().read(absPath)
  } catch {
    return { timestamp: null, gps: null }
  }

  // EXIF dates carry no timezone; build the timestamp from the wall-clock
  // components in local time so RAW matches the JPEG path and what writePhotoDate
  // stores (see the note there).
  let timestamp: number | null = null
  const dt = tags.DateTimeOriginal ?? tags.CreateDate
  if (dt instanceof ExifDateTime) {
    const ms = new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTime()
    if (!Number.isNaN(ms)) timestamp = ms
  }

  return { timestamp, gps: parseGps(tags as Record<string, unknown>) }
}

// ExifTool reports GPSLatitude/GPSLongitude either as a positive magnitude plus a
// hemisphere ref (N/S, E/W) — photos/RAW — or as an already-signed decimal with no
// ref — QuickTime videos. Taking abs() then applying the ref (when present) is
// correct for both: -abs(-122.4) with ref 'W' is still -122.4.
function parseGps(tags: Record<string, unknown>): { latitude: number; longitude: number } | null {
  let lat = Number(tags.GPSLatitude)
  let lon = Number(tags.GPSLongitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (/^S/i.test(String(tags.GPSLatitudeRef ?? ''))) lat = -Math.abs(lat)
  if (/^W/i.test(String(tags.GPSLongitudeRef ?? ''))) lon = -Math.abs(lon)
  if (lat === 0 && lon === 0) return null
  return { latitude: lat, longitude: lon }
}

// Video capture date, best tag first. QuickTime/MP4 CreateDate is stored in UTC
// (ExifTool's defaultVideosToUTC handles that); Apple's CreationDate carries the
// real capture-time zone offset, so it's preferred. We take the absolute instant
// via toMillis() — correct for a zoned value, and interpreted as local for the
// rare zoneless one — which the app then displays in the viewer's local time.
const VIDEO_DATE_TAGS = ['CreationDate', 'DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate']

/** Capture date and GPS (Apple clips embed both) from a video's container metadata. */
export async function readVideoMetadata(absPath: string): Promise<RawMetadata> {
  let tags: Record<string, unknown>
  try {
    tags = await tool().read(absPath) as Record<string, unknown>
  } catch {
    return { timestamp: null, gps: null }
  }

  let timestamp: number | null = null
  for (const tag of VIDEO_DATE_TAGS) {
    const v = tags[tag]
    // Skip zero/epoch placeholders some muxers write (e.g. 1904/1970-01-01).
    if (v instanceof ExifDateTime && v.year >= 1971) {
      const ms = v.toMillis()
      if (Number.isFinite(ms)) { timestamp = ms; break }
    }
  }

  return { timestamp, gps: parseGps(tags) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Write the given moment into a photo/video's EXIF date tags, in place.
 *
 * The stored timestamp is epoch ms; we format it from the machine's local
 * wall-clock components so the value written matches the date the app shows.
 * EXIF DateTimeOriginal has no timezone, so writing the local components keeps
 * a subsequent re-ingest reading back the same displayed date.
 */
export async function writePhotoDate(absPath: string, timestampMs: number): Promise<void> {
  const d = new Date(timestampMs)
  const stamp =
    `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  // Overwrite in place — these are copy-mode files the app owns, so we don't
  // want exiftool's default `<name>_original` backup piling up in the library.
  await tool().write(
    absPath,
    { DateTimeOriginal: stamp, CreateDate: stamp, ModifyDate: stamp },
    { writeArgs: ['-overwrite_original'] }
  )
}

/**
 * Write GPS coordinates into a photo/video's metadata. Signed decimal degrees are
 * split into a positive magnitude plus a N/S/E/W reference, matching how the read
 * path (parseGps) reconstructs the sign — so a re-ingest reads back the same point.
 */
export async function writePhotoGPS(
  absPath: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  await tool().write(
    absPath,
    {
      GPSLatitude: Math.abs(latitude),
      GPSLatitudeRef: latitude >= 0 ? 'N' : 'S',
      GPSLongitude: Math.abs(longitude),
      GPSLongitudeRef: longitude >= 0 ? 'E' : 'W',
    },
    { writeArgs: ['-overwrite_original'] }
  )
}
