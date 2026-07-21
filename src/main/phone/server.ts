import http from 'http'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import busboy from 'busboy'
import { app } from 'electron'
import type { WebContents } from 'electron'
import type { AddressInfo } from 'net'
import { ingestFiles } from '../ingest'
import { writeImportErrorLog } from '../ipc/ingest'
import { renderUploadPage } from './uploadPage'
import type { PhoneStartResult, IngestDoneEvent, IngestFailure } from '../../shared/types'

// The phone-upload receiver. Unlike the media server (src/main/media.ts) this binds
// to 0.0.0.0 so a phone on the same Wi-Fi can reach it — the phone can't see 127.0.0.1.
// The random per-session token is the only access guard, so this is meant for trusted
// networks and only runs on-demand while the "Import from phone" panel is open.

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB — generous headroom for long videos
const MAX_FILES = 1000
const PROGRESS_STEP = 512 * 1024 // throttle byte-progress events to one per ~512 KB

// A STABLE port (not an OS-assigned random one) so a firewall can whitelist it once —
// desktop firewalls (NixOS, Windows, macOS) block inbound LAN ports by default, and you
// can't add a rule for a port that changes every launch. Override with TIMELINE_PHONE_PORT.
// On conflict we walk a small contiguous range, so a range rule (47820–47829) still covers it.
const BASE_PORT = Number(process.env.TIMELINE_PHONE_PORT) || 47820
const PORT_ATTEMPTS = 10

let server: http.Server | null = null
let port = 0
let token = ''
let stagingDir = ''
let progressSender: WebContents | null = null

// Serialize only the ingest phase across concurrent uploads so two phones don't
// interleave on the single shared progress banner. Uploads still stream to disk
// concurrently; only ingestFiles() runs one batch at a time.
let ingestChain: Promise<void> = Promise.resolve()

function send(channel: string, data: unknown): void {
  if (progressSender && !progressSender.isDestroyed()) progressSender.send(channel, data)
}

/** Non-internal IPv4 addresses, most-likely-reachable first. May be empty (no LAN). */
export function getLanIps(): string[] {
  const candidates: { ip: string; score: number }[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!addrs) continue
    for (const a of addrs) {
      // Node <18 reports family as the string 'IPv4'; newer versions may use the number 4.
      const isV4 = a.family === 'IPv4' || (a.family as unknown as number) === 4
      if (!isV4 || a.internal || a.address.startsWith('169.254.')) continue
      let score = 0
      if (a.address.startsWith('192.168.')) score += 100
      else if (a.address.startsWith('10.')) score += 80
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 60
      else score += 20
      // De-prioritize VPN / virtual / container interfaces — a phone can't reach those.
      if (/^(veth|docker|br-|vmnet|vboxnet|utun|tun|tap|wg|zt|hyper-v|vEthernet)/i.test(name)) score -= 50
      candidates.push({ ip: a.address, score })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  return candidates.map(c => c.ip)
}

function sanitizeFilename(name: string | undefined): string {
  const base = path.basename(name ?? '').replace(/[/\\]/g, '_').trim()
  if (!base || base === '.' || base === '..') return `upload-${crypto.randomBytes(4).toString('hex')}`
  return base
}

function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) { used.add(name); return name }
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let i = 2
  let candidate = `${stem} (${i})${ext}`
  while (used.has(candidate)) { i++; candidate = `${stem} (${i})${ext}` }
  used.add(candidate)
  return candidate
}

// A readable message page instead of an empty body, so a mobile browser never
// renders an error as a blank (black, in dark mode) screen.
function sendMessage(res: http.ServerResponse, code: number, message: string): void {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light dark">'
    + `<body style="font:16px/1.5 system-ui,sans-serif;padding:40px;text-align:center">${message}</body>`)
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  // Constant-time-ish compare isn't needed; the token is single-use per session.
  if (!token || url.searchParams.get('token') !== token) {
    sendMessage(res, 403, 'This link has expired. On your computer, reopen “Import from phone” and scan the new QR code.')
    return
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(renderUploadPage(token))
    return
  }
  if (req.method === 'POST' && url.pathname === '/upload') {
    handleUpload(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
    return
  }
  sendMessage(res, 404, 'Not found.')
}

async function handleUpload(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Per-request subdir keeps two concurrent phones from colliding on filenames.
  const reqDir = path.join(stagingDir, crypto.randomBytes(4).toString('hex'))
  await fs.mkdir(reqDir, { recursive: true })

  const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } })
  const used = new Set<string>()
  const completed: string[] = []
  const writes: Promise<void>[] = []

  bb.on('file', (_field, stream, info) => {
    const safeName = uniqueName(used, sanitizeFilename(info.filename))
    const dest = path.join(reqDir, safeName)
    writes.push(new Promise<void>((resolve) => {
      const ws = createWriteStream(dest)
      let tooBig = false
      let received = 0
      let lastSent = 0
      stream.on('limit', () => { tooBig = true })
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received - lastSent >= PROGRESS_STEP) {
          lastSent = received
          send('phone:upload-progress', { file: safeName, receivedBytes: received })
        }
      })
      stream.pipe(ws)
      ws.on('finish', () => {
        if (tooBig) { void fs.rm(dest, { force: true }).catch(() => {}); resolve(); return }
        completed.push(dest)
        resolve()
      })
      ws.on('error', () => { void fs.rm(dest, { force: true }).catch(() => {}); resolve() })
    }))
  })

  bb.on('close', async () => {
    await Promise.all(writes)
    // Respond as soon as bytes are on disk — from the phone's side the upload is done.
    // Ingest runs afterward on the desktop and drives the shared progress banner.
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, received: completed.length }))
    }
    enqueueIngest(completed, reqDir)
  })

  bb.on('error', () => {
    if (!res.headersSent) res.writeHead(500).end()
  })

  req.pipe(bb)
}

function enqueueIngest(files: string[], reqDir: string): void {
  ingestChain = ingestChain.then(() => runIngest(files, reqDir))
}

async function runIngest(files: string[], reqDir: string): Promise<void> {
  if (files.length === 0) {
    await fs.rm(reqDir, { recursive: true, force: true }).catch(() => {})
    return
  }
  try {
    // Reuse the full desktop ingest pipeline: hashing, dedup, thumbnails, EXIF/GPS, DB insert.
    // Forward to the same channels the desktop importer uses so App.tsx's banner just works.
    const { failures, total } = await ingestFiles(files, 'copy', null, (p) => send('ingest:progress', p))
    const logPath = failures.length > 0 ? await writeImportErrorLog(failures) : null
    const imported = total - failures.length
    const done: IngestDoneEvent = { total, imported, failures, logPath }
    send('ingest:done', done)
    send('phone:upload-done', { received: files.length, imported })
  } catch (e) {
    const failures: IngestFailure[] = [{ file: files.join(', '), error: (e as Error).message ?? String(e) }]
    const logPath = await writeImportErrorLog(failures)
    send('ingest:done', { total: files.length, imported: 0, failures, logPath } satisfies IngestDoneEvent)
    send('phone:upload-done', { received: files.length, imported: 0 })
  } finally {
    // ingestFiles copies into the library, so the staging copies are safe to remove.
    await fs.rm(reqDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function isPhoneServerRunning(): boolean {
  return server !== null
}

// All start/stop calls run one-at-a-time through this chain. React StrictMode mounts the
// modal twice, firing start → stop → start concurrently; serializing guarantees the
// last-issued operation wins, so the running server's token always matches the QR the
// renderer shows (a race here would leave the phone hitting a stale token → 403).
let lifecycleChain: Promise<unknown> = Promise.resolve()
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = lifecycleChain.then(op, op)
  lifecycleChain = run.then(() => {}, () => {})
  return run
}

// Bind the stable BASE_PORT, walking a small range on EADDRINUSE. Falls back to an
// OS-assigned port only if the whole range is taken (that instance won't be reachable
// through a port-specific firewall rule, but at least it starts).
async function listenOnStablePort(srv: http.Server): Promise<number> {
  for (let p = BASE_PORT; p < BASE_PORT + PORT_ATTEMPTS; p++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (e: NodeJS.ErrnoException) => { srv.removeListener('listening', onOk); reject(e) }
        const onOk = () => { srv.removeListener('error', onError); resolve() }
        srv.once('error', onError)
        srv.once('listening', onOk)
        srv.listen(p, '0.0.0.0')
      })
      return p
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
      // try the next port in the range
    }
  }
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '0.0.0.0', () => resolve())
  })
  return (srv.address() as AddressInfo).port
}

async function doStart(sender: WebContents): Promise<PhoneStartResult> {
  await doStop()

  token = crypto.randomBytes(16).toString('hex')
  // Staging lives under the OS temp dir, OUTSIDE getFilesPath(), so the chokidar watcher
  // never sees partial uploads mid-transfer.
  stagingDir = path.join(app.getPath('temp'), 'timeline-phone-upload', crypto.randomBytes(6).toString('hex'))
  await fs.mkdir(stagingDir, { recursive: true })
  progressSender = sender

  const srv = http.createServer(handleRequest)
  srv.unref()
  port = await listenOnStablePort(srv)
  server = srv

  return { port, token, lanIps: getLanIps() }
}

async function doStop(): Promise<void> {
  if (server) {
    const srv = server
    server = null
    await new Promise<void>((resolve) => {
      srv.close(() => resolve())
      // Force-drop lingering keep-alive/upload connections in the same tick, else
      // close()'s callback waits on them forever and this hangs the next start.
      srv.closeAllConnections?.()
    })
  }
  port = 0
  token = ''
  progressSender = null
  if (stagingDir) {
    const dir = stagingDir
    stagingDir = ''
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function startPhoneServer(sender: WebContents): Promise<PhoneStartResult> {
  return enqueue(() => doStart(sender))
}

export function stopPhoneServer(): Promise<void> {
  return enqueue(() => doStop())
}
