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
  buildAllSetState,
  buildDashboardChecklist,
  type AllSetState,
  type DashboardChecklistResult,
} from '@/lib/onboarding/dashboardChecklist'
import type { UserPlan } from '@/lib/account/entitlements'

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

  // Block 5A-W-31 — when every item is complete, swap the checklist
  // for a compact "all-set" success card. Previously this component
  // hid itself entirely; that was technically correct but quietly
  // disappeared a card users (and admins debugging) had been watching.
  if (result.allComplete) {
    return <AllSetCard state={buildAllSetState(plan)} plan={plan} />
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>Get more from PokePrices</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Block 5A-W-31 — Pro context chip for incomplete Pro users
              so they see their tier without waiting until allComplete. */}
          {plan === 'pro' && <ProAccountChip />}
          <span style={progressStyle}>{result.completedCount} / {result.totalCount} done</span>
        </div>
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

// ─── Block 5A-W-31 — all-set success card ────────────────────────────
// Renders when every checklist item is complete. Pro users see Pro
// entitlements + the "Pro account" chip; free users see the Free
// benefits and a soft Pro early-access upgrade footer.

function AllSetCard({ state, plan }: { state: AllSetState; plan: UserPlan }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>{state.title}</h2>
        {plan === 'pro' ? <ProAccountChip /> : <FreeAccountChip />}
      </div>
      <p style={subStyle}>{state.description}</p>

      <div style={planBlockStyle(plan === 'pro')}>
        <div style={planHeadingStyle}>
          <span
            aria-hidden="true"
            style={planCheckStyle}
          >
            ✓
          </span>
          {state.planHeading}
        </div>
        <ul style={bulletListStyle}>
          {state.planBullets.map(b => (
            <li key={b} style={bulletStyle}>{b}</li>
          ))}
        </ul>
      </div>

      {state.upgrade && (
        <div style={upgradeStyle}>
          <div style={upgradeHeadingStyle}>{state.upgrade.heading}</div>
          <div style={upgradeDescStyle}>{state.upgrade.description}</div>
          <Link
            href={state.upgrade.ctaHref}
            style={upgradeCtaStyle}
            aria-label={state.upgrade.ctaLabel}
          >
            {state.upgrade.ctaLabel} →
          </Link>
        </div>
      )}
    </div>
  )
}

function ProAccountChip() {
  return (
    <span style={proChipStyle}>Pro account</span>
  )
}

function FreeAccountChip() {
  return (
    <span style={freeChipStyle}>Free account</span>
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

// ── Block 5A-W-31 — all-set card styles ─────────────────────────────

function planBlockStyle(isPro: boolean): React.CSSProperties {
  return {
    padding: '12px 14px',
    borderRadius: 12,
    border: isPro ? '1px solid rgba(124,58,237,0.30)' : '1px solid var(--border)',
    background: isPro ? 'rgba(124,58,237,0.06)' : 'rgba(34,197,94,0.06)',
  }
}
const planHeadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  marginBottom: 8,
}
const planCheckStyle: React.CSSProperties = {
  flex: '0 0 20px',
  width: 20,
  height: 20,
  borderRadius: 10,
  background: 'var(--green, #22c55e)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 12,
  lineHeight: '20px',
  textAlign: 'center',
  fontFamily: "'Figtree', sans-serif",
}
const bulletListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 4,
}
const bulletStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.55,
  paddingLeft: 14,
  position: 'relative',
}
const upgradeStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(26,95,173,0.25)',
  background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(124,58,237,0.05))',
}
const upgradeHeadingStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  marginBottom: 4,
}
const upgradeDescStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  marginBottom: 10,
  lineHeight: 1.5,
}
const upgradeCtaStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 800,
  fontFamily: "'Figtree', sans-serif",
  background: 'var(--primary)',
  color: '#fff',
  border: '1px solid var(--primary)',
  textDecoration: 'none',
}
const proChipStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  color: '#fff',
  background: 'linear-gradient(135deg, #7c3aed, #1a5fad)',
  padding: '3px 8px',
  borderRadius: 999,
  fontFamily: "'Figtree', sans-serif",
}
const freeChipStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  background: 'var(--bg-light)',
  padding: '3px 8px',
  borderRadius: 999,
  fontFamily: "'Figtree', sans-serif",
  border: '1px solid var(--border)',
}
