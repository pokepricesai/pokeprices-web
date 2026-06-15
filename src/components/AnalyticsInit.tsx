'use client'

// Mounted once at the top of the App Router tree from src/app/layout.tsx.
// Responsibilities:
//   * Capture UTM + referrer attribution on every route change.
//   * Maintain the analytics module's auth_state cache from the Supabase
//     onAuthStateChange listener.
//   * Fire dashboard_view when the user enters a /dashboard/* route.
//
// Nothing rendered. All work is in effects.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  setAuthContext,
  trackEvent,
  classifyPageType,
  markInited,
  isInited,
} from '@/lib/analytics'
import { captureAttribution } from '@/lib/attribution'

function dashboardFeatureFromPath(pathname: string): string {
  // /dashboard          → 'hub'
  // /dashboard/portfolio → 'portfolio'
  // /dashboard/quick-price → 'quick_price' (matches the page-type label)
  if (pathname === '/dashboard' || pathname === '/dashboard/') return 'hub'
  const m = pathname.match(/^\/dashboard\/([^\/]+)/)
  if (!m) return 'hub'
  return m[1].replace(/-/g, '_')
}

export default function AnalyticsInit() {
  const pathname = usePathname()
  const lastPathRef = useRef<string | null>(null)

  // One-time init: hook Supabase auth, mark module ready.
  useEffect(() => {
    if (isInited()) return
    markInited()

    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setAuthContext(data.session ? 'authenticated' : 'anonymous')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthContext(session ? 'authenticated' : 'anonymous')
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  // Per-route: capture attribution + fire dashboard_view when entering
  // a /dashboard/* page. GA4's built-in page_view already covers generic
  // route changes; we only add the dashboard-specific signal.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (pathname === lastPathRef.current) return
    lastPathRef.current = pathname

    try { captureAttribution() } catch { /* fail-quiet */ }

    const pt = classifyPageType(pathname)
    if (pt === 'dashboard' || pt === 'quick_price' || pt === 'grading') {
      trackEvent('dashboard_view', {
        feature_name:     dashboardFeatureFromPath(pathname),
        source_component: 'analytics_init',
      })
    }
  }, [pathname])

  return null
}
