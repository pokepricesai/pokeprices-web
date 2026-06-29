// Block 5A-W-2 — alert evaluator tests.
//
// Covers pure helpers + the end-to-end orchestrator via FakeDB:
//   * disabled / scope / cooldown gates
//   * each rule fires with the right payload + severity
//   * dryRun=true returns proposals but writes nothing
//   * dryRun=false inserts into alert_events
//   * "card on both lists" deduplicates and reports source='both'
//   * payload never contains user identifiers / emails

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// Block 5A-W-27 — instant alerts now require pro entitlement. The
// existing evaluator tests use `u1`, `u2`, etc. as test user ids and
// expect events to be generated. Pre-populate `ACCOUNT_PRO_USER_IDS`
// so the entitlement check passes for all the test user ids the
// fixtures use. A handful of new tests at the bottom of the file
// explicitly override this env to exercise the FREE path.
const TEST_PRO_USER_IDS = [
  'u1','u2','u3','u4','u5','u6','u7','u8','u9','u10',
  'user-A-uuid','user-B-uuid',
].join(',')
let envSnap: string | undefined
beforeEach(() => {
  fakeDB.reset()
  envSnap = process.env.ACCOUNT_PRO_USER_IDS
  process.env.ACCOUNT_PRO_USER_IDS = TEST_PRO_USER_IDS
})
afterEach(() => {
  if (envSnap === undefined) delete process.env.ACCOUNT_PRO_USER_IDS
  else process.env.ACCOUNT_PRO_USER_IDS = envSnap
})

function seedPrefs(userId: string, patch: Partial<typeof ALERT_PREFERENCE_DEFAULTS> = {}) {
  const prefs = applyPatch(ALERT_PREFERENCE_DEFAULTS, patch)
  fakeDB.seed('user_alert_preferences', [
    ...fakeDB.rows('user_alert_preferences'),
    { user_id: userId, ...preferencesToRow(prefs) },
  ])
}

// Block 5A-W-9 — the evaluator resolves watchlist/portfolio URL slugs
// to the bare-numeric cards.card_slug via the `cards` table before
// any market-data lookup. The existing tests pass the same string
// for both (e.g. '1450205' as URL slug AND bare numeric), so the
// helpers auto-seed a self-mapping cards row to keep them passing.
// Tests that exercise a DIFFERENT URL / bare pair seed the cards row
// explicitly via seedCardLink().
function seedCardLink(urlSlug: string, bareSlug: string = urlSlug) {
  const existing = fakeDB.rows('cards').filter(c => c.card_url_slug !== urlSlug)
  fakeDB.seed('cards', [
    ...existing,
    { card_url_slug: urlSlug, card_slug: bareSlug },
  ])
}

function seedWatch(userId: string, urlSlug: string, name = 'Charizard', set = 'Base') {
  seedCardLink(urlSlug)
  fakeDB.seed('watchlist', [
    ...fakeDB.rows('watchlist'),
    { user_id: userId, card_slug: urlSlug, card_name: name, set_name: set },
  ])
}

function seedPortfolio(userId: string, urlSlug: string, portfolioId = 'p-' + userId) {
  seedCardLink(urlSlug)
  if (!fakeDB.rows('portfolios').some(p => p.id === portfolioId)) {
    fakeDB.seed('portfolios', [...fakeDB.rows('portfolios'), { id: portfolioId, user_id: userId }])
  }
  fakeDB.seed('portfolio_items', [
    ...fakeDB.rows('portfolio_items'),
    { portfolio_id: portfolioId, card_slug: urlSlug },
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
// Display field resolution + admin response scrub (Block 5A-W-10)
// portfolio_items rows carry no card_name / set_name; the evaluator
// must backfill them from the cards table. The admin API response
// must NOT include the real user_id but should expose an opaque
// per-batch userIndex so the operator can see grouping.
// ─────────────────────────────────────────────────────────────────────

import { toPublicEvaluationResult } from '../evaluator'

describe('evaluateAlerts — display field resolution', () => {
  it('backfills cardName + setName from the cards table for a portfolio event', async () => {
    seedPrefs('u1')
    // cards row provides the display fields; portfolio_items row has none.
    fakeDB.seed('cards', [{
      card_url_slug: 'mystery-card-99',
      card_slug:     '889291',
      card_name:     'Mystery Card #99',
      set_name:      'Some Set',
    }])
    fakeDB.seed('portfolios',      [{ id: 'p-u1', user_id: 'u1' }])
    fakeDB.seed('portfolio_items', [{ portfolio_id: 'p-u1', card_slug: 'mystery-card-99' }])
    // Recent sales so a trigger fires
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '889291', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.proposedEvents).toHaveLength(1)
    expect(r.proposedEvents[0]).toMatchObject({
      cardSlug: '889291',
      cardName: 'Mystery Card #99',
      setName:  'Some Set',
      rule:     'recent_sales',
    })
  })

  it('keeps watchlist-provided display fields when the cards row also has them (watchlist wins)', async () => {
    seedPrefs('u1')
    fakeDB.seed('cards', [{
      card_url_slug: 'charizard-4',
      card_slug:     '630417',
      card_name:     'Charizard #4 (cards table)',
      set_name:      'Base (cards table)',
    }])
    fakeDB.seed('watchlist', [{
      user_id:   'u1',
      card_slug: 'charizard-4',
      card_name: 'My Charizard (watchlist)',
      set_name:  'My Base Set (watchlist)',
    }])
    seedPriceTwoPoints('630417', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.proposedEvents[0]).toMatchObject({
      cardName: 'My Charizard (watchlist)',
      setName:  'My Base Set (watchlist)',
    })
  })

  it('fills only the missing field when watchlist has one but not the other', async () => {
    seedPrefs('u1')
    fakeDB.seed('cards', [{
      card_url_slug: 'partial-1',
      card_slug:     '1111',
      card_name:     'CardsCardName',
      set_name:      'CardsSetName',
    }])
    fakeDB.seed('watchlist', [{
      user_id:   'u1',
      card_slug: 'partial-1',
      card_name: 'WatchlistName',
      set_name:  null,   // missing — should fall back to cards
    }])
    seedPriceTwoPoints('1111', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.proposedEvents[0]).toMatchObject({
      cardName: 'WatchlistName',       // watchlist value preserved
      setName:  'CardsSetName',        // backfilled from cards
    })
  })

  it('increments cardsWithMissingDisplayFields when no source provides cardName / setName', async () => {
    seedPrefs('u1')
    // cards row exists (so slug resolves) but display fields are null.
    fakeDB.seed('cards', [{
      card_url_slug: 'unnamed-card',
      card_slug:     '7777',
      card_name:     null,
      set_name:      null,
    }])
    fakeDB.seed('portfolios',      [{ id: 'p-u1', user_id: 'u1' }])
    fakeDB.seed('portfolio_items', [{ portfolio_id: 'p-u1', card_slug: 'unnamed-card' }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithMissingDisplayFields).toBe(1)
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(0)  // resolved but unnamed
  })

  it('cardsWithMissingDisplayFields does not double-count cards already in cardsWithNoSlugResolution', async () => {
    seedPrefs('u1')
    // No cards row → unresolved.
    fakeDB.seed('watchlist', [{ user_id: 'u1', card_slug: 'totally-unknown', card_name: null, set_name: null }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(1)
    expect(r.diagnostics.cardsWithMissingDisplayFields).toBe(0)
  })
})

describe('toPublicEvaluationResult', () => {
  const internal: import('../evaluator').EvaluationResult = {
    dryRun: true,
    asOf:   '2026-06-24T12:00:00Z',
    usersConsidered: 2, cardsConsidered: 3,
    triggersFound: 3, triggersSuppressedByCooldown: 0, triggersInserted: 0,
    proposedEvents: [
      { userId: 'user-A-uuid', cardSlug: '1', cardName: 'A', setName: 'X', rule: 'raw_change',   severity: 'normal', source: 'watchlist', payload: {} },
      { userId: 'user-A-uuid', cardSlug: '2', cardName: 'B', setName: 'X', rule: 'recent_sales', severity: 'normal', source: 'watchlist', payload: {} },
      { userId: 'user-B-uuid', cardSlug: '3', cardName: 'C', setName: 'Y', rule: 'raw_change',   severity: 'high',   source: 'portfolio', payload: {} },
    ],
    diagnostics: {
      usersWithDisabledPrefs: 0, usersWithNoCards: 0, cardsWithNoSlugResolution: 0,
      cardsWithMissingDisplayFields: 0, cardsWithInsufficientPriceHistory: 0,
      cardsWithNoRecentSales: 0,
      triggersByRule: { price_move: 0, recent_sales: 1, psa10_change: 0, raw_change: 2, spread_change: 0, market_activity: 0 },
      usersBlockedByEntitlement: 0,
    },
  }

  it('strips userId from every proposedEvent', () => {
    const pub = toPublicEvaluationResult(internal)
    for (const e of pub.proposedEvents) {
      expect(Object.prototype.hasOwnProperty.call(e, 'userId')).toBe(false)
    }
    const blob = JSON.stringify(pub)
    expect(blob).not.toMatch(/user-[AB]-uuid/)
    expect(blob).not.toMatch(/"userId"/i)
  })

  it('assigns a stable per-batch userIndex (events from the same user share an index)', () => {
    const pub = toPublicEvaluationResult(internal)
    expect(pub.proposedEvents[0].userIndex).toBe(1)
    expect(pub.proposedEvents[1].userIndex).toBe(1)   // same user as #0
    expect(pub.proposedEvents[2].userIndex).toBe(2)   // different user
  })

  it('passes the rest of the result through unchanged', () => {
    const pub = toPublicEvaluationResult(internal)
    expect(pub.dryRun).toBe(internal.dryRun)
    expect(pub.usersConsidered).toBe(internal.usersConsidered)
    expect(pub.triggersFound).toBe(internal.triggersFound)
    expect(pub.diagnostics).toEqual(internal.diagnostics)
  })

  it('returns an empty proposedEvents array unchanged (no userIndex churn)', () => {
    const pub = toPublicEvaluationResult({ ...internal, proposedEvents: [] })
    expect(pub.proposedEvents).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// Slug-format resolution (Block 5A-W-9)
// watchlist + portfolio_items store URL slugs; market-data tables
// are keyed by bare numeric cards.card_slug. The evaluator must
// resolve URL → bare via the `cards` table before any lookup.
// ─────────────────────────────────────────────────────────────────────

describe('evaluateAlerts — URL slug → bare numeric resolution', () => {
  it('resolves a watchlist URL slug to the bare numeric and finds daily_prices', async () => {
    seedPrefs('u1')
    // Different strings on purpose: URL slug 'charizard-4', bare numeric '630417'.
    seedCardLink('charizard-4', '630417')
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'charizard-4', card_name: 'Charizard', set_name: 'Base' },
    ])
    seedPriceTwoPoints('630417', 1000, 1200)   // pc-630417 in daily_prices
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.cardsConsidered).toBe(1)
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(0)
    expect(r.diagnostics.cardsWithInsufficientPriceHistory).toBe(0)
    expect(r.triggersFound).toBeGreaterThan(0)
    // ProposedAlertEvent.cardSlug should be the BARE NUMERIC so
    // alert_events.card_slug aligns with cards.card_slug (the digest
    // URL builder downstream queries by bare numeric).
    expect(r.proposedEvents[0].cardSlug).toBe('630417')
  })

  it('resolves a portfolio URL slug to the bare numeric and finds recent_sales', async () => {
    seedPrefs('u1')
    seedCardLink('haunter-incomplete-holo-error-6', '9536051')
    if (!fakeDB.rows('portfolios').some(p => p.id === 'p-u1')) {
      fakeDB.seed('portfolios', [{ id: 'p-u1', user_id: 'u1' }])
    }
    fakeDB.seed('portfolio_items', [
      { portfolio_id: 'p-u1', card_slug: 'haunter-incomplete-holo-error-6' },
    ])
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '9536051', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
      { internal_card_slug: '9536051', sale_date: '2026-06-23', parse_status: 'ok', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    const ev = r.proposedEvents.find(e => e.rule === 'recent_sales')
    expect(ev).toBeDefined()
    expect(ev!.cardSlug).toBe('9536051')
    expect(ev!.payload).toMatchObject({ recent_active_count: 2 })
  })

  it('does NOT query daily_prices with `pc-{urlSlug}` (no spurious match against a URL-slug-keyed row)', async () => {
    seedPrefs('u1')
    seedCardLink('charizard-4', '630417')
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'charizard-4', card_name: 'Charizard', set_name: 'Base' },
    ])
    // Decoy: a daily_prices row keyed with `pc-charizard-4` MUST NOT
    // be picked up. The fix should query `pc-630417` only.
    fakeDB.seed('daily_prices', [
      { card_slug: 'pc-charizard-4', date: '2026-06-15', raw_usd: 9999, psa10_usd: null },
      { card_slug: 'pc-charizard-4', date: '2026-06-22', raw_usd: 9999, psa10_usd: null },
      { card_slug: 'pc-630417',      date: '2026-06-15', raw_usd: 1000, psa10_usd: null },
      { card_slug: 'pc-630417',      date: '2026-06-22', raw_usd: 1200, psa10_usd: null },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.proposedEvents).toHaveLength(1)
    // The real (1000 → 1200, +20%) — not the decoy stays-at-9999.
    expect(r.proposedEvents[0].payload).toMatchObject({ old: 1000, new: 1200 })
  })

  it('does NOT query recent_sales using the URL slug (decoy rows under the URL key are ignored)', async () => {
    seedPrefs('u1')
    seedCardLink('charizard-4', '630417')
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'charizard-4', card_name: 'Charizard', set_name: 'Base' },
    ])
    // Decoy under the URL slug; only the bare-numeric row should be counted.
    fakeDB.seed('recent_sales', [
      { internal_card_slug: 'charizard-4', sale_date: '2026-06-23', parse_status: 'ok', review_status: 'active' },
      { internal_card_slug: '630417',      sale_date: '2026-06-23', parse_status: 'ok', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    const ev = r.proposedEvents.find(e => e.rule === 'recent_sales')
    expect(ev).toBeDefined()
    // Count is 1 (the bare-numeric row), not 2 (would include the decoy).
    expect(ev!.payload).toMatchObject({ recent_active_count: 1 })
  })

  it('increments cardsWithNoSlugResolution and skips market eval for unresolved URL slugs', async () => {
    seedPrefs('u1')
    // No cards row → no URL→bare mapping.
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'no-such-card-99', card_name: 'Mystery', set_name: 'Unknown' },
    ])
    // Even if daily_prices rows exist under any guess of the bare id,
    // the absence of a cards mapping should mean the evaluator never
    // looks them up.
    fakeDB.seed('daily_prices', [
      { card_slug: 'pc-no-such-card-99', date: '2026-06-15', raw_usd: 1000, psa10_usd: null },
      { card_slug: 'pc-no-such-card-99', date: '2026-06-22', raw_usd: 2000, psa10_usd: null },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.cardsConsidered).toBe(1)
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(1)
    expect(r.proposedEvents).toHaveLength(0)
  })

  it('counts unique URL slugs in cardsWithNoSlugResolution (card-level, not per-user-tuple)', async () => {
    seedPrefs('u1')
    seedPrefs('u2')
    // Three users would watch the same unresolved card; expect 1.
    seedPrefs('u3')
    for (const uid of ['u1','u2','u3']) {
      fakeDB.seed('watchlist', [
        ...fakeDB.rows('watchlist'),
        { user_id: uid, card_slug: 'unresolvable-card', card_name: null, set_name: null },
      ])
    }
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(1)
  })

  it('an unresolved card does not count toward cardsWithInsufficientPriceHistory or cardsWithNoRecentSales (avoids double-attribution)', async () => {
    seedPrefs('u1')
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'unresolvable', card_name: null, set_name: null },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(1)
    expect(r.diagnostics.cardsWithInsufficientPriceHistory).toBe(0)
    expect(r.diagnostics.cardsWithNoRecentSales).toBe(0)
  })

  it('a card on both watchlist + portfolio with different URL/bare values still produces ONE evaluated card per user', async () => {
    seedPrefs('u1')
    seedCardLink('charizard-4', '630417')
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'charizard-4', card_name: 'Charizard', set_name: 'Base' },
    ])
    fakeDB.seed('portfolios',       [{ id: 'p-u1', user_id: 'u1' }])
    fakeDB.seed('portfolio_items',  [{ portfolio_id: 'p-u1', card_slug: 'charizard-4' }])
    seedPriceTwoPoints('630417', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: true })
    expect(r.cardsConsidered).toBe(1)
    expect(r.proposedEvents[0].cardSlug).toBe('630417')
    expect(r.proposedEvents[0].payload).toMatchObject({ source: 'both' })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Diagnostics (Block 5A-W-7)
// ─────────────────────────────────────────────────────────────────────

describe('evaluateAlerts — diagnostics', () => {
  it('includes a diagnostics object on every result', async () => {
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics).toBeDefined()
    expect(r.diagnostics.usersWithDisabledPrefs).toBe(0)
    expect(r.diagnostics.usersWithNoCards).toBe(0)
    expect(r.diagnostics.cardsWithNoSlugResolution).toBe(0)
    expect(r.diagnostics.cardsWithMissingDisplayFields).toBe(0)
    expect(r.diagnostics.cardsWithInsufficientPriceHistory).toBe(0)
    expect(r.diagnostics.cardsWithNoRecentSales).toBe(0)
    expect(r.diagnostics.triggersByRule).toEqual({
      price_move: 0, recent_sales: 0, psa10_change: 0,
      raw_change: 0, spread_change: 0, market_activity: 0,
    })
  })

  it('counts users with disabled prefs as a global signal (does NOT inflate usersConsidered)', async () => {
    seedPrefs('u1', { enabled: true  })
    seedPrefs('u2', { enabled: false })
    seedPrefs('u3', { enabled: false })
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.usersConsidered).toBe(1)                  // only enabled
    expect(r.diagnostics.usersWithDisabledPrefs).toBe(2)
  })

  it('counts enabled users who happen to have zero cards on either list', async () => {
    seedPrefs('u1')                       // no watchlist + no portfolio
    seedPrefs('u2'); seedWatch('u2', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.usersConsidered).toBe(2)
    expect(r.diagnostics.usersWithNoCards).toBe(1)
  })

  it('counts unique cards with insufficient price history (cards-not-rows)', async () => {
    seedPrefs('u1')
    seedPrefs('u2')
    seedWatch('u1', '1450205')                          // 2 price points, 7d apart → enough
    seedWatch('u2', '9536051')                          // only 1 price point → not enough
    seedPriceTwoPoints('1450205', 1000, 1200)
    fakeDB.seed('daily_prices', [
      ...fakeDB.rows('daily_prices'),
      { card_slug: 'pc-9536051', date: '2026-06-22', raw_usd: 500, psa10_usd: 2000 },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithInsufficientPriceHistory).toBe(1)
  })

  it('counts unique cards with zero active recent_sales in the 14d window', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedWatch('u1', '9536051')
    seedPriceTwoPoints('1450205', 1000, 1200)
    seedPriceTwoPoints('9536051', 500,  600)
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '1450205', sale_date: '2026-06-23', parse_status: 'ok', review_status: 'active' },
      // 9536051 has nothing
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.diagnostics.cardsWithNoRecentSales).toBe(1)   // only 9536051
  })

  it('buckets triggersByRule with the same total as triggersFound', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    // Big move triggers both raw_change and psa10_change.
    seedPriceTwoPoints('1450205', 1000, 1500, 8000, 9500)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const total = Object.values(r.diagnostics.triggersByRule).reduce((a, b) => a + b, 0)
    expect(total).toBe(r.triggersFound)
    expect(r.diagnostics.triggersByRule.raw_change).toBeGreaterThanOrEqual(1)
    expect(r.diagnostics.triggersByRule.psa10_change).toBeGreaterThanOrEqual(1)
  })

  it('does not expose user_id / email in the diagnostics object', async () => {
    seedPrefs('should-not-leak', { enabled: false })
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const blob = JSON.stringify(r.diagnostics)
    expect(blob).not.toMatch(/should-not-leak/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"email"/i)
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

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-19 — per-card watchlist alert overrides, end-to-end via
// FakeDB. Exercises the loader, the resolver, and the asymmetric
// threshold path through evaluateAlerts.
// ─────────────────────────────────────────────────────────────────────

function seedOverride(
  userId:   string,
  cardSlug: string,
  patch: Partial<{
    enabled:                  boolean
    use_global_defaults:      boolean
    rise_pct:                 number | null
    drop_pct:                 number | null
    recent_sales_enabled:     boolean
    market_activity_enabled:  boolean
  }> = {},
) {
  fakeDB.seed('watchlist_alert_overrides', [
    ...fakeDB.rows('watchlist_alert_overrides'),
    {
      id:                      `over-${userId}-${cardSlug}`,
      user_id:                 userId,
      card_slug:               cardSlug,
      enabled:                 true,
      use_global_defaults:     false,
      rise_pct:                null,
      drop_pct:                null,
      recent_sales_enabled:    true,
      market_activity_enabled: true,
      ...patch,
    },
  ])
}

describe('evaluateAlerts — Block 5A-W-19 per-card overrides', () => {
  // The pre-19 behaviour is preserved end-to-end when no override row
  // exists. We rely on the 60+ existing tests above to assert that;
  // this block focuses on the new branches.

  it('global defaults still apply when no override row exists', async () => {
    seedPrefs('u1', { rulePriceMovePct: 10, ruleRawChangePct: 10 })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)   // +20%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const ev = r.proposedEvents.find(e => e.rule === 'raw_change')
    expect(ev).toBeDefined()
    expect(ev!.payload).toMatchObject({ threshold_source: 'global', threshold_pct: 10, direction: 'rise' })
  })

  it('use_global_defaults=true behaves identically to no row', async () => {
    seedPrefs('u1', { rulePriceMovePct: 10, ruleRawChangePct: 10 })
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: true, rise_pct: 50, drop_pct: 50 })  // wide custom thresholds — IGNORED
    seedPriceTwoPoints('1450205', 1000, 1200)   // +20%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const ev = r.proposedEvents.find(e => e.rule === 'raw_change')
    expect(ev).toBeDefined()
    expect(ev!.payload).toMatchObject({ threshold_source: 'global', threshold_pct: 10 })
  })

  it('custom rise threshold suppresses a +5% move when the user set rise=20%', async () => {
    seedPrefs('u1', { rulePriceMovePct: 4, ruleRawChangePct: 4 })   // would fire at globals
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 20, drop_pct: 10 })
    seedPriceTwoPoints('1450205', 1000, 1050)   // +5% only
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents.find(e => e.rule === 'raw_change' || e.rule === 'price_move')).toBeUndefined()
  })

  it('custom rise threshold FIRES a +21% move when the user set rise=20% (payload tags it as override)', async () => {
    seedPrefs('u1', { rulePriceMovePct: 30, ruleRawChangePct: 30 })   // would NOT fire at globals
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 20, drop_pct: 10 })
    seedPriceTwoPoints('1450205', 1000, 1210)   // +21%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const ev = r.proposedEvents.find(e => e.rule === 'raw_change')
    expect(ev).toBeDefined()
    expect(ev!.payload).toMatchObject({
      threshold_source: 'override',
      threshold_pct:    20,
      direction:        'rise',
    })
  })

  it('custom drop threshold suppresses a -5% move when the user set drop=20%', async () => {
    seedPrefs('u1', { rulePriceMovePct: 4, ruleRawChangePct: 4 })
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 50, drop_pct: 20 })
    seedPriceTwoPoints('1450205', 1000, 950)   // -5%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents.find(e => e.rule === 'raw_change' || e.rule === 'price_move')).toBeUndefined()
  })

  it('custom drop threshold FIRES a -12% move when the user set drop=10%', async () => {
    seedPrefs('u1', { rulePriceMovePct: 30, ruleRawChangePct: 30 })
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 50, drop_pct: 10 })
    seedPriceTwoPoints('1450205', 1000, 880)   // -12%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const ev = r.proposedEvents.find(e => e.rule === 'raw_change')
    expect(ev).toBeDefined()
    expect(ev!.payload).toMatchObject({
      threshold_source: 'override',
      threshold_pct:    10,
      direction:        'drop',
    })
  })

  it('enabled=false silences ALL rules for the card even when global toggles are on', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { enabled: false })
    seedPriceTwoPoints('1450205', 1000, 2000)   // +100%, would always fire
    // Recent sales too — should ALSO be suppressed.
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '1450205', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
      { internal_card_slug: '1450205', sale_date: '2026-06-21', parse_status: 'ok', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents.filter(e => e.cardSlug === '1450205')).toEqual([])
  })

  it('portfolio alerts unaffected when an override exists (source gate)', async () => {
    seedPrefs('u1', { rulePriceMovePct: 4, ruleRawChangePct: 4 })
    seedPortfolio('u1', '1450205')
    // Override would silence a watchlist card, but this card is
    // PORTFOLIO only — the override must be ignored.
    seedOverride('u1', '1450205', { enabled: false })
    seedPriceTwoPoints('1450205', 1000, 1100)   // +10%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const ev = r.proposedEvents.find(e => e.rule === 'raw_change')
    expect(ev).toBeDefined()
    expect(ev!.source).toBe('portfolio')
    expect(ev!.payload).toMatchObject({ threshold_source: 'global', source: 'portfolio' })
  })

  it('cooldown still suppresses an override-triggered alert', async () => {
    seedPrefs('u1', { minHoursBetweenAlerts: 24, rulePriceMovePct: 30, ruleRawChangePct: 30 })
    seedWatch('u1', '1450205')
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 10, drop_pct: 10 })
    seedPriceTwoPoints('1450205', 1000, 1200)   // +20% — clears override gate
    fakeDB.seed('alert_events', [{
      user_id: 'u1', card_slug: '1450205', rule: 'raw_change',
      detected_at: new Date(asOf.getTime() - 2 * 3_600_000).toISOString(),
    }])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.triggersSuppressedByCooldown).toBe(1)
    expect(r.proposedEvents).toEqual([])
  })

  it('override recent_sales_enabled=false suppresses the recent_sales rule for that card only', async () => {
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedWatch('u1', '9999999', 'Mew', 'Promo')   // second card without override
    seedOverride('u1', '1450205', { use_global_defaults: false, rise_pct: 50, drop_pct: 50, recent_sales_enabled: false })
    fakeDB.seed('recent_sales', [
      { internal_card_slug: '1450205', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
      { internal_card_slug: '9999999', sale_date: '2026-06-22', parse_status: 'ok', review_status: 'active' },
    ])
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const overridden = r.proposedEvents.find(e => e.cardSlug === '1450205' && e.rule === 'recent_sales')
    const otherCard  = r.proposedEvents.find(e => e.cardSlug === '9999999' && e.rule === 'recent_sales')
    expect(overridden).toBeUndefined()
    expect(otherCard).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-27 — instant alert entitlement enforcement
//
// Default `beforeEach` above sets ACCOUNT_PRO_USER_IDS to include
// the common test user ids. These tests deliberately scope the env
// per-test to put specific users on the free path.
// ─────────────────────────────────────────────────────────────────────

describe('evaluateAlerts — Block 5A-W-27 entitlement gating', () => {
  it('free user with instantAlertsEnabled=true is NOT evaluated; no events proposed', async () => {
    // Override the per-test default: 'u1' is NOT pro.
    process.env.ACCOUNT_PRO_USER_IDS = ''
    seedPrefs('u1', { instantAlertsEnabled: true })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)  // +100% — would normally trigger
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents).toEqual([])
    expect(r.triggersInserted).toBe(0)
    expect(r.diagnostics.usersBlockedByEntitlement).toBe(1)
  })

  it('legacy free user with instantAlertsEnabled=true does NOT get new events inserted on dryRun=false', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = ''
    seedPrefs('u1', { instantAlertsEnabled: true })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: false })
    expect(r.triggersInserted).toBe(0)
    expect(fakeDB.rows('alert_events')).toEqual([])
  })

  it('pro user (in ACCOUNT_PRO_USER_IDS) IS evaluated and events are proposed', async () => {
    // Only 'u1' is pro in this test.
    process.env.ACCOUNT_PRO_USER_IDS = 'u1'
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)  // +20%
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    expect(r.proposedEvents.length).toBeGreaterThan(0)
    expect(r.diagnostics.usersBlockedByEntitlement).toBe(0)
  })

  it('mixed batch: pro user gets events, free user is skipped with counter', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = 'u1'
    seedPrefs('u1')
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 1200)
    seedPrefs('u2')
    seedWatch('u2', '1450205')   // same card, same data
    const r = await evaluateAlerts(asSupa(fakeDB), { asOf })
    const u1Events = r.proposedEvents.filter(e => e.userId === 'u1')
    const u2Events = r.proposedEvents.filter(e => e.userId === 'u2')
    expect(u1Events.length).toBeGreaterThan(0)
    expect(u2Events).toEqual([])
    expect(r.diagnostics.usersBlockedByEntitlement).toBe(1)
  })

  it('user_alert_preferences row is NOT mutated when entitlement blocks the user', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = ''
    seedPrefs('u1', { instantAlertsEnabled: true, enabled: true })
    seedWatch('u1', '1450205')
    seedPriceTwoPoints('1450205', 1000, 2000)
    const before = JSON.stringify(fakeDB.rows('user_alert_preferences'))
    await evaluateAlerts(asSupa(fakeDB), { asOf, dryRun: false })
    expect(JSON.stringify(fakeDB.rows('user_alert_preferences'))).toBe(before)
  })
})
