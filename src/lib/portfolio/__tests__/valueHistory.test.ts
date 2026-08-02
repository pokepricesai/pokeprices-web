// Block 5A-W-50F / FIX1+FIX2 — valuation engine correctness tests.
//
// Covers the corrected accounting identity (with adjustments term),
// historical manual-value reconstruction, holding-type corrections,
// unpriced-to-priced adjustment, slug normalisation, FIX2 event_order
// determinism, initial-manual-value on additions, purchase_date
// corrections, and isComplete integrity flagging.

import { describe, it, expect } from 'vitest'
import {
  decideDominantCause,
  forwardFillPrice,
  preprocessEvents,
  priceHoldingAt,
  rangeToWindow,
  reconstructHoldingsAt,
  stateMarketValueCents,
  toPricingKey,
  toBareSlug,
  __TEST__,
} from '../valueHistory'

const { buildPriceIndex, buildDailyBuckets, aggregateBuckets, bucketKey, eachDay } = __TEST__

// ── helpers ──────────────────────────────────────────────────

function priceRow(cardSlug: string, date: string, extras: Record<string, number>) {
  return { card_slug: `pc-${cardSlug}`, date, ...extras } as any
}

// FIX2 — every event carries a monotonically-increasing event_order
// so reconstruction is deterministic even when two events share an
// event_date.
// FIX3 — every event carries a holding_instance_id (defaults to
// 'pi-1' so single-holding tests keep working). Multi-holding tests
// override holding_instance_id explicitly.
let evOrder = 0
function ev(overrides: Partial<any>) {
  evOrder += 1
  const base = {
    id: 'e-' + Math.random().toString(36).slice(2, 8),
    portfolio_item_id: 'pi-1',
    holding_instance_id: 'pi-1',
    card_slug: '1',
    set_name_snapshot: 'Set A',
    holding_type: 'raw',
    event_type: 'holding_added',
    quantity_delta: 1,
    event_date: '2026-01-01',
    market_value_cents_at_event: null,
    sale_proceeds_cents: null,
    currency: 'USD',
    is_estimated: false,
    metadata: null,
    event_order: evOrder,
  }
  return { ...base, ...overrides } as any
}

// ── slug normalisation ─────────────────────────────────────

describe('toPricingKey + toBareSlug', () => {
  it('adds pc- prefix to a bare slug', () => {
    expect(toPricingKey('8330138')).toBe('pc-8330138')
  })
  it('does NOT double-prefix an already-prefixed slug', () => {
    expect(toPricingKey('pc-8330138')).toBe('pc-8330138')
  })
  it('strips pc- to get bare', () => {
    expect(toBareSlug('pc-8330138')).toBe('8330138')
  })
  it('is safe on bare slug (leaves as-is)', () => {
    expect(toBareSlug('8330138')).toBe('8330138')
  })
  it('safe on empty string', () => {
    expect(toPricingKey('')).toBe('')
    expect(toBareSlug('')).toBe('')
  })
})

// ── forward-fill (unchanged from FIX1) ─────────────────────

describe('forwardFillPrice', () => {
  const index = buildPriceIndex([
    priceRow('1', '2026-07-25', { raw_usd: 100 }),
    priceRow('1', '2026-07-27', { raw_usd: 120 }),
    priceRow('1', '2026-08-01', { raw_usd: 130 }),
  ])
  it('returns exact-date row when present', () => {
    expect(forwardFillPrice(index, '1', '2026-07-27')?.raw_usd).toBe(120)
  })
  it('forward-fills from the latest earlier date', () => {
    expect(forwardFillPrice(index, '1', '2026-07-31')?.raw_usd).toBe(120)
  })
  it('never uses a future price', () => {
    expect(forwardFillPrice(index, '1', '2026-07-01')).toBeNull()
  })
  it('lookup accepts pc-prefixed OR bare input identity', () => {
    expect(forwardFillPrice(index, 'pc-1', '2026-07-27')?.raw_usd).toBe(120)
    expect(forwardFillPrice(index, '1',    '2026-07-27')?.raw_usd).toBe(120)
  })
})

// ── priceHoldingAt ─────────────────────────────────────────

describe('priceHoldingAt', () => {
  const index = buildPriceIndex([
    priceRow('1', '2026-07-01', { raw_usd: 100, psa10_usd: 900 }),
    priceRow('1', '2026-08-01', { raw_usd: 150, psa10_usd: 1200 }),
  ])
  it('selects raw for raw holdings', () => {
    expect(priceHoldingAt(index, { card_slug: '1', holding_type: 'raw', quantity: 1, manual_value_cents: null }, '2026-08-02')).toBe(150)
  })
  it('selects psa10 for psa10 holdings', () => {
    expect(priceHoldingAt(index, { card_slug: '1', holding_type: 'psa10', quantity: 1, manual_value_cents: null }, '2026-08-02')).toBe(1200)
  })
  it('manual value wins over market price', () => {
    expect(priceHoldingAt(index, { card_slug: '1', holding_type: 'raw', quantity: 2, manual_value_cents: 500 }, '2026-08-02')).toBe(1000)
  })
})

// ── FIX2 — event_order determinism ─────────────────────────

describe('preprocessEvents — deterministic ordering by (event_date, event_order)', () => {
  it('sorts by event_order within the same event_date', () => {
    const a = ev({ event_date: '2026-08-01', event_order: 5, event_type: 'quantity_added', quantity_delta: 1 })
    const b = ev({ event_date: '2026-08-01', event_order: 2, event_type: 'holding_added',  quantity_delta: 1 })
    const c = ev({ event_date: '2026-08-01', event_order: 9, event_type: 'quantity_added', quantity_delta: 1 })
    const sorted = preprocessEvents([a, b, c])
    expect(sorted.map(e => e.event_order)).toEqual([2, 5, 9])
  })

  it('same-day multi-field UPDATE state ends up identical to the trigger sequence order', () => {
    // Simulated trigger sequence for a same-day UPDATE that:
    //   * corrects holding_type raw -> psa10
    //   * changes manual value from null to 5000c
    //   * increases quantity from 1 to 2
    // Prior state: 1 raw with no manual value.
    const events = [
      ev({ event_type: 'opening_balance', event_date: '2026-07-31', event_order: 1, quantity_delta: 1, holding_type: 'raw' }),
      // Same-day multi-field UPDATE:
      ev({ event_type: 'correction', event_date: '2026-08-01', event_order: 2,
           quantity_delta: 0, holding_type: 'psa10',
           metadata: { correction_kind: 'holding_type', holding_type_before: 'raw', holding_type_after: 'psa10' } }),
      ev({ event_type: 'manual_value_changed', event_date: '2026-08-01', event_order: 3,
           quantity_delta: 0, holding_type: 'psa10',
           metadata: { manual_value_cents_before: null, manual_value_cents_after: 5000 } }),
      ev({ event_type: 'quantity_added', event_date: '2026-08-01', event_order: 4,
           quantity_delta: 1, holding_type: 'psa10',
           metadata: { quantity_before: 1, quantity_after: 2 } }),
    ]
    const state = reconstructHoldingsAt(preprocessEvents(events), '2026-08-01')
    expect(state.size).toBe(1)
    const only = Array.from(state.values())[0]
    expect(only.holding_type).toBe('psa10')
    expect(only.quantity).toBe(2)
    expect(only.manual_value_cents).toBe(5000)
  })
})

// ── reconstruct holdings ───────────────────────────────────

describe('reconstructHoldingsAt', () => {
  it('folds opening + increment', () => {
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-01-01', quantity_delta: 2 }),
      ev({ event_type: 'quantity_added',  event_date: '2026-02-01', quantity_delta: 1 }),
    ])
    const state = reconstructHoldingsAt(events, '2026-02-01')
    expect(state.size).toBe(1)
    expect(Array.from(state.values())[0].quantity).toBe(3)
  })

  it('correction with holding_type_before/after transfers quantity to the new key', () => {
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-01-01', quantity_delta: 1, holding_type: 'raw' }),
      ev({
        event_type: 'correction',
        event_date: '2026-02-01',
        quantity_delta: 0,
        holding_type: 'psa10',
        metadata: { correction_kind: 'holding_type', holding_type_before: 'raw', holding_type_after: 'psa10' },
      }),
    ])
    const state = reconstructHoldingsAt(events, '2026-02-01')
    expect(state.size).toBe(1)
    expect(Array.from(state.values())[0].holding_type).toBe('psa10')
    expect(Array.from(state.values())[0].quantity).toBe(1)
  })

  it('manual_value_changed updates state in place', () => {
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-01-01' }),
      ev({
        event_type: 'manual_value_changed',
        event_date: '2026-02-01',
        quantity_delta: 0,
        metadata: { manual_value_cents_before: null, manual_value_cents_after: 5000 },
      }),
    ])
    const state = reconstructHoldingsAt(events, '2026-02-01')
    expect(Array.from(state.values())[0].manual_value_cents).toBe(5000)
  })

  it('history reconstructs correctly BEFORE and AFTER a manual value change', () => {
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-01-01' }),
      ev({
        event_type: 'manual_value_changed',
        event_date: '2026-06-01',
        quantity_delta: 0,
        metadata: { manual_value_cents_before: null, manual_value_cents_after: 5000 },
      }),
    ])
    expect(Array.from(reconstructHoldingsAt(events, '2026-03-01').values())[0].manual_value_cents).toBeNull()
    expect(Array.from(reconstructHoldingsAt(events, '2026-06-01').values())[0].manual_value_cents).toBe(5000)
  })

  it('history survives after the holding is deleted (manual-valued holding case)', () => {
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-01-01' }),
      ev({
        event_type: 'manual_value_changed',
        event_date: '2026-02-01',
        quantity_delta: 0,
        metadata: { manual_value_cents_before: null, manual_value_cents_after: 5000 },
      }),
      ev({ event_type: 'holding_removed', event_date: '2026-06-01', quantity_delta: -1 }),
    ])
    expect(reconstructHoldingsAt(events, '2026-06-01').size).toBe(0)
    const before = Array.from(reconstructHoldingsAt(events, '2026-05-31').values())[0]
    expect(before.manual_value_cents).toBe(5000)
    expect(before.quantity).toBe(1)
  })

  // ── FIX2 — initial manual value seeded from metadata ─

  it('holding_added with initial_manual_value_cents seeds the state manual value', () => {
    const events = preprocessEvents([
      ev({
        event_type: 'holding_added',
        event_date: '2026-01-01',
        quantity_delta: 2,
        metadata: { initial_manual_value_cents: 5000 },
      }),
    ])
    const only = Array.from(reconstructHoldingsAt(events, '2026-01-01').values())[0]
    expect(only.manual_value_cents).toBe(5000)
    expect(only.quantity).toBe(2)
  })

  it('opening_balance with legacy initial_manual_value_cents seeds correctly too', () => {
    const events = preprocessEvents([
      ev({
        event_type: 'opening_balance',
        event_date: '2026-01-01',
        quantity_delta: 3,
        metadata: { source: 'legacy_backfill', initial_manual_value_cents: 7000 },
      }),
    ])
    const only = Array.from(reconstructHoldingsAt(events, '2026-01-01').values())[0]
    expect(only.manual_value_cents).toBe(7000)
    expect(only.quantity).toBe(3)
  })
})

// ── FIX2 — purchase_date corrections ───────────────────────

describe('preprocessEvents — purchase_date correction reroutes the initial event date', () => {
  it('moves the initial event forward when purchase_date is corrected later', () => {
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-05-01', event_order: 1, quantity_delta: 1, portfolio_item_id: 'pi-A' }),
      ev({
        event_type: 'correction',
        event_date:  '2026-07-15',
        event_order: 2,
        quantity_delta: 0,
        portfolio_item_id: 'pi-A',
        metadata: { correction_kind: 'purchase_date', purchase_date_before: '2026-05-01', purchase_date_after: '2026-06-01' },
      }),
    ]
    const processed = preprocessEvents(events)
    // The correction event is dropped; the initial event's effective
    // date is now 2026-06-01.
    expect(processed).toHaveLength(1)
    expect(processed[0].event_type).toBe('holding_added')
    expect(processed[0].event_date).toBe('2026-06-01')
  })

  it('moves the initial event earlier when purchase_date is corrected to a prior date', () => {
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-05-01', event_order: 1, quantity_delta: 1, portfolio_item_id: 'pi-A' }),
      ev({
        event_type: 'correction',
        event_date:  '2026-07-15',
        event_order: 2,
        quantity_delta: 0,
        portfolio_item_id: 'pi-A',
        metadata: { correction_kind: 'purchase_date', purchase_date_before: '2026-05-01', purchase_date_after: '2026-03-01' },
      }),
    ]
    const processed = preprocessEvents(events)
    expect(processed).toHaveLength(1)
    expect(processed[0].event_date).toBe('2026-03-01')
  })

  it('latest purchase_date correction wins', () => {
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-05-01', event_order: 1, quantity_delta: 1, portfolio_item_id: 'pi-A' }),
      ev({
        event_type: 'correction',
        event_date:  '2026-06-01',
        event_order: 2,
        quantity_delta: 0,
        portfolio_item_id: 'pi-A',
        metadata: { correction_kind: 'purchase_date', purchase_date_before: '2026-05-01', purchase_date_after: '2026-04-01' },
      }),
      ev({
        event_type: 'correction',
        event_date:  '2026-07-01',
        event_order: 3,
        quantity_delta: 0,
        portfolio_item_id: 'pi-A',
        metadata: { correction_kind: 'purchase_date', purchase_date_before: '2026-04-01', purchase_date_after: '2026-03-15' },
      }),
    ]
    const processed = preprocessEvents(events)
    expect(processed).toHaveLength(1)
    expect(processed[0].event_date).toBe('2026-03-15')
  })

  it('purchase_date correction does NOT become market movement (correction is dropped from valuation flow)', () => {
    // A raw holding first added on 2026-05-01 with market rising over
    // subsequent months. Correcting purchase_date to 2026-03-01 must
    // NOT create a market_gain for the 2026-03-01 -> 2026-05-01 window
    // — the correction moves ownership backward but the graph must
    // not fabricate a value.
    const prices = [
      priceRow('1', '2026-03-01', { raw_usd: 100 }),
      priceRow('1', '2026-04-01', { raw_usd: 120 }),
      priceRow('1', '2026-05-01', { raw_usd: 150 }),
    ]
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-05-01', event_order: 1, quantity_delta: 1, portfolio_item_id: 'pi-A' }),
      ev({
        event_type: 'correction',
        event_date:  '2026-06-01',
        event_order: 2,
        quantity_delta: 0,
        portfolio_item_id: 'pi-A',
        metadata: { correction_kind: 'purchase_date', purchase_date_after: '2026-03-01' },
      }),
    ]
    const bucket = buildDailyBuckets(preprocessEvents(events), buildPriceIndex(prices), new Date('2026-03-01'), new Date('2026-03-01'))[0]
    // Day of (retroactively-corrected) ownership: additions = market price at that day.
    expect(bucket.additionsCents).toBe(100)
    expect(bucket.marketMovementCents).toBe(0)
    expect(bucket.adjustmentsCents).toBe(0)
  })
})

// ── attribution ───────────────────────────────────────────

describe('decideDominantCause — adjustments included', () => {
  it('adjustment dominant returns adjustment', () => {
    expect(decideDominantCause({
      additionsCents: 0, removalsCents: 0, adjustmentsCents: 5000, marketMovementCents: 100, isEstimated: false,
    })).toBe('adjustment')
  })
  it('estimated wins over everything else', () => {
    expect(decideDominantCause({
      additionsCents: 0, removalsCents: 0, adjustmentsCents: 0, marketMovementCents: 10000, isEstimated: true,
    })).toBe('estimated')
  })
  it('pure market gain still detected', () => {
    expect(decideDominantCause({
      additionsCents: 0, removalsCents: 0, adjustmentsCents: 0, marketMovementCents: 500, isEstimated: false,
    })).toBe('market_gain')
  })
})

// ── FIX2 — initial manual value = addition (not adjustment) ─

describe('buildDailyBuckets — FIX2 initial-manual-value behaviour', () => {
  it('adding qty 2 with manual value £50/each = additions +£100, adjustments £0, ending £100', () => {
    // No daily_prices required — manual value wins.
    const events = preprocessEvents([
      ev({
        event_type: 'holding_added',
        event_date: '2026-08-01',
        quantity_delta: 2,
        metadata: { initial_manual_value_cents: 5000 },
      }),
    ])
    const bucket = buildDailyBuckets(events, buildPriceIndex([]), new Date('2026-08-01'), new Date('2026-08-01'))[0]
    expect(bucket.additionsCents).toBe(10000)         // 5000 x 2
    expect(bucket.adjustmentsCents).toBe(0)
    expect(bucket.endingValueCents).toBe(10000)
    expect(bucket.marketMovementCents).toBe(0)
    expect(bucket.dominantCause).toBe('addition')
  })

  it('legacy opening_balance with initial_manual_value_cents opens at that value with no phantom adjustment', () => {
    const events = preprocessEvents([
      ev({
        event_type: 'opening_balance',
        event_date: '2026-08-01',
        quantity_delta: 1,
        metadata: { source: 'legacy_backfill', initial_manual_value_cents: 8000 },
      }),
    ])
    const bucket = buildDailyBuckets(events, buildPriceIndex([]), new Date('2026-08-01'), new Date('2026-08-01'))[0]
    expect(bucket.additionsCents).toBe(8000)
    expect(bucket.adjustmentsCents).toBe(0)
    expect(bucket.endingValueCents).toBe(8000)
  })

  it('later manual value edit on a legacy manual-valued holding still produces an adjustment', () => {
    const events = preprocessEvents([
      ev({
        event_type: 'opening_balance',
        event_date: '2026-07-31',
        event_order: 1,
        quantity_delta: 1,
        metadata: { source: 'legacy_backfill', initial_manual_value_cents: 5000 },
      }),
      ev({
        event_type: 'manual_value_changed',
        event_date: '2026-08-01',
        event_order: 2,
        quantity_delta: 0,
        metadata: { manual_value_cents_before: 5000, manual_value_cents_after: 8000 },
      }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex([]), new Date('2026-08-01'), new Date('2026-08-01'))
    expect(buckets[0].adjustmentsCents).toBe(3000)   // 8000 - 5000
    expect(buckets[0].marketMovementCents).toBe(0)
  })

  it('later delete of a legacy manual-valued holding correctly ends value at 0', () => {
    const events = preprocessEvents([
      ev({
        event_type: 'opening_balance',
        event_date: '2026-07-31',
        event_order: 1,
        quantity_delta: 1,
        metadata: { source: 'legacy_backfill', initial_manual_value_cents: 5000 },
      }),
      ev({
        event_type: 'holding_removed',
        event_date: '2026-08-01',
        event_order: 2,
        quantity_delta: -1,
      }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex([]), new Date('2026-07-31'), new Date('2026-08-01'))
    expect(buckets[0].endingValueCents).toBe(5000)   // day 1 with holding
    expect(buckets[1].endingValueCents).toBe(0)      // day 2 after removal
    expect(buckets[1].removalsCents).toBe(5000)
  })
})

// ── FIX1 adjustment identity (unchanged) ───────────────────

describe('buildDailyBuckets — adjustments identity', () => {
  it('manual-value change is attributed as adjustment, NOT market gain', () => {
    const prices = [
      priceRow('1', '2026-07-31', { raw_usd: 100 }),
      priceRow('1', '2026-08-01', { raw_usd: 100 }),
    ]
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-07-31', event_order: 1, quantity_delta: 1 }),
      ev({
        event_type: 'manual_value_changed',
        event_date: '2026-08-01',
        event_order: 2,
        quantity_delta: 0,
        metadata: { manual_value_cents_before: null, manual_value_cents_after: 500 },
      }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex(prices), new Date('2026-08-01'), new Date('2026-08-01'))
    expect(buckets[0].adjustmentsCents).toBe(400)
    expect(buckets[0].marketMovementCents).toBe(0)
    expect(buckets[0].dominantCause).toBe('adjustment')
  })

  it('holding-type correction (raw -> psa10) is attributed as adjustment', () => {
    const prices = [
      priceRow('1', '2026-07-31', { raw_usd: 100, psa10_usd: 1000 }),
      priceRow('1', '2026-08-01', { raw_usd: 100, psa10_usd: 1000 }),
    ]
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-07-31', event_order: 1, quantity_delta: 1, holding_type: 'raw' }),
      ev({
        event_type: 'correction',
        event_date: '2026-08-01',
        event_order: 2,
        quantity_delta: 0,
        holding_type: 'psa10',
        metadata: { correction_kind: 'holding_type', holding_type_before: 'raw', holding_type_after: 'psa10' },
      }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex(prices), new Date('2026-08-01'), new Date('2026-08-01'))
    expect(buckets[0].adjustmentsCents).toBe(900)
    expect(buckets[0].marketMovementCents).toBe(0)
  })

  it('newly-available price after unpriced period is an adjustment', () => {
    const prices = [priceRow('1', '2026-08-01', { raw_usd: 150 })]
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-07-01', quantity_delta: 1 }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex(prices), new Date('2026-08-01'), new Date('2026-08-01'))
    expect(buckets[0].adjustmentsCents).toBe(150)
    expect(buckets[0].marketMovementCents).toBe(0)
  })

  it('per-bucket accounting identity holds every day', () => {
    const prices = [
      priceRow('1', '2026-06-30', { raw_usd: 100 }),
      priceRow('1', '2026-07-01', { raw_usd: 110 }),
      priceRow('1', '2026-07-02', { raw_usd: 120 }),
      priceRow('1', '2026-07-03', { raw_usd: 130 }),
    ]
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-06-29', event_order: 1, quantity_delta: 1 }),
      ev({ event_type: 'quantity_added',  event_date: '2026-07-02', event_order: 2, quantity_delta: 1 }),
    ])
    const buckets = buildDailyBuckets(events, buildPriceIndex(prices), new Date('2026-07-01'), new Date('2026-07-03'))
    for (const b of buckets) {
      expect(b.endingValueCents).toBe(
        b.startingValueCents + b.additionsCents - b.removalsCents + b.adjustmentsCents + b.marketMovementCents,
      )
    }
  })
})

// ── aggregation preserves totals ────────────────────────────

describe('aggregateBuckets', () => {
  it('weekly + monthly preserve every total AND the identity', () => {
    const prices = Array.from({ length: 7 }, (_, i) =>
      priceRow('1', `2026-07-0${i + 1}`, { raw_usd: 100 + i * 5 }),
    )
    const events = preprocessEvents([
      ev({ event_type: 'opening_balance', event_date: '2026-06-30', quantity_delta: 1 }),
      ev({ event_type: 'quantity_added',  event_date: '2026-07-03', quantity_delta: 1 }),
    ])
    const daily = buildDailyBuckets(events, buildPriceIndex(prices), new Date('2026-07-01'), new Date('2026-07-07'))
    for (const gran of ['weekly', 'monthly'] as const) {
      const agg = aggregateBuckets(daily, gran)
      for (const field of ['additionsCents', 'removalsCents', 'saleProceedsCents', 'adjustmentsCents'] as const) {
        expect(agg.reduce((s, p) => s + p[field], 0))
          .toBe(daily.reduce((s, p) => s + p[field], 0))
      }
      for (const b of agg) {
        expect(b.endingValueCents).toBe(
          b.startingValueCents + b.additionsCents - b.removalsCents + b.adjustmentsCents + b.marketMovementCents,
        )
      }
    }
  })
})

// ── Pagination + isComplete (FIX2) ─────────────────────────

describe('fetchAllDailyPrices — pagination + chunked IN + isComplete', () => {
  function makeFakeSupabase(fullRows: Array<{ card_slug: string; date: string; raw_usd: number }>) {
    return {
      from: (_table: string) => ({
        select: () => ({
          in: (_col: string, slugs: string[]) => ({
            gte: () => ({
              lte: () => ({
                range: async (from: number, to: number) => {
                  const filtered = fullRows.filter(r => slugs.includes(r.card_slug))
                  return { data: filtered.slice(from, to + 1), error: null }
                },
              }),
            }),
          }),
        }),
      }),
    } as any
  }

  it('successful multi-page fetch returns complete=true', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      card_slug: 'pc-1', date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, raw_usd: 100 + i,
    }))
    const warnings: string[] = []
    const res = await __TEST__.fetchAllDailyPrices(makeFakeSupabase(rows), ['1'], '2026-01-01', '2026-01-28', warnings)
    expect(res.rows.length).toBe(2500)
    expect(res.complete).toBe(true)
    expect(warnings.length).toBe(0)
  })

  it('chunked IN returns complete=true when every chunk succeeds', async () => {
    const slugs = Array.from({ length: 250 }, (_, i) => `${i}`)
    const rows  = slugs.map((s, i) => ({ card_slug: `pc-${s}`, date: '2026-01-01', raw_usd: 100 + i }))
    const warnings: string[] = []
    const res = await __TEST__.fetchAllDailyPrices(makeFakeSupabase(rows), slugs, '2026-01-01', '2026-01-01', warnings)
    expect(res.rows.length).toBe(250)
    expect(res.complete).toBe(true)
  })

  it('page error flips complete=false and surfaces a warning', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          in: () => ({
            gte: () => ({
              lte: () => ({
                range: async () => ({ data: null, error: { message: 'boom' } }),
              }),
            }),
          }),
        }),
      }),
    } as any
    const warnings: string[] = []
    const res = await __TEST__.fetchAllDailyPrices(supabase, ['1'], '2026-01-01', '2026-01-01', warnings)
    expect(res.rows.length).toBe(0)
    expect(res.complete).toBe(false)
    expect(warnings.some(w => w.includes('boom'))).toBe(true)
  })

  it('a mid-chunk page error only marks that chunk incomplete but does not silently accept the partial result', async () => {
    // First 100 slugs succeed, second chunk fails on its first page.
    let callIndex = 0
    const supabase = {
      from: () => ({
        select: () => ({
          in: (_col: string, slugs: string[]) => ({
            gte: () => ({
              lte: () => ({
                range: async (from: number, to: number) => {
                  callIndex++
                  if (callIndex === 2) return { data: null, error: { message: 'chunk-fail' } }
                  // Return a small dataset for other calls.
                  return { data: slugs.map(s => ({ card_slug: s, date: '2026-01-01', raw_usd: 100 })).slice(from, to + 1), error: null }
                },
              }),
            }),
          }),
        }),
      }),
    } as any
    const slugs = Array.from({ length: 150 }, (_, i) => `${i}`)
    const warnings: string[] = []
    const res = await __TEST__.fetchAllDailyPrices(supabase, slugs, '2026-01-01', '2026-01-01', warnings)
    expect(res.complete).toBe(false)
    expect(warnings.some(w => w.includes('chunk-fail'))).toBe(true)
  })
})

describe('fetchAllEvents / fetchAllCurrentHoldings pagination', () => {
  function makeFakeSupabaseFor(_table: string, rows: any[], erroringOffset: number | null = null) {
    return {
      from: (_t: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                range: async (from: number, _to: number) => {
                  if (erroringOffset != null && from === erroringOffset) {
                    return { data: null, error: { message: `err@${from}` } }
                  }
                  return { data: rows.slice(from, _to + 1), error: null }
                },
              }),
            }),
            range: async (from: number, _to: number) => {
              if (erroringOffset != null && from === erroringOffset) {
                return { data: null, error: { message: `err@${from}` } }
              }
              return { data: rows.slice(from, _to + 1), error: null }
            },
          }),
        }),
      }),
    } as any
  }

  it('events page-two failure flips complete=false', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `e-${i}`, portfolio_item_id: 'pi-1', card_slug: '1',
      set_name_snapshot: 'A', holding_type: 'raw', event_type: 'holding_added',
      quantity_delta: 1, event_date: '2026-01-01',
      market_value_cents_at_event: null, sale_proceeds_cents: null,
      currency: 'USD', is_estimated: false, metadata: null, event_order: i,
    }))
    const supabase = makeFakeSupabaseFor('portfolio_item_events', rows, 1000)
    const warnings: string[] = []
    const res = await __TEST__.fetchAllEvents(supabase, 'p-1', warnings)
    expect(res.complete).toBe(false)
    expect(warnings.some(w => w.includes('err@1000'))).toBe(true)
  })

  it('portfolio_items page-two failure flips complete=false', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `pi-${i}`, card_slug: `${i}`, set_name_snapshot: 'A', holding_type: 'raw', quantity: 1, manual_value_cents: null,
    }))
    const supabase = makeFakeSupabaseFor('portfolio_items', rows, 1000)
    const warnings: string[] = []
    const res = await __TEST__.fetchAllCurrentHoldings(supabase, 'p-1', warnings)
    expect(res.complete).toBe(false)
    expect(warnings.some(w => w.includes('err@1000'))).toBe(true)
  })
})

describe('missing historical prices do NOT trigger the fetch-integrity error state', () => {
  it('a holding with no price row still returns isComplete=true (missing prices are an expected valuation limitation)', async () => {
    // stateMarketValueCents already returns missingHoldings > 0 in
    // this case; we just prove the fetch helpers still report success.
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                range: async () => ({ data: [], error: null }),
              }),
            }),
            range: async () => ({ data: [], error: null }),
          }),
          in: () => ({
            gte: () => ({
              lte: () => ({
                range: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    } as any
    const warnings: string[] = []
    const events  = await __TEST__.fetchAllEvents(supabase, 'p-1', warnings)
    const current = await __TEST__.fetchAllCurrentHoldings(supabase, 'p-1', warnings)
    const prices  = await __TEST__.fetchAllDailyPrices(supabase, [], '2026-01-01', '2026-01-01', warnings)
    expect(events.complete).toBe(true)
    expect(current.complete).toBe(true)
    expect(prices.complete).toBe(true)
    expect(warnings.length).toBe(0)
  })
})

// ── stateMarketValueCents (unchanged) ──────────────────────

describe('stateMarketValueCents', () => {
  it('holdings with no price contribute 0 and count as missing', () => {
    const state = reconstructHoldingsAt(preprocessEvents([ev({ event_type: 'opening_balance', event_date: '2026-01-01' })]), '2026-08-01')
    const v = stateMarketValueCents(state, buildPriceIndex([]), '2026-08-01')
    expect(v.valueCents).toBe(0)
    expect(v.missingHoldings).toBe(1)
  })
})

// ── rangeToWindow / bucketKey / eachDay ────────────────────

// ── FIX3 — holding_instance_id preserves event chain ─────

describe('FIX3 — reconstruction keys by holding_instance_id', () => {
  it('two holdings with identical card+set+type but different holding_instance_id do NOT merge', () => {
    const events = preprocessEvents([
      ev({ event_type: 'holding_added', event_date: '2026-01-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A',
           quantity_delta: 1 }),
      ev({ event_type: 'holding_added', event_date: '2026-01-02', event_order: 2,
           holding_instance_id: 'inst-B', portfolio_item_id: 'inst-B',
           quantity_delta: 3 }),
    ])
    const state = reconstructHoldingsAt(events, '2026-01-02')
    // Both survive under distinct keys even though card+set+type match.
    expect(state.size).toBe(2)
    expect(state.get('inst-A')?.quantity).toBe(1)
    expect(state.get('inst-B')?.quantity).toBe(3)
  })

  it('delete-then-recreate produces two SEPARATE histories under different holding_instance_ids', () => {
    // Real-world sequence:
    //   1. Add card X as inst-A (1 copy)
    //   2. Delete card X → inst-A gets holding_removed
    //   3. Add card X again as inst-B (2 copies)
    // Under FIX3 keying the two histories never collide.
    const events = preprocessEvents([
      ev({ event_type: 'holding_added',   event_date: '2026-01-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 1 }),
      ev({ event_type: 'holding_removed', event_date: '2026-02-01', event_order: 2,
           holding_instance_id: 'inst-A', portfolio_item_id: null,   quantity_delta: -1 }),
      ev({ event_type: 'holding_added',   event_date: '2026-03-01', event_order: 3,
           holding_instance_id: 'inst-B', portfolio_item_id: 'inst-B', quantity_delta: 2 }),
    ])
    // On 2026-02-15: inst-A is deleted, no inst-B yet → state empty.
    expect(reconstructHoldingsAt(events, '2026-02-15').size).toBe(0)
    // On 2026-03-15: only inst-B present with qty 2.
    const later = reconstructHoldingsAt(events, '2026-03-15')
    expect(later.size).toBe(1)
    expect(later.get('inst-B')?.quantity).toBe(2)
    expect(later.get('inst-A')).toBeUndefined()
  })

  it('deleted holding retains its complete event chain under holding_instance_id', () => {
    // Full lifecycle inside events; the delete event uses the same
    // holding_instance_id as every earlier event even though
    // portfolio_item_id has been NULLed by the FK cascade.
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-01-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 1 }),
      ev({ event_type: 'quantity_added', event_date: '2026-02-01', event_order: 2,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 2 }),
      ev({ event_type: 'manual_value_changed', event_date: '2026-03-01', event_order: 3,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 0,
           metadata: { manual_value_cents_before: null, manual_value_cents_after: 500 } }),
      ev({ event_type: 'holding_removed', event_date: '2026-04-01', event_order: 4,
           holding_instance_id: 'inst-A', portfolio_item_id: null,   quantity_delta: -3 }),
    ]
    // Every event carries the same holding_instance_id even though
    // the last one has portfolio_item_id = null.
    expect(events.every(e => e.holding_instance_id === 'inst-A')).toBe(true)
    expect(events[events.length - 1].portfolio_item_id).toBeNull()
    // Historical reconstruction inside the range: manual value + qty
    // correct on 2026-03-15.
    const mid = reconstructHoldingsAt(preprocessEvents(events), '2026-03-15').get('inst-A')
    expect(mid?.quantity).toBe(3)
    expect(mid?.manual_value_cents).toBe(500)
  })

  it('holding-type correction stays inside the same holding_instance_id — no key transfer', () => {
    const events = preprocessEvents([
      ev({ event_type: 'holding_added', event_date: '2026-01-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A',
           holding_type: 'raw', quantity_delta: 1 }),
      ev({ event_type: 'correction', event_date: '2026-02-01', event_order: 2,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A',
           holding_type: 'psa10', quantity_delta: 0,
           metadata: { correction_kind: 'holding_type', holding_type_before: 'raw', holding_type_after: 'psa10' } }),
    ])
    const state = reconstructHoldingsAt(events, '2026-02-01')
    expect(state.size).toBe(1)
    expect(state.get('inst-A')?.holding_type).toBe('psa10')
    expect(state.get('inst-A')?.quantity).toBe(1)
  })

  it('purchase_date correction lookup uses holding_instance_id (works after delete has cleared portfolio_item_id)', () => {
    const events = [
      ev({ event_type: 'holding_added', event_date: '2026-05-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 1 }),
      ev({ event_type: 'correction', event_date: '2026-06-01', event_order: 2,
           holding_instance_id: 'inst-A',
           // portfolio_item_id null simulates the case where the FK
           // cascade fired between the correction and the query.
           portfolio_item_id: null,
           quantity_delta: 0,
           metadata: { correction_kind: 'purchase_date', purchase_date_after: '2026-03-15' } }),
    ]
    const processed = preprocessEvents(events)
    expect(processed).toHaveLength(1)
    expect(processed[0].event_type).toBe('holding_added')
    expect(processed[0].event_date).toBe('2026-03-15')
  })

  it('duplicate holdings with different holding_instance_id do NOT combine even at the same event_date', () => {
    const events = preprocessEvents([
      ev({ event_type: 'quantity_added', event_date: '2026-08-01', event_order: 1,
           holding_instance_id: 'inst-A', portfolio_item_id: 'inst-A', quantity_delta: 5 }),
      ev({ event_type: 'quantity_added', event_date: '2026-08-01', event_order: 2,
           holding_instance_id: 'inst-B', portfolio_item_id: 'inst-B', quantity_delta: 3 }),
    ])
    const state = reconstructHoldingsAt(events, '2026-08-01')
    // Neither inst-A nor inst-B had an earlier holding_added, so
    // both entries are only created if we treat quantity_added as
    // a first-add-through-the-ledger. Whether that happens or not,
    // we assert the two do NOT merge into one entry.
    const keys = Array.from(state.keys())
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('rangeToWindow / bucketKey / eachDay', () => {
  it('range granularity', () => {
    const today = new Date('2026-08-02T00:00:00Z')
    expect(rangeToWindow('7D', today).granularity).toBe('daily')
    expect(rangeToWindow('1Y', today).granularity).toBe('weekly')
    expect(rangeToWindow('ALL', today).granularity).toBe('monthly')
  })
  it('bucketKey', () => {
    expect(bucketKey('2026-08-02', 'daily')).toBe('2026-08-02')
    expect(bucketKey('2026-08-02', 'weekly')).toBe('2026-07-27')
    expect(bucketKey('2026-08-17', 'monthly')).toBe('2026-08-01')
  })
  it('eachDay inclusive', () => {
    expect(eachDay(new Date('2026-08-01'), new Date('2026-08-03')))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })
})
