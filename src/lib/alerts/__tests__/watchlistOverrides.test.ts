// Block 5A-W-19 — resolver tests for watchlist alert overrides.
// Pure logic only — `loadWatchlistAlertOverrides` (the DB plumbing
// half) is exercised end-to-end by evaluator.test.ts via FakeDB.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { ALERT_PREFERENCE_DEFAULTS, applyPatch } from '../preferences'
import {
  resolveCardAlertSettings,
  thresholdForSignedPct,
  type WatchlistAlertOverrideRow,
} from '../watchlistOverrides'

const globalPrefs = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
  rulePriceMoveWatchlistPct: 15,
  rulePriceMovePct:          15,
  ruleRecentSalesEnabled:    true,
  ruleMarketActivityEnabled: true,
})

function row(over: Partial<WatchlistAlertOverrideRow> = {}): WatchlistAlertOverrideRow {
  return {
    user_id:                 'u1',
    card_slug:               'charizard-4',
    enabled:                 true,
    use_global_defaults:     false,
    rise_pct:                20,
    drop_pct:                10,
    recent_sales_enabled:    true,
    market_activity_enabled: true,
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Source gate
// ─────────────────────────────────────────────────────────────────────

describe('resolveCardAlertSettings — source gate', () => {
  it('ignores the override for portfolio-source cards (portfolio behaviour unchanged)', () => {
    const out = resolveCardAlertSettings(globalPrefs, row(), 'portfolio')
    expect(out.thresholdSource).toBe('global')
    expect(out.risePct).toBe(15)
    expect(out.dropPct).toBe(15)
    expect(out.enabled).toBe(true)
  })

  it('ignores the override for "both" (watched-and-owned) cards', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ enabled: false }), 'both')
    // Even with the override set to enabled=false, "both" still runs.
    expect(out.enabled).toBe(true)
    expect(out.thresholdSource).toBe('global')
  })

  it('applies the override for pure watchlist-source cards', () => {
    const out = resolveCardAlertSettings(globalPrefs, row(), 'watchlist')
    expect(out.thresholdSource).toBe('override')
    expect(out.risePct).toBe(20)
    expect(out.dropPct).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Override semantics
// ─────────────────────────────────────────────────────────────────────

describe('resolveCardAlertSettings — override semantics', () => {
  it('returns globals when no override row exists', () => {
    const out = resolveCardAlertSettings(globalPrefs, null, 'watchlist')
    expect(out.thresholdSource).toBe('global')
    expect(out.risePct).toBe(15)
    expect(out.dropPct).toBe(15)
    expect(out.enabled).toBe(true)
  })

  it('returns globals when override has use_global_defaults=true (the no-op case)', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ use_global_defaults: true }), 'watchlist')
    expect(out.thresholdSource).toBe('global')
    expect(out.risePct).toBe(15)
    expect(out.dropPct).toBe(15)
  })

  it('returns enabled=false when override.enabled=false (master per-card switch)', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ enabled: false }), 'watchlist')
    expect(out.enabled).toBe(false)
  })

  it('asymmetric thresholds: rise 25% / drop 5%', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ rise_pct: 25, drop_pct: 5 }), 'watchlist')
    expect(out.risePct).toBe(25)
    expect(out.dropPct).toBe(5)
  })

  it('NULL on a side falls back to the global watchlist threshold for that direction', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ rise_pct: 25, drop_pct: null }), 'watchlist')
    expect(out.risePct).toBe(25)
    expect(out.dropPct).toBe(15)   // global watchlist fallback
  })

  it('override.recent_sales_enabled=false suppresses recent sales for this card', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ recent_sales_enabled: false }), 'watchlist')
    expect(out.recentSalesEnabled).toBe(false)
    expect(out.marketActivityEnabled).toBe(true)
  })

  it('override.market_activity_enabled=false suppresses market activity for this card', () => {
    const out = resolveCardAlertSettings(globalPrefs, row({ market_activity_enabled: false }), 'watchlist')
    expect(out.recentSalesEnabled).toBe(true)
    expect(out.marketActivityEnabled).toBe(false)
  })

  it('use_global_defaults=true ignores rise/drop AND the rule toggles on the override row', () => {
    const out = resolveCardAlertSettings(
      globalPrefs,
      row({ use_global_defaults: true, rise_pct: 50, drop_pct: 1, recent_sales_enabled: false, market_activity_enabled: false }),
      'watchlist',
    )
    expect(out.risePct).toBe(15)
    expect(out.dropPct).toBe(15)
    expect(out.recentSalesEnabled).toBe(true)        // global default
    expect(out.marketActivityEnabled).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// thresholdForSignedPct
// ─────────────────────────────────────────────────────────────────────

describe('thresholdForSignedPct', () => {
  const eff = resolveCardAlertSettings(globalPrefs, row({ rise_pct: 25, drop_pct: 5 }), 'watchlist')

  it('positive pct picks the rise threshold', () => {
    expect(thresholdForSignedPct(eff, 30)).toBe(25)
    expect(thresholdForSignedPct(eff, 0.001)).toBe(25)
  })
  it('negative pct picks the drop threshold', () => {
    expect(thresholdForSignedPct(eff, -10)).toBe(5)
  })
  it('exactly zero falls into the rise side (never triggers anyway)', () => {
    expect(thresholdForSignedPct(eff, 0)).toBe(25)
  })
})
