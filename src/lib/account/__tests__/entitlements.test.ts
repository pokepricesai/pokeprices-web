// Block 5A-W-24 — entitlements helper unit tests.

import { describe, it, expect } from 'vitest'
import {
  PLAN_LIMITS,
  UPGRADE_COPY,
  getUserPlan,
  getPlanLimits,
  canAddPortfolioItem,
  canAddWatchlistItem,
  canAddCustomAlertOverride,
  canUseInstantAlerts,
  canUseWeeklyDigest,
} from '../entitlements'

// ─────────────────────────────────────────────────────────────────────
// Plan resolution
// ─────────────────────────────────────────────────────────────────────

describe('getUserPlan', () => {
  it('defaults to "free" when profile is null/undefined', () => {
    expect(getUserPlan(null)).toBe('free')
    expect(getUserPlan(undefined)).toBe('free')
    expect(getUserPlan({})).toBe('free')
  })
  it('returns "pro" when profile.plan === "pro"', () => {
    expect(getUserPlan({ plan: 'pro' })).toBe('pro')
  })
  it('defaults to "free" for unrecognised plan strings', () => {
    expect(getUserPlan({ plan: 'enterprise' })).toBe('free')
    expect(getUserPlan({ plan: '' })).toBe('free')
    expect(getUserPlan({ plan: null })).toBe('free')
  })
})

describe('PLAN_LIMITS', () => {
  it('free plan caps match the product spec', () => {
    expect(PLAN_LIMITS.free.portfolioItems).toBe(25)
    expect(PLAN_LIMITS.free.watchlistItems).toBe(10)
    expect(PLAN_LIMITS.free.customAlertOverrides).toBe(3)
    expect(PLAN_LIMITS.free.instantAlertsAllowed).toBe(false)
    expect(PLAN_LIMITS.free.weeklyDigestAllowed).toBe(true)
  })
  it('pro plan grants unlimited (-1) for counted features + instant alerts on', () => {
    expect(PLAN_LIMITS.pro.portfolioItems).toBe(-1)
    expect(PLAN_LIMITS.pro.watchlistItems).toBe(-1)
    expect(PLAN_LIMITS.pro.customAlertOverrides).toBe(-1)
    expect(PLAN_LIMITS.pro.instantAlertsAllowed).toBe(true)
    expect(PLAN_LIMITS.pro.weeklyDigestAllowed).toBe(true)
  })
})

describe('getPlanLimits', () => {
  it('returns the canonical PLAN_LIMITS row for each plan', () => {
    expect(getPlanLimits('free')).toBe(PLAN_LIMITS.free)
    expect(getPlanLimits('pro')).toBe(PLAN_LIMITS.pro)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Watchlist limit
// ─────────────────────────────────────────────────────────────────────

describe('canAddWatchlistItem', () => {
  it('free below limit → allowed', () => {
    const r = canAddWatchlistItem('free', 9)
    expect(r.allowed).toBe(true)
    expect(r.current).toBe(9)
    expect(r.limit).toBe(10)
    expect(r.reason).toBeUndefined()
  })
  it('free at limit → blocked with friendly copy', () => {
    const r = canAddWatchlistItem('free', 10)
    expect(r.allowed).toBe(false)
    expect(r.limit).toBe(10)
    expect(r.reason).toBe(UPGRADE_COPY.watchlistLimit)
  })
  it('free OVER limit (legacy user with 47 cards) → blocked but never destructive', () => {
    const r = canAddWatchlistItem('free', 47)
    expect(r.allowed).toBe(false)
    expect(r.current).toBe(47)   // count is echoed, not "reset"
  })
  it('pro at any count → allowed, limit reported as -1', () => {
    expect(canAddWatchlistItem('pro', 999).allowed).toBe(true)
    expect(canAddWatchlistItem('pro', 999).limit).toBe(-1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Portfolio limit
// ─────────────────────────────────────────────────────────────────────

describe('canAddPortfolioItem', () => {
  it('free below limit → allowed', () => {
    const r = canAddPortfolioItem('free', 24)
    expect(r.allowed).toBe(true)
    expect(r.limit).toBe(25)
  })
  it('free at limit → blocked', () => {
    expect(canAddPortfolioItem('free', 25).allowed).toBe(false)
    expect(canAddPortfolioItem('free', 25).reason).toBe(UPGRADE_COPY.portfolioLimit)
  })
  it('over-limit existing user → blocked, current echoed', () => {
    const r = canAddPortfolioItem('free', 480)
    expect(r.allowed).toBe(false)
    expect(r.current).toBe(480)
  })
  it('pro → unlimited', () => {
    expect(canAddPortfolioItem('pro', 9_999).allowed).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Per-card custom alert override limit
// ─────────────────────────────────────────────────────────────────────

describe('canAddCustomAlertOverride', () => {
  it('free at 0/1/2 → allowed', () => {
    expect(canAddCustomAlertOverride('free', 0).allowed).toBe(true)
    expect(canAddCustomAlertOverride('free', 1).allowed).toBe(true)
    expect(canAddCustomAlertOverride('free', 2).allowed).toBe(true)
  })
  it('free at 3 → blocked with friendly copy', () => {
    const r = canAddCustomAlertOverride('free', 3)
    expect(r.allowed).toBe(false)
    expect(r.limit).toBe(3)
    expect(r.reason).toBe(UPGRADE_COPY.customAlertLimit)
  })
  it('pro at any count → allowed, unlimited', () => {
    expect(canAddCustomAlertOverride('pro', 99).allowed).toBe(true)
    expect(canAddCustomAlertOverride('pro', 99).limit).toBe(-1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Feature toggles (instant alerts / weekly digest)
// ─────────────────────────────────────────────────────────────────────

describe('canUseInstantAlerts', () => {
  it('free → blocked with friendly upgrade copy', () => {
    const r = canUseInstantAlerts('free')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(UPGRADE_COPY.instantAlerts)
  })
  it('pro → allowed', () => {
    expect(canUseInstantAlerts('pro').allowed).toBe(true)
    expect(canUseInstantAlerts('pro').reason).toBeUndefined()
  })
})

describe('canUseWeeklyDigest', () => {
  it('free → allowed (weekly digest is free for everyone today)', () => {
    expect(canUseWeeklyDigest('free').allowed).toBe(true)
  })
  it('pro → allowed', () => {
    expect(canUseWeeklyDigest('pro').allowed).toBe(true)
  })
})
