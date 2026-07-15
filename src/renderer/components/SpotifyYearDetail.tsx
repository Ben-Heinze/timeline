import React, { useEffect, useState } from 'react'
import type { YearDetail, ArtistPlaytime, TrackPlaytime, AlbumPlaytime } from '../../shared/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}:00`)
const HOUR_TICKS = HOUR_LABELS.map((l, i) => (i % 3 === 0 ? String(i) : ''))

function formatPlaytime(ms: number): string {
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-4)',
    }}>
      {children}
    </div>
  )
}

function BarChart({
  data, tickLabels, tooltipLabels, color, height = 120,
}: { data: number[]; tickLabels: string[]; tooltipLabels?: string[]; color: string; height?: number }) {
  const max = Math.max(1, ...data)
  const labelsForTooltip = tooltipLabels ?? tickLabels
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
        {data.map((v, i) => (
          <div
            key={i}
            title={`${labelsForTooltip[i]}: ${formatPlaytime(v)}`}
            style={{
              flex: 1, height: Math.max(2, (v / max) * height),
              background: color, opacity: v > 0 ? 0.85 : 0.15, borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {tickLabels.map((l, i) => (
          <div key={i} style={{ flex: 1, fontSize: 9, textAlign: 'center', color: 'var(--text-4)' }}>{l}</div>
        ))}
      </div>
    </div>
  )
}

function RankedList<T,>({
  title, items, getKey, getLabel, getSubLabel, getMs,
}: {
  title: string
  items: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  getSubLabel: (item: T) => string | null
  getMs: (item: T) => number
}) {
  const maxMs = items[0] ? getMs(items[0]) : 0
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ marginTop: 10 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No data.</div>
        ) : (
          items.map((item, i) => (
            <div key={getKey(item)} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, width: 16, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{
                  fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {getLabel(item)}
                  {getSubLabel(item) && (
                    <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> — {getSubLabel(item)}</span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{formatPlaytime(getMs(item))}</span>
              </div>
              <div style={{ height: 4, background: 'var(--bg-subtle)', borderRadius: 2, marginTop: 3, marginLeft: 24, overflow: 'hidden' }}>
                <div style={{
                  width: `${maxMs > 0 ? (getMs(item) / maxMs) * 100 : 0}%`,
                  height: '100%', background: '#1DB954', borderRadius: 2,
                }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}

export default function SpotifyYearDetail({ year, onBack }: { year: number; onBack: () => void }) {
  const [detail, setDetail] = useState<YearDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [artistFilter, setArtistFilter] = useState('')
  const [filteredMonthly, setFilteredMonthly] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDetail(null)
    setArtistFilter('')
    setFilteredMonthly(null)
    window.api.spotify.yearDetail(year).then(res => {
      if (!cancelled) { setDetail(res); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [year])

  useEffect(() => {
    if (!artistFilter) { setFilteredMonthly(null); return }
    let cancelled = false
    window.api.spotify.artistMonthlyForYear(year, artistFilter).then(res => {
      if (!cancelled) setFilteredMonthly(res)
    })
    return () => { cancelled = true }
  }, [year, artistFilter])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <button
          onClick={onBack}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0',
            fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600, marginBottom: 12,
          }}
        >
          ← All years
        </button>

        {loading ? (
          <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        ) : detail === null ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
            No listening history for {year}.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text)' }}>{year}</div>
              {detail.firstPlay !== null && detail.lastPlay !== null && (
                <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
                  {formatDay(detail.firstPlay)} – {formatDay(detail.lastPlay)}
                </div>
              )}
            </div>

            <div style={{
              display: 'flex', gap: 28, flexWrap: 'wrap', padding: '16px 0 20px',
              borderBottom: '1px solid var(--border-light)', marginBottom: 20,
            }}>
              <StatTile label="Listening time" value={formatPlaytime(detail.msPlayed)} />
              <StatTile label="Plays" value={detail.playCount.toLocaleString()} />
              <StatTile label="Artists" value={detail.uniqueArtists.toLocaleString()} />
              <StatTile label="Albums" value={detail.uniqueAlbums.toLocaleString()} />
              <StatTile label="Tracks" value={detail.uniqueTracks.toLocaleString()} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <SectionLabel>Listening by month</SectionLabel>
                  <select
                    value={artistFilter}
                    onChange={e => setArtistFilter(e.target.value)}
                    style={{
                      fontSize: 11.5, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--bg-subtle)', color: 'var(--text)',
                    }}
                  >
                    <option value="">All music</option>
                    {detail.topArtists.map(a => (
                      <option key={a.artist_name} value={a.artist_name}>{a.artist_name}</option>
                    ))}
                  </select>
                </div>
                <BarChart
                  data={artistFilter ? (filteredMonthly ?? new Array(12).fill(0)) : detail.monthly}
                  tickLabels={MONTH_LABELS}
                  color="#1DB954"
                  height={130}
                />
              </Card>
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 300 }}>
                <Card>
                  <SectionLabel>By day of week</SectionLabel>
                  <div style={{ marginTop: 12 }}>
                    <BarChart data={detail.dayOfWeek} tickLabels={DOW_LABELS} color="#1DB954" height={90} />
                  </div>
                </Card>
              </div>
              <div style={{ flex: 1, minWidth: 300 }}>
                <Card>
                  <SectionLabel>By hour of day</SectionLabel>
                  <div style={{ marginTop: 12 }}>
                    <BarChart
                      data={detail.hourOfDay}
                      tickLabels={HOUR_TICKS}
                      tooltipLabels={HOUR_LABELS}
                      color="#1DB954"
                      height={90}
                    />
                  </div>
                </Card>
              </div>
            </div>

            <Card>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                <RankedList<ArtistPlaytime>
                  title="Top artists"
                  items={detail.topArtists.slice(0, 10)}
                  getKey={a => a.artist_name}
                  getLabel={a => a.artist_name}
                  getSubLabel={() => null}
                  getMs={a => a.ms_played}
                />
                <RankedList<AlbumPlaytime>
                  title="Top albums"
                  items={detail.topAlbums.slice(0, 10)}
                  getKey={a => `${a.album_name}::${a.artist_name ?? ''}`}
                  getLabel={a => a.album_name}
                  getSubLabel={a => a.artist_name}
                  getMs={a => a.ms_played}
                />
                <RankedList<TrackPlaytime>
                  title="Top tracks"
                  items={detail.topTracks.slice(0, 10)}
                  getKey={t => `${t.track_name}::${t.artist_name ?? ''}`}
                  getLabel={t => t.track_name}
                  getSubLabel={t => t.artist_name}
                  getMs={t => t.ms_played}
                />
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
