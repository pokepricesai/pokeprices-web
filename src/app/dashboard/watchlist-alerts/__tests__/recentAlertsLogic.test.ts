// Block 5A-W-23 — Recent alerts sort + reason ordering tests.

import { describe, it, expect } from 'vitest'
import type { AlertRule } from '@/lib/alerts/preferences'
import {
  isPriceRule,
  cardHasPriceReason,
  sortReasonsPriceFirst,
  sortCardsPriceFirst,
  type AlertReason,
  type RecentAlertCard,
} from '../recentAlertsLogic'

function reason(rule: AlertRule, severity: 'low'|'normal'|'high' = 'normal'): AlertReason {
  return { rule, severity }
}

describe('isPriceRule', () => {
  it('marks raw/psa10/price/spread as price', () => {
    expect(isPriceRule('raw_change')).toBe(true)
    expect(isPriceRule('psa10_change')).toBe(true)
    expect(isPriceRule('price_move')).toBe(true)
    expect(isPriceRule('spread_change')).toBe(true)
  })
  it('marks recent_sales / market_activity as NOT price', () => {
    expect(isPriceRule('recent_sales')).toBe(false)
    expect(isPriceRule('market_activity')).toBe(false)
  })
})

describe('cardHasPriceReason', () => {
  it('true when any reason is price', () => {
    expect(cardHasPriceReason({ reasons: [reason('recent_sales'), reason('raw_change')] })).toBe(true)
  })
  it('false when all reasons are sales/activity', () => {
    expect(cardHasPriceReason({ reasons: [reason('recent_sales'), reason('market_activity')] })).toBe(false)
  })
  it('false on empty reasons', () => {
    expect(cardHasPriceReason({ reasons: [] })).toBe(false)
  })
})

describe('sortReasonsPriceFirst', () => {
  it('moves price reasons before sales reasons, stable within each bucket', () => {
    const out = sortReasonsPriceFirst([
      reason('recent_sales'),
      reason('raw_change'),
      reason('market_activity'),
      reason('psa10_change'),
    ])
    expect(out.map(r => r.rule)).toEqual(['raw_change', 'psa10_change', 'recent_sales', 'market_activity'])
  })

  it('returns a NEW array (does not mutate the input)', () => {
    const input: AlertReason[] = [reason('recent_sales'), reason('raw_change')]
    const out = sortReasonsPriceFirst(input)
    expect(out).not.toBe(input)
    expect(input.map(r => r.rule)).toEqual(['recent_sales', 'raw_change'])
  })

  it('handles all-price and all-sales inputs without reordering', () => {
    const allPrice = [reason('raw_change'), reason('psa10_change')]
    expect(sortReasonsPriceFirst(allPrice).map(r => r.rule)).toEqual(['raw_change', 'psa10_change'])
    const allSales = [reason('recent_sales'), reason('market_activity')]
    expect(sortReasonsPriceFirst(allSales).map(r => r.rule)).toEqual(['recent_sales', 'market_activity'])
  })
})

describe('sortCardsPriceFirst', () => {
  function card(slug: string, latestAt: string, ...rules: AlertRule[]): RecentAlertCard {
    return { cardSlug: slug, latestAt, reasons: rules.map(r => reason(r)) }
  }

  it('price-rule cards rank above sales-only cards even when the sales card is newer', () => {
    const newerSalesOnly = card('sales', '2026-06-28T10:00:00Z', 'recent_sales', 'market_activity')
    const olderPriceRule = card('price', '2026-06-20T10:00:00Z', 'raw_change')
    const out = sortCardsPriceFirst([newerSalesOnly, olderPriceRule])
    expect(out.map(c => c.cardSlug)).toEqual(['price', 'sales'])
  })

  it('within the price-rule bucket, newest latestAt wins', () => {
    const older = card('older', '2026-06-20T10:00:00Z', 'raw_change')
    const newer = card('newer', '2026-06-25T10:00:00Z', 'psa10_change')
    const out = sortCardsPriceFirst([older, newer])
    expect(out.map(c => c.cardSlug)).toEqual(['newer', 'older'])
  })

  it('within the sales-only bucket, newest latestAt wins', () => {
    const older = card('older', '2026-06-20T10:00:00Z', 'recent_sales')
    const newer = card('newer', '2026-06-25T10:00:00Z', 'market_activity')
    const out = sortCardsPriceFirst([older, newer])
    expect(out.map(c => c.cardSlug)).toEqual(['newer', 'older'])
  })

  it('returns a NEW array (does not mutate the input)', () => {
    const a = card('a', '2026-06-25T10:00:00Z', 'raw_change')
    const b = card('b', '2026-06-26T10:00:00Z', 'recent_sales')
    const input = [a, b]
    const out = sortCardsPriceFirst(input)
    expect(out).not.toBe(input)
  })

  it('handles a card with mixed reasons (price + sales) as a price-rule card', () => {
    const mixed     = card('mixed', '2026-06-20T10:00:00Z', 'raw_change', 'recent_sales')
    const salesOnly = card('sales', '2026-06-28T10:00:00Z', 'recent_sales')
    const out = sortCardsPriceFirst([salesOnly, mixed])
    expect(out.map(c => c.cardSlug)).toEqual(['mixed', 'sales'])
  })
})
