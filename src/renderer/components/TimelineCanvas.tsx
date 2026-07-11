import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { timeYear, timeMonth, timeWeek, timeDay } from 'd3-time'
import { useStore } from '../store/useStore'
import type { ZoomLevel } from '../../shared/types'

const MS_DAY = 86_400_000
const AXIS_H = 38
const BAND_H = 14   // height reserved below bars for date-range group bands
const BAR_FILL = 0.55
const YAXIS_W = 40  // left margin reserved for Y axis labels

const cv = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

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

// Exclusive end of the calendar period a bucket covers
const bucketEndMs = (bs: number, level: ZoomLevel): number => {
  if (level === 'year')  return new Date(new Date(bs).getFullYear() + 1, 0, 1).getTime()
  if (level === 'month') { const d = new Date(bs); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() }
  if (level === 'week')  return bs + 7 * MS_DAY
  return bs + MS_DAY
}

const TYPE_LABELS: Record<string, [string, string]> = {
  photo:    ['photo', 'photos'],
  video:    ['video', 'videos'],
  audio:    ['audio file', 'audio files'],
  document: ['document', 'documents'],
  journal:  ['journal entry', 'journal entries'],
}

const HOVER_DATE_FMT: Record<ZoomLevel, (bs: number) => string> = {
  year:  bs => `${new Date(bs).getFullYear()}`,
  month: bs => new Date(bs).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  week:  bs => `${new Date(bs).toLocaleString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(bs + 6 * MS_DAY).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
  day:   bs => new Date(bs).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
}

type TickConfig = { iv: { range: (a: Date, b: Date) => Date[] }; fmt: (d: Date) => string }
const TICK_CONFIG: Record<ZoomLevel, TickConfig> = {
  year:  { iv: timeYear,  fmt: d => `${d.getFullYear()}` },
  month: { iv: timeMonth, fmt: d => d.toLocaleString('en-US', { month: 'short' }) },
  week:  { iv: timeWeek,  fmt: d => d.toLocaleString('en-US', { weekday: 'short', day: 'numeric' }) },
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
      style={{ height: 20, position: 'relative', background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }}
    >
      <div
        onMouseDown={e => { dragRef.current = { startX: e.clientX, startFrom: vFrom }; e.stopPropagation(); e.preventDefault() }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${thumbLeft * 100}%`,
          width: `${thumbWidth * 100}%`,
          top: 4, bottom: 4,
          background: 'var(--scrollbar-thumb)', borderRadius: 4, cursor: 'grab', minWidth: 24,
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
    rangeSelectMode, setRangeSelectMode,
    dateRangeSelection, setDateRangeSelection,
    setPendingDateRange,
    settings,
  } = useStore()

  const theme = settings?.theme ?? 'light'
  const curveTension = settings?.curveTension ?? 1

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedMonthStart, setSelectedMonthStart] = useState<number>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  })
  const [selectedWeekStart, setSelectedWeekStart] = useState<number>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime()
  })
  const [curveMode, setCurveMode] = useState(false)

  const rangeRef      = useRef(visibleRange)
  const extentRef     = useRef(dataExtent)
  const zoomRef       = useRef(zoomLevel)
  const selAnchorRef  = useRef<number | null>(null)
  const dateRangeSelRef = useRef(dateRangeSelection)

  useEffect(() => { rangeRef.current  = visibleRange },        [visibleRange])
  useEffect(() => { extentRef.current = dataExtent   },        [dataExtent])
  useEffect(() => { zoomRef.current   = zoomLevel    },        [zoomLevel])
  useEffect(() => { dateRangeSelRef.current = dateRangeSelection }, [dateRangeSelection])

  // Fetch histogram with fixed bucket for this zoom level
  useEffect(() => {
    const [from, to] = visibleRange
    window.api.entries.histogram(from, to, zoomLevel, selectedGroupId ?? undefined).then(buckets => {
      setHistogramBuckets(buckets)
      // Only auto-fit to full extent from year view — never yank the user out of week/day/month
      if (buckets.length === 0 && selectedGroupId == null && zoomLevel === 'year') {
        const ext = extentRef.current
        if (ext) {
          const pad = (ext[1] - ext[0]) * 0.04 || MS_DAY * 30
          setVisibleRange([ext[0] - pad, ext[1] + pad])
          setZoomLevel('year')
        }
      }
    })
  }, [visibleRange, zoomLevel, selectedGroupId, refreshKey, setHistogramBuckets, setVisibleRange, setZoomLevel])

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
    const chartH = h - AXIS_H          // axis line position
    const barsH  = chartH - BAND_H     // bar area height

    const [from, to] = visibleRange
    const rangeMs = to - from

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = cv('--canvas-bg')
    ctx.fillRect(0, 0, w, h)

    const chartW = w - YAXIS_W
    const tsToX = (ts: number) => YAXIS_W + ((ts - from) / rangeMs) * chartW

    // Active range selection overlay (drawn under bars)
    const sel = dateRangeSelection
    if (sel) {
      const sx = tsToX(sel[0])
      const sw = tsToX(sel[1]) - sx
      ctx.fillStyle = 'rgba(99,102,241,0.12)'
      ctx.fillRect(Math.max(YAXIS_W, Math.floor(sx)), 0, Math.ceil(sw), chartH)
      ctx.strokeStyle = 'rgba(99,102,241,0.5)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(Math.max(YAXIS_W, Math.floor(sx)) + 0.5, 0.5, Math.max(1, Math.ceil(sw) - 1), chartH - 1)
    }

    // Rows arrive split by (group, type); merge back to one segment per group for stacking
    const byStart = new Map<number, { group_id: number | null; count: number }[]>()
    for (const b of histogramBuckets) {
      if (!byStart.has(b.bucket_start)) byStart.set(b.bucket_start, [])
      const segs = byStart.get(b.bucket_start)!
      const seg = segs.find(s => s.group_id === b.group_id)
      if (seg) seg.count += b.count
      else segs.push({ group_id: b.group_id, count: b.count })
    }

    let maxCount = 1
    for (const segs of byStart.values()) {
      const total = segs.reduce((s, sg) => s + sg.count, 0)
      if (total > maxCount) maxCount = total
    }

    // Nice Y-axis tick step
    const niceStep = (n: number) => {
      if (n <= 1) return 1
      const rough = n / 4
      const p = Math.pow(10, Math.floor(Math.log10(rough)))
      const norm = rough / p
      return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * p
    }
    const yStep   = niceStep(maxCount)
    const niceMax = Math.ceil(maxCount / yStep) * yStep
    const barScale = (barsH * 0.92) / niceMax

    // Y axis grid lines (drawn before bars)
    ctx.strokeStyle = cv('--canvas-grid')
    ctx.lineWidth = 1
    for (let v = yStep; v <= niceMax; v += yStep) {
      const y = Math.round(barsH - v * barScale) + 0.5
      ctx.beginPath()
      ctx.moveTo(YAXIS_W, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    const groupColors = new Map(groups.map(g => [g.id, g.color]))
    const defaultBarColor = cv('--accent')

    if (!curveMode) {
      for (const [bucketStart, segs] of byStart) {
        // bucket_start is calendar-aligned from SQL; compute actual period width for each bar
        const slotX = tsToX(bucketStart)
        const effectiveSlotW = tsToX(bucketEndMs(bucketStart, zoomLevel)) - slotX
        const barW  = Math.max(2, effectiveSlotW * BAR_FILL)
        const barOX = (effectiveSlotW - barW) / 2

        if (slotX + effectiveSlotW < YAXIS_W || slotX > w) continue
        const x = slotX + barOX

        const total     = segs.reduce((s, sg) => s + sg.count, 0)
        const totalBarH = Math.max(2, total * barScale)

        if (selectedPeriod && bucketStart >= selectedPeriod[0] && bucketStart < selectedPeriod[1]) {
          ctx.fillStyle = 'rgba(245,158,11,0.10)'
          ctx.fillRect(Math.floor(slotX), 0, Math.ceil(effectiveSlotW), chartH)
        }

        let yBase = barsH
        for (const seg of segs) {
          const color = seg.group_id !== null ? (groupColors.get(seg.group_id) ?? defaultBarColor) : defaultBarColor
          const segH  = (seg.count / total) * totalBarH
          ctx.fillStyle = color
          ctx.fillRect(Math.floor(x), Math.floor(yBase - segH), Math.ceil(barW), Math.ceil(segH) + 1)
          yBase -= segH
        }
      }
    } else {
      // Smooth curve mode — quadratic-bezier midpoint spline through bucket centroids
      const sorted = [...byStart.entries()].sort(([a], [b]) => a - b)
      const pts = sorted.map(([bs, segs]) => {
        const total = segs.reduce((s, sg) => s + sg.count, 0)
        const cx = tsToX((bs + bucketEndMs(bs, zoomLevel)) / 2)
        return { x: cx, y: barsH - Math.max(2, total * barScale) }
      })

      if (pts.length > 0) {
        const color = defaultBarColor

        const drawSpline = (close: boolean) => {
          ctx.moveTo(pts[0].x, close ? barsH : pts[0].y)
          if (close) ctx.lineTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2
            const my = (pts[i].y + pts[i + 1].y) / 2
            // tension=1: control pt at data point (max curve); tension=0: control pt at landing (straight line)
            const cpx = mx + curveTension * (pts[i].x - mx)
            const cpy = my + curveTension * (pts[i].y - my)
            ctx.quadraticCurveTo(cpx, cpy, mx, my)
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
          if (close) {
            ctx.lineTo(pts[pts.length - 1].x, barsH)
            ctx.closePath()
          }
        }

        // Filled area
        ctx.beginPath()
        drawSpline(true)
        ctx.globalAlpha = 0.18
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1

        // Stroke
        ctx.beginPath()
        drawSpline(false)
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
      }
    }

    // Date-range group bands
    const dateRangeGroups = groups.filter(g => g.date_from != null && g.date_to != null)
    for (const g of dateRangeGroups) {
      const x1 = tsToX(g.date_from!)
      const x2 = tsToX(g.date_to!)
      const bx = Math.max(YAXIS_W, Math.floor(x1))
      const bw = Math.min(w, Math.ceil(x2)) - bx
      if (bw <= 0) continue
      ctx.fillStyle = g.color
      ctx.fillRect(bx, barsH + 1, bw, BAND_H - 2)
      if (bw > 36) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(bx + 1, barsH + 1, bw - 2, BAND_H - 2)
        ctx.clip()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 9px system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillText(g.name, bx + 4, barsH + BAND_H / 2)
        ctx.restore()
      }
    }

    if (byStart.size === 0) {
      ctx.fillStyle = cv('--text-4')
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const msg = dataExtent
        ? 'No entries in this time window'
        : 'No entries yet — import files or add a journal entry to get started'
      ctx.fillText(msg, YAXIS_W + chartW / 2, barsH / 2)
    }

    ctx.strokeStyle = cv('--canvas-axis')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(YAXIS_W, chartH + 0.5)
    ctx.lineTo(w, chartH + 0.5)
    ctx.stroke()

    const { iv, fmt } = TICK_CONFIG[zoomLevel]
    const ticks = iv.range(new Date(from), new Date(to))
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'bottom'
    for (const tick of ticks) {
      // Center the tick label under its bar (midpoint of the calendar period)
      let tickMs: number
      if (zoomLevel === 'year') {
        tickMs = (tick.getTime() + new Date(tick.getFullYear() + 1, 0, 1).getTime()) / 2
      } else if (zoomLevel === 'month') {
        tickMs = (tick.getTime() + new Date(tick.getFullYear(), tick.getMonth() + 1, 1).getTime()) / 2
      } else if (zoomLevel === 'week') {
        tickMs = tick.getTime() + 3.5 * MS_DAY
      } else {
        tickMs = tick.getTime()
      }
      const x = tsToX(tickMs)
      if (x < YAXIS_W + 2 || x > w - 2) continue
      ctx.fillStyle = cv('--canvas-tick')
      ctx.fillRect(Math.round(x), chartH + 1, 1, 5)
      ctx.fillStyle = cv('--canvas-label')
      ctx.textAlign = x < YAXIS_W + 30 ? 'left' : x > w - 30 ? 'right' : 'center'
      ctx.fillText(fmt(tick), x, h - 3)
    }

    // Y axis: paint over left margin, draw labels and border
    ctx.fillStyle = cv('--canvas-bg')
    ctx.fillRect(0, 0, YAXIS_W - 1, h)
    ctx.fillStyle = cv('--canvas-label')
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let v = yStep; v <= niceMax; v += yStep) {
      const y = barsH - v * barScale
      if (y < 4) break
      ctx.fillText(String(v), YAXIS_W - 5, y)
    }
    ctx.strokeStyle = cv('--canvas-axis')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(YAXIS_W - 0.5, 0)
    ctx.lineTo(YAXIS_W - 0.5, chartH)
    ctx.stroke()
  }, [visibleRange, histogramBuckets, groups, selectedPeriod, size, zoomLevel, dateRangeSelection, dataExtent, theme, curveMode, curveTension])

  // Wheel → pan
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (zoomRef.current === 'month') {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const [from, to] = rangeRef.current
        const newYear = new Date((from + to) / 2).getFullYear() + (e.deltaY > 0 ? 1 : -1)
        setSelectedYear(newYear)
        setVisibleRange([new Date(newYear, 0, 1).getTime(), new Date(newYear + 1, 0, 1).getTime()])
      }
      return
    }
    if (zoomRef.current === 'week') {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const [from, to] = rangeRef.current
        const mid = new Date((from + to) / 2)
        const newMonth = new Date(mid.getFullYear(), mid.getMonth() + (e.deltaY > 0 ? 1 : -1), 1)
        setSelectedMonthStart(newMonth.getTime())
        setVisibleRange([newMonth.getTime(), new Date(newMonth.getFullYear(), newMonth.getMonth() + 1, 1).getTime()])
      }
      return
    }
    if (zoomRef.current === 'day') {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const [from] = rangeRef.current
        const newWeekStart = from + (e.deltaY > 0 ? 7 : -7) * MS_DAY
        setSelectedWeekStart(newWeekStart)
        setVisibleRange([newWeekStart, newWeekStart + 7 * MS_DAY])
      }
      return
    }
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
  }, [setVisibleRange, setSelectedYear, setSelectedMonthStart, setSelectedWeekStart])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Global mouseup for range select finalization
  useEffect(() => {
    if (!rangeSelectMode) return
    const onUp = () => {
      if (selAnchorRef.current === null) return
      const sel = dateRangeSelRef.current
      if (sel && sel[1] - sel[0] > 60_000) {
        setPendingDateRange(sel)
      }
      selAnchorRef.current = null
      setDateRangeSelection(null)
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [rangeSelectMode, setPendingDateRange, setDateRangeSelection])

  // Escape: exit range select mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rangeSelectMode) {
        setRangeSelectMode(false)
        setDateRangeSelection(null)
        selAnchorRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rangeSelectMode, setRangeSelectMode, setDateRangeSelection])

  const setYearRange = useCallback((year: number) => {
    const from = new Date(year, 0, 1).getTime()
    const to   = new Date(year + 1, 0, 1).getTime()
    setSelectedYear(year)
    setVisibleRange([from, to])
  }, [setVisibleRange])

  const setMonthRange = useCallback((monthStart: number) => {
    const d    = new Date(monthStart)
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const to   = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    setSelectedMonthStart(from)
    setVisibleRange([from, to])
  }, [setVisibleRange])

  const setWeekRange = useCallback((weekStart: number) => {
    setSelectedWeekStart(weekStart)
    setVisibleRange([weekStart, weekStart + 7 * MS_DAY])
  }, [setVisibleRange])

  // Drag: pan (or select in range select mode)
  const drag = useRef<{ startX: number; fromMs: number; toMs: number; moved: boolean } | null>(null)
  const [grabbing, setGrabbing] = useState(false)

  // Hovered bucket for the tooltip (cursor position is relative to the canvas container)
  const [hover, setHover] = useState<{ x: number; y: number; bucketStart: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (rangeSelectMode) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const [from, to] = rangeRef.current
      const ts = from + (cx / rect.width) * (to - from)
      selAnchorRef.current = ts
      setDateRangeSelection([ts, ts])
    } else {
      const [from, to] = rangeRef.current
      drag.current = { startX: e.clientX, fromMs: from, toMs: to, moved: false }
    }
  }, [rangeSelectMode, setDateRangeSelection])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (rangeSelectMode) {
      setHover(null)
      if (selAnchorRef.current === null) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const [from, to] = rangeRef.current
      const ts = from + (cx / rect.width) * (to - from)
      const anchor = selAnchorRef.current
      setDateRangeSelection([Math.min(anchor, ts), Math.max(anchor, ts)])
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const d = drag.current
    if (d && zoomRef.current !== 'month' && zoomRef.current !== 'week' && zoomRef.current !== 'day') {
      const dx = e.clientX - d.startX
      if (Math.abs(dx) > 4) { d.moved = true; setGrabbing(true) }
      if (d.moved) {
        setHover(null)
        const shift = -(dx / canvas.getBoundingClientRect().width) * (d.toMs - d.fromMs)
        setVisibleRange([d.fromMs + shift, d.toMs + shift])
        return
      }
    }

    // Hover: find the bucket whose slot contains the cursor
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const chartW = rect.width - YAXIS_W
    const barsBottom = rect.height - AXIS_H - BAND_H
    let found: number | null = null
    if (cx >= YAXIS_W && cy <= barsBottom) {
      const [from, to] = rangeRef.current
      const tsToX = (ts: number) => YAXIS_W + ((ts - from) / (to - from)) * chartW
      for (const b of histogramBuckets) {
        if (cx >= tsToX(b.bucket_start) && cx < tsToX(bucketEndMs(b.bucket_start, zoomLevel))) {
          found = b.bucket_start
          break
        }
      }
    }
    setHover(found !== null ? { x: cx, y: cy, bucketStart: found } : null)
  }, [rangeSelectMode, setDateRangeSelection, setVisibleRange, histogramBuckets, zoomLevel])

  // Click: drill down / open DayView (not used in range select mode — handled globally)
  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (rangeSelectMode) return  // handled by global mouseup effect
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

    if (level === 'day') {
      // Snap click to calendar day start (SQL returns UTC midnight bucket_starts)
      const dayStart = Math.floor(ts / MS_DAY) * MS_DAY
      setSelectedPeriod([dayStart, dayStart + MS_DAY])
      return
    }

    const next = NEXT_LEVEL[level]

    if (next === 'month') {
      // year → show the 12 months of the clicked year
      setYearRange(new Date(ts).getFullYear())
      setZoomLevel('month')
      return
    }

    if (next === 'week') {
      // month → show the weeks of the clicked month
      const d = new Date(ts)
      setMonthRange(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
      setZoomLevel('week')
      return
    }

    if (next === 'day') {
      // week → show the 7 days of the clicked week (Sunday-based)
      const d = new Date(ts)
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime()
      setWeekRange(weekStart)
      setZoomLevel('day')
      return
    }
  }, [rangeSelectMode, setSelectedPeriod, setZoomLevel, setVisibleRange, setYearRange, setMonthRange, setWeekRange])

  const onMouseLeave = useCallback(() => {
    setHover(null)
    if (!rangeSelectMode) {
      drag.current = null
      setGrabbing(false)
    }
  }, [rangeSelectMode])

  // Zoom level tab click
  const handleLevelChange = useCallback((level: ZoomLevel) => {
    const ext = extentRef.current
    if (level === 'year') {
      // Always re-fit to full data extent when clicking Year
      if (ext) {
        const pad = (ext[1] - ext[0]) * 0.04 || MS_DAY * 30
        setVisibleRange([ext[0] - pad, ext[1] + pad])
      }
      setZoomLevel('year')
      return
    }
    if (level === 'month') {
      const [from, to] = rangeRef.current
      const year = new Date((from + to) / 2).getFullYear()
      setYearRange(year)
      setZoomLevel('month')
      return
    }
    if (level === 'week') {
      const [from, to] = rangeRef.current
      const center = (from + to) / 2
      const d = new Date(center)
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      setMonthRange(monthStart)
      setZoomLevel('week')
      return
    }
    if (level === 'day') {
      const [from, to] = rangeRef.current
      const d = new Date((from + to) / 2)
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime()
      setWeekRange(weekStart)
      setZoomLevel('day')
      return
    }
    if (level === zoomRef.current) return
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
    setZoomLevel(level)
  }, [setVisibleRange, setZoomLevel, setYearRange, setMonthRange, setWeekRange])

  const panLeft = useCallback(() => {
    if (zoomRef.current === 'month') {
      const [from, to] = rangeRef.current
      setYearRange(new Date((from + to) / 2).getFullYear() - 1)
      return
    }
    if (zoomRef.current === 'week') {
      const [from, to] = rangeRef.current
      const mid = new Date((from + to) / 2)
      setMonthRange(new Date(mid.getFullYear(), mid.getMonth() - 1, 1).getTime())
      return
    }
    if (zoomRef.current === 'day') {
      const [from] = rangeRef.current
      setWeekRange(from - 7 * MS_DAY)
      return
    }
    const [from, to] = rangeRef.current
    const w = to - from
    const shift = w * 0.5
    const ext = extentRef.current
    let newFrom = from - shift
    if (ext) newFrom = Math.max(newFrom, ext[0] - (ext[1] - ext[0]) * 0.04)
    setVisibleRange([newFrom, newFrom + w])
  }, [setVisibleRange, setYearRange, setMonthRange])

  const panRight = useCallback(() => {
    if (zoomRef.current === 'month') {
      const [from, to] = rangeRef.current
      setYearRange(new Date((from + to) / 2).getFullYear() + 1)
      return
    }
    if (zoomRef.current === 'week') {
      const [from, to] = rangeRef.current
      const mid = new Date((from + to) / 2)
      setMonthRange(new Date(mid.getFullYear(), mid.getMonth() + 1, 1).getTime())
      return
    }
    if (zoomRef.current === 'day') {
      const [from] = rangeRef.current
      setWeekRange(from + 7 * MS_DAY)
      return
    }
    const [from, to] = rangeRef.current
    const w = to - from
    const shift = w * 0.5
    const ext = extentRef.current
    let newTo = to + shift
    if (ext) newTo = Math.min(newTo, ext[1] + (ext[1] - ext[0]) * 0.04)
    setVisibleRange([newTo - w, newTo])
  }, [setVisibleRange, setYearRange, setMonthRange, setWeekRange])

  // Total and per-type counts for the hovered bucket
  const hoverInfo = useMemo(() => {
    if (!hover) return null
    let total = 0
    const typeCounts = new Map<string, number>()
    for (const b of histogramBuckets) {
      if (b.bucket_start !== hover.bucketStart) continue
      total += b.count
      typeCounts.set(b.type, (typeCounts.get(b.type) ?? 0) + b.count)
    }
    if (total === 0) return null
    return { total, types: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]) }
  }, [hover, histogramBuckets])

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--text)' : 'none',
    color: active ? 'var(--bg-app)' : 'var(--text-2)',
    border: active ? 'none' : '1px solid var(--border)',
    borderRadius: 5, padding: '3px 11px',
    fontSize: 12, cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  })

  const navBtnStyle: React.CSSProperties = {
    background: 'none', border: '1px solid var(--border)',
    borderRadius: 5, padding: '3px 10px',
    fontSize: 13, cursor: 'pointer', color: 'var(--text-2)',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Zoom level strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '5px 12px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-muted)', flexShrink: 0,
      }}>
        {(['year', 'month', 'week', 'day'] as ZoomLevel[]).map(level => (
          <button key={level} onClick={() => handleLevelChange(level)} style={btnStyle(zoomLevel === level)}>
            {LEVEL_LABELS[level]}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 6px', flexShrink: 0 }} />
        <button onClick={() => setCurveMode(false)} style={btnStyle(!curveMode)} title="Bar chart">▬ Bars</button>
        <button onClick={() => setCurveMode(true)}  style={btnStyle(curveMode)}  title="Smooth curve">∿ Curve</button>
        <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 6 }}>
          {rangeSelectMode
            ? 'drag to select a date range'
            : zoomLevel === 'day' ? 'click bar to view entries' : 'click bar to zoom in'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            if (rangeSelectMode) {
              setRangeSelectMode(false)
              setDateRangeSelection(null)
              selAnchorRef.current = null
            } else {
              setRangeSelectMode(true)
            }
          }}
          style={{
            background: rangeSelectMode ? '#6366f1' : 'none',
            color: rangeSelectMode ? '#fff' : '#6366f1',
            border: '1px solid #6366f1',
            borderRadius: 5, padding: '3px 11px',
            fontSize: 12, cursor: 'pointer', fontWeight: 600,
            marginRight: 6,
          }}
        >
          {rangeSelectMode ? '✕ Cancel' : '⊞ Select Range'}
        </button>
        <button onClick={panLeft}  style={navBtnStyle}>←</button>
        <button onClick={panRight} style={{ ...navBtnStyle, marginLeft: 3 }}>→</button>
      </div>

      {/* Week navigator (day view only) */}
      {zoomLevel === 'day' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '4px 12px', borderBottom: '1px solid var(--border-light)',
          background: 'var(--bg-muted)', flexShrink: 0,
        }}>
          <button
            onClick={() => setWeekRange(selectedWeekStart - 7 * MS_DAY)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >←</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 160, textAlign: 'center' }}>
            {new Date(selectedWeekStart).toLocaleString('en-US', { month: 'short', day: 'numeric' })}
            {' – '}
            {new Date(selectedWeekStart + 6 * MS_DAY).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button
            onClick={() => setWeekRange(selectedWeekStart + 7 * MS_DAY)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >→</button>
        </div>
      )}

      {/* Month navigator (week view only) */}
      {zoomLevel === 'week' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '4px 12px', borderBottom: '1px solid var(--border-light)',
          background: 'var(--bg-muted)', flexShrink: 0,
        }}>
          <button
            onClick={() => {
              const d = new Date(selectedMonthStart)
              setMonthRange(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime())
            }}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >←</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 100, textAlign: 'center' }}>
            {new Date(selectedMonthStart).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => {
              const d = new Date(selectedMonthStart)
              setMonthRange(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime())
            }}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >→</button>
        </div>
      )}

      {/* Year navigator (month view only) */}
      {zoomLevel === 'month' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '4px 12px', borderBottom: '1px solid var(--border-light)',
          background: 'var(--bg-muted)', flexShrink: 0,
        }}>
          <button
            onClick={() => setYearRange(selectedYear - 1)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >←</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 48, textAlign: 'center' }}>
            {selectedYear}
          </span>
          <button
            onClick={() => setYearRange(selectedYear + 1)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}
          >→</button>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block', width: '100%', height: '100%',
            cursor: rangeSelectMode ? 'crosshair' : (grabbing ? 'grabbing' : 'default'),
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
        {hover && hoverInfo && (
          <div style={{
            position: 'absolute',
            left: hover.x > size.w - 200 ? hover.x - 12 : hover.x + 12,
            top:  hover.y > size.h - 150 ? hover.y - 10 : hover.y + 14,
            transform: `${hover.x > size.w - 200 ? 'translateX(-100%)' : ''} ${hover.y > size.h - 150 ? 'translateY(-100%)' : ''}`,
            pointerEvents: 'none',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '6px 10px',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>
              {HOVER_DATE_FMT[zoomLevel](hover.bucketStart)}
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>
              {hoverInfo.total} {hoverInfo.total === 1 ? 'file' : 'files'} total
            </div>
            {hoverInfo.types.map(([type, count]) => (
              <div key={type} style={{ color: 'var(--text-2)' }}>
                {count} {(TYPE_LABELS[type] ?? [type, type])[count === 1 ? 0 : 1]}
              </div>
            ))}
          </div>
        )}
      </div>

      {dataExtent && zoomLevel !== 'month' && zoomLevel !== 'week' && zoomLevel !== 'day' && (
        <Scrollbar dataExtent={dataExtent} visibleRange={visibleRange} onPan={setVisibleRange} />
      )}
    </div>
  )
}
