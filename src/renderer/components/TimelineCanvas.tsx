import React, { useEffect, useRef, useCallback, useState } from 'react'
import { timeYear, timeMonth, timeWeek, timeDay } from 'd3-time'
import { useStore } from '../store/useStore'
import type { ZoomLevel } from '../../shared/types'

const MS_DAY = 86_400_000
const AXIS_H = 38
const BAR_FILL = 0.85
const DEFAULT_COLOR = '#f59e0b'

// Fixed bucket size per zoom level
export const BUCKET_MS: Record<ZoomLevel, number> = {
  year:  365.25 * MS_DAY,
  month: 30.44  * MS_DAY,
  week:  7      * MS_DAY,
  day:   MS_DAY,
}

// Default visible window when entering a zoom level
const WINDOW_MS: Record<ZoomLevel, number> = {
  year:  20 * 365.25 * MS_DAY,
  month: 24 * 30.44  * MS_DAY,
  week:  26 * 7      * MS_DAY,
  day:   60 * MS_DAY,
}

const NEXT_LEVEL: Record<ZoomLevel, ZoomLevel> = {
  year: 'month', month: 'week', week: 'day', day: 'day',
}

type TickConfig = { iv: { range: (a: Date, b: Date) => Date[] }; fmt: (d: Date) => string }
const TICK_CONFIG: Record<ZoomLevel, TickConfig> = {
  year:  { iv: timeYear,  fmt: d => `${d.getFullYear()}` },
  month: { iv: timeMonth, fmt: d => d.toLocaleString('en-US', { month: 'short', year: '2-digit' }) },
  week:  { iv: timeWeek,  fmt: d => d.toLocaleString('en-US', { month: 'short', day: 'numeric' }) },
  day:   { iv: timeDay,   fmt: d => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) },
}

const LEVEL_LABELS: Record<ZoomLevel, string> = {
  year: 'Year', month: 'Month', week: 'Week', day: 'Day',
}

// ─── Scrollbar ───────────────────────────────────────────────────────────────

function Scrollbar({ dataExtent, visibleRange, onPan }: {
  dataExtent: [number, number]
  visibleRange: [number, number]
  onPan: (range: [number, number]) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<{ startX: number; startFrom: number } | null>(null)

  const [dFrom, dTo] = dataExtent
  const dataRange = dTo - dFrom
  const [vFrom, vTo] = visibleRange
  const vRange = vTo - vFrom

  const thumbLeft  = Math.max(0, Math.min(1 - vRange / dataRange, (vFrom - dFrom) / dataRange))
  const thumbWidth = Math.max(0.04, Math.min(1, vRange / dataRange))

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d || !trackRef.current) return
      const trackW = trackRef.current.getBoundingClientRect().width
      const dMs = ((e.clientX - d.startX) / trackW) * dataRange
      const newFrom = Math.max(dFrom, Math.min(dTo - vRange, d.startFrom + dMs))
      onPan([newFrom, newFrom + vRange])
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dFrom, dTo, dataRange, vRange, onPan])

  return (
    <div
      ref={trackRef}
      onClick={e => {
        if (!trackRef.current || dragRef.current) return
        const rect = trackRef.current.getBoundingClientRect()
        const frac = (e.clientX - rect.left) / rect.width
        const clickTs = dFrom + frac * dataRange
        const newFrom = Math.max(dFrom, Math.min(dTo - vRange, clickTs - vRange / 2))
        onPan([newFrom, newFrom + vRange])
      }}
      style={{ height: 20, position: 'relative', background: '#eaeae4', borderTop: '1px solid #e4e4dc', cursor: 'pointer', flexShrink: 0 }}
    >
      <div
        onMouseDown={e => { dragRef.current = { startX: e.clientX, startFrom: vFrom }; e.stopPropagation(); e.preventDefault() }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${thumbLeft * 100}%`,
          width: `${thumbWidth * 100}%`,
          top: 4, bottom: 4,
          background: '#b0b0a8', borderRadius: 4, cursor: 'grab', minWidth: 24,
        }}
      />
    </div>
  )
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function TimelineCanvas() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const {
    visibleRange, setVisibleRange,
    histogramBuckets, setHistogramBuckets,
    groups,
    selectedPeriod, setSelectedPeriod,
    selectedGroupId,
    dataExtent,
    refreshKey,
    zoomLevel, setZoomLevel,
  } = useStore()

  const rangeRef      = useRef(visibleRange)
  const extentRef     = useRef(dataExtent)
  const zoomRef       = useRef(zoomLevel)
  useEffect(() => { rangeRef.current  = visibleRange }, [visibleRange])
  useEffect(() => { extentRef.current = dataExtent   }, [dataExtent])
  useEffect(() => { zoomRef.current   = zoomLevel    }, [zoomLevel])

  // Fetch histogram with fixed bucket for this zoom level
  useEffect(() => {
    const [from, to] = visibleRange
    const bMs = BUCKET_MS[zoomLevel]
    window.api.entries.histogram(from - bMs, to + bMs, bMs, selectedGroupId ?? undefined).then(setHistogramBuckets)
  }, [visibleRange, zoomLevel, selectedGroupId, refreshKey, setHistogramBuckets])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const dpr = window.devicePixelRatio || 1
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      canvas.width  = Math.round(width  * dpr)
      canvas.height = Math.round(height * dpr)
      setSize({ w: width, h: height })
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    const chartH = h - AXIS_H
    const [from, to] = visibleRange
    const rangeMs = to - from

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const tsToX = (ts: number) => ((ts - from) / rangeMs) * w

    const byStart = new Map<number, { group_id: number | null; count: number }[]>()
    for (const b of histogramBuckets) {
      if (!byStart.has(b.bucket_start)) byStart.set(b.bucket_start, [])
      byStart.get(b.bucket_start)!.push({ group_id: b.group_id, count: b.count })
    }

    let maxCount = 1
    for (const segs of byStart.values()) {
      const total = segs.reduce((s, sg) => s + sg.count, 0)
      if (total > maxCount) maxCount = total
    }

    const bMs  = BUCKET_MS[zoomLevel]
    const slotW = (bMs / rangeMs) * w
    const barW  = Math.max(2, slotW * BAR_FILL)
    const barOX = (slotW - barW) / 2

    const groupColors = new Map(groups.map(g => [g.id, g.color]))

    for (const [bucketStart, segs] of byStart) {
      const slotX = tsToX(bucketStart)
      if (slotX + slotW < 0 || slotX > w) continue
      const x = slotX + barOX

      const total     = segs.reduce((s, sg) => s + sg.count, 0)
      const totalBarH = Math.max(2, (total / maxCount) * chartH * 0.92)

      if (selectedPeriod && bucketStart >= selectedPeriod[0] && bucketStart < selectedPeriod[1]) {
        ctx.fillStyle = 'rgba(245,158,11,0.10)'
        ctx.fillRect(Math.floor(slotX), 0, Math.ceil(slotW), chartH)
      }

      let yBase = chartH
      for (const seg of segs) {
        const color = seg.group_id !== null ? (groupColors.get(seg.group_id) ?? DEFAULT_COLOR) : DEFAULT_COLOR
        const segH  = (seg.count / total) * totalBarH
        ctx.fillStyle = color
        ctx.fillRect(Math.floor(x), Math.floor(yBase - segH), Math.ceil(barW), Math.ceil(segH) + 1)
        yBase -= segH
      }
    }

    if (byStart.size === 0) {
      ctx.fillStyle = '#ccc'
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No entries in this range', w / 2, chartH / 2)
    }

    ctx.strokeStyle = '#e8e8e0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, chartH + 0.5)
    ctx.lineTo(w, chartH + 0.5)
    ctx.stroke()

    const { iv, fmt } = TICK_CONFIG[zoomLevel]
    const ticks = iv.range(new Date(from), new Date(to))
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'bottom'
    for (const tick of ticks) {
      const x = tsToX(tick.getTime())
      if (x < 2 || x > w - 2) continue
      ctx.fillStyle = '#d0d0c8'
      ctx.fillRect(Math.round(x), chartH + 1, 1, 5)
      ctx.fillStyle = '#999'
      ctx.textAlign = x < 30 ? 'left' : x > w - 30 ? 'right' : 'center'
      ctx.fillText(fmt(tick), x, h - 3)
    }
  }, [visibleRange, histogramBuckets, groups, selectedPeriod, size, zoomLevel])

  // Wheel → pan (no longer zooms)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const [from, to] = rangeRef.current
    const width = to - from
    const shift = (e.deltaY > 0 ? 1 : -1) * width * 0.2
    let newFrom = from + shift
    let newTo   = newFrom + width
    const ext = extentRef.current
    if (ext) {
      const pad = (ext[1] - ext[0]) * 0.04
      if (newFrom < ext[0] - pad) { newFrom = ext[0] - pad; newTo = newFrom + width }
      if (newTo   > ext[1] + pad) { newTo = ext[1] + pad;   newFrom = newTo - width }
    }
    setVisibleRange([newFrom, newTo])
  }, [setVisibleRange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Drag: pan
  const drag = useRef<{ startX: number; fromMs: number; toMs: number; moved: boolean } | null>(null)
  const [grabbing, setGrabbing] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const [from, to] = rangeRef.current
    drag.current = { startX: e.clientX, fromMs: from, toMs: to, moved: false }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 4) { d.moved = true; setGrabbing(true) }
    if (!d.moved) return
    const canvas = canvasRef.current
    if (!canvas) return
    const shift = -(dx / canvas.getBoundingClientRect().width) * (d.toMs - d.fromMs)
    setVisibleRange([d.fromMs + shift, d.toMs + shift])
  }, [setVisibleRange])

  // Click: drill down to next level, or open DayView at 'day' level
  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
    setGrabbing(false)
    if (!d || d.moved) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx   = e.clientX - rect.left
    const [from, to] = rangeRef.current
    const ts    = from + (cx / rect.width) * (to - from)
    const level = zoomRef.current
    const bMs   = BUCKET_MS[level]
    const bucketStart = Math.floor(ts / bMs) * bMs

    if (level === 'day') {
      setSelectedPeriod([bucketStart, bucketStart + bMs])
      return
    }

    // Drill into next zoom level centered on the clicked bucket
    const next       = NEXT_LEVEL[level]
    const nextWindow = WINDOW_MS[next]
    const center     = bucketStart + bMs / 2
    let newFrom = center - nextWindow / 2
    let newTo   = newFrom + nextWindow
    const ext = extentRef.current
    if (ext) {
      const pad = (ext[1] - ext[0]) * 0.04
      if (newFrom < ext[0] - pad) { newFrom = ext[0] - pad; newTo = newFrom + nextWindow }
      if (newTo   > ext[1] + pad) { newTo = ext[1] + pad;   newFrom = newTo - nextWindow }
    }
    setZoomLevel(next)
    setVisibleRange([newFrom, newTo])
  }, [setSelectedPeriod, setZoomLevel, setVisibleRange])

  const onMouseLeave = useCallback(() => {
    drag.current = null
    setGrabbing(false)
  }, [])

  // Zoom level tab click
  const handleLevelChange = useCallback((level: ZoomLevel) => {
    if (level === zoomRef.current) return
    const ext = extentRef.current
    if (level === 'year' && ext) {
      const pad = (ext[1] - ext[0]) * 0.04
      setVisibleRange([ext[0] - pad, ext[1] + pad])
    } else {
      const [from, to] = rangeRef.current
      const center = (from + to) / 2
      let newFrom = center - WINDOW_MS[level] / 2
      let newTo   = newFrom + WINDOW_MS[level]
      if (ext) {
        const pad = (ext[1] - ext[0]) * 0.04
        if (newFrom < ext[0] - pad) { newFrom = ext[0] - pad; newTo = newFrom + WINDOW_MS[level] }
        if (newTo   > ext[1] + pad) { newTo = ext[1] + pad;   newFrom = newTo - WINDOW_MS[level] }
      }
      setVisibleRange([newFrom, newTo])
    }
    setZoomLevel(level)
  }, [setVisibleRange, setZoomLevel])

  const panLeft = useCallback(() => {
    const [from, to] = rangeRef.current
    const w = to - from
    const shift = w * 0.5
    const ext = extentRef.current
    let newFrom = from - shift
    if (ext) newFrom = Math.max(newFrom, ext[0] - (ext[1] - ext[0]) * 0.04)
    setVisibleRange([newFrom, newFrom + w])
  }, [setVisibleRange])

  const panRight = useCallback(() => {
    const [from, to] = rangeRef.current
    const w = to - from
    const shift = w * 0.5
    const ext = extentRef.current
    let newTo = to + shift
    if (ext) newTo = Math.min(newTo, ext[1] + (ext[1] - ext[0]) * 0.04)
    setVisibleRange([newTo - w, newTo])
  }, [setVisibleRange])

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#1a1a1a' : 'none',
    color: active ? '#fff' : '#666',
    border: active ? 'none' : '1px solid #e4e4dc',
    borderRadius: 5, padding: '3px 11px',
    fontSize: 12, cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  })

  const navBtnStyle: React.CSSProperties = {
    background: 'none', border: '1px solid #e4e4dc',
    borderRadius: 5, padding: '3px 10px',
    fontSize: 13, cursor: 'pointer', color: '#555',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Zoom level strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '5px 12px', borderBottom: '1px solid #eaeae4',
        background: '#fafaf8', flexShrink: 0,
      }}>
        {(['year', 'month', 'week', 'day'] as ZoomLevel[]).map(level => (
          <button key={level} onClick={() => handleLevelChange(level)} style={btnStyle(zoomLevel === level)}>
            {LEVEL_LABELS[level]}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#bbb', marginLeft: 6 }}>
          {zoomLevel === 'day' ? 'click bar to view entries' : 'click bar to zoom in'}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={panLeft}  style={navBtnStyle}>←</button>
        <button onClick={panRight} style={{ ...navBtnStyle, marginLeft: 3 }}>→</button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', cursor: grabbing ? 'grabbing' : 'crosshair' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
      </div>

      {dataExtent && (
        <Scrollbar dataExtent={dataExtent} visibleRange={visibleRange} onPan={setVisibleRange} />
      )}
    </div>
  )
}
