// Block 5A-W-50F/FIX4 — service-level tests proving computeValueHistory
// correctly includes holdings that no longer exist in portfolio_items.
// Uses a fake Supabase client that returns:
//   * zero current portfolio_items rows (holding deleted);
//   * a complete event chain for the deleted holding;
//   * historical daily_prices for that card.
//
// Confirms:
//   1. computeValueHistory derives the card-slug universe from the
//      event ledger (not from current portfolio_items alone);
//   2. daily_prices IS queried for the deleted holding's pc-slug;
//   3. the reconstruction shows the holding's value while held and
//      zero after removal;
//   4. two deleted holdings with different holding_instance_ids
//      remain separate.

import { describe, it, expect, vi } from 'vitest'
import { computeValueHistory, toPricingKey } from '../valueHistory'

// Small helper to build a fake Supabase that records the daily_prices
// queries it received (specifically the slug list passed to `.in()`).
function makeFakeSupabase(opts: {
  events: any[]
  currentHoldings: any[]
  dailyPrices: any[]
}) {
  const dailyPricesCalls: { slugs: string[]; from: string; to: string }[] = []
  return {
    calls: dailyPricesCalls,
    client: {
      from: (table: string) => {
        if (table === 'portfolio_item_events') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  order: () => ({
                    range: async (from: number, to: number) => ({
                      data: opts.events.slice(from, to + 1),
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'portfolio_items') {
          return {
            select: () => ({
              eq: () => ({
                range: async (from: number, to: number) => ({
                  data: opts.currentHoldings.slice(from, to + 1),
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'daily_prices') {
          return {
            select: () => ({
              in: (_col: string, slugs: string[]) => ({
                gte: (_c: string, fromDate: string) => ({
                  lte: (_c: string, toDate: string) => ({
                    range: async (from: number, to: number) => {
                      dailyPricesCalls.push({ slugs, from: fromDate, to: toDate })
                      const filtered = opts.dailyPrices.filter(r => slugs.includes(r.card_slug))
                      return { data: filtered.slice(from, to + 1), error: null }
                    },
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      },
    } as any,
  }
}

const now = new Date('2026-08-02T00:00:00Z')

// Small helper to build events with the FIX3/FIX4 shape.
let evOrder = 0
function ev(overrides: Partial<any>) {
  evOrder += 1
  return {
    id: 'e-' + evOrder,
    portfolio_item_id:   'inst-A',
    holding_instance_id: 'inst-A',
    card_slug:           '959616',
    set_name_snapshot:   'Chaotic Swell',
    holding_type:        'raw',
    event_type:          'holding_added',
    quantity_delta:      1,
    event_date:          '2026-07-01',
    market_value_cents_at_event: null,
    sale_proceeds_cents: null,
    currency:            'USD',
    is_estimated:        false,
    metadata:            {},
    event_order:         evOrder,
    ...overrides,
  }
}

describe('computeValueHistory — deleted holdings', () => {
  it('queries daily_prices for a deleted holding even when no current portfolio_items row exists', async () => {
    // Scenario: user added 1 raw card on 2026-07-01, removed it on
    // 2026-07-20. On 2026-08-02 there is NO current portfolio_items
    // row for this card. The graph must still show its value between
    // 2026-07-01 and 2026-07-20.
    const events = [
      ev({ event_type: 'holding_added',   event_date: '2026-07-01', quantity_delta: 1 }),
      ev({ event_type: 'holding_removed', event_date: '2026-07-20', quantity_delta: -1, portfolio_item_id: null }),
    ]
    const prices = [
      { card_slug: 'pc-959616', date: '2026-07-01', raw_usd: 100 },
      { card_slug: 'pc-959616', date: '2026-07-10', raw_usd: 130 },
      { card_slug: 'pc-959616', date: '2026-07-20', raw_usd: 150 },
    ]
    const fake = makeFakeSupabase({ events, currentHoldings: [], dailyPrices: prices })
    const result = await computeValueHistory({
      supabase: fake.client, portfolioId: 'p-1', range: '90D', currency: 'USD', now,
    })

    // (a) daily_prices was queried with the deleted holding's pc-slug.
    expect(fake.calls.length).toBeGreaterThan(0)
    expect(fake.calls[0].slugs).toContain(toPricingKey('959616'))

    // (b) The fetch completed successfully (no integrity failure).
    expect(result.isComplete).toBe(true)
    expect(result.warnings).toEqual([])

    // (c) At least one bucket while held has a positive value, and
    //     the final bucket (post-removal) has zero.
    const heldBucket = result.points.find(p => p.date === '2026-07-10')
    const finalBucket = result.points[result.points.length - 1]
    expect(heldBucket?.endingValueCents).toBeGreaterThan(0)
    expect(finalBucket?.endingValueCents).toBe(0)

    // (d) Total removals across the range is positive (the sale is
    //     recorded in the attribution even though the holding is gone).
    expect(result.cumulativeRemovalsCents).toBeGreaterThan(0)
  })

  it('a deleted graded holding fetches the correct grade column (psa10)', async () => {
    const events = [
      ev({ event_type: 'holding_added',   event_date: '2026-07-05', quantity_delta: 1, holding_type: 'psa10' }),
      ev({ event_type: 'holding_removed', event_date: '2026-07-25', quantity_delta: -1, holding_type: 'psa10', portfolio_item_id: null }),
    ]
    const prices = [
      { card_slug: 'pc-959616', date: '2026-07-05', raw_usd: 100, psa10_usd: 1500 },
      { card_slug: 'pc-959616', date: '2026-07-15', raw_usd: 110, psa10_usd: 1700 },
    ]
    const fake = makeFakeSupabase({ events, currentHoldings: [], dailyPrices: prices })
    const result = await computeValueHistory({
      supabase: fake.client, portfolioId: 'p-1', range: '90D', currency: 'USD', now,
    })
    // The mid-range bucket must use the psa10_usd column value.
    const mid = result.points.find(p => p.date === '2026-07-15')
    expect(mid?.endingValueCents).toBe(1700)
  })

  it('a deleted MANUAL-valued holding needs no current portfolio row + no daily_prices row', async () => {
    // Add a holding with manual value only; delete it; portfolio_items
    // is empty; daily_prices has NO row for this card. The chart
    // must still show the manual value while held.
    const events = [
      ev({
        event_type: 'holding_added', event_date: '2026-07-05', quantity_delta: 1,
        metadata: { source: 'trigger', initial_manual_value_cents: 8000 },
      }),
      ev({
        event_type: 'holding_removed', event_date: '2026-07-25',
        quantity_delta: -1, portfolio_item_id: null,
      }),
    ]
    const fake = makeFakeSupabase({ events, currentHoldings: [], dailyPrices: [] })
    const result = await computeValueHistory({
      supabase: fake.client, portfolioId: 'p-1', range: '90D', currency: 'USD', now,
    })
    expect(result.isComplete).toBe(true)
    const heldBucket = result.points.find(p => p.date === '2026-07-15')
    expect(heldBucket?.endingValueCents).toBe(8000)
    const finalBucket = result.points[result.points.length - 1]
    expect(finalBucket?.endingValueCents).toBe(0)
  })

  it('two deleted holdings with different holding_instance_id remain separate', async () => {
    const events = [
      ev({ event_type: 'holding_added',   event_date: '2026-07-01', quantity_delta: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A' }),
      ev({ event_type: 'holding_removed', event_date: '2026-07-05', quantity_delta: -1,
           holding_instance_id: 'inst-A', portfolio_item_id: null }),
      ev({ event_type: 'holding_added',   event_date: '2026-07-10', quantity_delta: 2,
           holding_instance_id: 'inst-B', portfolio_item_id: 'inst-B' }),
      ev({ event_type: 'holding_removed', event_date: '2026-07-15', quantity_delta: -2,
           holding_instance_id: 'inst-B', portfolio_item_id: null }),
    ]
    const prices = [
      { card_slug: 'pc-959616', date: '2026-07-01', raw_usd: 100 },
      { card_slug: 'pc-959616', date: '2026-07-05', raw_usd: 110 },
      { card_slug: 'pc-959616', date: '2026-07-10', raw_usd: 120 },
      { card_slug: 'pc-959616', date: '2026-07-15', raw_usd: 130 },
    ]
    const fake = makeFakeSupabase({ events, currentHoldings: [], dailyPrices: prices })
    const result = await computeValueHistory({
      supabase: fake.client, portfolioId: 'p-1', range: '90D', currency: 'USD', now,
    })
    // Bucket while ONLY inst-A held: 1 * 100c-ish.
    const early = result.points.find(p => p.date === '2026-07-01')
    expect(early?.endingValueCents).toBe(100)
    // Bucket while ONLY inst-B held (2 copies): 2 * ~120c.
    const middle = result.points.find(p => p.date === '2026-07-10')
    expect(middle?.endingValueCents).toBe(240)
    // Final bucket: nothing held.
    const final = result.points[result.points.length - 1]
    expect(final?.endingValueCents).toBe(0)
  })
})
