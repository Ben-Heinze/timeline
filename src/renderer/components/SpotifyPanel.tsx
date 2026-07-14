import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ArtistPlaytime } from '../../shared/types'

const fmtDay = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function formatPlaytime(ms: number): string {
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export default function SpotifyPanel() {
  const { spotifyPanelOpen, setSpotifyPanelOpen, selectedPeriod, visibleRange, refreshKey } = useStore()
  const [artists, setArtists] = useState<ArtistPlaytime[]>([])

  const [from, to] = selectedPeriod ?? visibleRange
  const scopeLabel = selectedPeriod
    ? `during ${fmtDay(selectedPeriod[0])}`
    : 'in the visible range'

  useEffect(() => {
    if (!spotifyPanelOpen) return
    let cancelled = false
    window.api.spotify.topArtists(from, to, 50).then(res => {
      if (!cancelled) setArtists(res)
    })
    return () => { cancelled = true }
  }, [spotifyPanelOpen, from, to, refreshKey])

  if (!spotifyPanelOpen) return null

  const maxMs = artists.length > 0 ? artists[0].ms_played : 0

  return (
    <aside style={{
      width: 272, flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Spotify</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            top artists {scopeLabel}
          </div>
        </div>
        <button
          onClick={() => setSpotifyPanelOpen(false)}
          title="Close panel"
          style={{
            marginLeft: 'auto',
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 15, lineHeight: 1, padding: '0 2px', color: 'var(--text-3)', flexShrink: 0,
          }}
        >×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {artists.length === 0 ? (
          <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6 }}>
            No listening history {scopeLabel}.
          </div>
        ) : (
          artists.map((a, i) => (
            <div key={a.artist_name} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, width: 16, flexShrink: 0 }}>
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
              <div style={{ height: 4, background: 'var(--bg-subtle)', borderRadius: 2, marginTop: 4, marginLeft: 24, overflow: 'hidden' }}>
                <div style={{
                  width: `${maxMs > 0 ? (a.ms_played / maxMs) * 100 : 0}%`,
                  height: '100%', background: '#1DB954', borderRadius: 2,
                }} />
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
