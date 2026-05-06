'use client'
// Small countdown badge used on the card-show listing pages, the
// /dashboard/card-shows planner, and the individual event detail page.
// Updates every minute. Multi-day events show "Live now" between
// startDate and endDate, then "Past" afterwards.

import { useEffect, useState } from 'react'

interface Props {
  startDate: string             // ISO yyyy-mm-dd
  endDate?: string              // ISO yyyy-mm-dd, omit for single-day
  /** 'sm' = inline pill (default) · 'lg' = bigger pill for the detail page hero */
  size?: 'sm' | 'lg'
}

interface State {
  label: string
  fg: string
  bg: string
  border: string
}

function compute(startDate: string, endDate: string | undefined, now: Date): State {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date((endDate || startDate) + 'T23:59:59')

  if (now > end) {
    return {
      label: 'Past',
      fg: 'var(--text-muted)',
      bg: 'var(--bg-light)',
      border: 'var(--border)',
    }
  }
  if (now >= start) {
    return {
      label: '● Live now',
      fg: '#dc2626',
      bg: 'rgba(220,38,38,0.10)',
      border: 'rgba(220,38,38,0.28)',
    }
  }

  const ms = start.getTime() - now.getTime()
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)

  let label: string
  if (days >= 30) {
    const months = Math.round(days / 30)
    label = months === 1 ? 'In 1 month' : `In ${months} months`
  } else if (days >= 7) {
    label = `In ${days} days`
  } else if (days >= 2) {
    label = `In ${days}d ${hours}h`
  } else if (days === 1) {
    label = `Tomorrow · ${hours}h`
  } else if (hours >= 1) {
    label = `Today · ${hours}h ${minutes}m`
  } else {
    label = `Today · ${Math.max(minutes, 1)} min`
  }

  // Urgency colour ramp: today = orange, this week = green, beyond = blue.
  if (days === 0) {
    return {
      label,
      fg: '#b45309',
      bg: 'rgba(245,158,11,0.14)',
      border: 'rgba(245,158,11,0.30)',
    }
  }
  if (days <= 7) {
    return {
      label,
      fg: '#15803d',
      bg: 'rgba(34,197,94,0.10)',
      border: 'rgba(34,197,94,0.25)',
    }
  }
  return {
    label,
    fg: 'var(--primary)',
    bg: 'rgba(26,95,173,0.08)',
    border: 'rgba(26,95,173,0.22)',
  }
}

export default function EventCountdown({ startDate, endDate, size = 'sm' }: Props) {
  // Initialise to null on the server / first render so SSR and client agree;
  // the real value populates on the next tick (avoids a hydration mismatch
  // when the build time and request time differ by a few seconds).
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null

  const { label, fg, bg, border } = compute(startDate, endDate, now)

  const big = size === 'lg'
  return (
    <span style={{
      display: 'inline-block',
      fontSize: big ? 12 : 10,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      background: bg,
      color: fg,
      border: `1px solid ${border}`,
      padding: big ? '5px 12px' : '3px 8px',
      borderRadius: big ? 999 : 8,
      fontFamily: "'Figtree', sans-serif",
      whiteSpace: 'nowrap',
    }}>
      ⏱ {label}
    </span>
  )
}
