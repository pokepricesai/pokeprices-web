'use client'

// Block 5A-W-18 — unified Watchlist & Alerts surface. Replaces the
// two separate /dashboard/watchlist and /dashboard/alerts entry points
// (both now redirect here). Layout, top to bottom:
//
//   1. Watchlist cards — embedded WatchlistClient (skipping its own
//      DashboardNav so this page owns the chrome).
//   2. Per-watchlist intent copy — single explanatory note covering
//      "how alerts fire on watched cards". No per-card UI today; the
//      thresholds in section 3 apply to every watched card.
//   3. Alert controls — full AlertPreferencesCard (master switch,
//      sensitivity preset, weekly toggle, instant toggle; advanced
//      thresholds in a collapsed <details>).
//   4. Recent alerts — grouped-by-card view of alert_events.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import WatchlistClient from '../watchlist/WatchlistClient'
import AlertPreferencesCard from '../settings/AlertPreferencesCard'
import RecentAlerts from './RecentAlerts'

export default function WatchlistAlertsClient() {
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/dashboard/login'); return }
      setUser({ id: session.user.id, email: session.user.email ?? null })
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.replace('/dashboard/login')
      else setUser({ id: session.user.id, email: session.user.email ?? null })
    })
    return () => subscription.unsubscribe()
  }, [router])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="watchlist" email={user?.email ?? undefined} />

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>
          Watchlist &amp; Alerts
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.5 }}>
          The cards you&apos;re watching plus the alerts that fire on them. Update what you watch and how loud the alerts are, in one place.
        </p>
      </div>

      {/* ─── Watchlist cards ─────────────────────────────────────────── */}
      <section style={panelStyle}>
        <WatchlistClient embedded />
      </section>

      {/* ─── Per-card intent copy ────────────────────────────────────── */}
      <section style={intentStyle}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
          <strong>Alerts on your watchlist:</strong> every watched card uses the thresholds below.
          We&apos;ll email you when watched cards move beyond your thresholds or show unusual market activity.
          Adjust sensitivity in <em>Alert controls</em>, or fine-tune each rule under <em>Advanced settings</em>.
        </div>
      </section>

      {/* ─── Alert controls ──────────────────────────────────────────── */}
      {user && <AlertPreferencesCard userId={user.id} />}

      {/* ─── Recent alerts ───────────────────────────────────────────── */}
      {user && <RecentAlerts userId={user.id} />}

      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', padding: '12px 0' }}>
        Looking for account or email settings? <Link href="/dashboard/settings" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Open settings →</Link>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 22, marginBottom: 16,
}

const intentStyle: React.CSSProperties = {
  background: 'rgba(26,95,173,0.06)',
  border: '1px solid rgba(26,95,173,0.18)',
  borderRadius: 12,
  padding: '12px 16px',
  marginBottom: 16,
}
