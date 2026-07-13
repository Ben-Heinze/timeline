import type { ZoomLevel } from '../../shared/types'

const MS_DAY = 86_400_000

// Grouping unit for section dividers: one level below the current zoom scope
export type SectionUnit = 'year' | 'month' | 'day'

export interface Scope {
  from: number
  to: number                        // exclusive
  label: string
  sectionUnit: SectionUnit | null   // null = no dividers (single selected period)
}

export function periodLabel(from: number, to: number): string {
  const rangeMs = to - from
  const d = new Date(from)
  if (rangeMs >= 364 * MS_DAY)
    return String(d.getFullYear())
  if (rangeMs >= 27 * MS_DAY)
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  if (rangeMs >= 6 * MS_DAY)
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  // Day periods span local midnights, so DST days can be 23 or 25 hours
  if (rangeMs >= 23 * 3_600_000)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const SECTION_KEY: Record<SectionUnit, (d: Date) => string> = {
  year:  d => `${d.getFullYear()}`,
  month: d => `${d.getFullYear()}-${d.getMonth()}`,
  day:   d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
}

export const SECTION_LABEL: Record<SectionUnit, (d: Date) => string> = {
  year:  d => `${d.getFullYear()}`,
  month: d => d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  day:   d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
}

// The current browsing scope, derived from the timeline state:
//  - a clicked bar (selectedPeriod) pins the scope to that exact period
//  - otherwise the zoom level decides: year → everything, month → the visible
//    year, day → the visible month; sections divide by the next unit down
export function computeScope(
  selectedPeriod: [number, number] | null,
  zoomLevel: ZoomLevel,
  visibleRange: [number, number],
  dataExtent: [number, number] | null,
): Scope | null {
  if (selectedPeriod) {
    return { from: selectedPeriod[0], to: selectedPeriod[1], label: periodLabel(selectedPeriod[0], selectedPeriod[1]), sectionUnit: null }
  }
  if (zoomLevel === 'year') {
    if (!dataExtent) return null
    return { from: dataExtent[0], to: dataExtent[1] + 1, label: 'All files', sectionUnit: 'year' }
  }
  const mid = new Date((visibleRange[0] + visibleRange[1]) / 2)
  if (zoomLevel === 'month') {
    const from = new Date(mid.getFullYear(), 0, 1).getTime()
    const to   = new Date(mid.getFullYear() + 1, 0, 1).getTime()
    return { from, to, label: `${mid.getFullYear()}`, sectionUnit: 'month' }
  }
  // day zoom → the visible month
  const from = new Date(mid.getFullYear(), mid.getMonth(), 1).getTime()
  const to   = new Date(mid.getFullYear(), mid.getMonth() + 1, 1).getTime()
  return { from, to, label: mid.toLocaleString('en-US', { month: 'long', year: 'numeric' }), sectionUnit: 'day' }
}
