'use client'

// Block 5A-W-23 — top-of-page summary panel for Watchlist & Alerts.
//
// Reads four data sources scoped to the signed-in user via RLS:
//   * watchlist             — to count watched cards
//   * watchlist_alert_overrides — to bucket cards by alert state
//   * alert_events          — to count notifications in the last 7d
//   * user_alert_preferences.enabled — for the "Alerts off" CTA
//
// All five visible stats are derived by `summariseWatchlistAlerts`
// (pure, unit-tested). When the master switch is off, an amber strip
// invites the user to turn alerts back on with a deep link to the
// AlertPreferencesCard on the same page.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  summariseWatchlistAlerts,
  type WatchlistAlertsSummary,
  type WatchlistOverrideRowLite,
  type AlertEventLite,
} from './summaryStats'
import { getPlanLimits } from '@/lib/account/entitlements'
import { useUserPlan } from '@/lib/account/useUserPlan'
import AccountPlanBadge from '@/components/account/AccountPlanBadge'
import {
  watchlistOverLimitMessage,
  customAlertOverLimitMessage,
} from '@/components/account/overLimitMessages'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export default function WatchlistAlertsSummaryPanel({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<WatchlistAlertsSummary | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  // Block 5A-W-25 — `planLoading` is true while the /api/account/plan
  // fetch is in flight. The plan-note row hides until it settles so
  // a pro user doesn't see "Free account · …" copy flash for a tick.
  const { plan, loading: planLoading } = useUserPlan(userId)
  const limits   = getPlanLimits(plan)

  useEffect(() => {
    let live = true
    void (async () => {
      // Run the four queries in parallel — each is scoped to the
      // user via RLS. We deliberately swallow per-query errors and
      // surface them as a single inline note; the panel stays useful
      // even when one of the tables (e.g. watchlist_alert_overrides
      // on an un-migrated env) is unavailable.
      const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()
      const [wlR, ovR, evR, prefsR] = await Promise.all([
        supabase
          .from('watchlist')
          .select('card_slug, card_url_slug')
          .eq('user_id', userId),
        supabase
          .from('watchlist_alert_overrides')
          .select('card_slug, enabled, use_global_defaults')
          .eq('user_id', userId),
        supabase
          .from('alert_events')
          .select('detected_at')
          .eq('user_id', userId)
          .gte('detected_at', sinceIso),
        supabase
          .from('user_alert_preferences')
          .select('enabled')
          .eq('user_id', userId)
          .maybeSingle(),
      ])
      if (!live) return

      // Watchlist row's card_slug already mirrors the URL slug the
      // override table keys on; prefer card_url_slug when present.
      const watchlistSlugs: string[] = Array.isArray(wlR.data)
        ? (wlR.data as Array<{ card_slug: string | null; card_url_slug: string | null }>).map(r => (r.card_url_slug ?? r.card_slug) ?? '').filter(Boolean)
        : []
      const overrides: WatchlistOverrideRowLite[] = Array.isArray(ovR.data)
        ? (ovR.data as WatchlistOverrideRowLite[])
        : []
      const events: AlertEventLite[] = Array.isArray(evR.data)
        ? (evR.data as AlertEventLite[])
        : []
      // Defensive default: when the prefs row is missing OR the field
      // is null, assume enabled=true (matches ALERT_PREFERENCE_DEFAULTS).
      const masterEnabled = prefsR.data == null
        ? true
        : (prefsR.data as { enabled?: boolean }).enabled !== false

      // Surface the first non-empty error message so the operator
      // can see when something's wrong. We don't block the panel on it.
      const firstError = [wlR.error, ovR.error, evR.error, prefsR.error]
        .find(e => e && e.code !== 'PGRST116')
      if (firstError) setError(firstError.message)

      setSummary(summariseWatchlistAlerts({
        watchlistSlugs, overrides, recentEvents7d: events, masterEnabled,
      }))
    })()
    return () => { live = false }
  }, [userId])

  if (!summary) {
    return (
      <div style={panelStyle}>
        <SectionHeader>Watchlist summary</SectionHeader>
        <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <SectionHeader>Watchlist summary</SectionHeader>
      <p style={subStyle}>How your alerts are set up across the cards you watch.</p>

      <div style={statsGridStyle}>
        <Stat
          label="Watched cards"
          value={summary.watchedCount}
          limit={limits.watchlistItems}
        />
        <Stat label="Global defaults"    value={summary.globalDefault} tone={summary.globalDefault > 0 ? 'primary' : 'muted'} />
        <Stat
          label="Custom thresholds"
          value={summary.customThreshold}
          limit={limits.customAlertOverrides}
          tone={summary.customThreshold > 0 ? 'primary' : 'muted'}
        />
        <Stat label="Alerts off"         value={summary.alertsOff}      tone={summary.alertsOff > 0 ? 'warn' : 'muted'} />
        <Stat label="Alerts this week"   value={summary.recent7dCount}  tone={summary.recent7dCount > 0 ? 'primary' : 'muted'} />
      </div>
      {/* Block 5A-W-26 — canonical plan badge. Replaces the inline
          plan-note paragraph from 5A-W-25 with the shared component
          so the wording stays in sync across the dashboard. */}
      {!planLoading && (
        <div style={{ marginTop: 14 }}>
          <AccountPlanBadge userId={userId} mode="full" />
        </div>
      )}

      {/* Block 5A-W-26 — over-limit copy for free users who already
          carry more than the new caps. Non-destructive: their
          existing watchlist / custom alerts stay; this just explains
          why new adds will refuse until Pro / lower count. */}
      {(() => {
        const wl = watchlistOverLimitMessage(plan, summary.watchedCount)
        return wl ? <div style={offBannerStyle}>{wl}</div> : null
      })()}
      {(() => {
        const ca = customAlertOverLimitMessage(plan, summary.customThreshold)
        return ca ? <div style={offBannerStyle}>{ca}</div> : null
      })()}

      {!summary.masterEnabled && (
        <div style={offBannerStyle}>
          <strong>Alerts are currently off.</strong>{' '}
          You won&apos;t receive instant emails or the weekly overview while the master switch is off. Turn it on under <em>Alert defaults</em> below.
        </div>
      )}

      {error && (
        <div style={warnStyle}>
          Some summary data didn&apos;t load. Numbers above may be partial. <span style={{ color: 'var(--text-muted)' }}>({error})</span>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'muted', limit }: {
  label: string
  value: number
  tone?: 'primary' | 'muted' | 'warn'
  /** Optional usage cap. -1 = unlimited (hidden). Renders as "X / N". */
  limit?: number
}) {
  const color =
    tone === 'primary' ? 'var(--primary)' :
    tone === 'warn'    ? '#b45309' :
                          'var(--text)'
  const showLimit = typeof limit === 'number' && limit > 0
  return (
    <div style={statCellStyle}>
      <div style={{ fontSize: 22, fontWeight: 900, color, fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>
        {value}{showLimit && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginLeft: 4 }}>/ {limit}</span>}
      </div>
      <div style={statLabelStyle}>{label}</div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px',
      color: 'var(--text)',
    }}>{children}</h2>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 22, marginBottom: 16,
}
const subStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
  margin: '0 0 14px',
}
const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 8,
}
const statCellStyle: React.CSSProperties = {
  background: 'var(--bg-light)', padding: '12px 14px',
  borderRadius: 12, border: '1px solid var(--border)',
}
const statLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  marginTop: 6,
}
// Block 5A-W-26 — plan-note + Pro-chip styles removed; the shared
// AccountPlanBadge supplies that visual now.
const offBannerStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(245,158,11,0.10)',
  border: '1px solid rgba(245,158,11,0.30)',
  color: '#92400e',
  fontSize: 12.5,
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.5,
}
const warnStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 11,
  color: '#92400e',
  fontFamily: "'Figtree', sans-serif",
}
