import { getDb } from '../index'
import { bucketExprSql } from './bucketing'
import type { SpotifyPlay, ArtistPlaytime, TrackPlaytime, ListeningBucket, YearlySpotifySummary } from '../../../shared/types'

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

// Same calendar bucketing as the entries histogram, so the density ribbon lines up
// with the bars it's drawn under on the timeline.
export function getListeningHistogram(from: number, to: number, zoomLevel: string): ListeningBucket[] {
  const bucketExpr = bucketExprSql(zoomLevel)
  return getDb().prepare(`
    SELECT ${bucketExpr} AS bucket_start, SUM(ms_played) AS ms_played
    FROM listening_history
    WHERE timestamp >= :from AND timestamp < :to
    GROUP BY bucket_start
    ORDER BY bucket_start
  `).all({ from, to }) as ListeningBucket[]
}

interface YearTotalsRow { year: number; ms_played: number; play_count: number }
interface YearArtistRow { year: number; artist_name: string; ms_played: number; play_count: number }
interface YearTrackRow { year: number; track_name: string; artist_name: string | null; ms_played: number; play_count: number }
interface YearMonthRow { year: number; month: number; ms_played: number }

// One recap per calendar year that has any listening history: totals, top 5 artists,
// the single most-played track, and a Jan..Dec breakdown for the "Spotify" tab's yearly cards.
export function getYearlySummaries(): YearlySpotifySummary[] {
  const db = getDb()
  const yearExpr = `CAST(strftime('%Y', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER)`

  const totals = db.prepare(`
    SELECT ${yearExpr} AS year, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    GROUP BY year
  `).all() as YearTotalsRow[]

  const topArtistRows = db.prepare(`
    WITH by_artist_year AS (
      SELECT ${yearExpr} AS year, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
      FROM listening_history
      WHERE media_type = 'track' AND artist_name IS NOT NULL
      GROUP BY year, artist_name
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY year ORDER BY ms_played DESC) AS rnk
      FROM by_artist_year
    )
    SELECT year, artist_name, ms_played, play_count FROM ranked WHERE rnk <= 5 ORDER BY year, rnk
  `).all() as YearArtistRow[]

  const topTrackRows = db.prepare(`
    WITH by_track_year AS (
      SELECT ${yearExpr} AS year, track_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
      FROM listening_history
      WHERE media_type = 'track' AND track_name IS NOT NULL
      GROUP BY year, track_name, artist_name
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY year ORDER BY ms_played DESC) AS rnk
      FROM by_track_year
    )
    SELECT year, track_name, artist_name, ms_played, play_count FROM ranked WHERE rnk = 1
  `).all() as YearTrackRow[]

  const monthlyRows = db.prepare(`
    SELECT ${yearExpr} AS year,
           CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history
    GROUP BY year, month
  `).all() as YearMonthRow[]

  const artistsByYear = new Map<number, ArtistPlaytime[]>()
  for (const r of topArtistRows) {
    const arr = artistsByYear.get(r.year) ?? []
    arr.push({ artist_name: r.artist_name, ms_played: r.ms_played, play_count: r.play_count })
    artistsByYear.set(r.year, arr)
  }
  const trackByYear = new Map<number, TrackPlaytime>()
  for (const r of topTrackRows) {
    trackByYear.set(r.year, { track_name: r.track_name, artist_name: r.artist_name, ms_played: r.ms_played, play_count: r.play_count })
  }
  const monthlyByYear = new Map<number, number[]>()
  for (const r of monthlyRows) {
    let arr = monthlyByYear.get(r.year)
    if (!arr) { arr = new Array(12).fill(0); monthlyByYear.set(r.year, arr) }
    arr[r.month - 1] = r.ms_played
  }

  return totals
    .sort((a, b) => b.year - a.year)
    .map(t => ({
      year: t.year,
      msPlayed: t.ms_played,
      playCount: t.play_count,
      topArtists: artistsByYear.get(t.year) ?? [],
      topTrack: trackByYear.get(t.year) ?? null,
      monthly: monthlyByYear.get(t.year) ?? new Array(12).fill(0),
    }))
}
