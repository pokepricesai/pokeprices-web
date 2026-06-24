// Block 5A-W-2 — alert evaluator tests.
//
// Covers pure helpers + the end-to-end orchestrator via FakeDB:
//   * disabled / scope / cooldown gates
//   * each rule fires with the right payload + severity
//   * dryRun=true returns proposals but writes nothing
//   * dryRun=false inserts into alert_events
//   * "card on both lists" deduplicates and reports source='both'
//   * payload never contains user identifiers / emails

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import {
  evaluateAlerts,
  evaluateCardForUser,
  findPriceComparisonPair,
  isOnCooldown,
  pctChange,
  severityForPct,
  spreadMultiple,
  type ProposedAlertEvent,
} from '../evaluator'
import {
  ALERT_PREFERENCE_DEFAULTS,
  applyPatch,
  preferencesToRow,
} from '../preferences'

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('pctChange', () => {
  it('returns null when old is zero / null / undefined', () => {
    expect(pctChange(0,    100 )).toBeNull()
    expect(pctChange(null, 100 )).toBeNull()
    expect(pctChange(100,  null)).toBeNull()
  })
  it('returns signed percent change', () => {
    expect(pctChange(100, 110)).toBeCloseTo(10)
    expect(pctChange(100,  90)).toBeCloseTo(-10)
    expect(pctChange(100, 200)).toBeCloseTo(100)
  })
})

describe('findPriceComparisonPair', () => {
  it('returns null for <2 rows', () => {
    expect(findPriceComparisonPair([])).toBeNull()
    expect(findPriceComparisonPair([{ date: '2026-06-20' }])).toBeNull()
  })
  it('picks the latest + the row whose date is closest to latest-7d', () => {
    const rows = [
      { date: '2026-06-01', raw_usd: 100 },
      { date: '2026-06-10', raw_usd: 110 },
      { date: '2026-06-15', raw_usd: 130 },  // exactly 7d before latest
      { date: '2026-06-20', raw_usd: 140 },  // latest (relative to 7d cutoff)
      { date: '2026-06-22', raw_usd: 160 },  // latest in real
    ]
    const out = findPriceComparisonPair(rows)
    expect(out).not.toBeNull()
    expect(out!.latest.date).toBe('2026-06-22')
    // cutoff = 2026-06-15; baseline is the row dated 2026-06-15 (<=).
    expect(out!.baseline.date).toBe('2026-06-15')
  })
  it('returns null when no row is old enough', () => {
    const rows = [
      { date: '2026-06-20', raw_usd: 100 },
      { date: '2026-06-21', raw_usd: 110 },
      { date: '2026-06-22', raw_usd: 120 },  // latest; no row <= 2026-06-15
    ]
    expect(findPriceComparisonPair(rows)).toBeNull()
  })
})

describe('severityForPct', () => {
  it('promotes >= 25% absolute to high', () => {
    expect(severityForPct( 25)).toBe('high')
    expect(severityForPct(-30)).toBe('high')
    expect(severityForPct( 10)).toBe('normal')
    expect(severityForPct(-24)).toBe('normal')
  })
})

describe('spreadMultiple', () => {
  it('returns psa10 / raw', () => {
    expect(spreadMultiple(100, 500)).toBe(5)
  })
  it('returns null on missing / zero legs', () => {
    expect(spreadMultiple(0, 500)).toBeNull()
    expect(spreadMultiple(null, 500)).toBeNull()
    expect(spreadMultiple(100, null)).toBeNull()
  })
})

describe('isOnCooldown', () => {
  const now = new Date('2026-06-24T12:00:00Z')
  it('returns false when no prior event exists', () => {
    expect(isOnCooldown(new Map(), 'u', 'c', 'raw_change', 24, now)).toBe(false)
  })
  it('returns true when prior event is within the cooldown window', () => {
    const idx = new Map([['u|c|raw_change', '2026-06-24T10:00:00Z']])  // 2h ago
    expect(isOnCooldown(idx, 'u', 'c', 'raw_change', 24, now)).toBe(true)
  })
  it('returns false when prior event is outside the cooldown window', () => {
    const idx = new Map([['u|c|raw_change', '2026-06-22T10:00:00Z']])  // 50h ago
    expect(isOnCooldown(idx, 'u', 'c', 'raw_change', 24, now)).toBe(false)
  })
  it('returns false when minHours is 0', () => {
    const idx = new Map([['u|c|raw_change', '2026-06-24T11:00:00Z']])
    expect(isOnCooldown(idx, 'u', 'c', 'raw_change', 0, now)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Per-card evaluation — covers each rule branch
// ─────────────────────────────────────────────────────────────────────

const baseCard = { cardSlug: '1450205', cardName: 'Charizard', setName: 'Base', source: 'watchlist' as const }
const basePrefs = ALERT_PREFERENCE_DEFAULTS

function rows(...entries: Array<[string, number | null, number | null]>): Array<{ card_slug: string; date: string; raw_usd: number | null; psa10_usd: number | null }> {
  return entries.map(([date, raw, psa10]) => ({
    card_slug: '1450205', date, raw_usd: raw, psa10_usd: psa10,
  }))
}

describe('evaluateCardForUser — rule firing', () => {
  it('fires raw_change for a >=10% raw move (and not psa10/spread when psa10 missing)', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 1200, null]),
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out).toHaveLength(1)
    expect(out[0].rule).toBe('raw_change')
    expect(out[0].severity).toBe('normal')
    expect(out[0].payload).toMatchObject({ old: 1000, new: 1200, pct: 20, source: 'watchlist' })
  })

  it('does not fire raw_change when the move is below the threshold', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 1050, null]),  // +5%
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out).toEqual([])
  })

  it('fires psa10_change for a >=10% PSA10 move', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, 8000], ['2026-06-22', 1000, 9500]),  // +18.75% PSA10
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out.map(e => e.rule)).toContain('psa10_change')
    const ev = out.find(e => e.rule === 'psa10_change')!
    expect(ev.payload).toMatchObject({ old: 8000, new: 9500, source: 'watchlist' })
  })

  it('promotes severity to high for a >=25% move', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 1500, null]),  // +50%
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out[0].severity).toBe('high')
  })

  it('falls back to price_move when raw_change is disabled but price_move is enabled', () => {
    const prefs = applyPatch(basePrefs, { ruleRawChangeEnabled: false })
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 1200, null]),
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out.map(e => e.rule)).toEqual(['price_move'])
    expect(out[0].payload).toMatchObject({ price_field: 'raw_usd', old: 1000, new: 1200 })
  })

  it('emits at most one event per (rule, card) — raw + psa10 fire independently', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, 8000], ['2026-06-22', 1200, 9500]),
      recentCount7d: 0, recentCount14d: 0,
    })
    const rules = out.map(e => e.rule).sort()
    expect(rules).toEqual(['psa10_change','raw_change'])
  })

  it('fires spread_change only when the rule is enabled', () => {
    const prefsOff = basePrefs   // spread_change disabled by default
    const offOut = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: prefsOff,
      priceRows:     rows(['2026-06-15', 1000, 5000], ['2026-06-22', 1000, 8000]),  // spread 5x → 8x = +60%
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(offOut.find(e => e.rule === 'spread_change')).toBeUndefined()

    const prefsOn = applyPatch(basePrefs, { ruleSpreadChangeEnabled: true, ruleSpreadChangePct: 15 })
    const onOut = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: prefsOn,
      priceRows:     rows(['2026-06-15', 1000, 5000], ['2026-06-22', 1000, 8000]),
      recentCount7d: 0, recentCount14d: 0,
    })
    const spread = onOut.find(e => e.rule === 'spread_change')
    expect(spread).toBeDefined()
    expect(spread!.payload).toMatchObject({ old_spread: 5, new_spread: 8 })
    expect(spread!.severity).toBe('high')   // +60% → high
  })

  it('fires recent_sales when there is >=1 active sale in the last 7d', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows: [],
      recentCount7d: 3, recentCount14d: 3,
    })
    const rs = out.find(e => e.rule === 'recent_sales')
    expect(rs).toBeDefined()
    expect(rs!.payload).toMatchObject({ recent_active_count: 3, window_days: 7, source: 'watchlist' })
  })

  it('fires market_activity at >=5 active sales in the last 14d', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows: [],
      recentCount7d: 0, recentCount14d: 6,
    })
    const ma = out.find(e => e.rule === 'market_activity')
    expect(ma).toBeDefined()
    expect(ma!.payload).toMatchObject({ active_count: 6, window_days: 14 })
  })

  it('does not fire market_activity below the 5-sale threshold', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs: basePrefs,
      priceRows: [],
      recentCount7d: 0, recentCount14d: 4,
    })
    expect(out.find(e => e.rule === 'market_activity')).toBeUndefined()
  })

  it('emits zero events when prefs.enabled is false', () => {
    const prefs = applyPatch(basePrefs, { enabled: false })
    const out = evaluateCardForUser({
      userId: 'u1', card: baseCard, prefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 2000, null]),
      recentCount7d: 10, recentCount14d: 10,
    })
    expect(out).toEqual([])
  })

  it('propagates source="both" into the payload', () => {
    const out = evaluateCardForUser({
      userId: 'u1', card: { ...baseCard, source: 'both' }, prefs: basePrefs,
      priceRows:     rows(['2026-06-15', 1000, null], ['2026-06-22', 1200, null]),
      recentCount7d: 0, recentCount14d: 0,
    })
    expect(out[0].payload).toMatchObject({ source: 'both' })
  })
})

// ─────────────────────────────────────────────────────────────────────
// End-to-end orchestrator via FakeDB
// ─────────────────────────────────────────────────────────────────────

const fakeDB = new FakeDB()
const asOf   = new Date('2026-06-24T12:00:00Z')

beforeEach(() => { fakeDB.reset() })

function seedPrefs(userId: string, patch: Partial<typeof ALERT_PREFERENCE_DEFAULTS> = {}) {
  const prefs = applyPatch(ALERT_PREFERENCE_DEFAULTS, patch)
  fakeDB.seed('user_alert_preferences', [
    ...fakeDB.rows('user_alert_preferences'),
    { user_id: userId, ...preferencesToRow(prefs) },
  ])
}

function seedWatch(userId: string, cardSlug: string, name = 'Charizard', set = 'Base') {
  fakeDB.seed('watchlist', [
    ...fakeDB.rows('watchlist'),
    { user_id: userId, card_slug: cardSlug, card_name: name, set_name: set },
  ])
}

function seedPortfolio(userId: string, cardSlug: string, portfolioId = 'p-' + userId) {
  if (!fakeDB.rows('portfolios').some(p => p.id === portfolioId)) {
    fakeDB.seed('portfolios', [...fakeDB.rows('portfolios'), { id: portfolioId, user_id: userId }])
  }
  fakeDB.seed('portfolio_items', [
    ...fakeDB.rows('portfolio_items'),
    { portfolio_id: portfolioId, card_slug: cardSlug },
  ])
}

function seedPriceTwoPoints(bareSlug: string, oldRaw: number, newRaw: number, oldPsa10: number | null = null, newPsa10: number | null = null) {
  fakeDB.seed('daily_prices', [
    ...fakeDB.rows('daily_prices'),
    { card_slug: 'pc-' + bareSlug, date: '2026-06-15', raw_usd: oldRaw, psa10_usd: oldPsa10 },
    { card_slug: 'pc-' + bareSlug, date: '2026-06-22', raw_usd: newRaw, psa10_usd: newPsa10 },
  ])
}

describe('evaluateAlerts — orchestrator', () => {
  it('returns an empty result when no prefs exist', async () => {
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.usersConsidered).toBe(0)
    expect(r.proposedEvents).toEqual([])
    expect(r.triggersInserted).toBe(0)
  })

  it('returns no events for a user whose prefs are disabled', async () => {
    seedPrefs('u1', { enabled: false })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.usersConsidered).toBe(0)  // .eq('enabled', true) filters it out
    expect(r.proposedEvents).toEqual([])
  })

  it('skips watchlist cards when scope_watchlist=false', async () => {
    seedPrefs('u1', { scopeWatchlist: false, scopePortfolio: true })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.cardsConsidered).toBe(0)
  })

  it('skips portfolio cards when scope_portfolio=false', async () => {
    seedPrefs('u1', { scopeWatchlist: true, scopePortfolio: false })
    seedPortfolio('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.cardsConsidered).toBe(0)
  })

  it('reports source="both" when a card is on watchlist AND portfolio', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedPortfolio('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.cardsConsidered).toBe(1)        // dedup
    expect(r.proposedEvents).toHaveLength(1)
    expect(r.proposedEvents[0].source).toBe('both')
    expect(r.proposedEvents[0].payload).toMatchObject({ source: 'both' })
  })

  it('dryRun=true returns proposals but writes NOTHING into alert_events', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.triggersInserted).toBe(0)
    expect(r.proposedEvents).toHaveLength(1)
    expect(fakeDB.rows('alert_events')).toEqual([])
  })

  it('dryRun=false inserts the proposed events into alert_events', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: false })
    expect(r.dryRun).toBe(false)
    expect(r.triggersInserted).toBe(1)
    const inserted = fakeDB.rows('alert_events')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      user_id:   'u1',
      card_slug: '1450205',
      rule:      'raw_change',
      severity:  'normal',
    })
    expect(inserted[0].detected_at).toBe(asOf.toISOString())
  })

  it('suppresses triggers that fall within the per-user cooldown', async () => {
    seedPrefs('u1', { minHoursBetweenAlerts: 24 })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    // A prior event for the same (user, card, rule) 2h before asOf.
    fakeDB.seed('alert_events', [{
      user_id: 'u1', card_slug: '1450205', rule: 'raw_change',
      detected_at: new Date(asOf.getTime() - 2 * 3_600_000).toISOString(),
    }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.triggersSuppressedByCooldown).toBe(1)
    expect(r.proposedEvents).toEqual([])
  })

  it('allows the trigger once the cooldown has passed', async () => {
    seedPrefs('u1', { minHoursBetweenAlerts: 24 })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    fakeDB.seed('alert_events', [{
      user_id: 'u1', card_slug: '1450205', rule: 'raw_change',
      detected_at: new Date(asOf.getTime() - 30 * 3_600_000).toISOString(),  // 30h ago
    }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.triggersSuppressedByCooldown).toBe(0)
    expect(r.proposedEvents).toHaveLength(1)
  })

  it('honours scope toggles independently per user', async () => {
    seedPrefs('u1', { scopeWatchlist: true,  scopePortfolio: false })
    seedPrefs('u2', { scopeWatchlist: false, scopePortfolio: true  })
    seedWatch('u1',     '1450205')
    seedPortfolio('u2', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.usersConsidered).toBe(2)
    expect(r.cardsConsidered).toBe(2)
    const u1ev = r.proposedEvents.find(e => e.userId === 'u1')
    const u2ev = r.proposedEvents.find(e => e.userId === 'u2')
    expect(u1ev!.source).toBe('watchlist')
    expect(u2ev!.source).toBe('portfolio')
  })

  it('detects recent_sales when active sales are present in the last 7d', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    // No price history → only recent_sales rule can fire (and market_activity if >=5).
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '1450205', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
      { internal_card_slug: '1450205', sale_date: '2026-06-20', parse_status: 'ok', review_status: 'active' },
      // Stale: outside the 7d window
      { internal_card_slug: '1450205', sale_date: '2026-05-01', parse_status: 'ok', review_status: 'active' },
      // Excluded by status
      { internal_card_slug: '1450205', sale_date: '2026-06-23', parse_status: 'quarantined', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const rs = r.proposedEvents.find(e => e.rule === 'recent_sales')
    expect(rs).toBeDefined()
    expect(rs!.payload).toMatchObject({ recent_active_count: 2, window_days: 7 })
  })

  it('does not insert events for users with insufficient price history', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    // Only one price row — no baseline available.
    fakeDB.seed('daily_prices', [{ card_slug: 'pc-1450205', date: '2026-06-22', raw_usd: 1000, psa10_usd: 5000 }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents.find(e => e.rule === 'raw_change')).toBeUndefined()
  })

  it('never includes emails / user_id strings beyond the structured userId field', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205', 'Charizard', 'Base Set')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    const blob = JSON.stringify(r.proposedEvents.map(e => e.payload))
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(blob).not.toMatch(/u1/)              // userId never appears IN the payload
    expect(blob).not.toMatch(/"email"/i)
    expect(blob).not.toMatch(/"user_id"/i)
  })

  it('respects the limitUsers cap', async () => {
    for (let i = 0; i < 5; i++) {
      seedPrefs(`u${i}`)
      seedWatch(`u${i}`, '1450205')
    }
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, limitUsers: 2 })
    expect(r.usersConsidered).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Type-system smoke — surfaces the exported shape so a future block
// can't silently drop a field without breaking this file.
// ─────────────────────────────────────────────────────────────────────

describe('ProposedAlertEvent shape', () => {
  it('keeps the structured fields that the email block will need', () => {
    const sample: ProposedAlertEvent = {
      userId: 'u', cardSlug: 'c', cardName: 'n', setName: 's',
      rule: 'raw_change', severity: 'normal', source: 'watchlist', payload: { x: 1 },
    }
    expect(sample).toBeDefined()
  })
})
