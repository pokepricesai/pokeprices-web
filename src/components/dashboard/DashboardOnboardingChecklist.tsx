'use client'

// Block 5A-W-30 — "Get more from PokePrices" onboarding card for the
// dashboard hub.
//
// Loads the five inputs the pure helper needs (portfolio count,
// watchlist count, weekly_digest_enabled, custom-override count, and
// — for free users only — any pro_early_access_requests row) and
// renders the resulting checklist. Each per-query try/catch returns
// `null` on failure so the helper sees "not yet" rather than the UI
// crashing on an un-migrated env.
//
// Read-only — no writes, no email sends. The card hides itself once
// every item is complete so it doesn't clutter the hub for active
// users.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserPlan } from '@/lib/account/useUserPlan'
import {
  buildDashboardChecklist,
  type DashboardChecklistResult,
} from '@/lib/onboarding/dashboardChecklist'

type Props = { userId: string }

async function countRows(table: string, userId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

async function countCustomOverrides(userId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('watchlist_alert_overrides')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('use_global_defaults', false)
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

async function loadWeeklyEnabled(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('user_alert_preferences')
      .select('weekly_digest_enabled')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    const v = (data as { weekly_digest_enabled?: unknown }).weekly_digest_enabled
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

async function loadProEarlyAccess(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('pro_early_access_requests')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (error) {
      // PGRST116 = "no rows" on maybeSingle — that's "not submitted yet",
      // not a query failure. Map it to false.
      if (error.code === 'PGRST116') return false
      return null
    }
    return Boolean(data)
  } catch {
    return null
  }
}

export default function DashboardOnboardingChecklist({ userId }: Props) {
  const { plan, loading: planLoading } = useUserPlan(userId)
  const [result, setResult] = useState<DashboardChecklistResult | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    let live = true
    setDataLoading(true)
    void (async () => {
      const [portfolioCount, watchlistCount, weekly, customCount, earlyAccess] = await Promise.all([
        countRows('portfolio_items', userId),
        countRows('watchlist',       userId),
        loadWeeklyEnabled(userId),
        countCustomOverrides(userId),
        plan === 'free' ? loadProEarlyAccess(userId) : Promise.resolve<boolean | null>(false),
      ])
      if (!live) return
      setResult(buildDashboardChecklist({
        plan,
        portfolioCount,
        watchlistCount,
        weeklyOverviewEnabled:    weekly,
        customAlertOverrideCount: customCount,
        proEarlyAccessSubmitted:  earlyAccess,
      }))
      setDataLoading(false)
    })()
    return () => { live = false }
  }, [userId, plan])

  if (planLoading || dataLoading || !result) {
    return (
      <div style={cardStyle}>
        <div className="skeleton" style={{ height: 24, width: '50%', borderRadius: 6, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 60, borderRadius: 8 }} />
      </div>
    )
  }

  // Once every item is complete, the card disappears so it doesn't
  // hang around forever on a power-user's hub.
  if (result.allComplete) return null

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>Get more from PokePrices</h2>
        <span style={progressStyle}>{result.completedCount} / {result.totalCount} done</span>
      </div>
      <p style={subStyle}>
        A short list of things to set up so the hub actually pulls for you.
      </p>

      <ul style={listStyle}>
        {result.items.map(item => (
          <li key={item.id} style={itemRowStyle(item.complete)}>
            <span
              aria-hidden="true"
              style={checkStyle(item.complete)}
            >
              {item.complete ? '✓' : ''}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={labelStyle(item.complete)}>{item.label}</div>
              <div style={descStyle}>{item.description}</div>
            </div>
            <Link
              href={item.href}
              style={ctaStyle(item.complete)}
              aria-label={item.complete ? `${item.label} — review` : `${item.label} — open`}
            >
              {item.complete ? 'Review' : 'Open'}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── styles ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 22,
  marginBottom: 16,
}
const titleStyle: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 18,
  margin: 0,
  color: 'var(--text)',
}
const subStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  margin: '0 0 14px',
}
const progressStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
}
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
function itemRowStyle(complete: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: complete ? 'rgba(34,197,94,0.06)' : 'var(--bg-light)',
  }
}
function checkStyle(complete: boolean): React.CSSProperties {
  return {
    flex: '0 0 22px',
    width: 22,
    height: 22,
    borderRadius: 11,
    border: complete ? '1px solid var(--green, #22c55e)' : '1px solid var(--border)',
    background: complete ? 'var(--green, #22c55e)' : 'transparent',
    color: '#fff',
    fontWeight: 800,
    fontSize: 13,
    lineHeight: '22px',
    textAlign: 'center',
    marginTop: 1,
    fontFamily: "'Figtree', sans-serif",
  }
}
function labelStyle(complete: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: "'Figtree', sans-serif",
    textDecoration: complete ? 'line-through' : 'none',
    opacity: complete ? 0.7 : 1,
  }
}
const descStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  marginTop: 2,
  lineHeight: 1.5,
}
function ctaStyle(complete: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    fontFamily: "'Figtree', sans-serif",
    background: complete ? 'transparent' : 'var(--primary)',
    color: complete ? 'var(--text-muted)' : '#fff',
    border: complete ? '1px solid var(--border)' : '1px solid var(--primary)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
  }
}
