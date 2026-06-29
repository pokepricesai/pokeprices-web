// src/components/account/accountPlanCopy.ts
// Block 5A-W-26 — pure copy + CTA constants for the AccountPlanBadge.
// Centralised so the same wording lands everywhere the badge mounts
// (Watchlist & Alerts summary, Portfolio, Settings, Dashboard hub).
//
// Pure — no React, no env reads — so the strings can be pinned via
// unit tests without rendering.

import { PLAN_LIMITS, type UserPlan } from '@/lib/account/entitlements'

export type AccountPlanCopy = {
  planName:   string
  limitsLine: string
  benefitsLine: string
}

/**
 * The two visible variants of the badge. Free shows the actual numeric
 * limits so a new account knows what they get; Pro shows the
 * unlimited line so a founder/early-access user knows it lifted.
 *
 * If a future plan slot adds a third tier, add a row here and the
 * type system forces the limits to match what `PLAN_LIMITS` says.
 */
export function getPlanCopy(plan: UserPlan): AccountPlanCopy {
  if (plan === 'pro') {
    return {
      planName:     'Pro account',
      limitsLine:   'Unlimited portfolio, watchlist and custom alerts',
      benefitsLine: 'Instant alerts included',
    }
  }
  const f = PLAN_LIMITS.free
  return {
    planName:     'Free account',
    limitsLine:   `Portfolio ${f.portfolioItems} cards · Watchlist ${f.watchlistItems} cards · ${f.customAlertOverrides} custom alerts`,
    benefitsLine: 'Weekly overview included',
  }
}

// ─────────────────────────────────────────────────────────────────────
// Upgrade / early-access CTA. Stripe isn't live yet, so we route the
// "Get Pro" interaction to a mailto. Pre-filled subject so an
// inbound email is easy to triage. No URL params that carry the
// user's email — we let their default mail client populate the
// "From" field instead.
// ─────────────────────────────────────────────────────────────────────

export const UPGRADE_CTA = {
  /** Heading shown on the free badge — friendly future-tense per the
   *  brief, no aggressive paywall language. */
  heading:     'Pro is coming soon',
  /** One-sentence value prop. Mirrors the headline copy in
   *  WatchlistAlertsSummary so the message reads consistently. */
  blurb:       'Unlock unlimited portfolio, watchlist alerts and instant emails.',
  /** Button copy. */
  buttonLabel: 'Join early access',
  /** Tap target — `mailto:` keeps the block free of new routes /
   *  Stripe wiring. Subject pre-filled so an inbound email is
   *  obviously about Pro. */
  buttonHref:  'mailto:hello@pokeprices.io?subject=Pro%20early%20access',
} as const

/**
 * Pro users see a confirmation panel instead of an upgrade CTA. The
 * copy intentionally calls out exactly what they get so an existing
 * over-limit user moved to Pro via the env allowlist can SEE that
 * the limits are off.
 */
export const PRO_CONFIRMATION_LINES: ReadonlyArray<string> = [
  "You're on Pro",
  'Unlimited portfolio and watchlist',
  'Custom alerts on every watched card',
  'Instant alerts available',
]
