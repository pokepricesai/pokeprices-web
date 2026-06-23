// Block 4B-W-9A — admin-query helpers added for the monitoring panels.
// Covers parseRunNotes, getRecentSalesHealth (grade-cap violations,
// freshness, top cards, totals), and the static affiliate monitoring
// panel.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import {
  parseRunNotes,
  getRecentSalesHealth,
  getAffiliateMonitoringPanel,
} from '../adminQueries'

// ─────────────────────────────────────────────────────────────────────
// parseRunNotes — defensive JSON parsing
// ─────────────────────────────────────────────────────────────────────

describe('parseRunNotes', () => {
  it('returns null for null input', () => {
    expect(parseRunNotes(null)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseRunNotes('')).toBeNull()
    expect(parseRunNotes('   ')).toBeNull()
  })

  it('parses a valid JSON object', () => {
    const out = parseRunNotes('{"errors_count": 0, "skipped_429": 2}')
    expect(out).toEqual({ errors_count: 0, skipped_429: 2 })
  })

  it('returns null when the JSON root is an array (not an object)', () => {
    expect(parseRunNotes('[1,2,3]')).toBeNull()
  })

  it('returns null when the JSON root is a primitive', () => {
    expect(parseRunNotes('"hello"')).toBeNull()
    expect(parseRunNotes('42')).toBeNull()
    expect(parseRunNotes('true')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseRunNotes('{not json')).toBeNull()
    expect(parseRunNotes('this is a plain note')).toBeNull()
  })

  it('preserves nested objects and arrays as-is', () => {
    const out = parseRunNotes('{"nested": {"a": 1}, "list": [1, 2]}')
    expect(out).toEqual({ nested: { a: 1 }, list: [1, 2] })
  })
})

// ─────────────────────────────────────────────────────────────────────
// getAffiliateMonitoringPanel — static, informational
// ─────────────────────────────────────────────────────────────────────

describe('getAffiliateMonitoringPanel', () => {
  it('reports server-side storage as unavailable', () => {
    const panel = getAffiliateMonitoringPanel()
    expect(panel.available).toBe(false)
    expect(panel.source).toMatch(/Google Analytics/i)
    expect(panel.note).toMatch(/no Supabase table/i)
  })

  it('exposes the GA4 placement filter list', () => {
    const panel = getAffiliateMonitoringPanel()
    for (const p of [
      'recent_sales_all','recent_sales_raw',
      'recent_sales_psa10','recent_sales_psa9','recent_sales_psa8',
      'recent_sales_graded',
    ]) {
      expect(panel.placements).toContain(p)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// getRecentSalesHealth — totals, violations, freshness, top cards
// ─────────────────────────────────────────────────────────────────────

const fakeDB = new FakeDB()
beforeEach(() => { fakeDB.reset() })

function seedRow(over: Record<string, any> = {}): Record<string, any> {
  return {
    provider_sale_key: `k-${Math.random().toString(36).slice(2, 10)}`,
    provider: 'pricecharting',
    provider_card_id: '1450205',
    internal_card_slug: '1450205',
    sale_date: '2026-06-20',
    sale_price_cents: 100,
    marketplace_source: 'ebay',
    observed_section: 'Ungraded',
    grading_company: null,
    grade: null,
    raw_or_graded: 'raw',
    parse_status: 'ok',
    review_status: 'active',
    parse_confidence: 90,
    first_seen_at: '2026-06-22T00:00:00Z',
    ...over,
  }
}

describe('getRecentSalesHealth — totals', () => {
  it('returns zeroed health for an empty table', async () => {
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.totalRows).toBe(0)
    expect(h.okActiveRows).toBe(0)
    expect(h.okSupersededRows).toBe(0)
    expect(h.distinctActiveCards).toBe(0)
    expect(h.gradeCapViolations.violationCount).toBe(0)
    expect(h.topActiveCards).toEqual([])
    expect(h.freshness.anchorDate).toBeNull()
  })

  it('counts ok+active and ok+superseded separately', async () => {
    fakeDB.seed('recent_sales', [
      seedRow({ review_status: 'active'     }),
      seedRow({ review_status: 'active'     }),
      seedRow({ review_status: 'superseded' }),
      seedRow({ parse_status: 'quarantined', review_status: 'active' }), // excluded from ok counts
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.totalRows).toBe(4)
    expect(h.okActiveRows).toBe(2)
    expect(h.okSupersededRows).toBe(1)
  })

  it('counts distinct active cards', async () => {
    fakeDB.seed('recent_sales', [
      seedRow({ internal_card_slug: 'a' }),
      seedRow({ internal_card_slug: 'a' }),
      seedRow({ internal_card_slug: 'b' }),
      seedRow({ internal_card_slug: 'c', review_status: 'superseded' }), // superseded excluded
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.distinctActiveCards).toBe(2)
  })
})

describe('getRecentSalesHealth — grade-cap violations', () => {
  it('reports 0 violations when no card+grade bucket exceeds 5', async () => {
    fakeDB.seed('recent_sales', [
      ...Array.from({ length: 5 }, () => seedRow({ raw_or_graded: 'raw' })),
      ...Array.from({ length: 4 }, () => seedRow({
        raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
      })),
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.gradeCapViolations.cap).toBe(5)
    expect(h.gradeCapViolations.violationCount).toBe(0)
    expect(h.gradeCapViolations.samples).toEqual([])
  })

  it('reports a violation when a card+grade bucket exceeds 5', async () => {
    fakeDB.seed('recent_sales', [
      // 6 PSA 10 active rows for the same card → violation
      ...Array.from({ length: 6 }, () => seedRow({
        internal_card_slug: 'over',
        raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
      })),
      // 3 raw rows for a different card → not a violation
      ...Array.from({ length: 3 }, () => seedRow({
        internal_card_slug: 'under', raw_or_graded: 'raw',
      })),
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.gradeCapViolations.violationCount).toBe(1)
    expect(h.gradeCapViolations.samples).toHaveLength(1)
    expect(h.gradeCapViolations.samples[0]).toMatchObject({
      internalCardSlug: 'over',
      gradeKey:         'psa-10',
      gradeLabel:       'PSA 10',
      activeRowCount:   6,
    })
  })

  it('does NOT count superseded rows toward the cap', async () => {
    fakeDB.seed('recent_sales', [
      // 5 active + 5 superseded for the same PSA 10 bucket → cap respected
      ...Array.from({ length: 5 }, () => seedRow({
        raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
      })),
      ...Array.from({ length: 5 }, () => seedRow({
        raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
        review_status: 'superseded',
      })),
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.gradeCapViolations.violationCount).toBe(0)
  })
})

describe('getRecentSalesHealth — freshness anchoring', () => {
  it('anchors on the latest sale_date in the data, not Date.now()', async () => {
    // Latest sale_date in the dataset is 2021-12-01 (years in the past).
    // The "last 7 days" bucket must still capture the rows at or after
    // 2021-11-24 — proving the anchor is the data's max, not the wall
    // clock.
    fakeDB.seed('recent_sales', [
      seedRow({ sale_date: '2021-12-01' }),  // 0 days old vs anchor
      seedRow({ sale_date: '2021-11-25' }),  // 6 days old → last7d
      seedRow({ sale_date: '2021-11-10' }),  // 21 days old → last30d
      seedRow({ sale_date: '2021-10-01' }),  // 61 days old → last90d
      seedRow({ sale_date: '2020-01-01' }),  // very old → older
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.freshness.anchorDate).toBe('2021-12-01')
    expect(h.freshness.last7d).toBe(2)
    expect(h.freshness.last30d).toBe(1)
    expect(h.freshness.last90d).toBe(1)
    expect(h.freshness.older).toBe(1)
  })

  it('counts each row in exactly one bucket (mutually exclusive)', async () => {
    fakeDB.seed('recent_sales', [
      seedRow({ sale_date: '2026-06-20' }),
      seedRow({ sale_date: '2026-06-18' }),
      seedRow({ sale_date: '2026-05-30' }),
      seedRow({ sale_date: '2026-04-01' }),
      seedRow({ sale_date: '2025-12-01' }),
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    const sum = h.freshness.last7d + h.freshness.last30d + h.freshness.last90d + h.freshness.older
    expect(sum).toBe(5)
  })
})

describe('getRecentSalesHealth — top active cards', () => {
  it('returns the top 20 cards by active row count, sorted desc', async () => {
    // 25 distinct cards with descending row counts so we can verify the
    // top-20 slice.
    const rows: Record<string, any>[] = []
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j <= i; j++) {
        rows.push(seedRow({ internal_card_slug: `card-${i}`, provider_card_id: `card-${i}` }))
      }
    }
    fakeDB.seed('recent_sales', rows)
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.topActiveCards).toHaveLength(20)
    expect(h.topActiveCards[0].internalCardSlug).toBe('card-24')
    expect(h.topActiveCards[0].rowCount).toBe(25)
    expect(h.topActiveCards[19].internalCardSlug).toBe('card-5')
  })

  it('records the latest sale_date per top card', async () => {
    fakeDB.seed('recent_sales', [
      seedRow({ internal_card_slug: 'a', sale_date: '2026-06-10' }),
      seedRow({ internal_card_slug: 'a', sale_date: '2026-06-22' }),
      seedRow({ internal_card_slug: 'a', sale_date: '2026-06-15' }),
    ])
    const h = await getRecentSalesHealth(asSupa(fakeDB))
    expect(h.topActiveCards[0].latestSaleDate).toBe('2026-06-22')
  })
})
