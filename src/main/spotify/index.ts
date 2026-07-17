import fs from 'fs/promises'
import path from 'path'
import { getSpotifyPath, isPathUnder } from '../library'
import type { SpotifyPlayInsert } from '../db/queries/listeningHistory'

// Matches the file names inside a Spotify "Extended streaming history" export,
// e.g. Streaming_History_Audio_2013-2015_0.json / Streaming_History_Video_2020-2021_3.json
const FILE_PATTERN = /Streaming_History_(Audio|Video)_.*\.json$/i

export async function expandSpotifyPaths(inputPaths: string[]): Promise<string[]> {
  const files: string[] = []
  for (const p of inputPaths) {
    const st = await fs.stat(p)
    if (st.isDirectory()) {
      const entries = await fs.readdir(p, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && FILE_PATTERN.test(e.name)) files.push(path.join(p, e.name))
      }
    } else if (/\.json$/i.test(p)) {
      files.push(p)
    }
  }
  return files
}

/**
 * Copy a raw Spotify export into the library's spotify/ folder so the source
 * data is preserved alongside everything else. A same-named file is overwritten,
 * since Spotify export file names are stable per date range — re-importing an
 * updated export refreshes the stored copy rather than piling up duplicates.
 * Files already inside the library (e.g. re-imported from spotify/) are left alone.
 */
export async function saveExportToLibrary(sourcePath: string): Promise<void> {
  const spotifyDir = getSpotifyPath()
  if (isPathUnder(spotifyDir, sourcePath)) return
  await fs.mkdir(spotifyDir, { recursive: true })
  await fs.copyFile(sourcePath, path.join(spotifyDir, path.basename(sourcePath)))
}

interface RawSpotifyEntry {
  ts: string
  ms_played: number
  master_metadata_track_name: string | null
  master_metadata_album_artist_name: string | null
  master_metadata_album_album_name: string | null
  spotify_track_uri: string | null
  episode_name: string | null
  episode_show_name: string | null
  spotify_episode_uri: string | null
}

export async function parseSpotifyFile(filePath: string): Promise<SpotifyPlayInsert[]> {
  const raw = await fs.readFile(filePath, 'utf-8')
  const data = JSON.parse(raw) as RawSpotifyEntry[]
  const plays: SpotifyPlayInsert[] = []
  for (const entry of data) {
    if (!entry.ts) continue
    const timestamp = Date.parse(entry.ts)
    if (Number.isNaN(timestamp)) continue
    const isEpisode = !!entry.spotify_episode_uri
    const trackName = isEpisode ? entry.episode_name : entry.master_metadata_track_name
    if (!trackName) continue // skips ads / local-file-only rows with no identifiable title
    plays.push({
      timestamp,
      track_name: trackName,
      artist_name: isEpisode ? entry.episode_show_name : entry.master_metadata_album_artist_name,
      album_name: isEpisode ? null : entry.master_metadata_album_album_name,
      ms_played: entry.ms_played ?? 0,
      media_type: isEpisode ? 'episode' : 'track',
      spotify_uri: isEpisode ? entry.spotify_episode_uri : entry.spotify_track_uri,
    })
  }
  return plays
}
