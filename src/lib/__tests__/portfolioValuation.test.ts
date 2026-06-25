// Block 5A-W-16C — shared portfolio valuation helper.
//
// Covers source precedence (card_trends → daily_prices → manual →
// missing), per-grade column selection, quantity handling, duplicate
// rows, source bucket counts, headline total math, and the read-only
// guarantee (no DB mutations).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

import { valuePortfolio, type ValuationHolding } from '../portfolioValuation'

const fakeDB = new FakeDB()

beforeEach(() => { fakeDB.reset() })

// Tiny seed helpers ───────────────────────────────────────────────────

function seedCardLink(urlSlug: string, bare: string, cardName: string, setName: string) {
  fakeDB.seed('cards', [
    ...fakeDB.rows('cards'),
    { card_url_slug: urlSlug, card_slug: bare, card_name: cardName, set_name: setName },
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

function seedDailyPrice(bare: string, date: string, prices: Record<string, number | null>) {
  fakeDB.seed('daily_prices', [
    ...fakeDB.rows('daily_prices'),
    { card_slug: 'pc-' + bare, date, raw_usd: null, psa9_usd: null, psa10_usd: null, ...prices },
  ])
}

function h(over: Partial<ValuationHolding>): ValuationHolding {
  return {
    card_slug:    over.card_slug ?? 'slug',
    card_name:    over.card_name ?? null,
    set_name:     over.set_name  ?? null,
    holding_type: over.holding_type ?? 'raw',
    quantity:     over.quantity ?? 1,
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Empty input
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — empty input', () => {
  it('returns zero totals and empty buckets', async () => {
    const r = await valuePortfolio(asSupa(fakeDB), [])
    expect(r.items).toEqual([])
    expect(r.marketTotalCents).toBe(0)
    expect(r.itemCount).toBe(0)
    expect(r.sourceCounts).toEqual({ card_trends: 0, daily_prices: 0, manual: 0, missing: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Precedence — card_trends for raw/psa9/psa10
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — card_trends precedence for raw/psa9/psa10', () => {
  it('uses card_trends.current_raw for a raw holding', async () => {
    seedCardLink('charizard-base-4', '1450205', 'Charizard', 'Base Set')
    seedCardTrend('Charizard', 'Base Set', { raw: 290_74, psa10: 5_000_00 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'charizard-base-4', card_name: 'Charizard', set_name: 'Base Set', holding_type: 'raw' }),
    ])
    expect(r.items[0].marketValueCents).toBe(290_74)
    expect(r.items[0].source).toBe('card_trends')
    expect(r.marketTotalCents).toBe(290_74)
    expect(r.sourceCounts.card_trends).toBe(1)
  })

  it('uses card_trends.current_psa9 for a psa9 holding', async () => {
    seedCardLink('dark-hypno-9', '9000', 'Dark Hypno', 'Team Rocket')
    seedCardTrend('Dark Hypno', 'Team Rocket', { raw: 10_00, psa9: 67_32, psa10: 200_00 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'dark-hypno-9', card_name: 'Dark Hypno', set_name: 'Team Rocket', holding_type: 'psa9' }),
    ])
    expect(r.items[0].marketValueCents).toBe(67_32)
    expect(r.items[0].source).toBe('card_trends')
  })

  it('uses card_trends.current_psa10 for a psa10 holding', async () => {
    seedCardLink('chien-pao-54', '5400', 'Chien-Pao', 'Set')
    seedCardTrend('Chien-Pao', 'Set', { raw: 91, psa10: 12_500 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'chien-pao-54', card_name: 'Chien-Pao', set_name: 'Set', holding_type: 'psa10' }),
    ])
    expect(r.items[0].marketValueCents).toBe(12_500)
  })

  it('falls through to daily_prices when card_trends does not have the value', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-25', { raw_usd: 555 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'raw' }),
    ])
    expect(r.items[0].source).toBe('daily_prices')
    expect(r.items[0].marketValueCents).toBe(555)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Precedence — daily_prices for extra tiers
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — daily_prices for extra tiers', () => {
  it('uses cgc10_usd for a cgc10 holding', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-25', { cgc10_usd: 700_00, psa10_usd: 600_00 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'cgc10' }),
    ])
    expect(r.items[0].marketValueCents).toBe(700_00)
    expect(r.items[0].source).toBe('daily_prices')
  })

  it('uses bgs10black_usd for a bgs10black holding', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-25', { bgs10black_usd: 1_200_00 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'bgs10black' }),
    ])
    expect(r.items[0].marketValueCents).toBe(1_200_00)
  })

  it('uses sgc10_usd for sgc10, tag10_usd for tag10, ace10_usd for ace10', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-25', {
      sgc10_usd: 100, tag10_usd: 200, ace10_usd: 300,
    })
    const sgc = await valuePortfolio(asSupa(fakeDB), [h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'sgc10' })])
    const tag = await valuePortfolio(asSupa(fakeDB), [h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'tag10' })])
    const ace = await valuePortfolio(asSupa(fakeDB), [h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'ace10' })])
    expect(sgc.items[0].marketValueCents).toBe(100)
    expect(tag.items[0].marketValueCents).toBe(200)
    expect(ace.items[0].marketValueCents).toBe(300)
  })

  it('uses grade1_usd…grade6_usd for low-grade PSA holdings', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-25', {
      grade1_usd: 11, grade2_usd: 22, grade3_usd: 33,
      grade4_usd: 44, grade5_usd: 55, grade6_usd: 66,
    })
    for (const [ht, expected] of [
      ['psa1', 11], ['psa2', 22], ['psa3', 33],
      ['psa4', 44], ['psa5', 55], ['psa6', 66],
    ] as Array<[string, number]>) {
      const r = await valuePortfolio(asSupa(fakeDB), [h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: ht })])
      expect(r.items[0].marketValueCents).toBe(expected)
    }
  })

  it('falls back to (card_name, set_name) lookup when URL slug does not match a cards row', async () => {
    // No cards row for 'drifted-slug', but the (name, set) lookup
    // finds the numeric slug and resolves the price.
    fakeDB.seed('cards', [
      { card_url_slug: 'totally-different', card_slug: '111', card_name: 'A', set_name: 'S' },
    ])
    seedDailyPrice('111', '2026-06-25', { cgc10_usd: 999 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'drifted-slug', card_name: 'A', set_name: 'S', holding_type: 'cgc10' }),
    ])
    expect(r.items[0].marketValueCents).toBe(999)
    expect(r.items[0].source).toBe('daily_prices')
  })

  it('uses the most recent daily_prices row per card (latest date wins)', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedDailyPrice('111', '2026-06-18', { cgc10_usd: 500_00 })
    seedDailyPrice('111', '2026-06-25', { cgc10_usd: 750_00 })   // latest
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'cgc10' }),
    ])
    expect(r.items[0].marketValueCents).toBe(750_00)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Manual override + missing
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — manual override + missing', () => {
  it('reports manual override as effective value but EXCLUDES it from the market total', async () => {
    seedCardLink('a', '111', 'A', 'S')
    // No card_trends, no daily_prices for this holding type
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({
        card_slug: 'a', card_name: 'A', set_name: 'S',
        holding_type: 'bgs9',         // manual grade (no price column)
        manual_value_cents: 50_00,
      }),
    ])
    expect(r.items[0].source).toBe('manual')
    expect(r.items[0].effectiveValueCents).toBe(50_00)
    expect(r.items[0].marketValueCents).toBeNull()
    expect(r.items[0].positionValueCents).toBeNull()
    expect(r.marketTotalCents).toBe(0)            // matches dashboard headline behaviour
    expect(r.sourceCounts.manual).toBe(1)
  })

  it('reports source=missing when no source resolves the card', async () => {
    seedCardLink('a', '111', 'A', 'S')
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'bgs9' }),
    ])
    expect(r.items[0].source).toBe('missing')
    expect(r.items[0].marketValueCents).toBeNull()
    expect(r.items[0].effectiveValueCents).toBeNull()
    expect(r.items[0].positionValueCents).toBeNull()
    expect(r.sourceCounts.missing).toBe(1)
  })

  it('a 0 or negative manual override is treated as no override (falls through)', async () => {
    seedCardLink('a', '111', 'A', 'S')
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({
        card_slug: 'a', card_name: 'A', set_name: 'S',
        holding_type: 'bgs9', manual_value_cents: 0,
      }),
    ])
    expect(r.items[0].source).toBe('missing')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Quantity + duplicates + headline total
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — quantity + headline total', () => {
  it('multiplies position value by quantity for the headline total', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedCardTrend('A', 'S', { raw: 1000 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'raw', quantity: 3 }),
    ])
    expect(r.items[0].marketValueCents).toBe(1000)
    expect(r.items[0].positionValueCents).toBe(3000)
    expect(r.marketTotalCents).toBe(3000)
    expect(r.itemCount).toBe(3)
  })

  it('counts every portfolio_items row separately in headline total (duplicates included)', async () => {
    seedCardLink('a', '111', 'Charizard', 'Base')
    seedCardTrend('Charizard', 'Base', { raw: 200_00, psa10: 5_000_00 })
    // Same user holding two rows on the same card: a raw copy and a psa10
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'Charizard', set_name: 'Base', holding_type: 'raw',   quantity: 1 }),
      h({ card_slug: 'a', card_name: 'Charizard', set_name: 'Base', holding_type: 'psa10', quantity: 1 }),
    ])
    expect(r.items[0].marketValueCents).toBe(200_00)
    expect(r.items[1].marketValueCents).toBe(5_000_00)
    expect(r.marketTotalCents).toBe(200_00 + 5_000_00)
  })

  it('mixed-source portfolio fixture matches expected headline total', async () => {
    // A realistic mix: raw + psa9 from card_trends, cgc10 from daily_prices,
    // bgs9 manual override (excluded from total), an unresolved row (missing).
    seedCardLink('crz-base-4',  '1', 'Charizard',  'Base Set')
    seedCardLink('dark-hypno-9','2', 'Dark Hypno', 'Team Rocket')
    seedCardLink('blastoise-2', '3', 'Blastoise',  'Base Set')
    seedCardLink('venusaur-15', '4', 'Venusaur',   'Base Set')
    seedCardLink('mr-mime-6',   '5', 'Mr. Mime',   'Jungle')
    seedCardTrend('Charizard',  'Base Set',    { raw: 290_74, psa10: 5_000_00 })
    seedCardTrend('Dark Hypno', 'Team Rocket', { psa9: 67_32 })
    seedDailyPrice('3', '2026-06-25', { cgc10_usd: 1_200_00 })
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'crz-base-4',   card_name: 'Charizard',  set_name: 'Base Set',    holding_type: 'raw',   quantity: 1 }),
      h({ card_slug: 'dark-hypno-9', card_name: 'Dark Hypno', set_name: 'Team Rocket', holding_type: 'psa9',  quantity: 1 }),
      h({ card_slug: 'blastoise-2',  card_name: 'Blastoise',  set_name: 'Base Set',    holding_type: 'cgc10', quantity: 1 }),
      h({ card_slug: 'venusaur-15',  card_name: 'Venusaur',   set_name: 'Base Set',    holding_type: 'bgs9',  quantity: 1, manual_value_cents: 999_99 }),
      h({ card_slug: 'mr-mime-6',    card_name: 'Mr. Mime',   set_name: 'Jungle',      holding_type: 'cgc8',  quantity: 1 }),  // manual grade, no override
    ])
    expect(r.marketTotalCents).toBe(290_74 + 67_32 + 1_200_00)   // 1_558_06 USD-cents
    expect(r.sourceCounts).toEqual({
      card_trends: 2, daily_prices: 1, manual: 1, missing: 1,
    })
    // Manual override appears as effective per-card BUT not in the headline.
    const venusaur = r.items[3]
    expect(venusaur.effectiveValueCents).toBe(999_99)
    expect(venusaur.positionValueCents).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Currency / unit semantics
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — unit semantics', () => {
  it('treats card_trends + daily_prices column values as USD-cents (no ×100)', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedCardTrend('A', 'S', { raw: 12_345 })   // 12_345 USD-cents = $123.45
    const r = await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'raw' }),
    ])
    expect(r.items[0].marketValueCents).toBe(12_345)   // NOT 1_234_500
    expect(r.marketTotalCents).toBe(12_345)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Read-only guarantee
// ─────────────────────────────────────────────────────────────────────

describe('valuePortfolio — read-only', () => {
  it('does not insert or update any rows', async () => {
    seedCardLink('a', '111', 'A', 'S')
    seedCardTrend('A', 'S', { raw: 500 })
    seedDailyPrice('111', '2026-06-25', { cgc10_usd: 750 })
    const snap = {
      cards:    JSON.stringify(fakeDB.rows('cards')),
      trends:   JSON.stringify(fakeDB.rows('card_trends')),
      prices:   JSON.stringify(fakeDB.rows('daily_prices')),
    }
    await valuePortfolio(asSupa(fakeDB), [
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'raw' }),
      h({ card_slug: 'a', card_name: 'A', set_name: 'S', holding_type: 'cgc10' }),
    ])
    expect(JSON.stringify(fakeDB.rows('cards'))).toBe(snap.cards)
    expect(JSON.stringify(fakeDB.rows('card_trends'))).toBe(snap.trends)
    expect(JSON.stringify(fakeDB.rows('daily_prices'))).toBe(snap.prices)
  })
})
