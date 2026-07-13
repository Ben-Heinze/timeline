import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { LifeEvent } from '../../shared/types'

const MS_DAY = 86_400_000

const fmtDay = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// date_to is exclusive midnight; back up half a day for the inclusive display date
const fmtEventRange = (e: LifeEvent) =>
  `${fmtDay(e.date_from)} – ${e.date_to != null ? fmtDay(e.date_to - MS_DAY / 2) : 'present'}`

function EventRow({ event, expanded, onToggle }: {
  event: LifeEvent
  expanded: boolean
  onToggle: () => void
}) {
  const { openEventModal, setEvents } = useStore()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleDelete = async () => {
    await window.api.events.delete(event.id)
    setEvents(await window.api.events.list())
  }

  const smallBtn: React.CSSProperties = {
    padding: '3px 10px', fontSize: 11, fontWeight: 600,
    background: 'none', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-2)', cursor: 'pointer',
  }

  return (
    <div
      onClick={onToggle}
      style={{
        borderLeft: `3px solid ${event.color}`,
        borderBottom: '1px solid var(--border-light)',
        padding: '8px 10px 8px 9px',
        cursor: 'pointer',
        background: expanded ? 'var(--bg-subtle)' : 'transparent',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
        {event.title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
        {fmtEventRange(event)}
      </div>
      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
          {event.description && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {event.description}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button style={smallBtn} onClick={() => openEventModal(event)}>Edit</button>
            {confirmingDelete ? (
              <>
                <button
                  style={{ ...smallBtn, background: '#ef4444', border: 'none', color: '#fff' }}
                  onClick={handleDelete}
                >Confirm delete</button>
                <button style={smallBtn} onClick={() => setConfirmingDelete(false)}>Keep</button>
              </>
            ) : (
              <button
                style={{ ...smallBtn, color: '#ef4444', borderColor: '#ef4444' }}
                onClick={() => setConfirmingDelete(true)}
              >Delete</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function EventsPanel() {
  const {
    events, eventsPanelOpen, setEventsPanelOpen,
    selectedPeriod, visibleRange,
    focusedEventId, setFocusedEventId,
    openEventModal,
  } = useStore()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  // A click on an event band in the canvas focuses that event here
  useEffect(() => {
    if (focusedEventId == null) return
    setExpandedIds(prev => new Set(prev).add(focusedEventId))
    // Let the expanded row render before scrolling to it
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-event-id="${focusedEventId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    setFocusedEventId(null)
  }, [focusedEventId, setFocusedEventId])

  const [from, to] = selectedPeriod ?? visibleRange
  const scopeLabel = selectedPeriod
    ? `during ${fmtDay(selectedPeriod[0])}`
    : 'in the visible range'

  const visibleEvents = useMemo(
    () => events.filter(e => e.date_from < to && (e.date_to ?? Infinity) > from),
    [events, from, to]
  )

  if (!eventsPanelOpen) return null

  const toggle = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <aside style={{
      width: 272, flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Events</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {visibleEvents.length} {scopeLabel}
          </div>
        </div>
        <button
          onClick={() => openEventModal()}
          style={{
            marginLeft: 'auto', padding: '4px 10px', fontSize: 12, fontWeight: 600,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            border: 'none', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
          }}
        >+ Add</button>
        <button
          onClick={() => setEventsPanelOpen(false)}
          title="Close panel"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 15, lineHeight: 1, padding: '0 2px', color: 'var(--text-3)', flexShrink: 0,
          }}
        >×</button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto' }}>
        {visibleEvents.length === 0 ? (
          <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6 }}>
            {events.length === 0
              ? 'No events yet. Add periods of your life — homes, jobs, school years — and they appear here and on the timeline.'
              : `No events ${scopeLabel}.`}
          </div>
        ) : (
          visibleEvents.map(e => (
            <div key={e.id} data-event-id={e.id}>
              <EventRow event={e} expanded={expandedIds.has(e.id)} onToggle={() => toggle(e.id)} />
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
