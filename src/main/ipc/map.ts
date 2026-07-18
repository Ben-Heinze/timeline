import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getLibraryPath } from '../library'
import type { MapHiresLayer, GeocodeResult } from '../../shared/types'

// Natural Earth 10m data (public domain) rendered locally for the hi-res
// offline map. Downloaded on demand into <library>/map/.
const LAYERS: Record<MapHiresLayer, { file: string; url: string }> = {
  countries: {
    file: 'ne_10m_admin_0_countries.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson',
  },
  states: {
    file: 'ne_10m_admin_1_states_provinces_lines.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson',
  },
  places: {
    file: 'ne_10m_populated_places_simple.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson',
  },
}

const mapDir = () => path.join(getLibraryPath(), 'map')

async function allDownloaded(): Promise<boolean> {
  for (const { file } of Object.values(LAYERS)) {
    try { await fs.access(path.join(mapDir(), file)) } catch { return false }
  }
  return true
}

async function contentLength(url: string): Promise<number> {
  const res = await fetch(url, { method: 'HEAD' })
  return Number(res.headers.get('content-length') ?? 0)
}

async function downloadTo(
  url: string,
  dest: string,
  onChunk: (bytes: number) => void,
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${url}`)
  const chunks: Buffer[] = []
  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    onChunk(value.byteLength)
  }
  const tmp = `${dest}.download`
  await fs.writeFile(tmp, Buffer.concat(chunks))
  await fs.rename(tmp, dest)
}

let downloading = false

export function registerMapHandlers(): void {
  ipcMain.handle('map:hiresStatus', async () => ({
    downloaded: await allDownloaded(),
    downloading,
  }))

  ipcMain.handle('map:getLayer', async (_, layer: MapHiresLayer) => {
    const def = LAYERS[layer]
    if (!def) return null
    try {
      return await fs.readFile(path.join(mapDir(), def.file), 'utf-8')
    } catch {
      return null
    }
  })

  // Online place-name lookup via OpenStreetMap Nominatim. Runs in main so we can
  // send the User-Agent their usage policy requires and dodge renderer CORS/CSP.
  // The renderer also searches a bundled offline gazetteer; this adds street- and
  // POI-level precision when the user is online.
  ipcMain.handle('geocode:search', async (_, query: string): Promise<GeocodeResult[]> => {
    const q = query.trim()
    if (!q) return []
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Timeline-Photo-App/1.0 (personal photo library)' },
      })
      if (!res.ok) return []
      const rows = await res.json() as Array<{ display_name: string; lat: string; lon: string }>
      return rows.map(r => ({
        label: r.display_name,
        latitude: Number(r.lat),
        longitude: Number(r.lon),
        source: 'online' as const,
      })).filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    } catch {
      return []
    }
  })

  ipcMain.handle('map:downloadHires', async (event) => {
    if (downloading) return
    downloading = true
    const sender = event.sender
    try {
      await fs.mkdir(mapDir(), { recursive: true })
      const defs = Object.values(LAYERS)
      const sizes = await Promise.all(defs.map(d => contentLength(d.url)))
      const total = sizes.reduce((a, b) => a + b, 0)

      let received = 0
      let lastSent = 0
      for (const def of defs) {
        await downloadTo(def.url, path.join(mapDir(), def.file), (bytes) => {
          received += bytes
          // Throttle progress events to every 256 KB
          if (received - lastSent >= 256 * 1024 || received === total) {
            lastSent = received
            if (!sender.isDestroyed()) {
              sender.send('map:downloadProgress', { received, total, file: def.file })
            }
          }
        })
      }
    } finally {
      downloading = false
    }
  })
}
