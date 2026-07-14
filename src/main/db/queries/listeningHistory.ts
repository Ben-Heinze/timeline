import { getDb } from '../index'
import type { SpotifyPlay, ArtistPlaytime } from '../../../shared/types'

export interface SpotifyPlayInsert {
  timestamp: number
  track_name: string | null
  artist_name: string | null
  album_name: string | null
  ms_played: number
  media_type: 'track' | 'episode'
  spotify_uri: string | null
}

export function insertPlays(plays: SpotifyPlayInsert[]): number {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO listening_history
      (timestamp, track_name, artist_name, album_name, ms_played, media_type, spotify_uri, created_at)
    VALUES
      (@timestamp, @track_name, @artist_name, @album_name, @ms_played, @media_type, @spotify_uri, @created_at)
  `)
  const insertMany = db.transaction((rows: SpotifyPlayInsert[]) => {
    let inserted = 0
    for (const row of rows) {
      const info = stmt.run({ ...row, created_at: now })
      if (info.changes > 0) inserted++
    }
    return inserted
  })
  return insertMany(plays)
}

export function getPlaysForPeriod(from: number, to: number): SpotifyPlay[] {
  return getDb().prepare(
    `SELECT * FROM listening_history WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`
  ).all(from, to) as SpotifyPlay[]
}

// Podcast episodes are excluded — "top artists" is a music ranking.
export function getTopArtists(from: number, to: number, limit: number): ArtistPlaytime[] {
  return getDb().prepare(`
    SELECT artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND artist_name IS NOT NULL
    GROUP BY artist_name
    ORDER BY ms_played DESC
    LIMIT ?
  `).all(from, to, limit) as ArtistPlaytime[]
}
