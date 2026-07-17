import { getDb } from '../index'
import { bucketExprSql } from './bucketing'
import type { SpotifyPlay, ArtistPlaytime, TrackPlaytime, AlbumPlaytime, ListeningBucket, YearlySpotifySummary, YearDetail } from '../../../shared/types'

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

interface DailyRow       { day: number; ms_played: number; play_count: number }
interface ArtistDailyRow { day: number; artist_name: string; ms_played: number; play_count: number }
interface YearTrackRow   { year: number; track_name: string; artist_name: string | null; ms_played: number; play_count: number }

// One recap per calendar year that has any listening history: totals, top 5 artists,
// the single most-played track, and a Jan..Dec breakdown for the "Spotify" tab's yearly cards.
// Totals/top-artists/monthly read the daily rollups (thousands of rows, already built for
// getTopArtists/getListeningHistogram above) and reduce them to years in JS. Top track is
// the one piece with no existing rollup to lean on; adding a whole new (day, track, artist)
// rollup table just for this was measured to cost more at rebuild time (one more full-table
// scan on every import) than it saves, since this only needs a per-*year* answer, not
// per-day — so it stays a single targeted raw-table scan instead, same as the original
// implementation, rather than paying for rollup granularity nothing else needs.
export function getYearlySummaries(): YearlySpotifySummary[] {
  if (yearlySummariesCache !== null) return yearlySummariesCache
  ensureRollups()

  const db = getDb()
  const dailyRows       = db.prepare(`SELECT day, ms_played, play_count FROM listening_daily`).all() as DailyRow[]
  const artistDailyRows = db.prepare(`SELECT day, artist_name, ms_played, play_count FROM listening_artist_daily`).all() as ArtistDailyRow[]

  const yearExpr = `CAST(strftime('%Y', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER)`
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

  const totalsByYear = new Map<number, { ms_played: number; play_count: number }>()
  const monthlyByYear = new Map<number, number[]>()
  for (const r of dailyRows) {
    const d = new Date(r.day)
    const year = d.getFullYear()
    const t = totalsByYear.get(year) ?? { ms_played: 0, play_count: 0 }
    t.ms_played += r.ms_played
    t.play_count += r.play_count
    totalsByYear.set(year, t)
    let monthly = monthlyByYear.get(year)
    if (!monthly) { monthly = new Array(12).fill(0); monthlyByYear.set(year, monthly) }
    monthly[d.getMonth()] += r.ms_played
  }

  const artistsByYear = new Map<number, Map<string, ArtistPlaytime>>()
  for (const r of artistDailyRows) {
    const year = new Date(r.day).getFullYear()
    let byArtist = artistsByYear.get(year)
    if (!byArtist) { byArtist = new Map(); artistsByYear.set(year, byArtist) }
    const a = byArtist.get(r.artist_name) ?? { artist_name: r.artist_name, ms_played: 0, play_count: 0 }
    a.ms_played += r.ms_played
    a.play_count += r.play_count
    byArtist.set(r.artist_name, a)
  }

  const trackByYear = new Map<number, TrackPlaytime>()
  for (const r of topTrackRows) {
    trackByYear.set(r.year, { track_name: r.track_name, artist_name: r.artist_name, ms_played: r.ms_played, play_count: r.play_count })
  }

  yearlySummariesCache = [...totalsByYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, totals]) => {
      const topArtists = [...(artistsByYear.get(year)?.values() ?? [])]
        .sort((a, b) => b.ms_played - a.ms_played)
        .slice(0, 5)
      return {
        year,
        msPlayed: totals.ms_played,
        playCount: totals.play_count,
        topArtists,
        topTrack: trackByYear.get(year) ?? null,
        monthly: monthlyByYear.get(year) ?? new Array(12).fill(0),
      }
    })
  return yearlySummariesCache
}

// Everything needed for the Spotify tab's year-detail drill-down page: totals, unique
// counts, top-15 artists/tracks/albums, and three breakdowns (month, weekday, hour-of-day)
// for the page's charts. Scoped by a plain timestamp range rather than a strftime
// expression per row, so it can use the timestamp index directly.
export function getYearDetail(year: number): YearDetail | null {
  const db = getDb()
  const from = new Date(year, 0, 1).getTime()
  const to = new Date(year + 1, 0, 1).getTime()

  const totals = db.prepare(`
    SELECT SUM(ms_played) AS ms_played, COUNT(*) AS play_count,
           MIN(timestamp) AS first_play, MAX(timestamp) AS last_play
    FROM listening_history WHERE timestamp >= ? AND timestamp < ?
  `).get(from, to) as { ms_played: number | null; play_count: number; first_play: number | null; last_play: number | null }

  if (!totals.play_count) return null

  const uniqueCounts = db.prepare(`
    SELECT COUNT(DISTINCT artist_name) AS artists, COUNT(DISTINCT track_name) AS tracks, COUNT(DISTINCT album_name) AS albums
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track'
  `).get(from, to) as { artists: number; tracks: number; albums: number }

  const topArtists = db.prepare(`
    SELECT artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND artist_name IS NOT NULL
    GROUP BY artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to) as { artist_name: string; ms_played: number; play_count: number }[]

  const topTracks = db.prepare(`
    SELECT track_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND track_name IS NOT NULL
    GROUP BY track_name, artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to) as { track_name: string; artist_name: string | null; ms_played: number; play_count: number }[]

  const topAlbums = db.prepare(`
    SELECT album_name, artist_name, SUM(ms_played) AS ms_played, COUNT(*) AS play_count
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND media_type = 'track' AND album_name IS NOT NULL
    GROUP BY album_name, artist_name ORDER BY ms_played DESC LIMIT 15
  `).all(from, to) as { album_name: string; artist_name: string | null; ms_played: number; play_count: number }[]

  const monthlyRows = db.prepare(`
    SELECT CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY month
  `).all(from, to) as { month: number; ms_played: number }[]
  const monthly = new Array(12).fill(0)
  for (const r of monthlyRows) monthly[r.month - 1] = r.ms_played

  const dowRows = db.prepare(`
    SELECT CAST(strftime('%w', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS dow,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY dow
  `).all(from, to) as { dow: number; ms_played: number }[]
  const dayOfWeek = new Array(7).fill(0)
  for (const r of dowRows) dayOfWeek[r.dow] = r.ms_played

  const hourRows = db.prepare(`
    SELECT CAST(strftime('%H', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS hour,
           SUM(ms_played) AS ms_played
    FROM listening_history WHERE timestamp >= ? AND timestamp < ? GROUP BY hour
  `).all(from, to) as { hour: number; ms_played: number }[]
  const hourOfDay = new Array(24).fill(0)
  for (const r of hourRows) hourOfDay[r.hour] = r.ms_played

  return {
    year,
    msPlayed: totals.ms_played ?? 0,
    playCount: totals.play_count,
    uniqueArtists: uniqueCounts.artists,
    uniqueTracks: uniqueCounts.tracks,
    uniqueAlbums: uniqueCounts.albums,
    firstPlay: totals.first_play,
    lastPlay: totals.last_play,
    topArtists: topArtists as ArtistPlaytime[],
    topTracks: topTracks as TrackPlaytime[],
    topAlbums: topAlbums as AlbumPlaytime[],
    monthly, dayOfWeek, hourOfDay,
  }
}

// Monthly breakdown for a single artist within one year, used by the year-detail page's
// artist filter on the monthly chart.
export function getArtistMonthlyForYear(year: number, artistName: string): number[] {
  const db = getDb()
  const from = new Date(year, 0, 1).getTime()
  const to = new Date(year + 1, 0, 1).getTime()
  const rows = db.prepare(`
    SELECT CAST(strftime('%m', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS INTEGER) AS month,
           SUM(ms_played) AS ms_played
    FROM listening_history
    WHERE timestamp >= ? AND timestamp < ? AND artist_name = ?
    GROUP BY month
  `).all(from, to, artistName) as { month: number; ms_played: number }[]
  const monthly = new Array(12).fill(0)
  for (const r of rows) monthly[r.month - 1] = r.ms_played
  return monthly
}
