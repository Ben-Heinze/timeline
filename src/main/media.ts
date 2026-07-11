import http from 'http'
import crypto from 'crypto'
import path, { extname } from 'path'
import { createReadStream, statSync } from 'fs'
import type { AddressInfo } from 'net'
import { getEntry } from './db/queries/entries'
import { getLibraryPath } from './library'

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.flac': 'audio/flac',
}

/** Absolute path to the entry's file on disk, or null if it has none. */
export function resolveEntryFilePath(entryId: number): string | null {
  const entry = getEntry(entryId)
  if (!entry?.file_path) return null
  return entry.import_mode === 'reference'
    ? entry.file_path
    : path.join(getLibraryPath(), entry.file_path)
}

// Media is served over a loopback HTTP server rather than a custom protocol:
// Electron 31's protocol.handle/registerFileProtocol break Chromium's media
// pipeline on the second Range request, so large video/audio files stall or
// error. HTTP is the one loader path where ranged media reads are reliable.
// The random token keeps other local processes / web pages from fetching
// library files off the port.
let serverPort = 0
const serverToken = crypto.randomBytes(16).toString('hex')

export function getMediaUrl(entryId: number): string | null {
  if (!serverPort || !resolveEntryFilePath(entryId)) return null
  return `http://127.0.0.1:${serverPort}/media/${entryId}?token=${serverToken}`
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const match = url.pathname.match(/^\/media\/(\d+)$/)
  if (req.method !== 'GET' || !match || url.searchParams.get('token') !== serverToken) {
    res.writeHead(403).end()
    return
  }

  const abs = resolveEntryFilePath(Number(match[1]))
  let size: number
  try { size = statSync(abs!).size } catch { res.writeHead(404).end(); return }

  const mime = MEDIA_MIME[extname(abs!).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/)

  let start = 0
  let end = size - 1
  if (range) {
    start = Number(range[1])
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
  }

  res.writeHead(range ? 206 : 200, {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  })
  const stream = createReadStream(abs!, { start, end })
  stream.pipe(res)
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
}

export function startMediaServer(): Promise<void> {
  const server = http.createServer(handleRequest)
  server.unref()
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as AddressInfo).port
      resolve()
    })
  })
}
