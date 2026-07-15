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

// The Spotify aggregations re-scan the whole table with per-row strftime/datetime
// conversions — hundreds of ms over a large export. getYearlySummaries only changes
// on import, so it's memoized; the timeline's ribbon/panel queries instead read the
// precomputed daily rollups (see ensureRollups), which are tiny to aggregate.
let yearlySummariesCache: YearlySpotifySummary[] | null = null

// `day` = the play's local-midnight as a UTC ms, i.e. the same bucket grid the
// timeline histogram uses, so rollup rows line up with the entries bars.
const DAY_EXPR = bucketExprSql('day')

// rollupsEnsured short-circuits the freshness check once we've confirmed it this
// session; insertPlays resets it. Rollups are rebuilt when listening_history's row
// count no longer matches the marker stored at the last build — plays are only ever
// added (INSERT OR IGNORE) or wiped, so a count mismatch reliably means "stale".
let rollupsEnsured = false

function ensureRollups(): void {
  if (rollupsEnsured) return
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) AS c FROM listening_history').get() as { c: number }).c
  const marker = db.prepare(`SELECT value FROM listening_rollup_meta WHERE key = 'source_count'`).get() as { value: string } | undefined
  if (!marker || Number(marker.value) !== count) rebuildRollups(count)
  rollupsEnsured = true
}

function rebuildRollups(count: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM listening_daily').run()
    db.prepare(`
      INSERT INTO listening_daily (day, ms_played, play_count)
      SELECT ${DAY_EXPR} AS day, SUM(ms_played), COUNT(*)
      FROM listening_history GROUP BY day
    `).run()
    db.prepare('DELETE FROM listening_artist_daily').run()
    db.prepare(`
      INSERT INTO listening_artist_daily (day, artist_name, ms_played, play_count)
      SELECT ${DAY_EXPR} AS day, artist_name, SUM(ms_played), COUNT(*)
      FROM listening_history
      WHERE media_type = 'track' AND artist_name IS NOT NULL
      GROUP BY day, artist_name
    `).run()
    db.prepare(`INSERT OR REPLACE INTO listening_rollup_meta (key, value) VALUES ('source_count', ?)`).run(String(count))
  })()
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
  const inserted = insertMany(plays)
  if (inserted > 0) { yearlySummariesCache = null; rollupsEnsured = false }
  return inserted
}

export function getPlaysForPeriod(from: number, to: number): SpotifyPlay[] {
  return getDb().prepare(
    `SELECT * FROM listening_history WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`
  ).all(from, to) as SpotifyPlay[]
}

// Podcast episodes are excluded from the rollup, so this is a music ranking. Reads
// listening_artist_daily (day × artist) — a small fraction of the raw plays.
export function getTopArtists(from: number, to: number, limit: number): ArtistPlaytime[] {
  ensureRollups()
  return getDb().prepare(`
    SELECT artist_name, SUM(ms_played) AS ms_played, SUM(play_count) AS play_count
    FROM listening_artist_daily
    WHERE day >= ? AND day < ?
    GROUP BY artist_name
    ORDER BY ms_played DESC
    LIMIT ?
  `).all(from, to, limit) as ArtistPlaytime[]
}

// Same calendar bucketing as the entries histogram, so the density ribbon lines up
// with the bars it's drawn under. Reads the daily rollup (thousands of rows) and
// re-buckets days into months/years in JS — new Date(day) reconstructs the local
// calendar date since `day` is that date's local midnight (see bucketExprSql).
export function getListeningHistogram(from: number, to: number, zoomLevel: string): ListeningBucket[] {
  ensureRollups()
  const rows = getDb().prepare(
    `SELECT day, ms_played FROM listening_daily WHERE day >= ? AND day < ? ORDER BY day`
  ).all(from, to) as { day: number; ms_played: number }[]

  if (zoomLevel === 'day') {
    return rows.map(r => ({ bucket_start: r.day, ms_played: r.ms_played }))
  }
  const totals = new Map<number, number>()
  for (const r of rows) {
    const d = new Date(r.day)
    const bucket = zoomLevel === 'year'
      ? new Date(d.getFullYear(), 0, 1).getTime()
      : new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    totals.set(bucket, (totals.get(bucket) ?? 0) + r.ms_played)
  }
  return [...totals.entries()]
    .map(([bucket_start, ms_played]) => ({ bucket_start, ms_played }))
    .sort((a, b) => a.bucket_start - b.bucket_start)
}

interface YearTotalsRow { year: number; ms_played: number; play_count: number }
interface YearArtistRow { year: number; artist_name: string; ms_played: number; play_count: number }
interface YearTrackRow { year: number; track_name: string; artist_name: string | null; ms_played: number; play_count: number }
interface YearMonthRow { year: number; month: number; ms_played: number }

// One recap per calendar year that has any listening history: totals, top 5 artists,
// the single most-played track, and a Jan..Dec breakdown for the "Spotify" tab's yearly cards.
export function getYearlySummaries(): YearlySpotifySummary[] {
  if (yearlySummariesCache !== null) return yearlySummariesCache

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

  yearlySummariesCache = totals
    .sort((a, b) => b.year - a.year)
    .map(t => ({
      year: t.year,
      msPlayed: t.ms_played,
      playCount: t.play_count,
      topArtists: artistsByYear.get(t.year) ?? [],
      topTrack: trackByYear.get(t.year) ?? null,
      monthly: monthlyByYear.get(t.year) ?? new Array(12).fill(0),
    }))
  return yearlySummariesCache
}
