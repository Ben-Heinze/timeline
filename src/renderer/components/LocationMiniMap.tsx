import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store/useStore'
import type { MapMode } from '../../shared/types'
import type { FeatureCollection } from 'geojson'
import world110 from '../assets/ne_110m_countries.json'

const OCEAN = '#aad3df'
const LAND_STYLE: L.PathOptions = { fillColor: '#ece7d8', fillOpacity: 1, color: '#998f7a', weight: 0.8 }
const PIN_STYLE: L.PathOptions = { weight: 2, color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }

// Point-map zoom per mode — closer than the full MapView's "fit all photos"
// zoom since this only ever centers on a single coordinate.
const ZOOM: Record<MapMode, number> = { offline: 6, hires: 8, online: 13 }

interface Props {
  latitude: number
  longitude: number
}

/** Small, non-interactive map centered on a single entry's GPS coordinate. */
export default function LocationMiniMap({ latitude, longitude }: Props) {
  const { settings } = useStore()
  const mode: MapMode = settings?.mapMode ?? 'offline'
  const containerRef = useRef<HTMLDivElement>(null)
  const [hiresCountries, setHiresCountries] = useState<FeatureCollection | null>(null)

  useEffect(() => {
    if (mode !== 'hires') return
    let cancelled = false
    window.api.map.hiresStatus().then(s => {
      if (cancelled || !s.downloaded) return
      window.api.map.getLayer('countries').then(c => {
        if (!cancelled && c) setHiresCountries(JSON.parse(c))
      })
    })
    return () => { cancelled = true }
  }, [mode])

  useEffect(() => {
    if (!containerRef.current) return
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: ZOOM[mode],
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    })

    if (mode === 'online') {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    } else {
      L.geoJSON((mode === 'hires' && hiresCountries) ? hiresCountries : (world110 as unknown as FeatureCollection), {
        style: LAND_STYLE,
      }).addTo(map)
    }

    L.circleMarker([latitude, longitude], { ...PIN_STYLE, radius: 7 }).addTo(map)

    return () => { map.remove() }
  }, [latitude, longitude, mode, hiresCountries])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 160, borderRadius: 8, background: OCEAN }}
    />
  )
}
