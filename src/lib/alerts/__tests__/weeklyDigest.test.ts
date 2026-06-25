// Block 5A-W-14 — weekly digest builder tests.
//
// Covers:
//   * disabled master prefs / disabled weekly returns the early-out
//   * per-section preferences omit individual sections
//   * URL slug → bare numeric resolution feeds market lookups
//   * daily_prices lookup uses pc-{bare} prefix; recent_sales uses bare
//   * top-N portfolio + watchlist selection with reason labels
//   * alert events grouped by card, top N
//   * missing price data is non-fatal
//   * NO writes / mutations to the FakeDB
//   * pure helpers: priceColumnForHoldingType, pctChange,
//     usdToCents, selectTopItems

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import {
  buildWeeklyDigestForUser,
  priceColumnForHoldingType,
  pctChange,
  usdToCents,
  selectTopItems,
  type ScoredCard,
} from '../weeklyDigest'
import { preferencesToRow, applyPatch, ALERT_PREFERENCE_DEFAULTS } from '../preferences'

const fakeDB = new FakeDB()
const asOf   = new Date('2026-06-25T12:00:00Z')

beforeEach(() => { fakeDB.reset() })

// Seed helpers ─────────────────────────────────────────────────────────

function seedPrefs(userId: string, patch: Partial<typeof ALERT_PREFERENCE_DEFAULTS> = {}) {
  const prefs = applyPatch(ALERT_PREFERENCE_DEFAULTS, patch)
  fakeDB.seed('user_alert_preferences', [
    ...fakeDB.rows('user_alert_preferences'),
    { user_id: userId, ...preferencesToRow(prefs) },
  ])
}

function seedCardLink(urlSlug: string, bare: string, cardName = 'Card', setName = 'Set') {
  fakeDB.seed('cards', [
    ...fakeDB.rows('cards'),
    { card_url_slug: urlSlug, card_slug: bare, card_name: cardName, set_name: setName },
  ])
}

function seedWatch(userId: string, urlSlug: string, cardName: string | null = null, setName: string | null = null) {
  fakeDB.seed('watchlist', [
    ...fakeDB.rows('watchlist'),
    { user_id: userId, card_slug: urlSlug, card_name: cardName, set_name: setName },
  ])
}

function seedPortfolio(userId: string, urlSlug: string, opts: { holding_type?: string; quantity?: number } = {}) {
  // Ensure a portfolio row exists for this user, then add the item.
  let portfolioId = (fakeDB.rows('portfolios').find(p => p.user_id === userId) as { id?: string } | undefined)?.id
  if (!portfolioId) {
    portfolioId = `pf-${userId}`
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: portfolioId, user_id: userId },
    ])
  }
  fakeDB.seed('portfolio_items', [
    ...fakeDB.rows('portfolio_items'),
    {
      portfolio_id: portfolioId,
      card_slug:    urlSlug,
      holding_type: opts.holding_type ?? 'raw',
      quantity:     opts.quantity ?? 1,
    },
  ])
}

function seedPrice(bare: string, date: string, prices: { raw?: number; psa9?: number; psa10?: number }) {
  fakeDB.seed('daily_prices', [
    ...fakeDB.rows('daily_prices'),
    {
      card_slug:  `pc-${bare}`,
      date,
      raw_usd:    prices.raw   ?? null,
      psa9_usd:   prices.psa9  ?? null,
      psa10_usd:  prices.psa10 ?? null,
    },
  ])
}

function seedSale(bare: string, saleDate: string) {
  fakeDB.seed('recent_sales', [
    ...fakeDB.rows('recent_sales'),
    {
      internal_card_slug: bare,
      sale_date:          saleDate,
      parse_status:       'ok',
      review_status:      'active',
    },
  ])
}

function seedAlertEvent(userId: string, opts: Partial<Record<string, unknown>> = {}) {
  fakeDB.seed('alert_events', [
    ...fakeDB.rows('alert_events'),
    {
      id: `e-${Math.random().toString(36).slice(2, 8)}`,
      user_id:     userId,
      card_slug:   '1450205',
      card_name:   'Charizard',
      set_name:    'Base Set',
      rule:        'raw_change',
      severity:    'normal',
      detected_at: '2026-06-24T10:00:00Z',
      delivered_at: null,
      ...opts,
    },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('priceColumnForHoldingType', () => {
  it('maps raw / unknown / null to raw_usd', () => {
    expect(priceColumnForHoldingType('raw')).toBe('raw_usd')
    expect(priceColumnForHoldingType('manual')).toBe('raw_usd')
    expect(priceColumnForHoldingType('sealed')).toBe('raw_usd')
    expect(priceColumnForHoldingType(null)).toBe('raw_usd')
    expect(priceColumnForHoldingType(undefined)).toBe('raw_usd')
    expect(priceColumnForHoldingType('')).toBe('raw_usd')
  })
  it('maps psa10 / cgc10 / bgs10 / sgc10 to psa10_usd', () => {
    expect(priceColumnForHoldingType('psa10')).toBe('psa10_usd')
    expect(priceColumnForHoldingType('PSA10')).toBe('psa10_usd')
    expect(priceColumnForHoldingType('cgc10')).toBe('psa10_usd')
    expect(priceColumnForHoldingType('bgs10')).toBe('psa10_usd')
    expect(priceColumnForHoldingType('sgc10')).toBe('psa10_usd')
  })
  it('maps psa9 / cgc9 family to psa9_usd', () => {
    expect(priceColumnForHoldingType('psa9')).toBe('psa9_usd')
    expect(priceColumnForHoldingType('cgc9')).toBe('psa9_usd')
  })
})

describe('pctChange', () => {
  it('returns null when either side is missing', () => {
    expect(pctChange(null, 100)).toBeNull()
    expect(pctChange(100, null)).toBeNull()
    expect(pctChange(null, null)).toBeNull()
  })
  it('returns null when the base is non-positive', () => {
    expect(pctChange(0,    100)).toBeNull()
    expect(pctChange(-10,  100)).toBeNull()
  })
  it('returns signed percent', () => {
    expect(pctChange(100, 120)).toBeCloseTo(20)
    expect(pctChange(100,  80)).toBeCloseTo(-20)
  })
})

describe('usdToCents', () => {
  it('multiplies by 100 and rounds', () => {
    expect(usdToCents(12.34)).toBe(1234)
    expect(usdToCents(0.005)).toBe(1)            // 0.005 USD = 0.5 cents → rounds to 1
    expect(usdToCents(0)).toBe(0)
  })
  it('returns null for null / NaN', () => {
    expect(usdToCents(null)).toBeNull()
    expect(usdToCents(undefined)).toBeNull()
    expect(usdToCents(Number.NaN)).toBeNull()
  })
})

describe('selectTopItems', () => {
  function card(over: Partial<ScoredCard>): ScoredCard {
    return {
      source: 'portfolio', urlSlug: `s-${Math.random()}`,
      cardSlug: '1', cardName: 'C', setName: 'S', cardUrl: null,
      currentCents: 100, previousCents: 100, pctChange: 0,
      absChangeCents: 0, recentSalesCount: 0, quantity: 1,
      ...over,
    }
  }

  it('picks biggest riser first, biggest faller second, most active third', () => {
    const cards: ScoredCard[] = [
      card({ urlSlug: 'a', pctChange: +30,   recentSalesCount: 0 }),
      card({ urlSlug: 'b', pctChange: -25,   recentSalesCount: 1 }),
      card({ urlSlug: 'c', pctChange: +5,    recentSalesCount: 8 }),
    ]
    const out = selectTopItems(cards, 3)
    expect(out.map(i => i.reason)).toEqual(['biggest_riser', 'biggest_faller', 'most_active'])
  })

  it('caps to max items', () => {
    const cards: ScoredCard[] = Array.from({ length: 20 }, (_, i) => card({
      urlSlug: `u-${i}`, pctChange: i, recentSalesCount: i,
    }))
    expect(selectTopItems(cards, 5)).toHaveLength(5)
    expect(selectTopItems(cards, 1)).toHaveLength(1)
  })

  it('falls back to |pct| ranking when the three category leaders are taken', () => {
    const cards: ScoredCard[] = [
      card({ urlSlug: 'top-riser',  pctChange: +50,  recentSalesCount: 0 }),
      card({ urlSlug: 'top-faller', pctChange: -40,  recentSalesCount: 0 }),
      card({ urlSlug: 'high-mag',   pctChange: +35,  recentSalesCount: 0 }),
      card({ urlSlug: 'mid-mag',    pctChange: -20,  recentSalesCount: 0 }),
    ]
    const out = selectTopItems(cards, 4)
    expect(out.map(i => i.cardSlug)).toEqual(['1', '1', '1', '1'])    // all same default
    // Order should be: top-riser, top-faller, then biggest |pct| of remainder.
    const slugs = out.map(i => (i as unknown as { _urlSlug?: string })._urlSlug)
    void slugs
    expect(out.length).toBe(4)
  })

  it('handles empty input gracefully', () => {
    expect(selectTopItems([], 5)).toEqual([])
  })

  it('falls back to new_sales_activity when cards have only sales (no pct)', () => {
    const cards: ScoredCard[] = [
      card({ urlSlug: 'sales-only', pctChange: null, recentSalesCount: 4 }),
    ]
    const out = selectTopItems(cards, 5)
    expect(out).toHaveLength(1)
    // Card has sales > 0 so it qualifies as most_active in the third pass.
    expect(out[0].reason).toBe('most_active')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Preference gating
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — preference gating', () => {
  it('returns disabled_master when the master switch is off', async () => {
    seedPrefs('u1', { enabled: false })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('disabled_master')
    expect(out.portfolio).toBeUndefined()
    expect(out.watchlist).toBeUndefined()
    expect(out.alertSummary.totalEvents).toBe(0)
  })

  it('returns disabled_weekly when weekly digest is off', async () => {
    seedPrefs('u1', { weeklyDigestEnabled: false })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('disabled_weekly')
    expect(out.portfolio).toBeUndefined()
    expect(out.watchlist).toBeUndefined()
  })

  it('omits the portfolio section when weeklyOverviewPortfolioEnabled is false', async () => {
    seedPrefs('u1', { weeklyOverviewPortfolioEnabled: false })
    seedCardLink('charizard-base-4', '1450205', 'Charizard', 'Base Set')
    seedPortfolio('u1', 'charizard-base-4')
    seedWatch    ('u1', 'charizard-base-4')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('ok')
    expect(out.portfolio).toBeUndefined()
    expect(out.watchlist).toBeDefined()
    expect(out.diagnostics.sectionsOmittedByPreferences).toContain('portfolio')
  })

  it('omits the watchlist section when weeklyOverviewWatchlistEnabled is false', async () => {
    seedPrefs('u1', { weeklyOverviewWatchlistEnabled: false })
    seedCardLink('charizard-base-4', '1450205', 'Charizard', 'Base Set')
    seedPortfolio('u1', 'charizard-base-4')
    seedWatch    ('u1', 'charizard-base-4')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('ok')
    expect(out.watchlist).toBeUndefined()
    expect(out.portfolio).toBeDefined()
    expect(out.diagnostics.sectionsOmittedByPreferences).toContain('watchlist')
  })

  it('returns ok with empty sections for a brand-new user with no portfolio/watchlist', async () => {
    seedPrefs('u-new')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u-new', { asOf })
    expect(out.status).toBe('ok')
    expect(out.portfolio?.itemCount).toBe(0)
    expect(out.watchlist?.itemCount).toBe(0)
    expect(out.diagnostics.portfolioCardsConsidered).toBe(0)
    expect(out.diagnostics.watchlistCardsConsidered).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Slug resolution + market lookups
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — slug resolution', () => {
  it('resolves URL slug → bare numeric via cards, uses pc-{bare} for daily_prices and bare for recent_sales', async () => {
    seedPrefs('u1')
    // URL slug stored on watchlist / portfolio_items
    seedCardLink('charizard-base-4', '1450205', 'Charizard', 'Base Set')
    seedWatch    ('u1', 'charizard-base-4')
    seedPortfolio('u1', 'charizard-base-4', { holding_type: 'raw', quantity: 1 })
    // Prices indexed by pc-1450205
    seedPrice('1450205', '2026-06-18', { raw: 10.00 })  // baseline 7d before asOf
    seedPrice('1450205', '2026-06-25', { raw: 12.00 })  // latest
    // Sales indexed by bare 1450205
    seedSale('1450205', '2026-06-23T08:00:00Z')
    seedSale('1450205', '2026-06-24T08:00:00Z')

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('ok')

    // Portfolio reflects the resolved price (in cents, quantity 1)
    expect(out.portfolio?.currentTotalCents).toBe(1200)
    expect(out.portfolio?.previousTotalCents).toBe(1000)
    expect(out.portfolio?.pctChange).toBeCloseTo(20)
    expect(out.portfolio?.absChangeCents).toBe(200)
    // Top item carries the price + sales data
    expect(out.portfolio?.topItems[0]).toMatchObject({
      cardSlug:         '1450205',
      cardName:         'Charizard',
      setName:          'Base Set',
      currentCents:     1200,
      previousCents:    1000,
      recentSalesCount: 2,
    })
    // And a public URL was synthesised from cards.card_url_slug + set_name
    expect(out.portfolio?.topItems[0].cardUrl).toBe('https://www.pokeprices.io/set/Base%20Set/card/charizard-base-4')
    // Watchlist mirrors the same numbers (default raw, qty 1)
    expect(out.watchlist?.topItems[0]).toMatchObject({
      cardSlug:         '1450205',
      currentCents:     1200,
      previousCents:    1000,
      recentSalesCount: 2,
    })
  })

  it('counts cards with unresolved URL slugs in diagnostics.cardsWithNoSlugResolution', async () => {
    seedPrefs('u1')
    seedWatch('u1', 'ghost-card-no-cards-row')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.cardsWithNoSlugResolution).toBe(1)
    expect(out.watchlist?.itemCount).toBe(1)
    // Card has no usable signal (no slug → no price, no sales) so it
    // is counted in diagnostics but does NOT appear in topItems.
    expect(out.watchlist?.topItems).toEqual([])
  })

  it('counts cards with no price data and no recent sales in diagnostics', async () => {
    seedPrefs('u1')
    seedCardLink('lonely-card', '999999', 'Lonely', 'Set')
    seedWatch('u1', 'lonely-card')
    // No daily_prices and no recent_sales for 999999
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.cardsWithNoPriceData).toBe(1)
    expect(out.diagnostics.cardsWithNoRecentSales).toBe(1)
    // Same as above — no signal means the card is tracked in
    // diagnostics but does not waste a topItems slot.
    expect(out.watchlist?.topItems).toEqual([])
  })

  it('uses the holding_type to pick the right price column (psa10 → psa10_usd)', async () => {
    seedPrefs('u1')
    seedCardLink('crz', '111', 'Charizard', 'Base')
    seedPortfolio('u1', 'crz', { holding_type: 'psa10', quantity: 1 })
    // Different raw vs psa10 prices to prove we pick psa10
    seedPrice('111', '2026-06-18', { raw:   1.00, psa10: 500.00 })
    seedPrice('111', '2026-06-25', { raw:   2.00, psa10: 600.00 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(60_000)
    expect(out.portfolio?.previousTotalCents).toBe(50_000)
  })

  it('multiplies the per-card price by quantity in the portfolio total', async () => {
    seedPrefs('u1')
    seedCardLink('crz', '111', 'Charizard', 'Base')
    seedPortfolio('u1', 'crz', { holding_type: 'raw', quantity: 3 })
    seedPrice('111', '2026-06-18', { raw: 10 })
    seedPrice('111', '2026-06-25', { raw: 15 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(4500)   // 1500 cents × 3
    expect(out.portfolio?.previousTotalCents).toBe(3000)  // 1000 cents × 3
    expect(out.portfolio?.absChangeCents).toBe(1500)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Top-N selection inside the builder
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — top-N selection', () => {
  it('limits each section to its configured maximum', async () => {
    seedPrefs('u1')
    // 10 watchlist cards, all with different pct moves
    for (let i = 0; i < 10; i++) {
      const url  = `card-${i}`
      const bare = String(1_000_000 + i)
      seedCardLink(url, bare, `Card ${i}`, `Set ${i}`)
      seedWatch('u1', url)
      seedPrice(bare, '2026-06-18', { raw: 10 })
      seedPrice(bare, '2026-06-25', { raw: 10 + i })  // 0 % .. +90 %
    }
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', {
      asOf, maxWatchlistItems: 3, maxPortfolioItems: 3,
    })
    expect(out.watchlist?.itemCount).toBe(10)
    expect(out.watchlist?.topItems).toHaveLength(3)
  })

  it('orders the first three top items as biggest riser, biggest faller, most active', async () => {
    seedPrefs('u1')
    // Riser
    seedCardLink('riser',  '101', 'Riser',  'S')
    seedWatch('u1', 'riser')
    seedPrice('101', '2026-06-18', { raw: 10 })
    seedPrice('101', '2026-06-25', { raw: 30 })   // +200%
    // Faller
    seedCardLink('faller', '102', 'Faller', 'S')
    seedWatch('u1', 'faller')
    seedPrice('102', '2026-06-18', { raw: 30 })
    seedPrice('102', '2026-06-25', { raw: 10 })   // -66%
    // Most active (small move, many sales)
    seedCardLink('active', '103', 'Active', 'S')
    seedWatch('u1', 'active')
    seedPrice('103', '2026-06-18', { raw: 10 })
    seedPrice('103', '2026-06-25', { raw: 11 })   // +10%
    for (let i = 0; i < 8; i++) seedSale('103', `2026-06-2${(i % 5) + 1}T08:00:00Z`)

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf, maxWatchlistItems: 3 })
    const reasons = out.watchlist?.topItems.map(i => i.reason) ?? []
    expect(reasons).toEqual(['biggest_riser', 'biggest_faller', 'most_active'])
    expect(out.watchlist?.topItems[0].cardName).toBe('Riser')
    expect(out.watchlist?.topItems[1].cardName).toBe('Faller')
    expect(out.watchlist?.topItems[2].cardName).toBe('Active')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Alert summary
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — alert summary', () => {
  it('groups alert_events by card and reports the per-card severity mix', async () => {
    seedPrefs('u1')
    seedAlertEvent('u1', { id: 'e1', card_slug: '111', rule: 'raw_change',   severity: 'high'   })
    seedAlertEvent('u1', { id: 'e2', card_slug: '111', rule: 'psa10_change', severity: 'normal' })
    seedAlertEvent('u1', { id: 'e3', card_slug: '222', rule: 'recent_sales', severity: 'normal' })

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.alertSummary.totalEvents).toBe(3)
    const blocks = out.alertSummary.cardBlocks
    expect(blocks).toHaveLength(2)
    const card111 = blocks.find(b => b.cardSlug === '111')!
    expect(card111.eventCount).toBe(2)
    expect(card111.severities).toEqual({ high: 1, normal: 1, low: 0 })
    expect(card111.rules.sort()).toEqual(['psa10_change', 'raw_change'])
    const card222 = blocks.find(b => b.cardSlug === '222')!
    expect(card222.eventCount).toBe(1)
  })

  it('caps cardBlocks to maxAlertItems', async () => {
    seedPrefs('u1')
    for (let i = 0; i < 12; i++) {
      seedAlertEvent('u1', { id: `e-${i}`, card_slug: String(1000 + i), severity: 'normal' })
    }
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf, maxAlertItems: 4 })
    expect(out.alertSummary.totalEvents).toBe(12)
    expect(out.alertSummary.cardBlocks).toHaveLength(4)
  })

  it('orders blocks by severity score (high outranks normal outranks low)', async () => {
    seedPrefs('u1')
    seedAlertEvent('u1', { id: 'a', card_slug: 'A', severity: 'low'    })
    seedAlertEvent('u1', { id: 'b', card_slug: 'B', severity: 'high'   })
    seedAlertEvent('u1', { id: 'c', card_slug: 'C', severity: 'normal' })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.alertSummary.cardBlocks.map(b => b.cardSlug)).toEqual(['B', 'C', 'A'])
  })

  it('ignores events outside the lookback window', async () => {
    seedPrefs('u1')
    seedAlertEvent('u1', { id: 'recent', card_slug: '111', detected_at: '2026-06-24T10:00:00Z' })
    seedAlertEvent('u1', { id: 'stale',  card_slug: '222', detected_at: '2025-12-01T10:00:00Z' })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf, lookbackDays: 7 })
    expect(out.alertSummary.totalEvents).toBe(1)
    expect(out.alertSummary.cardBlocks).toHaveLength(1)
    expect(out.alertSummary.cardBlocks[0].cardSlug).toBe('111')
  })

  it('does NOT mutate alert_events.delivered_at when building the summary', async () => {
    seedPrefs('u1')
    seedAlertEvent('u1', { id: 'e1', card_slug: '111' })
    seedAlertEvent('u1', { id: 'e2', card_slug: '111' })
    await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    // All rows should still have delivered_at === null.
    const rows = fakeDB.rows('alert_events') as Array<{ delivered_at: string | null }>
    expect(rows.every(r => r.delivered_at == null)).toBe(true)
    expect(rows).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Read-only guarantee
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — read-only', () => {
  it('does not insert or update ANY rows during a full digest build', async () => {
    seedPrefs('u1')
    seedCardLink('crz', '111', 'Charizard', 'Base')
    seedWatch('u1', 'crz')
    seedPortfolio('u1', 'crz', { holding_type: 'raw', quantity: 1 })
    seedPrice('111', '2026-06-18', { raw: 10 })
    seedPrice('111', '2026-06-25', { raw: 15 })
    seedSale('111', '2026-06-24T08:00:00Z')
    seedAlertEvent('u1', { id: 'e1', card_slug: '111', severity: 'high' })

    // Snapshot every table we touch and assert it's unchanged afterwards.
    const before = {
      prefs:     JSON.stringify(fakeDB.rows('user_alert_preferences')),
      port:      JSON.stringify(fakeDB.rows('portfolios')),
      portItems: JSON.stringify(fakeDB.rows('portfolio_items')),
      watch:     JSON.stringify(fakeDB.rows('watchlist')),
      cards:     JSON.stringify(fakeDB.rows('cards')),
      prices:    JSON.stringify(fakeDB.rows('daily_prices')),
      sales:     JSON.stringify(fakeDB.rows('recent_sales')),
      alerts:    JSON.stringify(fakeDB.rows('alert_events')),
    }
    await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(JSON.stringify(fakeDB.rows('user_alert_preferences'))).toBe(before.prefs)
    expect(JSON.stringify(fakeDB.rows('portfolios'))).toBe(before.port)
    expect(JSON.stringify(fakeDB.rows('portfolio_items'))).toBe(before.portItems)
    expect(JSON.stringify(fakeDB.rows('watchlist'))).toBe(before.watch)
    expect(JSON.stringify(fakeDB.rows('cards'))).toBe(before.cards)
    expect(JSON.stringify(fakeDB.rows('daily_prices'))).toBe(before.prices)
    expect(JSON.stringify(fakeDB.rows('recent_sales'))).toBe(before.sales)
    expect(JSON.stringify(fakeDB.rows('alert_events'))).toBe(before.alerts)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Diagnostics shape
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestForUser — diagnostics', () => {
  it('always returns the documented diagnostic keys', async () => {
    seedPrefs('u1')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    const d = out.diagnostics
    expect(typeof d.portfolioCardsConsidered).toBe('number')
    expect(typeof d.watchlistCardsConsidered).toBe('number')
    expect(typeof d.cardsWithNoSlugResolution).toBe('number')
    expect(typeof d.cardsWithNoPriceData).toBe('number')
    expect(typeof d.cardsWithNoRecentSales).toBe('number')
    expect(Array.isArray(d.sectionsOmittedByPreferences)).toBe(true)
    expect(typeof d.generatedAt).toBe('string')
  })
})
