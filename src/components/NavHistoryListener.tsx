'use client'
// src/components/NavHistoryListener.tsx
//
// Block 5A-W-50E — ambient popstate listener. Runs once in the root
// layout and writes a short-lived history-return marker for every
// popstate destination. Individual page hooks consume the marker to
// decide whether to attempt scroll restoration.
//
// This is the reliable signal for browser Back / Forward navigation
// in the Next.js App Router. document.referrer, history.length and
// performance navigation type are all unreliable across client-side
// route transitions, per the block brief.

import { useEffect } from 'react'
import { markHistoryReturn } from '@/lib/nav/historyReturnMarker'

export default function NavHistoryListener(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      // At popstate time window.location already reflects the new URL.
      markHistoryReturn(window.location.pathname)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  return null
}
