import React, { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'

const MS_DAY = 86_400_000

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return '#f0f0ea'
  const f = count / max
  if (f < 0.10) return '#fef3c7'
  if (f < 0.25) return '#fde68a'
  if (f < 0.50) return '#fbbf24'
  if (f < 0.75) return '#f59e0b'
  return '#d97706'
}

function textColor(count: number, max: number): string {
  if (count === 0) return '#c8c8c0'
  return count / max > 0.5 ? '#fff' : '#555'
}

function MonthGrid({ year, month, countMap, maxCount, onDayClick }: {
  year: number
  month: number
  countMap: Map<string, number>
  maxCount: number
  onDayClick: (ts: number) => void
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDOW    = new Date(year, month, 1).getDay()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDOW; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div style={{ padding: '10px 12px', background: '#fff', borderRadius: 8, border: '1px solid #eaeae4' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
        {MONTH_NAMES[month]}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {DOW.map(d => (
          <div key={d} style={{ fontSize: 9, textAlign: 'center', color: '#bbb', lineHeight: '14px', height: 14 }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} style={{ height: 22 }} />
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const count = countMap.get(key) ?? 0
          const bg = heatColor(count, maxCount)
          const fg = textColor(count, maxCount)
          return (
            <div
              key={i}
              onClick={() => count > 0 && onDayClick(new Date(year, month, day).getTime())}
              title={count > 0 ? `${key}: ${count} entr${count === 1 ? 'y' : 'ies'}` : key}
              style={{
                height: 22, borderRadius: 3, background: bg,
                cursor: count > 0 ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: fg, fontWeight: 500,
                transition: 'background 0.1s',
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
  const { selectedGroupId, refreshKey, setSelectedPeriod } = useStore()
  const [year, setYear]     = useState(new Date().getFullYear())
  const [countMap, setCM]   = useState(new Map<string, number>())
  const [maxCount, setMax]  = useState(0)
  const [totalYear, setTotal] = useState(0)

  useEffect(() => {
    const from = new Date(year, 0, 1).getTime()
    const to   = new Date(year + 1, 0, 1).getTime()
    window.api.entries.histogram(from, to, MS_DAY, selectedGroupId ?? undefined).then(buckets => {
      const map = new Map<string, number>()
      let max = 0
      let total = 0
      for (const b of buckets) {
        // bucket_start may not be at midnight local — use UTC date as stored
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

  const handleDayClick = useCallback((ts: number) => {
    setSelectedPeriod([ts, ts + MS_DAY])
  }, [setSelectedPeriod])

  // Build legend steps
  const legendSteps = [0, 0.1, 0.3, 0.6, 1.0]

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#f8f8f5' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => setYear(y => y - 1)}
          style={{ background: 'none', border: '1px solid #e4e4dc', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#555' }}
        >←</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', minWidth: 52, textAlign: 'center' }}>{year}</span>
        <button
          onClick={() => setYear(y => y + 1)}
          style={{ background: 'none', border: '1px solid #e4e4dc', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#555' }}
        >→</button>
        <span style={{ fontSize: 12, color: '#999' }}>
          {totalYear > 0 ? `${totalYear} entr${totalYear === 1 ? 'y' : 'ies'} this year` : 'No entries this year'}
        </span>
        <div style={{ flex: 1 }} />
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: '#bbb' }}>Less</span>
          {legendSteps.map((f, i) => (
            <div
              key={i}
              style={{ width: 14, height: 14, borderRadius: 3, background: heatColor(f * (maxCount || 1), maxCount || 1) }}
            />
          ))}
          <span style={{ fontSize: 10, color: '#bbb' }}>More</span>
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
            maxCount={maxCount}
            onDayClick={handleDayClick}
          />
        ))}
      </div>
    </div>
  )
}
