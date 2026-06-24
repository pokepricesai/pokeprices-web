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
  it('mirrors the column DEFAULTs in the migrations', () => {
    // These constants are the same numbers that appear in
    // migrations/2026-06-23-user-alert-preferences.sql AND
    // migrations/2026-06-24-alert-preferences-v2.sql. Updating one
    // without the others will fail this test on purpose.
    expect(ALERT_PREFERENCE_DEFAULTS).toEqual({
      // v1 (Block 5A-W-1)
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
      // v2 (Block 5A-W-13)
      weeklyDigestEnabled:            true,
      weeklyOverviewPortfolioEnabled: true,
      weeklyOverviewWatchlistEnabled: true,
      weeklyDigestDayOfWeek:          1,
      instantAlertsEnabled:           true,
      rulePriceMovePortfolioPct:      10,
      rulePriceMoveWatchlistPct:      15,
      ruleRecentSalesMinCount:        3,
      ruleMarketActivityMinCount:     5,
      digestCooldownHours:            24,
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
      // v1
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
      // v2 (Block 5A-W-13)
      weekly_digest_enabled:             false,
      weekly_overview_portfolio_enabled: false,
      weekly_overview_watchlist_enabled: true,
      weekly_digest_day_of_week:         5,
      instant_alerts_enabled:            false,
      rule_price_move_portfolio_pct:     20,
      rule_price_move_watchlist_pct:     25,
      rule_recent_sales_min_count:       7,
      rule_market_activity_min_count:    12,
      digest_cooldown_hours:             48,
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
      weeklyDigestEnabled:            false,
      weeklyOverviewPortfolioEnabled: false,
      weeklyOverviewWatchlistEnabled: true,
      weeklyDigestDayOfWeek:          5,
      instantAlertsEnabled:           false,
      rulePriceMovePortfolioPct:      20,
      rulePriceMoveWatchlistPct:      25,
      ruleRecentSalesMinCount:        7,
      ruleMarketActivityMinCount:     12,
      digestCooldownHours:            48,
    })
  })

  it('falls back to v2 defaults when the row predates the Block 5A-W-13 migration', () => {
    // Pre-migration row (v1 columns only). The helper must synthesise
    // the v2 fields so an existing user landing on the new UI sees
    // sensible defaults rather than zeros/falses.
    const v1Row = {
      enabled: true, rule_price_move_pct: 10,
    }
    const p = rowToPreferences(v1Row)
    expect(p.weeklyDigestEnabled).toBe(true)
    expect(p.weeklyDigestDayOfWeek).toBe(1)
    expect(p.instantAlertsEnabled).toBe(true)
    expect(p.rulePriceMovePortfolioPct).toBe(10)
    expect(p.rulePriceMoveWatchlistPct).toBe(15)
    expect(p.ruleRecentSalesMinCount).toBe(3)
    expect(p.ruleMarketActivityMinCount).toBe(5)
    expect(p.digestCooldownHours).toBe(24)
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

  it('persists every Block 5A-W-13 snake_case column on first save (defaults for new users)', async () => {
    await saveUserAlertPreferences(asSupa(fakeDB), 'newbie', {})
    const row = fakeDB.rows('user_alert_preferences')[0]
    expect(row).toMatchObject({
      user_id:                            'newbie',
      weekly_digest_enabled:              true,
      weekly_overview_portfolio_enabled:  true,
      weekly_overview_watchlist_enabled:  true,
      weekly_digest_day_of_week:          1,
      instant_alerts_enabled:             true,
      rule_price_move_portfolio_pct:      10,
      rule_price_move_watchlist_pct:      15,
      rule_recent_sales_min_count:        3,
      rule_market_activity_min_count:     5,
      digest_cooldown_hours:              24,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-13 — new field validation
// ─────────────────────────────────────────────────────────────────────

describe('applyPatch — Block 5A-W-13 fields', () => {
  it('toggles weekly overview booleans independently', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      weeklyDigestEnabled:            false,
      weeklyOverviewPortfolioEnabled: false,
    })
    expect(out.weeklyDigestEnabled).toBe(false)
    expect(out.weeklyOverviewPortfolioEnabled).toBe(false)
    // watchlist half stays on
    expect(out.weeklyOverviewWatchlistEnabled).toBe(true)
  })

  it('clamps weeklyDigestDayOfWeek to 1..7', () => {
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { weeklyDigestDayOfWeek: 0   }).weeklyDigestDayOfWeek).toBe(1)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { weeklyDigestDayOfWeek: 7   }).weeklyDigestDayOfWeek).toBe(7)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { weeklyDigestDayOfWeek: 99  }).weeklyDigestDayOfWeek).toBe(7)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { weeklyDigestDayOfWeek: -1  }).weeklyDigestDayOfWeek).toBe(1)
  })

  it('clamps the per-scope price-move pcts to 1..100', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      rulePriceMovePortfolioPct: 9999,
      rulePriceMoveWatchlistPct: 0,
    })
    expect(out.rulePriceMovePortfolioPct).toBe(100)
    expect(out.rulePriceMoveWatchlistPct).toBe(1)
  })

  it('clamps recent_sales min count to 1..50 and market activity to 1..100', () => {
    const high = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      ruleRecentSalesMinCount:    9999,
      ruleMarketActivityMinCount: 9999,
    })
    expect(high.ruleRecentSalesMinCount).toBe(50)
    expect(high.ruleMarketActivityMinCount).toBe(100)

    const low = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      ruleRecentSalesMinCount:    0,
      ruleMarketActivityMinCount: -5,
    })
    expect(low.ruleRecentSalesMinCount).toBe(1)
    expect(low.ruleMarketActivityMinCount).toBe(1)
  })

  it('clamps digestCooldownHours to 1..168 (cannot disable via 0)', () => {
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { digestCooldownHours: 0    }).digestCooldownHours).toBe(1)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { digestCooldownHours: 200  }).digestCooldownHours).toBe(168)
    expect(applyPatch(ALERT_PREFERENCE_DEFAULTS, { digestCooldownHours: 72   }).digestCooldownHours).toBe(72)
  })

  it('drops non-boolean values for new boolean fields', () => {
    const out = applyPatch(ALERT_PREFERENCE_DEFAULTS, {
      weeklyDigestEnabled:  ('true' as unknown) as boolean,
      instantAlertsEnabled: ('false' as unknown) as boolean,
    })
    expect(out.weeklyDigestEnabled).toBe(true)   // unchanged from default
    expect(out.instantAlertsEnabled).toBe(true)  // unchanged from default
  })

  it('round-trips losslessly with non-default Block 5A-W-13 values', () => {
    const custom: UserAlertPreferences = {
      ...ALERT_PREFERENCE_DEFAULTS,
      weeklyDigestEnabled:            false,
      weeklyOverviewPortfolioEnabled: false,
      weeklyDigestDayOfWeek:          7,
      instantAlertsEnabled:           false,
      rulePriceMovePortfolioPct:      25,
      rulePriceMoveWatchlistPct:      30,
      ruleRecentSalesMinCount:        10,
      ruleMarketActivityMinCount:     20,
      digestCooldownHours:            72,
    }
    expect(rowToPreferences(preferencesToRow(custom))).toEqual(custom)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-13 — migration shape
// ─────────────────────────────────────────────────────────────────────

describe('migrations/2026-06-24-alert-preferences-v2.sql', () => {
  // Read the file directly so the tests assert the SQL matches the JS
  // contract. (No DB roundtrip — Luke runs migrations by hand in the
  // Supabase SQL Editor.)
  const fs = require('node:fs')
  const path = require('node:path')
  const sqlPath = path.join(process.cwd(), 'migrations', '2026-06-24-alert-preferences-v2.sql')
  const rawSql = fs.readFileSync(sqlPath, 'utf8') as string
  // Strip line comments so the operator rollback playbook in the
  // trailing comments does not trip the destructive-DDL checks.
  const sql = rawSql.replace(/--[^\n]*/g, '')

  it('is additive only — no destructive DDL against existing tables', () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+public\./i)
  })

  it('adds every expected column with ADD COLUMN IF NOT EXISTS', () => {
    for (const col of [
      'weekly_digest_enabled',
      'weekly_overview_portfolio_enabled',
      'weekly_overview_watchlist_enabled',
      'weekly_digest_day_of_week',
      'instant_alerts_enabled',
      'rule_price_move_portfolio_pct',
      'rule_price_move_watchlist_pct',
      'rule_recent_sales_min_count',
      'rule_market_activity_min_count',
      'digest_cooldown_hours',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\b`, 'i'))
    }
  })

  it('defaults each column to the same value as ALERT_PREFERENCE_DEFAULTS', () => {
    expect(sql).toMatch(/weekly_digest_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i)
    expect(sql).toMatch(/weekly_overview_portfolio_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i)
    expect(sql).toMatch(/weekly_overview_watchlist_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i)
    expect(sql).toMatch(/weekly_digest_day_of_week\s+INT\s+NOT\s+NULL\s+DEFAULT\s+1/i)
    expect(sql).toMatch(/instant_alerts_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i)
    expect(sql).toMatch(/rule_price_move_portfolio_pct\s+INT\s+NOT\s+NULL\s+DEFAULT\s+10/i)
    expect(sql).toMatch(/rule_price_move_watchlist_pct\s+INT\s+NOT\s+NULL\s+DEFAULT\s+15/i)
    expect(sql).toMatch(/rule_recent_sales_min_count\s+INT\s+NOT\s+NULL\s+DEFAULT\s+3/i)
    expect(sql).toMatch(/rule_market_activity_min_count\s+INT\s+NOT\s+NULL\s+DEFAULT\s+5/i)
    expect(sql).toMatch(/digest_cooldown_hours\s+INT\s+NOT\s+NULL\s+DEFAULT\s+24/i)
  })

  it('wraps the migration in a transaction with the sanity check', () => {
    expect(sql).toMatch(/^BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;/m)
    expect(sql).toMatch(/expected 10 new columns/i)
  })

  it('adds CHECK constraints idempotently via pg_constraint guards', () => {
    expect(sql).toMatch(/user_alert_preferences_weekly_dow_chk/)
    expect(sql).toMatch(/user_alert_preferences_pm_portfolio_chk/)
    expect(sql).toMatch(/user_alert_preferences_pm_watchlist_chk/)
    expect(sql).toMatch(/user_alert_preferences_recent_sales_chk/)
    expect(sql).toMatch(/user_alert_preferences_market_activity_chk/)
    expect(sql).toMatch(/user_alert_preferences_digest_cooldown_chk/)
  })

  it('does not touch other existing tables', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.(watchlist|portfolios|portfolio_items|alert_events|user_email_preferences|cards|provider_card_links)/i)
  })
})
