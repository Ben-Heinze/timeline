import React from 'react'
import type { EntryType } from '../../shared/types'

interface Props {
  type: EntryType
  size?: number
  color?: string
}

export default function TypeIcon({ type, size = 48, color = '#bbb' }: Props) {
  const s = size
  switch (type) {
    case 'photo':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="10" width="40" height="30" rx="3" stroke={color} strokeWidth="2.5" fill="none"/>
          <circle cx="34" cy="18" r="4" stroke={color} strokeWidth="2.5" fill="none"/>
          <path d="M4 32 L14 22 L22 30 L30 22 L44 36" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        </svg>
      )
    case 'video':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="10" width="28" height="28" rx="3" stroke={color} strokeWidth="2.5" fill="none"/>
          <path d="M32 18 L44 13 L44 35 L32 30 Z" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        </svg>
      )
    case 'audio':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <path d="M20 8 L20 40 M14 14 L14 34 M8 18 L8 30 M26 12 L26 36 M32 16 L32 32 M38 20 L38 28"
            stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      )
    case 'document':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <path d="M10 6 H30 L38 14 V42 H10 Z" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
          <path d="M30 6 V14 H38" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
          <line x1="16" y1="22" x2="32" y2="22" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="16" y1="29" x2="32" y2="29" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="16" y1="36" x2="24" y2="36" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      )
    case 'journal':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <rect x="10" y="6" width="28" height="36" rx="3" stroke={color} strokeWidth="2.5" fill="none"/>
          <line x1="10" y1="14" x2="38" y2="14" stroke={color} strokeWidth="2"/>
          <line x1="16" y1="22" x2="32" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round"/>
          <line x1="16" y1="29" x2="32" y2="29" stroke={color} strokeWidth="2" strokeLinecap="round"/>
          <line x1="16" y1="36" x2="26" y2="36" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        </svg>
      )
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
          <rect x="8" y="8" width="32" height="32" rx="4" stroke={color} strokeWidth="2.5" fill="none"/>
          <text x="24" y="31" textAnchor="middle" fontSize="18" fill={color} fontFamily="sans-serif">?</text>
        </svg>
      )
  }
}
