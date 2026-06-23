// Block 5A-W-1 — tests for the rule-based alert preference helpers.
//
// Covers:
//   * defaults match the migration's column DEFAULTs
//   * applyPatch — coerces, clamps and drops invalid input
//   * row <-> camelCase conversion round-trips
//   * loadUserAlertPreferences — returns defaults on missing row / error
//   * saveUserAlertPreferences — upserts a normalised row

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import {
  ALERT_PREFERENCE_DEFAULTS,
  ALERT_PREFERENCE_BOUNDS,
  ALERT_RULES,
  applyPatch,
  loadUserAlertPreferences,
  preferencesToRow,
  rowToPreferences,
  saveUserAlertPreferences,
  type UserAlertPreferences,
} from '../preferences'

// ─────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────

describe('ALERT_PREFERENCE_DEFAULTS', () => {
  it('mirrors the column DEFAULTs in the migration', () => {
    // These constants are the same numbers that appear in
    // migrations/2026-06-23-user-alert-preferences.sql. Updating one
    // without the other will fail this test on purpose.
    expect(ALERT_PREFERENCE_DEFAULTS).toEqual({
      enabled:                   true,
      scopeWatchlist:            true,
      scopePortfolio:            true,
      rulePriceMoveEnabled:      true,
      rulePriceMovePct:          10,
      ruleRecentSalesEnabled:    true,
      ruleMyPSA10ChangeEnabled:  true,
      ruleMyPSA10ChangePct:      10,
      ruleRawChangeEnabled:      true,
      ruleRawChangePct:          10,
      ruleSpreadChangeEnabled:   false,
      ruleSpreadChangePct:       15,
      ruleMarketActivityEnabled: true,
      minHoursBetweenAlerts:     24,
    })
  })

  it('exposes every rule from the brief in ALERT_RULES', () => {
    expect(ALERT_RULES).toEqual([
      'price_move','recent_sales','psa10_change','raw_change','spread_change','market_activity',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────
// applyPatch — coercion + clamping
// ─────────────────────────────────────────────────────────────────────

describe('applyPatch', () => {
  it('returns a copy when given an empty patch', () => {
    const base = { ...ALERT_PREFERENCE_DEFAULTS }
    const out = applyPatch(base, {})
    expect(out).toEqual(ALERT_PREFERENCE_DEFAULTS)
    expect(out).not.toBe(base)
  })

  it('overrides only the fields supplied', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: 25, scopePortfolio: false })
    expect(out.rulePriceMovePct).toBe(25)
    expect(out.scopePortfolio).toBe(false)
    expect(out.scopeWatchlist).toBe(true)
    expect(out.rulePriceMoveEnabled).toBe(true)
  })

  it('clamps pct fields to the CHECK constraint range', () => {
    const high = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: 999 })
    expect(high.rulePriceMovePct).toBe(ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.max)

    const low = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: 0 })
    expect(low.rulePriceMovePct).toBe(ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.min)

    const negative = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: -50 })
    expect(negative.rulePriceMovePct).toBe(ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.min)
  })

  it('clamps minHoursBetweenAlerts between 0 and 168', () => {
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { minHoursBetweenAlerts: -5  }).minHoursBetweenAlerts).toBe(0)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { minHoursBetweenAlerts: 200 }).minHoursBetweenAlerts).toBe(168)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { minHoursBetweenAlerts:  72 }).minHoursBetweenAlerts).toBe( 72)
  })

  it('floors non-integer pct values', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: 12.9 })
    expect(out.rulePriceMovePct).toBe(12)
  })

  it('drops non-boolean values for boolean fields', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      enabled: ('true' as unknown) as boolean,
    })
    // 'true' is not a boolean → ignored; existing value retained.
    expect(out.enabled).toBe(ALERT_PREFERENCE_DEFAULTS.enabled)
  })

  it('drops NaN / Infinity pct values', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, { rulePriceMovePct: Number.NaN })
    expect(out.rulePriceMovePct).toBe(ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.min)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Row / camelCase conversion
// ─────────────────────────────────────────────────────────────────────

describe('rowToPreferences', () => {
  it('falls back to defaults for a null / undefined row', () => {
    expect(rowToPreferences(null)).toEqual(ALERT_PREFERENCE_DEFAULTS)
    expect(rowToPreferences(undefined)).toEqual(ALERT_PREFERENCE_DEFAULTS)
  })

  it('reads each snake_case column into the camelCase shape', () => {
    const row = {
      enabled:                       false,
      scope_watchlist:               false,
      scope_portfolio:               true,
      rule_price_move_enabled:       false,
      rule_price_move_pct:           33,
      rule_recent_sales_enabled:     false,
      rule_psa10_change_enabled:     true,
      rule_psa10_change_pct:         20,
      rule_raw_change_enabled:       false,
      rule_raw_change_pct:           5,
      rule_spread_change_enabled:    true,
      rule_spread_change_pct:        40,
      rule_market_activity_enabled:  false,
      min_hours_between_alerts:      12,
    }
    expect(rowToPreferences(row)).toEqual({
      enabled:                   false,
      scopeWatchlist:            false,
      scopePortfolio:            true,
      rulePriceMoveEnabled:      false,
      rulePriceMovePct:          33,
      ruleRecentSalesEnabled:    false,
      ruleMyPSA10ChangeEnabled:  true,
      ruleMyPSA10ChangePct:      20,
      ruleRawChangeEnabled:      false,
      ruleRawChangePct:          5,
      ruleSpreadChangeEnabled:   true,
      ruleSpreadChangePct:       40,
      ruleMarketActivityEnabled: false,
      minHoursBetweenAlerts:     12,
    })
  })

  it('falls back to the field default when a single column is missing', () => {
    const row = { enabled: false, rule_price_move_pct: 50 } // most cols missing
    const p = rowToPreferences(row)
    expect(p.enabled).toBe(false)
    expect(p.rulePriceMovePct).toBe(50)
    expect(p.scopeWatchlist).toBe(ALERT_PREFERENCE_DEFAULTS.scopeWatchlist)
    expect(p.minHoursBetweenAlerts).toBe(ALERT_PREFERENCE_DEFAULTS.minHoursBetweenAlerts)
  })
})

describe('preferencesToRow + rowToPreferences', () => {
  it('round-trips losslessly with the defaults', () => {
    const back = rowToPreferences(preferencesToRow(ALERT_PREFERENCE_DEFAULTS))
    expect(back).toEqual(ALERT_PREFERENCE_DEFAULTS)
  })

  it('round-trips losslessly with non-default values', () => {
    const custom: UserAlertPreferences = {
      ...ALERT_PREFERENCE_DEFAULTS,
      enabled:                  false,
      rulePriceMovePct:         25,
      ruleSpreadChangeEnabled:  true,
      minHoursBetweenAlerts:    72,
    }
    expect(rowToPreferences(preferencesToRow(custom))).toEqual(custom)
  })
})

// ─────────────────────────────────────────────────────────────────────
// loadUserAlertPreferences — graceful defaults
// ─────────────────────────────────────────────────────────────────────

const fakeDB = new FakeDB()
beforeEach(() => { fakeDB.reset() })

describe('loadUserAlertPreferences', () => {
  it('returns defaults when no row exists for the user', async () => {
    const p = await loadUserAlertPreferences(asSupa(fakeDB), 'user-1')
    expect(p).toEqual(ALERT_PREFERENCE_DEFAULTS)
  })

  it('returns defaults when the table is missing (no throw)', async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: 'PGRST205', message: 'Could not find the table' },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const p = await loadUserAlertPreferences(broken, 'user-1')
    expect(p).toEqual(ALERT_PREFERENCE_DEFAULTS)
  })

  it('reads the seeded row for the requested user only', async () => {
    fakeDB.seed('user_alert_preferences', [
      { user_id: 'me',    enabled: false, rule_price_move_pct: 30 },
      { user_id: 'other', enabled: true,  rule_price_move_pct: 5  },
    ])
    const mine = await loadUserAlertPreferences(asSupa(fakeDB), 'me')
    expect(mine.enabled).toBe(false)
    expect(mine.rulePriceMovePct).toBe(30)
  })
})

// ─────────────────────────────────────────────────────────────────────
// saveUserAlertPreferences — upsert path
// ─────────────────────────────────────────────────────────────────────

describe('saveUserAlertPreferences', () => {
  it('upserts a normalised row with the user_id', async () => {
    await saveUserAlertPreferences(asSupa(fakeDB), 'user-1', { rulePriceMovePct: 25 })
    const rows = fakeDB.rows('user_alert_preferences')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      user_id:                  'user-1',
      enabled:                  true,
      rule_price_move_pct:      25,
      rule_price_move_enabled:  true,
      min_hours_between_alerts: 24,
    })
  })

  it('clamps values before persisting', async () => {
    await saveUserAlertPreferences(asSupa(fakeDB), 'user-1', { rulePriceMovePct: 9999, minHoursBetweenAlerts: -10 })
    const row = fakeDB.rows('user_alert_preferences')[0]
    expect(row.rule_price_move_pct).toBe(100)
    expect(row.min_hours_between_alerts).toBe(0)
  })

  it('returns the effective preferences after save', async () => {
    const out = await saveUserAlertPreferences(asSupa(fakeDB), 'user-1', { enabled: false })
    expect(out.enabled).toBe(false)
    expect(out.rulePriceMoveEnabled).toBe(ALERT_PREFERENCE_DEFAULTS.rulePriceMoveEnabled)
  })
})
