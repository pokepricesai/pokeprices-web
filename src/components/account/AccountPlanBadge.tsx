'use client'

// src/components/account/AccountPlanBadge.tsx
// Block 5A-W-26 — reusable plan badge for dashboard surfaces.
//
// Two display modes:
//   * compact  — one-line chip + plan name (Watchlist & Alerts
//                summary, Dashboard hub).
//   * full     — chip + plan name + limits / benefits lines, plus
//                either the upgrade CTA (free) or the Pro
//                confirmation block (pro). (Portfolio, Settings.)
//
// Reads the plan via `useUserPlan` which hits `/api/account/plan` —
// the env allowlist stays server-side. While the plan is loading
// the badge renders a discreet skeleton so the panel reserves
// space and never flashes free→pro copy.

import Link from 'next/link'
import { useUserPlan } from '@/lib/account/useUserPlan'
import { getPlanCopy, UPGRADE_CTA, PRO_CONFIRMATION_LINES } from './accountPlanCopy'

export type AccountPlanBadgeProps = {
  /** Caller passes the signed-in user's id so the hook can fetch
   *  their plan. Null/undefined → renders nothing (no logged-in
   *  user means no plan to show). */
  userId: string | null | undefined
  /** `compact` is a single chip + name (small horizontal strip).
   *  `full` adds limits/benefits lines + the upgrade / pro panel. */
  mode?: 'compact' | 'full'
  /** When true (default), the free badge renders the early-access
   *  CTA. Set to false on surfaces that already have their own
   *  upgrade CTA so the page doesn't show two side-by-side. */
  showUpgradeCta?: boolean
}

export default function AccountPlanBadge({
  userId,
  mode = 'full',
  showUpgradeCta = true,
}: AccountPlanBadgeProps) {
  const { plan, loading } = useUserPlan(userId ?? null)
  if (!userId) return null

  if (loading) {
    return (
      <div style={skeletonStyle} aria-hidden="true">
        <div className="skeleton" style={{ height: mode === 'compact' ? 22 : 64, borderRadius: 10 }} />
      </div>
    )
  }

  const copy = getPlanCopy(plan)
  const isPro = plan === 'pro'

  // Compact: chip + plan name on one line. No benefits / CTA.
  if (mode === 'compact') {
    return (
      <div style={compactRowStyle}>
        <span style={chipStyle(isPro)}>{isPro ? 'Pro' : 'Free'}</span>
        <span style={compactNameStyle}>{copy.planName}</span>
      </div>
    )
  }

  // Full: chip + name + limits + benefits + CTA / pro panel.
  return (
    <div style={fullPanelStyle(isPro)}>
      <div style={fullHeadRowStyle}>
        <span style={chipStyle(isPro)}>{isPro ? 'Pro' : 'Free'}</span>
        <span style={fullNameStyle}>{copy.planName}</span>
      </div>
      <div style={fullLineStyle}>{copy.limitsLine}</div>
      <div style={fullLineMutedStyle}>{copy.benefitsLine}</div>

      {isPro && (
        <ul style={proListStyle}>
          {PRO_CONFIRMATION_LINES.slice(1).map((line, i) => (
            <li key={i} style={proListItemStyle}>{line}</li>
          ))}
        </ul>
      )}

      {!isPro && showUpgradeCta && (
        <div style={ctaWrapStyle}>
          <div style={ctaHeadingStyle}>{UPGRADE_CTA.heading}</div>
          <div style={ctaBlurbStyle}>{UPGRADE_CTA.blurb}</div>
          <Link href={UPGRADE_CTA.buttonHref} style={ctaButtonStyle}>
            {UPGRADE_CTA.buttonLabel}
          </Link>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Styles — small palette, no CSS variables that email clients strip
// (this is a web component, so CSS vars are fine; matches the rest
// of the dashboard). Pro and Free are distinguished by chip + panel
// border tone, not by an accent colour the user has to learn.
// ─────────────────────────────────────────────────────────────────────

function chipStyle(isPro: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 10, fontWeight: 900,
    letterSpacing: 0.8, textTransform: 'uppercase',
    padding: '2px 8px', borderRadius: 6,
    background: isPro ? 'rgba(26,95,173,0.12)' : 'rgba(100,116,139,0.10)',
    color:      isPro ? 'var(--primary)'       : 'var(--text-muted)',
    border:     '1px solid ' + (isPro ? 'rgba(26,95,173,0.30)' : 'rgba(100,116,139,0.25)'),
    fontFamily: "'Figtree', sans-serif",
    flexShrink: 0,
  }
}

function fullPanelStyle(isPro: boolean): React.CSSProperties {
  return {
    background: isPro ? 'rgba(26,95,173,0.04)' : 'var(--card)',
    border:     '1px solid ' + (isPro ? 'rgba(26,95,173,0.25)' : 'var(--border)'),
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 16,
  }
}

const skeletonStyle: React.CSSProperties = {
  marginBottom: 16,
}

const compactRowStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: 0,
}
const compactNameStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
}

const fullHeadRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6,
}
const fullNameStyle: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 15, fontWeight: 800,
  color: 'var(--text)',
}
const fullLineStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.5,
}
const fullLineMutedStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  marginTop: 2,
}

const proListStyle: React.CSSProperties = {
  marginTop: 10,
  paddingLeft: 18,
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.7,
}
const proListItemStyle: React.CSSProperties = {
  marginBottom: 0,
}

const ctaWrapStyle: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px dashed var(--border-light)',
}
const ctaHeadingStyle: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 13, fontWeight: 800,
  color: 'var(--text)',
  marginBottom: 4,
}
const ctaBlurbStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1.5,
  marginBottom: 10,
}
const ctaButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 10,
  background: 'var(--primary)',
  color: '#fff',
  fontSize: 12, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none',
}
