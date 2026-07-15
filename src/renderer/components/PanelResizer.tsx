import React, { useState } from 'react'

// Vertical drag handle for resizing a side panel. Sits on the panel's inner
// edge (`side`) and adjusts width live while dragging; `onCommit` fires on
// release so the caller can persist the final width.
export default function PanelResizer({
  side, width, min = 180, max = 640, onResize, onCommit,
}: {
  side: 'left' | 'right'
  width: number
  min?: number
  max?: number
  onResize: (w: number) => void
  onCommit: (w: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    // Left-edge handles grow the panel as the cursor moves left; right-edge as it moves right.
    const compute = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const delta = side === 'left' ? -dx : dx
      return Math.max(min, Math.min(max, startW + delta))
    }
    setDragging(true)
    const onMove = (ev: MouseEvent) => onResize(compute(ev))
    const onUp = (ev: MouseEvent) => {
      onCommit(compute(ev))
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Seated flush inside the panel's resize edge — an overhang would be
        // clipped by the panel's own `overflow: hidden` (or painted over by a
        // sibling), leaving the grab target dead.
        position: 'absolute', top: 0, bottom: 0, [side]: 0,
        width: 7, cursor: 'ew-resize', zIndex: 5, userSelect: 'none',
        background: hovered || dragging ? 'var(--scrollbar-thumb)' : 'transparent',
        transition: 'background 0.12s',
      }}
    />
  )
}
