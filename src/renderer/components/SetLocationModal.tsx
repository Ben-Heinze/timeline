import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store/useStore'
import type { MapMode, GeocodeResult, SetLocationResult } from '../../shared/types'
import type { FeatureCollection } from 'geojson'
import world110 from '../assets/ne_110m_countries.json'
import citiesJson from '../assets/cities.json'

// Bundled GeoNames cities15000 gazetteer, sorted by population descending, as
// compact tuples: [name, countryCode, lat, lng, population, asciiName?]. Searched
// entirely in the renderer so place-name lookup works with no network.
type City = [string, string, number, number, number, string?]
const CITIES = citiesJson as unknown as City[]

const OCEAN = '#aad3df'
const LAND_STYLE: L.PathOptions = { fillColor: '#ece7d8', fillOpacity: 1, color: '#998f7a', weight: 0.8 }

interface Props {
  ids: number[]
  onClose: () => void
  onApplied: () => void
}

// ISO country code → English country name, for gazetteer result labels.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
function countryName(cc: string): string {
  try { return regionNames.of(cc) ?? cc } catch { return cc }
}

// Rank offline matches: the list is already population-sorted, so we scan in
// order (most populous first), preferring prefix matches over substring ones,
// and stop once we have enough candidates.
function searchOffline(query: string): GeocodeResult[] {
  const s = query.trim().toLowerCase()
  if (s.length < 2) return []
  const starts: City[] = []
  const contains: City[] = []
  for (const c of CITIES) {
    const name = c[0].toLowerCase()
    const ascii = c[5]?.toLowerCase()
    if (name.startsWith(s) || (ascii && ascii.startsWith(s))) starts.push(c)
    else if (name.includes(s) || (ascii && ascii.includes(s))) contains.push(c)
    if (starts.length + contains.length >= 60) break
  }
  return [...starts, ...contains].slice(0, 6).map(c => ({
    label: `${c[0]}, ${countryName(c[1])}`,
    latitude: c[2],
    longitude: c[3],
    source: 'offline' as const,
  }))
}

const ZOOM_ON_PICK: Record<MapMode, number> = { offline: 6, hires: 8, online: 13 }

export default function SetLocationModal({ ids, onClose, onApplied }: Props) {
  const { settings, bumpRefreshKey } = useStore()
  const globalMode: MapMode = settings?.mapMode ?? 'offline'

  // Local map mode so the user can flip to online tiles for precise placement
  // (street detail) without changing the app-wide map setting.
  const [mode, setMode] = useState<MapMode>(globalMode === 'online' ? 'online' : 'offline')
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [writeExif, setWriteExif] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SetLocationResult | null>(null)
  const [hiresCountries, setHiresCountries] = useState<FeatureCollection | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const baseLayerRef = useRef<L.Layer | null>(null)
  const coordRef = useRef(coord)
  coordRef.current = coord
  // A pending recenter request (prefill / search pick), consumed once the map exists.
  // User clicks and drags deliberately do NOT set this, so they never zoom-jump.
  const pendingCenter = useRef<{ lat: number; lng: number } | null>(null)

  // Prefill the pin from the first selected entry's existing coordinate, if any.
  useEffect(() => {
    let alive = true
    if (ids.length > 0) {
      window.api.entries.get(ids[0]).then(e => {
        if (alive && e && e.latitude != null && e.longitude != null) {
          pendingCenter.current = { lat: e.latitude, lng: e.longitude }
          setCoord({ lat: e.latitude, lng: e.longitude })
        }
      })
    }
    return () => { alive = false }
  }, [ids])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load hi-res country outlines once, if that mode is available.
  useEffect(() => {
    if (mode !== 'hires' || hiresCountries) return
    let cancelled = false
    window.api.map.hiresStatus().then(s => {
      if (cancelled || !s.downloaded) return
      window.api.map.getLayer('countries').then(c => {
        if (!cancelled && c) setHiresCountries(JSON.parse(c))
      })
    })
    return () => { cancelled = true }
  }, [mode, hiresCountries])

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start = coordRef.current
    const map = L.map(containerRef.current, {
      center: start ? [start.lat, start.lng] : [25, 0],
      zoom: start ? ZOOM_ON_PICK[mode] : 2,
      minZoom: 2,
      worldCopyJump: true,
    })
    mapRef.current = map
    // Click anywhere to drop / move the pin.
    map.on('click', (e: L.LeafletMouseEvent) => {
      setCoord({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      baseLayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the base layer when the mode (or loaded hi-res data) changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (baseLayerRef.current) { map.removeLayer(baseLayerRef.current); baseLayerRef.current = null }
    let layer: L.Layer
    if (mode === 'online') {
      layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      map.setMaxZoom(19)
    } else {
      const data = (mode === 'hires' && hiresCountries) ? hiresCountries : (world110 as unknown as FeatureCollection)
      layer = L.geoJSON(data, { style: LAND_STYLE, attribution: 'Natural Earth' })
      map.setMaxZoom(mode === 'hires' ? 11 : 8)
    }
    layer.addTo(map)
    baseLayerRef.current = layer
  }, [mode, hiresCountries])

  // Keep the draggable marker in sync with `coord`.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!coord) {
      if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null }
      return
    }
    if (!markerRef.current) {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);'
          + 'background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 18],
      })
      const marker = L.marker([coord.lat, coord.lng], { draggable: true, icon }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setCoord({ lat: p.lat, lng: p.lng })
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLatLng([coord.lat, coord.lng])
    }
    // Honor a pending recenter (prefill / picked search result) now the map is ready.
    if (pendingCenter.current) {
      map.setView([pendingCenter.current.lat, pendingCenter.current.lng], ZOOM_ON_PICK[mode])
      pendingCenter.current = null
    }
  }, [coord, mode])

  // Debounced place-name search: instant offline gazetteer, plus online Nominatim
  // (street/POI precision) when the map is in online mode.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    const offline = searchOffline(q)
    setResults(offline)
    if (mode !== 'online') return
    setSearching(true)
    let cancelled = false
    const t = setTimeout(async () => {
      const online = await window.api.map.geocode(q)
      if (cancelled) return
      // Online hits first (more precise), then any offline names not already covered.
      const seen = new Set(online.map(r => r.label.split(',')[0].toLowerCase()))
      const merged = [...online, ...offline.filter(r => !seen.has(r.label.split(',')[0].toLowerCase()))]
      setResults(merged.slice(0, 8))
      setSearching(false)
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, mode])

  function pick(r: GeocodeResult) {
    setCoord({ lat: r.latitude, lng: r.longitude })
    setQuery('')
    setResults([])
    mapRef.current?.flyTo([r.latitude, r.longitude], ZOOM_ON_PICK[mode], { duration: 0.6 })
  }

  async function apply() {
    if (busy || !coord) return
    setBusy(true)
    try {
      const res = await window.api.entries.setLocation({
        ids, latitude: coord.lat, longitude: coord.lng, writeExif,
      })
      onApplied()
      bumpRefreshKey()
      if (!writeExif) { onClose(); return }
      setResult(res)
    } finally {
      setBusy(false)
    }
  }

  const many = ids.length > 1

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 20, width: 460, maxWidth: '92vw',
        border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Set location</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            {ids.length} {ids.length === 1 ? 'item' : 'items'}
          </p>
        </div>

        {result ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
              <div><strong>{result.updated}</strong> {result.updated === 1 ? 'location' : 'locations'} updated</div>
              <div><strong>{result.exifWritten}</strong> {result.exifWritten === 1 ? 'file' : 'files'} written to disk</div>
              {result.exifSkipped > 0 && (
                <div style={{ color: 'var(--text-4)' }}>
                  {result.exifSkipped} skipped (referenced originals / non-photos / missing)
                </div>
              )}
              {result.exifFailed > 0 && (
                <div style={{ color: '#ef4444' }}>{result.exifFailed} failed to write</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        ) : (
          <>
            {/* Search box + results dropdown */}
            <div style={{ position: 'relative' }}>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search a city or place — e.g. Belize City"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid var(--border-strong)', borderRadius: 6,
                  padding: '8px 10px', fontSize: 13,
                  background: 'var(--bg-input)', color: 'var(--text)', outline: 'none',
                }}
              />
              {results.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.2)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
                }}>
                  {results.map((r, i) => (
                    <div
                      key={`${r.source}-${i}-${r.label}`}
                      onClick={() => pick(r)}
                      style={{
                        padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        borderBottom: i < results.length - 1 ? '1px solid var(--border-light)' : 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.label}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                        color: 'var(--text-4)', flexShrink: 0,
                      }}>
                        {r.source}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Map */}
            <div style={{ position: 'relative' }}>
              <div ref={containerRef} style={{ width: '100%', height: 260, borderRadius: 8, background: OCEAN }} />
              {/* Mode toggle */}
              <div style={{
                position: 'absolute', top: 8, right: 8, zIndex: 500,
                display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              }}>
                {(['offline', 'online'] as MapMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    style={{
                      padding: '4px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
                      background: mode === m ? 'var(--accent)' : 'transparent',
                      color: mode === m ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {m === 'offline' ? 'Simple' : 'Detailed (online)'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: -4 }}>
              {coord
                ? <>Pin at <strong style={{ color: 'var(--text-3)' }}>{coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}</strong> — drag it or click the map to adjust.{searching ? ' · searching…' : ''}</>
                : <>Search a place above, or click on the map to drop a pin.{searching ? ' · searching…' : ''}</>}
            </div>

            {/* Write-to-file option */}
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)' }}>
              <input type="checkbox" checked={writeExif} onChange={e => setWriteExif(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                Also write GPS into the photo/video file
                <span style={{ display: 'block', color: 'var(--text-4)', fontSize: 11, marginTop: 2 }}>
                  Copied files only — your referenced originals are never modified.
                </span>
              </span>
            </label>

            {many && coord && (
              <p style={{ margin: '-4px 0 0', fontSize: 11, color: 'var(--text-4)' }}>
                All {ids.length} items will be set to this location.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={apply}
                disabled={busy || !coord}
                style={{ ...primaryBtn, flex: 1, opacity: busy || !coord ? 0.5 : 1 }}
              >
                {busy ? 'Saving…' : 'Save location'}
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px', fontSize: 13, background: 'none',
                  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
}
