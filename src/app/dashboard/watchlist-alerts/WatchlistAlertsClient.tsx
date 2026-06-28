'use client'

// Block 5A-W-23 — polished Watchlist & Alerts page. Originally
// Block 5A-W-18 unified four separate surfaces into one; this pass
// adds proper section headings, a top-of-page summary panel,
// product-level CTAs, and clearer empty-state guidance so the page
// reads as a product surface rather than a developer settings page.
//
// Layout, top to bottom:
//
//   A. Watchlist summary    — WatchlistAlertsSummaryPanel: 5 counters
//                             + "Alerts off" banner when applicable.
//   B. Watched cards        — embedded WatchlistClient (per-row UI
//                             includes the per-card alert override
//                             control shipped in 5A-W-19).
//   C. Alert defaults       — full AlertPreferencesCard.
//   D. Recent alert history — grouped-by-card view of alert_events,
//                             price-rule cards/reasons first.
//   E. CTA footer           — Browse cards · Open settings.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import WatchlistClient from '../watchlist/WatchlistClient'
import AlertPreferencesCard from '../settings/AlertPreferencesCard'
import RecentAlerts from './RecentAlerts'
import WatchlistAlertsSummaryPanel from './WatchlistAlertsSummary'

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

      {/* A. Watchlist summary */}
      {user && <WatchlistAlertsSummaryPanel userId={user.id} />}

      {/* B. Watched cards */}
      <section>
        <h2 style={sectionHeadingStyle}>Watched cards</h2>
        <div style={panelStyle}>
          <WatchlistClient embedded />
        </div>
      </section>

      {/* C. Alert defaults */}
      <section>
        <h2 style={sectionHeadingStyle}>Alert defaults</h2>
        <div style={intentStyle}>
          <strong>How alerts work on your watchlist:</strong> each watched card uses the global thresholds set here by default. Override the rise/drop thresholds (or silence alerts entirely) per card from the &quot;Customise alerts&quot; control on each watched card row above.
        </div>
        {user && <AlertPreferencesCard userId={user.id} />}
      </section>

      {/* D. Recent alert history */}
      <section>
        <h2 style={sectionHeadingStyle}>Recent alert history</h2>
        {user && <RecentAlerts userId={user.id} />}
      </section>

      {/* E. CTA footer */}
      <div style={ctaFooterStyle}>
        <Link href="/browse" style={ctaPrimaryStyle}>Browse cards →</Link>
        <Link href="/dashboard/settings" style={ctaSecondaryStyle}>Open settings</Link>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 22, marginBottom: 16,
}

const sectionHeadingStyle: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 13,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  color: 'var(--text-muted)',
  margin: '24px 0 8px',
}

const intentStyle: React.CSSProperties = {
  background: 'rgba(26,95,173,0.06)',
  border: '1px solid rgba(26,95,173,0.18)',
  borderRadius: 12,
  padding: '12px 16px',
  marginBottom: 12,
  fontSize: 12.5,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.6,
}

const ctaFooterStyle: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap',
  justifyContent: 'center', alignItems: 'center',
  padding: '20px 0 8px',
}
const ctaPrimaryStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 18px',
  borderRadius: 10,
  background: 'var(--primary)',
  color: '#fff',
  fontSize: 13, fontWeight: 800,
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none',
}
const ctaSecondaryStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 18px',
  borderRadius: 10,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none',
}
