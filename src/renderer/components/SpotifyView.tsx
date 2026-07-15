import React, { useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { YearlySpotifySummary } from '../../shared/types'

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function formatPlaytime(ms: number): string {
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function YearCard({ summary }: { summary: YearlySpotifySummary }) {
  const maxArtistMs = summary.topArtists[0]?.ms_played ?? 0
  const maxMonthMs = Math.max(1, ...summary.monthly)

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 18, display: 'flex', gap: 24, flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 140, flexShrink: 0 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{summary.year}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
          {formatPlaytime(summary.msPlayed)} · {summary.playCount.toLocaleString()} plays
        </div>
        {summary.topTrack && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-4)' }}>
              Most played
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginTop: 3 }}>
              {summary.topTrack.track_name}
            </div>
            {summary.topTrack.artist_name && (
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{summary.topTrack.artist_name}</div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 1 }}>
              {summary.topTrack.play_count} play{summary.topTrack.play_count === 1 ? '' : 's'}
            </div>
          </div>
        )}

        {/* Monthly mini bar chart */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, marginTop: 14 }}>
          {summary.monthly.map((ms, i) => (
            <div
              key={i}
              title={`${formatPlaytime(ms)}`}
              style={{
                flex: 1, height: `${Math.max(2, (ms / maxMonthMs) * 32)}px`,
                background: '#1DB954', opacity: ms > 0 ? 0.75 : 0.15, borderRadius: 1.5,
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
          {MONTH_LABELS.map((m, i) => (
            <div key={i} style={{ flex: 1, fontSize: 8, textAlign: 'center', color: 'var(--text-4)' }}>{m}</div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6 }}>
          Top artists
        </div>
        {summary.topArtists.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No music plays this year.</div>
        ) : (
          summary.topArtists.map((a, i) => (
            <div key={a.artist_name} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, width: 14, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{
                  fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.artist_name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                  {formatPlaytime(a.ms_played)}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--bg-subtle)', borderRadius: 2, marginTop: 3, marginLeft: 22, overflow: 'hidden' }}>
                <div style={{
                  width: `${maxArtistMs > 0 ? (a.ms_played / maxArtistMs) * 100 : 0}%`,
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

export default function SpotifyView() {
  const { activeView, refreshKey, spotifySummaries, spotifySummariesKey, setSpotifySummaries } = useStore()

  // Serve the store cache immediately; only refetch when it's missing or stale
  // (an import bumps refreshKey). This avoids the "Loading…" flash and the heavy
  // main-process aggregation on every tab switch.
  const isStale = spotifySummariesKey !== refreshKey
  const summaries = isStale ? null : spotifySummaries

  useEffect(() => {
    if (activeView !== 'spotify' || !isStale) return
    let cancelled = false
    window.api.spotify.yearlySummaries().then(res => {
      if (!cancelled) setSpotifySummaries(res, refreshKey)
    })
    return () => { cancelled = true }
  }, [activeView, refreshKey, isStale, setSpotifySummaries])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {summaries === null ? (
          <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        ) : summaries.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13, lineHeight: 1.6 }}>
            No listening history imported yet.<br />
            Import your Spotify "Extended streaming history" export from Settings to see yearly recaps here.
          </div>
        ) : (
          summaries.map(s => <YearCard key={s.year} summary={s} />)
        )}
      </div>
    </div>
  )
}
