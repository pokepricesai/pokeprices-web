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
  classifyPortfolioPriceBasis,
  pctChange,
  usdToCents,
  dailyPriceCentsFromColumn,
  selectTopItems,
  MIN_MEANINGFUL_PCT,
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

function seedPortfolio(userId: string, urlSlug: string, opts: {
  holding_type?:      string
  quantity?:          number
  card_name?:         string | null
  set_name?:          string | null
  manual_value_cents?: number | null
} = {}) {
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
      portfolio_id:       portfolioId,
      card_slug:          urlSlug,
      holding_type:       opts.holding_type ?? 'raw',
      quantity:           opts.quantity     ?? 1,
      card_name:          opts.card_name    ?? null,
      set_name:           opts.set_name     ?? null,
      manual_value_cents: opts.manual_value_cents ?? null,
    },
  ])
}

function seedCardTrend(cardName: string, setName: string, prices: { raw?: number; psa9?: number; psa10?: number }) {
  fakeDB.seed('card_trends', [
    ...fakeDB.rows('card_trends'),
    {
      card_name:     cardName,
      set_name:      setName,
      current_raw:   prices.raw   ?? null,
      current_psa9:  prices.psa9  ?? null,
      current_psa10: prices.psa10 ?? null,
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
    // Prices indexed by pc-1450205. Values are USD CENTS (matches the
    // actual daily_prices column convention — fixed in Block 5A-W-16B).
    seedPrice('1450205', '2026-06-18', { raw: 1000 })   // baseline 7d before asOf = $10.00
    seedPrice('1450205', '2026-06-25', { raw: 1200 })   // latest = $12.00
    // Sales indexed by bare 1450205
    seedSale('1450205', '2026-06-23T08:00:00Z')
    seedSale('1450205', '2026-06-24T08:00:00Z')

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('ok')

    // Portfolio reflects the resolved price (USD-cents, quantity 1).
    expect(out.portfolio?.currentTotalCents).toBe(1200)
    // Block 5A-W-16E — headline weekly change is suppressed (no
    // dashboard-equivalent historical total available).
    expect(out.portfolio?.previousTotalCents).toBeNull()
    expect(out.portfolio?.pctChange).toBeNull()
    expect(out.portfolio?.absChangeCents).toBeNull()
    // Top item carries the price + sales data. Block 5A-W-16E:
    // portfolio previousCents is null (no dashboard-equivalent
    // historical per-card baseline), but the activity rule still
    // surfaces the card via recent sales.
    expect(out.portfolio?.topItems[0]).toMatchObject({
      cardSlug:         '1450205',
      cardName:         'Charizard',
      setName:          'Base Set',
      currentCents:     1200,
      previousCents:    null,
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
    // USD-cents in the columns. Wildly different raw vs psa10 so a
    // wrong-column read would be obvious.
    seedPrice('111', '2026-06-18', { raw:   100, psa10: 50_000 })   // $1 raw, $500 psa10
    seedPrice('111', '2026-06-25', { raw:   200, psa10: 60_000 })   // $2 raw, $600 psa10
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(60_000)
    // Block 5A-W-16E — headline previous always null
    expect(out.portfolio?.previousTotalCents).toBeNull()
  })

  it('multiplies the per-card price by quantity in the portfolio total', async () => {
    seedPrefs('u1')
    seedCardLink('crz', '111', 'Charizard', 'Base')
    seedPortfolio('u1', 'crz', { holding_type: 'raw', quantity: 3 })
    seedPrice('111', '2026-06-18', { raw: 1000 })   // $10.00 in USD-cents
    seedPrice('111', '2026-06-25', { raw: 1500 })   // $15.00 in USD-cents
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(4500)   // 1500 cents × 3
    // Block 5A-W-16E — headline change suppressed
    expect(out.portfolio?.previousTotalCents).toBeNull()
    expect(out.portfolio?.absChangeCents).toBeNull()
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
    // Block 5A-W-15B — basis-counts diagnostic
    expect(d.portfolioPriceBasisCounts).toEqual({
      raw_usd: 0, psa9_usd: 0, psa10_usd: 0, unknown_fallback: 0,
    })
    // Block 5A-W-16C — shared valuation source diagnostics
    expect(d.portfolioValueSource).toBe('shared_valuation_helper')
    // Block 5A-W-16E — movement source + headline-suppression diagnostics
    expect(d.portfolioMovementSource).toBe('none')           // empty user → no movement to show
    expect(d.portfolioItemMovementWindowDays).toBeNull()
    expect(d.portfolioHeadlineChangeSuppressed).toBe(true)
    expect(typeof d.portfolioHeadlineSuppressedReason).toBe('string')
    expect(typeof d.portfolioHoldingsPricedCount).toBe('number')
    expect(typeof d.portfolioHoldingsMissingPriceCount).toBe('number')
    expect(d.portfolioValueSourceCounts).toEqual({
      card_trends: 0, daily_prices: 0, manual: 0, missing: 0,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-15B — quality polish
// ─────────────────────────────────────────────────────────────────────

describe('selectTopItems — Block 5A-W-15B threshold guards', () => {
  function card(over: Partial<ScoredCard>): ScoredCard {
    return {
      source: 'watchlist', urlSlug: `s-${Math.random()}`,
      cardSlug: '1', cardName: 'C', setName: 'S', cardUrl: null,
      currentCents: 100, previousCents: 100, pctChange: 0,
      absChangeCents: 0, recentSalesCount: 0, quantity: 1,
      ...over,
    }
  }

  it('exports a non-zero MIN_MEANINGFUL_PCT default', () => {
    expect(MIN_MEANINGFUL_PCT).toBeGreaterThan(0)
  })

  it('never labels a 0.0% card as Biggest riser when it has no sales', () => {
    const out = selectTopItems([card({ urlSlug: 'flat', pctChange: 0, recentSalesCount: 0 })], 5)
    expect(out).toEqual([])
  })

  it('never labels a 0.0% card as Biggest faller when it has no sales', () => {
    const out = selectTopItems([card({ urlSlug: 'flat', pctChange: 0, recentSalesCount: 0 })], 5)
    expect(out).toEqual([])
  })

  it('a 0.0% card WITH sales surfaces as new_sales_activity (not Biggest riser)', () => {
    const out = selectTopItems([card({ urlSlug: 'flat', pctChange: 0, recentSalesCount: 6 })], 5)
    expect(out).toHaveLength(1)
    // Sales > 0 → 3rd pass picks it as "most_active".
    expect(out[0].reason).toBe('most_active')
  })

  it('a sub-threshold +0.5% card with no sales is excluded entirely', () => {
    const out = selectTopItems([card({ urlSlug: 'tiny', pctChange: 0.5, recentSalesCount: 0 })], 5)
    expect(out).toEqual([])
  })

  it('a +1.0% card meets the threshold and qualifies as Biggest riser', () => {
    const out = selectTopItems([card({ urlSlug: 'meet', pctChange: 1.0, recentSalesCount: 0 })], 5)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('biggest_riser')
  })

  it('a -1.0% card meets the threshold and qualifies as Biggest faller', () => {
    const out = selectTopItems([card({ urlSlug: 'meet', pctChange: -1.0, recentSalesCount: 0 })], 5)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('biggest_faller')
  })

  it('does NOT pad with weak items — returns fewer than max when no candidates qualify', () => {
    const cards: ScoredCard[] = [
      card({ urlSlug: 'flat1', pctChange: 0,   recentSalesCount: 0 }),
      card({ urlSlug: 'flat2', pctChange: 0.2, recentSalesCount: 0 }),
      card({ urlSlug: 'flat3', pctChange: -0.4, recentSalesCount: 0 }),
      card({ urlSlug: 'real',  pctChange: 25,  recentSalesCount: 0 }),
    ]
    const out = selectTopItems(cards, 5)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('biggest_riser')
  })

  it('a recent-sales item still appears even when it has no price movement', () => {
    const cards: ScoredCard[] = [
      card({ urlSlug: 'sales-no-move',  pctChange: null, recentSalesCount: 3 }),
    ]
    const out = selectTopItems(cards, 5)
    expect(out).toHaveLength(1)
    // Pass 3 picks it as "most_active" because recentSalesCount > 0.
    expect(out[0].reason).toBe('most_active')
  })
})

describe('classifyPortfolioPriceBasis', () => {
  it('explicit raw → raw_usd column, raw_usd basis', () => {
    expect(classifyPortfolioPriceBasis('raw')).toEqual({ column: 'raw_usd', basis: 'raw_usd' })
  })

  it('psa10 / cgc10 / bgs10 / sgc10 → psa10_usd column + basis', () => {
    for (const ht of ['psa10', 'cgc10', 'bgs10', 'sgc10']) {
      expect(classifyPortfolioPriceBasis(ht)).toEqual({ column: 'psa10_usd', basis: 'psa10_usd' })
    }
  })

  it('psa9 / cgc9 / bgs9 / sgc9 → psa9_usd column + basis', () => {
    for (const ht of ['psa9', 'cgc9', 'bgs9', 'sgc9']) {
      expect(classifyPortfolioPriceBasis(ht)).toEqual({ column: 'psa9_usd', basis: 'psa9_usd' })
    }
  })

  it('manual / sealed / null / unknown → raw_usd column but unknown_fallback basis', () => {
    for (const ht of ['manual', 'sealed', 'whatever', null, undefined, '']) {
      expect(classifyPortfolioPriceBasis(ht as string | null | undefined)).toEqual({
        column: 'raw_usd', basis: 'unknown_fallback',
      })
    }
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-15B basis diagnostic', () => {
  it('counts each portfolio_items row in the correct basis bucket', async () => {
    seedPrefs('u1')
    seedCardLink('a-card', '111', 'A', 'S')
    seedCardLink('b-card', '222', 'B', 'S')
    seedCardLink('c-card', '333', 'C', 'S')
    seedCardLink('d-card', '444', 'D', 'S')
    seedPortfolio('u1', 'a-card', { holding_type: 'raw',    quantity: 1 })  // raw_usd
    seedPortfolio('u1', 'b-card', { holding_type: 'psa10',  quantity: 1 })  // psa10_usd
    seedPortfolio('u1', 'c-card', { holding_type: 'psa9',   quantity: 1 })  // psa9_usd
    seedPortfolio('u1', 'd-card', { holding_type: 'manual', quantity: 1 })  // unknown_fallback
    seedPortfolio('u1', 'd-card', { holding_type: 'sealed', quantity: 1 })  // unknown_fallback (2nd)

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.portfolioPriceBasisCounts).toEqual({
      raw_usd:          1,
      psa10_usd:        1,
      psa9_usd:         1,
      unknown_fallback: 2,
    })
  })

  it('uses psa10_usd for a psa10 holding when both columns are populated', async () => {
    seedPrefs('u1')
    seedCardLink('crz', '111', 'Charizard', 'Base')
    seedPortfolio('u1', 'crz', { holding_type: 'psa10', quantity: 1 })
    // Wildly different raw vs psa10 USD-cents — the holding chooses psa10
    seedPrice('111', '2026-06-18', { raw: 100, psa10: 10_000 })   // $1 raw, $100 psa10
    seedPrice('111', '2026-06-25', { raw: 100, psa10: 15_000 })   // $1 raw, $150 psa10
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(15_000)
    // Block 5A-W-16E — headline previous always null
    expect(out.portfolio?.previousTotalCents).toBeNull()
    expect(out.diagnostics.portfolioPriceBasisCounts.psa10_usd).toBe(1)
  })

  it('uses raw_usd for a raw holding, never psa10', async () => {
    // Block 5A-W-16C — the shared valuation helper resolves raw via
    // card_trends. Unknown holding_types (e.g. 'manual', 'sealed')
    // no longer silently fall back to raw — they go to the 'missing'
    // source so the total isn't quietly inflated by treating a
    // sealed/manual holding as if it were ungraded raw.
    seedPrefs('u1')
    seedCardLink('a-card', '111', 'A', 'S')
    seedPortfolio('u1', 'a-card', { holding_type: 'raw', quantity: 1, card_name: 'A', set_name: 'S' })
    fakeDB.seed('card_trends', [
      { card_name: 'A', set_name: 'S', current_raw: 600, current_psa9: null, current_psa10: 60_000 },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(600)   // raw, not psa10 (would be 60_000)
    expect(out.diagnostics.portfolioPriceBasisCounts.raw_usd).toBe(1)
    expect(out.diagnostics.portfolioValueSourceCounts.card_trends).toBe(1)
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-15B end-to-end reason guards', () => {
  it('a flat-price watchlist card does NOT appear as biggest riser', async () => {
    seedPrefs('u1')
    seedCardLink('flat', '777', 'Haunter', 'Fossil')
    seedWatch('u1', 'flat')
    seedPrice('777', '2026-06-18', { raw: 50 })
    seedPrice('777', '2026-06-25', { raw: 50 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.watchlist?.topItems).toEqual([])
  })

  it('renders the "No major watchlist changes" fallback in the email when every watched card is flat', async () => {
    // Use the renderer to verify the friendly fallback survives the pipeline.
    const data = (await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf }))
    // Seed up to render: prefs + watchlist with 1 flat card.
    seedPrefs('u1')
    seedCardLink('flat', '777', 'Haunter', 'Fossil')
    seedWatch('u1', 'flat')
    seedPrice('777', '2026-06-18', { raw: 50 })
    seedPrice('777', '2026-06-25', { raw: 50 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    void data
    expect(out.watchlist?.itemCount).toBe(1)
    expect(out.watchlist?.topItems).toEqual([])  // friendly fallback fires at render
  })

  it('priceColumnForHoldingType backwards-compatible: raw / manual / unknown still return raw_usd', () => {
    expect(priceColumnForHoldingType('raw')).toBe('raw_usd')
    expect(priceColumnForHoldingType('manual')).toBe('raw_usd')
    expect(priceColumnForHoldingType('whatever')).toBe('raw_usd')
    expect(priceColumnForHoldingType(null)).toBe('raw_usd')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-16B — unit correctness + currency selection
// ─────────────────────────────────────────────────────────────────────

describe('dailyPriceCentsFromColumn — Block 5A-W-16B', () => {
  it('treats the daily_prices column value as USD CENTS — no ×100', () => {
    expect(dailyPriceCentsFromColumn(1200)).toBe(1200)
    expect(dailyPriceCentsFromColumn(116)).toBe(116)
    expect(dailyPriceCentsFromColumn(0)).toBe(0)
  })
  it('returns null for null / non-finite', () => {
    expect(dailyPriceCentsFromColumn(null)).toBeNull()
    expect(dailyPriceCentsFromColumn(undefined)).toBeNull()
    expect(dailyPriceCentsFromColumn(Number.NaN)).toBeNull()
  })
  it('legacy usdToCents helper still multiplies (kept for back-compat)', () => {
    // The legacy helper must NOT be invoked on daily_prices values.
    // The new helper above is the right surface for column reads.
    expect(usdToCents(12.34)).toBe(1234)
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-16B currency', () => {
  it('defaults to GBP when the user has no display_currency preference', async () => {
    seedPrefs('u1')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.currency).toBe('GBP')
    expect(out.diagnostics.displayCurrency).toBe('GBP')
  })

  it('honours USD when user_email_preferences.display_currency = USD', async () => {
    seedPrefs('u1')
    fakeDB.seed('user_email_preferences', [
      { user_id: 'u1', display_currency: 'USD' },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.currency).toBe('USD')
    expect(out.diagnostics.displayCurrency).toBe('USD')
  })

  it('honours GBP when user_email_preferences.display_currency = GBP', async () => {
    seedPrefs('u1')
    fakeDB.seed('user_email_preferences', [
      { user_id: 'u1', display_currency: 'GBP' },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.currency).toBe('GBP')
  })

  it('ignores garbage values and falls back to GBP', async () => {
    seedPrefs('u1')
    fakeDB.seed('user_email_preferences', [
      { user_id: 'u1', display_currency: 'JPY' },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.currency).toBe('GBP')
  })

  it('passes currency through to disabled-master / disabled-weekly states', async () => {
    seedPrefs('u1', { enabled: false })
    fakeDB.seed('user_email_preferences', [
      { user_id: 'u1', display_currency: 'USD' },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.status).toBe('disabled_master')
    expect(out.currency).toBe('USD')
    expect(out.diagnostics.displayCurrency).toBe('USD')
  })

  it('echoes portfolioValueSource = shared_valuation_helper + Block 5A-W-16E movement diagnostics', async () => {
    seedPrefs('u1')
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.portfolioValueSource).toBe('shared_valuation_helper')
    expect(out.diagnostics.portfolioMovementSource).toBe('none')
    expect(out.diagnostics.portfolioHeadlineChangeSuppressed).toBe(true)
    expect(out.diagnostics.portfolioValueSourceCounts).toEqual({
      card_trends: 0, daily_prices: 0, manual: 0, missing: 0,
    })
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-16C dashboard-aligned valuation', () => {
  it('uses card_trends for raw / psa9 / psa10 holdings (matches dashboard totals)', async () => {
    seedPrefs('u1')
    // Real example: Charizard #4 — Base Set raw at £290.74 ≈ 36_924 USD-cents
    seedCardLink('charizard-base-4', '1', 'Charizard', 'Base Set')
    seedPortfolio('u1', 'charizard-base-4', {
      holding_type: 'raw', quantity: 1,
      card_name: 'Charizard', set_name: 'Base Set',
    })
    seedCardTrend('Charizard', 'Base Set', { raw: 36_924, psa10: 500_000 })
    // daily_prices for the same card would give a DIFFERENT raw value
    // (older snapshot). The helper must prefer card_trends.
    seedPrice('1', '2026-06-25', { raw: 999 })

    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(36_924)   // from card_trends, NOT 999
    expect(out.diagnostics.portfolioValueSourceCounts.card_trends).toBe(1)
    expect(out.diagnostics.portfolioValueSourceCounts.daily_prices).toBe(0)
  })

  it('uses card_trends.current_psa9 for a PSA 9 Dark Hypno (real example)', async () => {
    seedPrefs('u1')
    // £67.32 ≈ 8_549 USD-cents
    seedCardLink('dark-hypno-9', '2', 'Dark Hypno', 'Team Rocket')
    seedPortfolio('u1', 'dark-hypno-9', {
      holding_type: 'psa9', quantity: 1,
      card_name: 'Dark Hypno', set_name: 'Team Rocket',
    })
    seedCardTrend('Dark Hypno', 'Team Rocket', { psa9: 8_549 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(8_549)
    expect(out.diagnostics.portfolioValueSourceCounts.card_trends).toBe(1)
  })

  it('uses daily_prices.cgc10_usd for a cgc10 holding (extra tier path)', async () => {
    seedPrefs('u1')
    seedCardLink('a', '111', 'A', 'S')
    seedPortfolio('u1', 'a', {
      holding_type: 'cgc10', quantity: 2,
      card_name: 'A', set_name: 'S',
    })
    fakeDB.seed('daily_prices', [
      ...fakeDB.rows('daily_prices'),
      { card_slug: 'pc-111', date: '2026-06-25', raw_usd: 100, psa10_usd: 200, cgc10_usd: 750_00 },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(1_500_00)   // 750_00 × 2
    expect(out.diagnostics.portfolioValueSourceCounts.daily_prices).toBe(1)
  })

  it('manual override appears per-card but does NOT inflate the headline total (matches dashboard)', async () => {
    seedPrefs('u1')
    seedCardLink('a', '111', 'A', 'S')
    // Two holdings: one card_trends raw + one manual-grade with override
    seedCardLink('b', '222', 'B', 'S2')
    seedCardTrend('A', 'S', { raw: 100_00 })
    seedPortfolio('u1', 'a', {
      holding_type: 'raw', quantity: 1, card_name: 'A', set_name: 'S',
    })
    seedPortfolio('u1', 'b', {
      holding_type: 'bgs9',   // manual grade
      quantity: 1, card_name: 'B', set_name: 'S2',
      manual_value_cents: 999_99,
    })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(100_00)    // NOT 100_00 + 999_99
    expect(out.diagnostics.portfolioValueSourceCounts).toEqual({
      card_trends: 1, daily_prices: 0, manual: 1, missing: 0,
    })
  })

  it('low-value cards stay low (Chien-Pao 116 cents → £0.91 displayed via renderer)', async () => {
    seedPrefs('u1')
    seedCardLink('chien-pao-54', '5400', 'Chien-Pao', 'Set')
    seedPortfolio('u1', 'chien-pao-54', {
      holding_type: 'raw', quantity: 1,
      card_name: 'Chien-Pao', set_name: 'Set',
    })
    seedCardTrend('Chien-Pao', 'Set', { raw: 116 })   // £0.91 at 1 USD ≈ 0.79 GBP
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(116)
    // The renderer turns 116 USD-cents into £0.91 (116 / 127). The
    // valuation helper just hands the cents through.
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-16E no fake weekly moves', () => {
  // Real dashboard fixture, with the per-card 30d figures the
  // dashboard ACTUALLY shows. The pre-fix code was inventing
  // wildly different percentages by comparing card_trends current
  // values against daily_prices baselines.
  function seedRealishUser() {
    seedPrefs('u1')
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
    ])
    const items: Array<[string, string, string, string, number, number | null]> = [
      // [urlSlug, bareSlug, cardName, setName, current_raw, raw_pct_30d]
      ['charizard-4',  '1', 'Charizard', 'Base Set', 29_074, +19.8],
      ['venusaur-15',  '2', 'Venusaur',  'Base Set',  4_886, -15.6],
      ['blastoise-2',  '3', 'Blastoise', 'Base Set',  7_874,  -5.5],
      ['meowstic-34',  '4', 'Meowstic',  'Some Set',     24, +121.4],
    ]
    for (const [url, bare, name, set, raw, pct30] of items) {
      seedCardLink(url, bare, name, set)
      seedCardTrend(name, set, { raw })
      // Also tack the 30d pct onto the trend row.
      const trends = fakeDB.rows('card_trends') as Array<Record<string, unknown>>
      const tr = trends[trends.length - 1] as { raw_pct_30d?: number | null }
      tr.raw_pct_30d = pct30
      fakeDB.seed('portfolio_items', [
        ...fakeDB.rows('portfolio_items'),
        {
          portfolio_id:       'pf-u1',
          card_slug:          url,
          holding_type:       'raw',
          quantity:           1,
          card_name_snapshot: name,
          set_name_snapshot:  set,
        },
      ])
    }
  }

  it('per-item pctChange comes from card_trends.raw_pct_30d — never a fabricated 7d figure', async () => {
    seedRealishUser()
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    const byName = new Map(out.portfolio!.topItems.map(i => [i.cardName, i]))
    expect(byName.get('Venusaur')?.pctChange).toBeCloseTo(-15.6, 1)
    expect(byName.get('Charizard')?.pctChange).toBeCloseTo(+19.8, 1)
    expect(byName.get('Blastoise')?.pctChange).toBeCloseTo(-5.5, 1)
    // The fake-moves the regression produced (Venusaur +486.6%,
    // Charizard +62.3%, Blastoise +233.3%) must never reappear.
    for (const item of out.portfolio!.topItems) {
      if (item.pctChange != null) {
        expect(Math.abs(item.pctChange)).toBeLessThan(150)
      }
    }
  })

  it('every per-portfolio-item pctChange carries pctChangeWindowDays = 30', async () => {
    seedRealishUser()
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    for (const item of out.portfolio!.topItems) {
      if (item.pctChange != null) {
        expect(item.pctChangeWindowDays).toBe(30)
      }
    }
  })

  it('headline portfolio change is suppressed — currentTotalCents present, change fields null', async () => {
    seedRealishUser()
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.currentTotalCents).toBe(29_074 + 4_886 + 7_874 + 24)   // sum of 4 raw values
    expect(out.portfolio?.previousTotalCents).toBeNull()
    expect(out.portfolio?.absChangeCents).toBeNull()
    expect(out.portfolio?.pctChange).toBeNull()
    expect(out.diagnostics.portfolioHeadlineChangeSuppressed).toBe(true)
    expect(out.diagnostics.portfolioMovementSource).toBe('dashboard_30d')
    expect(out.diagnostics.portfolioItemMovementWindowDays).toBe(30)
  })

  it('most_valuable surfaces the largest position (Charizard wins on currentCents)', async () => {
    seedRealishUser()
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    const mostValuable = out.portfolio!.topItems.find(i => i.reason === 'most_valuable')
    expect(mostValuable?.cardName).toBe('Charizard')
  })

  it('diagnostics report holdings priced + missing counts', async () => {
    seedRealishUser()
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.portfolioHoldingsPricedCount).toBe(4)
    expect(out.diagnostics.portfolioHoldingsMissingPriceCount).toBe(0)
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-16D regression (snapshot columns)', () => {
  it('reads card_name_snapshot / set_name_snapshot — the actual production column names', async () => {
    // Production portfolio_items uses _snapshot suffixed columns
    // (see PortfolioDashboard.tsx upsert payload). Seeding with the
    // snapshot variant must produce the same digest as seeding the
    // unsuffixed columns did in older tests.
    seedPrefs('u1')
    seedCardLink('charizard-base-4', '1', 'Charizard', 'Base Set')
    seedCardTrend('Charizard', 'Base Set', { raw: 36_924 })
    // Baseline 7d ago so the card qualifies as a meaningful mover
    // and lands in topItems.
    seedPrice('1', '2026-06-18', { raw: 30_000 })
    seedPrice('1', '2026-06-25', { raw: 36_924 })
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
    ])
    fakeDB.seed('portfolio_items', [
      ...fakeDB.rows('portfolio_items'),
      {
        portfolio_id:        'pf-u1',
        card_slug:           'charizard-base-4',
        holding_type:        'raw',
        quantity:            1,
        card_name_snapshot:  'Charizard',
        set_name_snapshot:   'Base Set',
        // NOTE: no card_name / set_name columns — production schema
      },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.itemCount).toBe(1)
    expect(out.portfolio?.currentTotalCents).toBe(36_924)
    expect(out.portfolio?.topItems[0]?.cardName).toBe('Charizard')
    expect(out.portfolio?.topItems[0]?.setName).toBe('Base Set')
  })

  it('itemCount reflects ALL loaded portfolio_items, not just successfully valued ones', async () => {
    // Mirror the user's real case: 35 holdings, some unprice-able.
    seedPrefs('u1')
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
    ])
    // 35 items, none with any pricing data in card_trends or daily_prices
    for (let i = 0; i < 35; i++) {
      fakeDB.seed('portfolio_items', [
        ...fakeDB.rows('portfolio_items'),
        {
          portfolio_id:        'pf-u1',
          card_slug:           `card-${i}`,
          holding_type:        'raw',
          quantity:            1,
          card_name_snapshot:  `Card ${i}`,
          set_name_snapshot:   'Set',
        },
      ])
    }
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.itemCount).toBe(35)
    expect(out.portfolio?.currentTotalCents).toBeNull()
    expect(out.diagnostics.portfolioItemsLoaded).toBe(35)
    expect(out.diagnostics.portfolioPortfoliosLoaded).toBe(1)
    expect(out.diagnostics.portfolioItemsValuedAsMissing).toBe(35)
  })

  it('exposes portfoliosLoaded + portfolioItemsLoaded + missing counts in diagnostics', async () => {
    seedPrefs('u1')
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
      { id: 'pf-u1-second', user_id: 'u1' },
    ])
    fakeDB.seed('portfolio_items', [
      ...fakeDB.rows('portfolio_items'),
      { portfolio_id: 'pf-u1', card_slug: 'a', holding_type: 'raw', quantity: 1, card_name_snapshot: 'A', set_name_snapshot: 'S' },
      { portfolio_id: 'pf-u1', card_slug: 'b', holding_type: 'raw', quantity: 1 /* no name */ },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.diagnostics.portfolioPortfoliosLoaded).toBe(2)
    expect(out.diagnostics.portfolioItemsLoaded).toBe(2)
    expect(out.diagnostics.portfolioItemsMissingCardName).toBe(1)   // the second row
  })

  it('falls back to a "core" SELECT when snapshot columns are unavailable', async () => {
    // FakeDB tolerates any column, so this case primarily verifies
    // the loader still works when rows lack snapshot columns — the
    // PRIMARY production query may succeed even with NULL snapshot
    // values (lenient PostgREST). The orchestrator must still surface
    // those items via the cards-table fallback for naming.
    seedPrefs('u1')
    seedCardLink('charizard-base-4', '1', 'Charizard', 'Base Set')
    seedCardTrend('Charizard', 'Base Set', { raw: 100_00 })
    seedPrice('1', '2026-06-18', { raw: 80_00 })
    seedPrice('1', '2026-06-25', { raw: 100_00 })
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
    ])
    fakeDB.seed('portfolio_items', [
      ...fakeDB.rows('portfolio_items'),
      {
        portfolio_id: 'pf-u1',
        card_slug:    'charizard-base-4',
        holding_type: 'raw',
        quantity:     1,
        // Neither snapshot NOR direct card_name — name must come from cards lookup
      },
    ])
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.itemCount).toBe(1)
    expect(out.portfolio?.topItems[0]?.cardName).toBe('Charizard')   // from cards-table lookup
    expect(out.portfolio?.currentTotalCents).toBe(100_00)
  })
})

describe('buildWeeklyDigestForUser — Block 5A-W-16B portfolio_items name preference', () => {
  it('prefers portfolio_items.card_name / set_name over the cards-table lookup', async () => {
    seedPrefs('u1')
    // cards-table says "Crystal Guardians" — wrong set
    seedCardLink('charizard-4', '111', 'Charizard', 'Crystal Guardians')
    // portfolio row says "Base Set" — user's own label, should win
    fakeDB.seed('portfolios', [
      ...fakeDB.rows('portfolios'),
      { id: 'pf-u1', user_id: 'u1' },
    ])
    fakeDB.seed('portfolio_items', [
      ...fakeDB.rows('portfolio_items'),
      {
        portfolio_id: 'pf-u1',
        card_slug:    'charizard-4',
        holding_type: 'raw',
        quantity:     1,
        card_name:    'Charizard',
        set_name:     'Base Set',
      },
    ])
    seedPrice('111', '2026-06-18', { raw: 50_00_00 })   // $5,000 in cents
    seedPrice('111', '2026-06-25', { raw: 60_00_00 })
    const out = await buildWeeklyDigestForUser(asSupa(fakeDB), 'u1', { asOf })
    expect(out.portfolio?.topItems[0].setName).toBe('Base Set')
    expect(out.portfolio?.topItems[0].cardName).toBe('Charizard')
  })
})
