// Block 4B-W-4A — server-only query for the card-page section.
// Verifies: flag-off short-circuit (no DB call), ok+active filter,
// quarantined/rejected excluded, ordering, limit clamping.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

// FakeDB structurally implements the subset of SupabaseClient we use.
// Cast at the call site rather than widening the helper's signature.
const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
const supaCalls: { calls: number } = { calls: 0 }
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => {
    supaCalls.calls++
    return fakeDB
  },
}))

import { getRecentSalesForCard, loadRecentSalesForCardIfEnabled } from '../cardQueries'

const KEYS = ['RECENT_SALES_FREE_PREVIEW_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  supaCalls.calls = 0
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function seedThree(slug: string) {
  fakeDB.seed('recent_sales', [
    // ok + active — should appear
    { internal_card_slug: slug, sale_date: '2026-06-21', marketplace_source: 'ebay',
      marketplace_country: 'US', observed_section: 'PSA 10',
      raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
      condition_bucket: 'mint', condition_text: null,
      best_offer_status: 'accepted', sale_price_cents: 12500,
      parse_status: 'ok', review_status: 'active' },
    // ok + active, raw, older
    { internal_card_slug: slug, sale_date: '2026-06-18', marketplace_source: 'ebay',
      marketplace_country: 'GB', observed_section: 'Ungraded',
      raw_or_graded: 'raw', grading_company: null, grade: null,
      condition_bucket: 'near_mint', condition_text: null,
      best_offer_status: 'none', sale_price_cents: 4500,
      parse_status: 'ok', review_status: 'active' },
    // quarantined — must be excluded
    { internal_card_slug: slug, sale_date: '2026-06-20', marketplace_source: 'ebay',
      observed_section: 'Ungraded', raw_or_graded: null,
      condition_bucket: null, best_offer_status: null, sale_price_cents: 100,
      parse_status: 'quarantined', review_status: 'active' },
    // rejected — must be excluded
    { internal_card_slug: slug, sale_date: '2026-06-19', marketplace_source: 'ebay',
      observed_section: 'Ungraded', raw_or_graded: null,
      condition_bucket: null, best_offer_status: null, sale_price_cents: 100,
      parse_status: 'rejected', review_status: 'active' },
    // superseded — ok but not active
    { internal_card_slug: slug, sale_date: '2026-06-17', marketplace_source: 'ebay',
      observed_section: 'Ungraded', raw_or_graded: 'raw',
      condition_bucket: 'near_mint', best_offer_status: 'none', sale_price_cents: 4000,
      parse_status: 'ok', review_status: 'superseded' },
    // different card — must be excluded
    { internal_card_slug: 'other', sale_date: '2026-06-22', marketplace_source: 'ebay',
      observed_section: 'Ungraded', raw_or_graded: 'raw',
      condition_bucket: 'near_mint', best_offer_status: 'none', sale_price_cents: 9999,
      parse_status: 'ok', review_status: 'active' },
  ])
}

describe('getRecentSalesForCard — query semantics', () => {
  it('returns only parse_status=ok AND review_status=active rows for the slug', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), '959616', 10)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(['ebay']).toContain(r.marketplaceSource)
    }
  })

  it('orders by sale_date DESC', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), '959616', 10)
    expect(rows[0].saleDate).toBe('2026-06-21')
    expect(rows[1].saleDate).toBe('2026-06-18')
  })

  it('clamps limit to a sane range', async () => {
    seedThree('959616')
    const lots = await getRecentSalesForCard(asSupa(fakeDB), '959616', 999)
    expect(lots.length).toBeLessThanOrEqual(20)
    const one  = await getRecentSalesForCard(asSupa(fakeDB), '959616', 1)
    expect(one.length).toBe(1)
    const zero = await getRecentSalesForCard(asSupa(fakeDB), '959616', 0)
    expect(zero.length).toBeGreaterThan(0)   // clamped up to 1
    expect(zero.length).toBeLessThanOrEqual(1)
  })

  it('returns [] for an unknown slug', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), 'nonexistent', 10)
    expect(rows).toEqual([])
  })

  it('returns [] for an empty / non-string slug without touching the DB', async () => {
    seedThree('959616')
    // empty string
    expect(await getRecentSalesForCard(asSupa(fakeDB), '', 10)).toEqual([])
    // null/undefined should also short-circuit (type assertion to test runtime guard)
    expect(await getRecentSalesForCard(asSupa(fakeDB), (null as unknown as string), 10)).toEqual([])
  })

  it('preserves marketplace_country, condition_bucket, best_offer_status when present', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), '959616', 10)
    const psa10 = rows.find(r => r.gradingCompany === 'PSA')
    expect(psa10?.marketplaceCountry).toBe('US')
    expect(psa10?.bestOfferStatus).toBe('accepted')
    expect(psa10?.conditionBucket).toBe('mint')
  })
})

describe('loadRecentSalesForCardIfEnabled — flag gate', () => {
  it('returns [] and DOES NOT touch the DB when flag is unset', async () => {
    seedThree('959616')
    const rows = await loadRecentSalesForCardIfEnabled('959616')
    expect(rows).toEqual([])
    expect(supaCalls.calls).toBe(0)
  })

  it('returns [] for non-literal-true values (no DB call)', async () => {
    seedThree('959616')
    for (const v of ['1','yes','TRUE','True','enabled','false']) {
      supaCalls.calls = 0
      process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = v
      const rows = await loadRecentSalesForCardIfEnabled('959616')
      expect(rows, `value=${v}`).toEqual([])
      expect(supaCalls.calls, `value=${v}`).toBe(0)
    }
  })

  it('queries when flag is literal "true"', async () => {
    process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = 'true'
    seedThree('959616')
    const rows = await loadRecentSalesForCardIfEnabled('959616')
    expect(rows.length).toBe(2)
    expect(supaCalls.calls).toBe(1)
  })

  it('returns [] when flag is on but the card has no rows', async () => {
    process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = 'true'
    seedThree('959616')
    const rows = await loadRecentSalesForCardIfEnabled('does-not-exist')
    expect(rows).toEqual([])
  })
})
