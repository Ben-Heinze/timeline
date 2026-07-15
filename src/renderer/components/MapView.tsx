import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.heat'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store/useStore'
import type { Entry, MapMode } from '../../shared/types'
import type { FeatureCollection } from 'geojson'
import world110 from '../assets/ne_110m_countries.json'

const OCEAN = '#aad3df'
const LAND_STYLE: L.PathOptions = { fillColor: '#ece7d8', fillOpacity: 1, color: '#998f7a', weight: 0.8 }
const STATE_STYLE: L.PathOptions = { color: '#a89f8d', weight: 0.7, dashArray: '4 3', fill: false }

// How far the "fit to my photos" zoom may go per mode: offline basemaps have
// no street detail, so zooming close just shows blank land.
const FIT_MAX_ZOOM: Record<MapMode, number> = { offline: 5, hires: 7, online: 11 }

const MODE_LABEL: Record<MapMode, string> = {
  offline: 'Simple (offline)',
  online: 'OpenStreetMap (online)',
  hires: 'Detailed (offline)',
}

interface HiresData {
  countries: FeatureCollection
  states: FeatureCollection | null
  places: FeatureCollection | null
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Click tolerance in screen pixels — matches the heat layer's own radius so
// clicking anywhere on a visible "blob" picks up the photos that make it up.
const CLICK_RADIUS_PX = 26

export default function MapView() {
  const { refreshKey, settings, setSettings, selectedLocation, setSelectedLocation } = useStore()
  const mode: MapMode = settings?.mapMode ?? 'offline'
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const heatRef = useRef<L.Layer | null>(null)
  const baseLayersRef = useRef<L.Layer[]>([])
  const locatedRef = useRef<Entry[]>([])
  const selectionCircleRef = useRef<L.Circle | null>(null)
  const [located, setLocated] = useState<Entry[] | null>(null)
  const [hiresDownloaded, setHiresDownloaded] = useState<boolean | null>(null)
  const [hiresData, setHiresData] = useState<HiresData | null>(null)
  const [dl, setDl] = useState<{ received: number; total: number } | null>(null)
  const [dlError, setDlError] = useState<string | null>(null)
  const [clickMarker, setClickMarker] = useState<{ lat: number; lng: number; radiusMeters: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [25, 0],
      zoom: 2,
      minZoom: 2,
      worldCopyJump: true,
      preferCanvas: true,
    })
    // Basemap vectors get their own pane between the tile pane (200) and the
    // overlay pane (400), so land polygons never paint over the heatmap.
    map.createPane('basemap')
    map.getPane('basemap')!.style.zIndex = '250'
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      heatRef.current = null
      baseLayersRef.current = []
    }
  }, [])

  useEffect(() => {
    window.api.map.hiresStatus().then(s => setHiresDownloaded(s.downloaded))
    return window.api.map.onDownloadProgress(ev => setDl({ received: ev.received, total: ev.total }))
  }, [])

  // Load hi-res GeoJSON from disk once downloaded and the mode wants it
  useEffect(() => {
    if (mode !== 'hires' || hiresDownloaded !== true || hiresData) return
    let cancelled = false
    Promise.all([
      window.api.map.getLayer('countries'),
      window.api.map.getLayer('states'),
      window.api.map.getLayer('places'),
    ]).then(([c, s, p]) => {
      if (cancelled || !c) return
      setHiresData({
        countries: JSON.parse(c),
        states: s ? JSON.parse(s) : null,
        places: p ? JSON.parse(p) : null,
      })
    })
    return () => { cancelled = true }
  }, [mode, hiresDownloaded, hiresData])

  // Swap base layers when the mode changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const layer of baseLayersRef.current) map.removeLayer(layer)
    baseLayersRef.current = []
    const add = (layer: L.Layer) => {
      layer.addTo(map)
      baseLayersRef.current.push(layer)
    }

    if (mode === 'online') {
      add(L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }))
      map.setMaxZoom(19)
    } else if (mode === 'hires' && hiresData) {
      add(L.geoJSON(hiresData.countries, {
        style: LAND_STYLE, pane: 'basemap', attribution: 'Natural Earth',
      }))
      if (hiresData.states) {
        add(L.geoJSON(hiresData.states, { style: STATE_STYLE, pane: 'basemap' }))
      }
      if (hiresData.places) {
        add(L.geoJSON(hiresData.places, {
          pane: 'basemap',
          pointToLayer: (feature, latlng) =>
            L.circleMarker(latlng, {
              radius: 2.5, weight: 0, fillColor: '#6b6252', fillOpacity: 0.85,
              pane: 'basemap',
            }).bindTooltip(String(feature.properties?.name ?? ''), { direction: 'top' }),
        }))
      }
      map.setMaxZoom(11)
    } else {
      // Bundled low-res world map — also the fallback while hi-res data
      // hasn't been downloaded or is still loading
      add(L.geoJSON(world110 as unknown as FeatureCollection, {
        style: LAND_STYLE, pane: 'basemap', attribution: 'Natural Earth',
      }))
      map.setMaxZoom(8)
    }
  }, [mode, hiresData])

  useEffect(() => {
    let cancelled = false
    window.api.entries.locations().then(entries => {
      if (!cancelled) setLocated(entries)
    })
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    locatedRef.current = located ?? []
  }, [located])

  // Click a heat blob to see the photos that make it up. Tolerance is a
  // fixed screen-pixel radius converted to ground distance at click time, so
  // it stays visually consistent (and clickable) at every zoom level.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMapClick = (e: L.LeafletMouseEvent) => {
      const clickPt = map.latLngToContainerPoint(e.latlng)
      const edgeLatLng = map.containerPointToLatLng(clickPt.add(L.point(CLICK_RADIUS_PX, 0)))
      const radiusMeters = map.distance(e.latlng, edgeLatLng)
      const nearby = locatedRef.current.filter(entry =>
        map.distance([entry.latitude!, entry.longitude!], e.latlng) <= radiusMeters
      )
      if (nearby.length > 0) {
        setSelectedLocation(nearby)
        setClickMarker({ lat: e.latlng.lat, lng: e.latlng.lng, radiusMeters })
      } else {
        setSelectedLocation(null)
        setClickMarker(null)
      }
    }
    map.on('click', onMapClick)
    return () => { map.off('click', onMapClick) }
  }, [setSelectedLocation])

  // Keep the on-map selection ring in sync if the panel gets closed elsewhere
  useEffect(() => {
    if (selectedLocation === null) setClickMarker(null)
  }, [selectedLocation])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (selectionCircleRef.current) {
      map.removeLayer(selectionCircleRef.current)
      selectionCircleRef.current = null
    }
    if (clickMarker) {
      selectionCircleRef.current = L.circle([clickMarker.lat, clickMarker.lng], {
        radius: clickMarker.radiusMeters,
        color: '#ffffff', weight: 2, dashArray: '4 4', fillColor: '#ffffff', fillOpacity: 0.08,
        interactive: false,
      }).addTo(map)
    }
  }, [clickMarker])

  useEffect(() => {
    const map = mapRef.current
    if (!map || located === null) return

    if (heatRef.current) {
      map.removeLayer(heatRef.current)
      heatRef.current = null
    }
    if (located.length === 0) return

    const points = located.map(e => [e.latitude!, e.longitude!, 1] as [number, number, number])
    heatRef.current = L.heatLayer(points, {
      radius: 22,
      blur: 16,
      maxZoom: 11,
      minOpacity: 0.35,
    }).addTo(map)

    const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng] as [number, number]))
    map.fitBounds(bounds.pad(0.2), { maxZoom: FIT_MAX_ZOOM[mode] })
  }, [located, mode])

  function setMode(m: MapMode) {
    if (!settings) return
    setSettings({ ...settings, mapMode: m })
    window.api.settings.set({ mapMode: m })
  }

  async function startDownload() {
    setDlError(null)
    setDl({ received: 0, total: 0 })
    try {
      await window.api.map.downloadHires()
      const status = await window.api.map.hiresStatus()
      setHiresDownloaded(status.downloaded)
      if (!status.downloaded) setDlError('Download did not complete — try again.')
    } catch (e) {
      setDlError((e as Error).message ?? String(e))
    }
    setDl(null)
  }

  const panel: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  }
  const modeBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-fg)' : 'var(--text-2)',
    border: 'none', borderRadius: 5,
    fontWeight: active ? 600 : 400,
  })

  const showDownloadPrompt = mode === 'hires' && hiresDownloaded === false

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0, isolation: 'isolate' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: OCEAN }} />

      {/* Mode switcher */}
      <div style={{
        ...panel,
        position: 'absolute', top: 12, right: 12, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 2, padding: 4,
      }}>
        {(['offline', 'online', 'hires'] as MapMode[]).map(m => (
          <button key={m} style={modeBtn(mode === m)} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {/* Hi-res download prompt / progress */}
      {showDownloadPrompt && (
        <div style={{
          ...panel,
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, padding: '12px 16px', maxWidth: 380,
          fontSize: 12, color: 'var(--text-2)',
        }}>
          {dl === null ? (
            <>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                Detailed offline map not downloaded yet
              </div>
              <div style={{ marginBottom: 10 }}>
                A one-time ~40 MB download (Natural Earth, public domain) adds detailed
                coastlines, state borders, and cities — rendered fully offline.
                Until then the simple map is shown.
              </div>
              {dlError && <div style={{ color: '#ef4444', marginBottom: 8 }}>{dlError}</div>}
              <button
                onClick={startDownload}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  border: 'none', borderRadius: 5,
                }}
              >Download map data</button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                Downloading map data… {dl.total > 0 ? `${formatMB(dl.received)} / ${formatMB(dl.total)}` : ''}
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: 'var(--accent)',
                  width: dl.total > 0 ? `${Math.round((dl.received / dl.total) * 100)}%` : '10%',
                  transition: 'width 200ms',
                }} />
              </div>
            </>
          )}
        </div>
      )}

      {located !== null && located.length === 0 && (
        <div style={{
          ...panel,
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, padding: '8px 16px',
          fontSize: 13, color: 'var(--text-2)', whiteSpace: 'nowrap',
        }}>
          No photos with location data yet — photos with GPS info will appear here when imported.
        </div>
      )}
      {located !== null && located.length > 0 && (
        <div style={{
          ...panel,
          position: 'absolute', top: 12, left: 54, zIndex: 1000,
          padding: '4px 10px', borderRadius: 6,
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
            {located.length} photo{located.length !== 1 ? 's' : ''} with location
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
            Click a hotspot to see its photos
          </span>
        </div>
      )}
    </div>
  )
}
