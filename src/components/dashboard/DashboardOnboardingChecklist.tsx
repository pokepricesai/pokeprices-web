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
import { loadPortfolioItemCount } from '@/lib/account/usage'
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
        // Block 5A-W-42A-FIX — portfolio_items lives behind portfolios
        // for the user_id; the single-step `.eq('user_id', ...)` used to
        // miss older rows where user_id was never populated. Reuse the
        // proven two-step helper from src/lib/account/usage.ts.
        loadPortfolioItemCount(supabase, userId).catch(() => null),
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

// ─── Block 5A-W-42A-FIX — compact "all-set" account strip ────────────
// Previously rendered a large bordered card with a heading, sub-copy,
// a padded plan block (purple bg + coloured border), a bulleted grid
// of entitlements, and — for free users — a large upgrade sub-panel.
// It dominated the top of the hub for Pro users who had completed
// onboarding and pushed the personal-snapshot cards well below the
// fold.
//
// The strip below keeps the account tier visible without overwhelming
// the hub: a single row with the plan chip, the plan heading, the
// entitlements joined into a compact "·"-separated line, and — free
// users only — a small inline upgrade link on the right. No purple
// gradient, no bulleted grid, no giant success block.

function AllSetCard({ state, plan }: { state: AllSetState; plan: UserPlan }) {
  const isPro = plan === 'pro'
  return (
    <div style={stripCardStyle} aria-label="Account status">
      <div style={stripLeftStyle}>
        {isPro ? <ProAccountChip /> : <FreeAccountChip />}
        <span style={stripHeadingStyle}>{state.planHeading}</span>
        {state.planBullets.length > 0 && (
          <span style={stripBulletsStyle}>{state.planBullets.join(' · ')}</span>
        )}
      </div>
      {!isPro && state.upgrade && (
        <Link
          href={state.upgrade.ctaHref}
          style={stripUpgradeCtaStyle}
          aria-label={state.upgrade.ctaLabel}
        >
          {state.upgrade.ctaLabel} →
        </Link>
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

// ── Block 5A-W-42A-FIX — compact account strip styles ──────────────

const stripCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '9px 14px',
  marginBottom: 14,
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  fontFamily: "'Figtree', sans-serif",
}
const stripLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  minWidth: 0,
}
const stripHeadingStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 800,
  color: 'var(--text)',
}
const stripBulletsStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.4,
}
const stripUpgradeCtaStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 800,
  color: 'var(--primary)',
  textDecoration: 'none',
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  whiteSpace: 'nowrap',
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
