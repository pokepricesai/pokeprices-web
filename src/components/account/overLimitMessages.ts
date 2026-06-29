// src/components/account/overLimitMessages.ts
// Block 5A-W-26 — pure helpers that produce the friendly "you're
// over the free limit, your saved cards are safe" copy.
//
// Returns `null` when there's nothing to surface (pro plan; under
// the limit; cap is unlimited). The caller renders the string when
// non-null and skips otherwise — keeps the conditional render at
// the call site short.

import { PLAN_LIMITS, type UserPlan } from '@/lib/account/entitlements'

function overLimitMessage(resource: 'portfolio' | 'watchlist' | 'custom alert', currentCount: number, limit: number): string {
  // Two-sentence template; non-destructive, future-tense. Mirrors
  // the brief verbatim where possible: "your saved cards are
  // safe" and "Upgrade coming soon".
  const noun     = resource === 'custom alert' ? 'custom alert thresholds' : `${resource} cards`
  const safeNoun = resource === 'custom alert' ? 'thresholds'              : 'cards'
  const action   = resource === 'portfolio'    ? 'view, edit or remove them'
                 : resource === 'watchlist'    ? 'view, customise or remove them'
                                               : 'turn them off or switch them back to global defaults'
  return `You’re over the free limit of ${limit} ${noun} (currently ${currentCount}), but your saved ${safeNoun} are safe. You can still ${action}. Upgrade coming soon to add more.`
}

export function portfolioOverLimitMessage(plan: UserPlan, currentCount: number): string | null {
  if (plan !== 'free') return null
  const limit = PLAN_LIMITS.free.portfolioItems
  if (limit < 0 || currentCount <= limit) return null
  return overLimitMessage('portfolio', currentCount, limit)
}

export function watchlistOverLimitMessage(plan: UserPlan, currentCount: number): string | null {
  if (plan !== 'free') return null
  const limit = PLAN_LIMITS.free.watchlistItems
  if (limit < 0 || currentCount <= limit) return null
  return overLimitMessage('watchlist', currentCount, limit)
}

export function customAlertOverLimitMessage(plan: UserPlan, currentCount: number): string | null {
  if (plan !== 'free') return null
  const limit = PLAN_LIMITS.free.customAlertOverrides
  if (limit < 0 || currentCount <= limit) return null
  return overLimitMessage('custom alert', currentCount, limit)
}
