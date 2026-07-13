import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { Group, LifeEvent } from '../../shared/types'
import EventsPanel from './EventsPanel'

const MS_DAY = 86_400_000

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']

function heatColorFromF(f: number): string {
  if (f <= 0) return 'var(--bg-subtle)'
  const pct = Math.round(f * 80 + 12)
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-subtle))`
}

function computeF(count: number, effectiveMax: number, scale: 'log' | 'linear'): number {
  if (count === 0 || effectiveMax === 0) return 0
  if (scale === 'log') return Math.log(count + 1) / Math.log(effectiveMax + 1)
  return Math.min(count / effectiveMax, 1)
}

function heatColor(count: number, effectiveMax: number, scale: 'log' | 'linear'): string {
  return heatColorFromF(computeF(count, effectiveMax, scale))
}

function textColor(count: number, effectiveMax: number, scale: 'log' | 'linear'): string {
  if (count === 0) return 'var(--text-4)'
  return computeF(count, effectiveMax, scale) > 0.6 ? 'var(--accent-fg)' : 'var(--text-2)'
}

type DateRangeGroup = Pick<Group, 'date_from' | 'date_to' | 'color' | 'name'>

function MonthGrid({ year, month, countMap, effectiveMax, scale, selRange, dateRangeGroups, events, onDayClick, onDayMouseDown, onDayMouseEnter, onMonthClick, cellSize = 22 }: {
  year: number
  month: number
  countMap: Map<string, number>
  effectiveMax: number
  scale: 'log' | 'linear'
  selRange: [number, number] | null
  dateRangeGroups: DateRangeGroup[]
  events: LifeEvent[]
  onDayClick: (ts: number) => void
  onDayMouseDown: (ts: number, e: React.MouseEvent) => void
  onDayMouseEnter: (ts: number) => void
  onMonthClick?: () => void
  cellSize?: number
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDOW    = new Date(year, month, 1).getDay()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDOW; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isExpanded = cellSize > 30
  const dayFont = isExpanded ? Math.round(cellSize * 0.22) : 9
  const dowFont = isExpanded ? Math.round(cellSize * 0.18) : 9
  const dowH    = isExpanded ? Math.round(cellSize * 0.3) : 14
  const gap     = isExpanded ? Math.max(4, Math.round(cellSize * 0.06)) : 2
  const radius  = isExpanded ? Math.max(6, Math.round(cellSize * 0.08)) : 3

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
      {!isExpanded && (
        <div
          style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8,
            cursor: onMonthClick ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          onClick={onMonthClick}
          title={onMonthClick ? `View ${MONTH_NAMES[month]} in full` : undefined}
        >
          {MONTH_NAMES[month]}
          {onMonthClick && <span style={{ fontSize: 9, color: 'var(--text-4)' }}>↗</span>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap }}>
        {DOW.map(d => (
          <div key={d} style={{ fontSize: dowFont, textAlign: 'center', color: 'var(--text-4)', lineHeight: `${dowH}px`, height: dowH }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} style={{ height: cellSize }} />
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const count = countMap.get(key) ?? 0
          const dayTs = new Date(year, month, day).getTime()

          const inSel = selRange !== null && dayTs >= selRange[0] && dayTs <= selRange[1]
          const eventForDay = events.find(ev => dayTs >= ev.date_from && dayTs < (ev.date_to ?? Infinity))
          const groupForDay = dateRangeGroups.find(gr => dayTs >= gr.date_from! && dayTs < gr.date_to!)
          const rangeForDay = eventForDay ?? (groupForDay ? { color: groupForDay.color, title: groupForDay.name } : null)

          const bg = inSel
            ? '#c7d2fe'
            : rangeForDay
              ? `${rangeForDay.color}55`
              : heatColor(count, effectiveMax, scale)

          const fg = inSel ? '#3730a3' : textColor(count, effectiveMax, scale)

          return (
            <div
              key={i}
              onClick={() => onDayClick(dayTs)}
              onMouseDown={e => onDayMouseDown(dayTs, e)}
              onMouseEnter={() => onDayMouseEnter(dayTs)}
              title={rangeForDay
                ? `${key}: ${count} entr${count === 1 ? 'y' : 'ies'} · ${rangeForDay.title}`
                : count > 0 ? `${key}: ${count} entr${count === 1 ? 'y' : 'ies'}` : key}
              style={{
                height: cellSize, borderRadius: radius, background: bg,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: dayFont, color: fg, fontWeight: 500,
                transition: inSel ? 'none' : 'background 0.1s',
                userSelect: 'none',
              }}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CalendarHeatmap() {
  const { selectedGroupId, refreshKey, setSelectedPeriod, groups, events, openEventModal, settings } = useStore()
  const [year, setYear]         = useState(new Date().getFullYear())
  const [countMap, setCM]       = useState(new Map<string, number>())
  const [dataMax, setMax]       = useState(0)
  const [totalYear, setTotal]   = useState(0)
  const [zoomedMonth, setZoomedMonth] = useState<number | null>(null)

  const scale = settings?.heatmapScale ?? 'log'
  const effectiveMax = (settings?.heatmapMaxCount ?? null) !== null
    ? settings!.heatmapMaxCount!
    : dataMax

  // Range selection state
  const [selRange, setSelRange] = useState<[number, number] | null>(null)
  const selStartRef    = useRef<number | null>(null)
  const selEndRef      = useRef<number | null>(null)
  const isSelectingRef = useRef(false)
  const didSelectRef   = useRef(false)

  useEffect(() => {
    const from = new Date(year, 0, 1).getTime()
    const to   = new Date(year + 1, 0, 1).getTime()
    window.api.entries.histogram(from, to, 'day', selectedGroupId ?? undefined).then(buckets => {
      const map = new Map<string, number>()
      let max = 0
      let total = 0
      for (const b of buckets) {
        const d = new Date(b.bucket_start)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const c = (map.get(key) ?? 0) + b.count
        map.set(key, c)
        if (c > max) max = c
        total += b.count
      }
      setCM(map)
      setMax(max)
      setTotal(total)
    })
  }, [year, selectedGroupId, refreshKey])

  // Global mouseup: finalize range selection
  useEffect(() => {
    const handleMouseUp = () => {
      if (!isSelectingRef.current || selStartRef.current === null) return
      isSelectingRef.current = false
      const start = selStartRef.current
      const end   = selEndRef.current ?? start
      const from  = Math.min(start, end)
      const to    = Math.max(start, end)
      if (to > from) {
        didSelectRef.current = true
        openEventModal(null, [from, to + MS_DAY])
      }
      selStartRef.current = null
      selEndRef.current   = null
      setSelRange(null)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [openEventModal])

  const handleDayMouseDown = useCallback((ts: number, e: React.MouseEvent) => {
    e.preventDefault()
    selStartRef.current  = ts
    selEndRef.current    = ts
    isSelectingRef.current = true
    didSelectRef.current   = false
    setSelRange([ts, ts])
  }, [])

  const handleDayMouseEnter = useCallback((ts: number) => {
    if (!isSelectingRef.current || selStartRef.current === null) return
    selEndRef.current = ts
    const from = Math.min(selStartRef.current, ts)
    const to   = Math.max(selStartRef.current, ts)
    setSelRange([from, to])
  }, [])

  const handleDayClick = useCallback((ts: number) => {
    if (didSelectRef.current) {
      didSelectRef.current = false
      return
    }
    // ts is local midnight; end at the next local midnight so DST-shifted days match the SQL buckets
    const d = new Date(ts)
    setSelectedPeriod([ts, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()])
  }, [setSelectedPeriod])

  const goToPrevMonth = useCallback(() => {
    if (zoomedMonth === 0) {
      setYear(y => y - 1)
      setZoomedMonth(11)
    } else {
      setZoomedMonth(zoomedMonth! - 1)
    }
  }, [zoomedMonth])

  const goToNextMonth = useCallback(() => {
    if (zoomedMonth === 11) {
      setYear(y => y + 1)
      setZoomedMonth(0)
    } else {
      setZoomedMonth(zoomedMonth! + 1)
    }
  }, [zoomedMonth])

  const dateRangeGroups: DateRangeGroup[] = groups.filter(
    g => g.date_from != null && g.date_to != null
  )

  // Only events overlapping the shown year matter for cell tint and legend
  const yearStart = new Date(year, 0, 1).getTime()
  const yearEnd   = new Date(year + 1, 0, 1).getTime()
  const yearEvents = events.filter(ev => ev.date_from < yearEnd && (ev.date_to ?? Infinity) > yearStart)

  const legendFs = [0, 0.2, 0.45, 0.7, 1.0]

  const navBtnStyle: React.CSSProperties = {
    background: 'none', border: '1px solid var(--border)', borderRadius: 5,
    padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text-2)',
  }

  // Zoomed single-month view
  if (zoomedMonth !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', background: 'var(--bg-app)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <button style={navBtnStyle} onClick={() => setZoomedMonth(null)}>← Back</button>
            <div style={{ width: 1, height: 18, background: 'var(--border)', marginLeft: 2, marginRight: 2 }} />
            <button style={navBtnStyle} onClick={goToPrevMonth}>←</button>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', minWidth: 200, textAlign: 'center' }}>
              {MONTH_NAMES[zoomedMonth]} {year}
            </span>
            <button style={navBtnStyle} onClick={goToNextMonth}>→</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 1100 }}>
              <MonthGrid
                year={year}
                month={zoomedMonth}
                countMap={countMap}
                effectiveMax={effectiveMax}
                scale={scale}
                selRange={selRange}
                dateRangeGroups={dateRangeGroups}
                events={yearEvents}
                onDayClick={handleDayClick}
                onDayMouseDown={handleDayMouseDown}
                onDayMouseEnter={handleDayMouseEnter}
                cellSize={100}
              />
            </div>
          </div>
        </div>
        <EventsPanel />
      </div>
    )
  }

  // Multi-month year view
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--bg-app)' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => setYear(y => y - 1)}
          style={navBtnStyle}
        >←</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', minWidth: 52, textAlign: 'center' }}>{year}</span>
        <button
          onClick={() => setYear(y => y + 1)}
          style={navBtnStyle}
        >→</button>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {totalYear > 0 ? `${totalYear} entr${totalYear === 1 ? 'y' : 'ies'} this year` : 'No entries this year'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
          · drag across days to create an event
        </span>
        <div style={{ flex: 1 }} />
        {/* Event and date-range group legend */}
        {(yearEvents.length > 0 || dateRangeGroups.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {yearEvents.map(ev => (
              <div key={`e${ev.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: ev.color }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{ev.title}</span>
              </div>
            ))}
            {dateRangeGroups.map(g => (
              <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: g.color }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{g.name}</span>
              </div>
            ))}
          </div>
        )}
        {/* Heatmap legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Less</span>
          {legendFs.map((f, i) => (
            <div
              key={i}
              style={{ width: 14, height: 14, borderRadius: 3, background: heatColorFromF(f) }}
            />
          ))}
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>More</span>
        </div>
      </div>

      {/* 4×3 month grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {Array.from({ length: 12 }, (_, m) => (
          <MonthGrid
            key={m}
            year={year}
            month={m}
            countMap={countMap}
            effectiveMax={effectiveMax}
            scale={scale}
            selRange={selRange}
            dateRangeGroups={dateRangeGroups}
            events={yearEvents}
            onDayClick={handleDayClick}
            onDayMouseDown={handleDayMouseDown}
            onDayMouseEnter={handleDayMouseEnter}
            onMonthClick={() => setZoomedMonth(m)}
          />
        ))}
      </div>
    </div>
  )
}
