// Server-only query for the card-page section. Verifies:
//  - flag-off short-circuit (no DB call)
//  - ok+active filter; quarantined/rejected excluded
//  - DESC ordering, limit clamping
//  - grade-key derivation and grouping behaviour
//  - grouped loader returns up-to-5 rows per grade tab

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

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

import {
  getRecentSalesForCard,
  getRecentSalesGroupedForCard,
  loadRecentSalesGroupedForCardIfEnabled,
  deriveGradeKey,
  groupRecentSalesByGrade,
  type CardPageRecentSale,
} from '../cardQueries'

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

// ─────────────────────────────────────────────────────────────────────
// Row-level fetcher semantics
// ─────────────────────────────────────────────────────────────────────

describe('getRecentSalesForCard — query semantics', () => {
  it('returns only parse_status=ok AND review_status=active rows for the slug', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), '959616', 10)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(['ebay']).toContain(r.marketplaceSource)
  })

  it('orders by sale_date DESC', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), '959616', 10)
    expect(rows[0].saleDate).toBe('2026-06-21')
    expect(rows[1].saleDate).toBe('2026-06-18')
  })

  it('clamps limit to a sane range (max 200)', async () => {
    seedThree('959616')
    const lots = await getRecentSalesForCard(asSupa(fakeDB), '959616', 9999)
    expect(lots.length).toBeLessThanOrEqual(200)
    const one  = await getRecentSalesForCard(asSupa(fakeDB), '959616', 1)
    expect(one.length).toBe(1)
    const zero = await getRecentSalesForCard(asSupa(fakeDB), '959616', 0)
    expect(zero.length).toBeGreaterThan(0)
    expect(zero.length).toBeLessThanOrEqual(1)
  })

  it('returns [] for an unknown slug', async () => {
    seedThree('959616')
    const rows = await getRecentSalesForCard(asSupa(fakeDB), 'nonexistent', 10)
    expect(rows).toEqual([])
  })

  it('returns [] for an empty / non-string slug without touching the DB', async () => {
    seedThree('959616')
    expect(await getRecentSalesForCard(asSupa(fakeDB), '', 10)).toEqual([])
    expect(await getRecentSalesForCard(asSupa(fakeDB), (null as unknown as string), 10)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// Grade-key derivation
// ─────────────────────────────────────────────────────────────────────

function row(over: Partial<CardPageRecentSale>): CardPageRecentSale {
  return {
    saleDate: '2026-06-20',
    marketplaceSource: 'ebay',
    marketplaceCountry: null,
    observedSection: 'Ungraded',
    rawOrGraded: null,
    gradingCompany: null,
    grade: null,
    conditionBucket: null,
    conditionText: null,
    bestOfferStatus: null,
    salePriceCents: 100,
    ...over,
  }
}

describe('deriveGradeKey', () => {
  it('maps a clean PSA 10 row to key=psa-10 label=PSA 10', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'PSA', grade: '10' })))
      .toEqual({ key: 'psa-10', label: 'PSA 10' })
  })

  it('strips a duplicated company prefix from the grade text', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'PSA', grade: 'PSA 10' })))
      .toEqual({ key: 'psa-10', label: 'PSA 10' })
  })

  it('strips a double-duplicated company prefix from the grade text', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'PSA', grade: 'PSA PSA 10' })))
      .toEqual({ key: 'psa-10', label: 'PSA 10' })
  })

  it('normalises the company to uppercase', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'psa', grade: '9' })))
      .toEqual({ key: 'psa-9', label: 'PSA 9' })
  })

  it('returns Raw for raw_or_graded=raw with no grading info', () => {
    expect(deriveGradeKey(row({ rawOrGraded: 'raw' })))
      .toEqual({ key: 'raw', label: 'Raw' })
  })

  it('returns the company tag when only the company is known', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'CGC', rawOrGraded: 'graded' })))
      .toEqual({ key: 'cgc', label: 'CGC' })
  })

  it('falls back to Graded when only raw_or_graded=graded is set', () => {
    expect(deriveGradeKey(row({ rawOrGraded: 'graded' })))
      .toEqual({ key: 'graded', label: 'Graded' })
  })

  it('falls back to Other when nothing is known', () => {
    expect(deriveGradeKey(row({})))
      .toEqual({ key: 'other', label: 'Other' })
  })

  it('handles a CGC 9.5 grade verbatim', () => {
    expect(deriveGradeKey(row({ gradingCompany: 'CGC', grade: '9.5' })))
      .toEqual({ key: 'cgc-9.5', label: 'CGC 9.5' })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────

describe('groupRecentSalesByGrade', () => {
  it('returns empty groups for empty input', () => {
    expect(groupRecentSalesByGrade([])).toEqual({ groups: [], total: 0 })
  })

  it('builds an All bucket plus one bucket per derived grade key', () => {
    const data = groupRecentSalesByGrade([
      row({ saleDate: '2026-06-21', gradingCompany: 'PSA', grade: '10' }),
      row({ saleDate: '2026-06-20', gradingCompany: 'PSA', grade: '9' }),
      row({ saleDate: '2026-06-19', rawOrGraded: 'raw' }),
    ])
    expect(data.total).toBe(3)
    expect(data.groups.map(g => g.key)).toEqual(['all','raw','psa-10','psa-9'])
  })

  it('orders PSA 10 / 9 / 8 / 7 in priority order, then alphabetical', () => {
    const data = groupRecentSalesByGrade([
      row({ gradingCompany: 'BGS', grade: '9' }),
      row({ gradingCompany: 'PSA', grade: '8' }),
      row({ gradingCompany: 'PSA', grade: '10' }),
      row({ gradingCompany: 'CGC', grade: '10' }),
      row({ rawOrGraded: 'raw' }),
    ])
    expect(data.groups.map(g => g.key)).toEqual([
      'all','raw','psa-10','psa-8','bgs-9','cgc-10',
    ])
  })

  it('caps each group at the per-grade limit (default 5)', () => {
    const psa10s = Array.from({ length: 9 }, (_, i) =>
      row({ saleDate: `2026-06-2${(i % 9)}`, gradingCompany: 'PSA', grade: '10' }))
    const data = groupRecentSalesByGrade(psa10s)
    const psa10 = data.groups.find(g => g.key === 'psa-10')!
    expect(psa10.rows.length).toBe(5)
    const all = data.groups.find(g => g.key === 'all')!
    expect(all.rows.length).toBe(5)
    expect(data.total).toBe(9)
  })

  it('respects an explicit smaller per-grade limit', () => {
    const psa10s = Array.from({ length: 4 }, (_, i) =>
      row({ saleDate: `2026-06-1${i}`, gradingCompany: 'PSA', grade: '10' }))
    const data = groupRecentSalesByGrade(psa10s, 2)
    expect(data.groups.find(g => g.key === 'psa-10')!.rows.length).toBe(2)
    expect(data.groups.find(g => g.key === 'all')!.rows.length).toBe(2)
  })

  it('does not create a tab for a grade that has zero rows', () => {
    const data = groupRecentSalesByGrade([row({ rawOrGraded: 'raw' })])
    const keys = data.groups.map(g => g.key)
    expect(keys).toContain('raw')
    expect(keys).not.toContain('psa-10')
    expect(keys).not.toContain('psa-9')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Grouped read (DB → groups)
// ─────────────────────────────────────────────────────────────────────

describe('getRecentSalesGroupedForCard', () => {
  it('returns all+raw+psa-10 groups for a mixed seed and excludes quarantined/rejected/superseded', async () => {
    seedThree('959616')
    const data = await getRecentSalesGroupedForCard(asSupa(fakeDB), '959616')
    expect(data.total).toBe(2)
    expect(data.groups.map(g => g.key)).toEqual(['all','raw','psa-10'])
    const all = data.groups.find(g => g.key === 'all')!
    expect(all.rows.length).toBe(2)
    expect(all.rows[0].saleDate).toBe('2026-06-21')
  })

  it('keeps per-grade rows capped at 5 even when fetch returns more', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      internal_card_slug: '959616',
      sale_date: `2026-06-${10 + i}`,
      marketplace_source: 'ebay',
      observed_section: 'PSA 10',
      raw_or_graded: 'graded', grading_company: 'PSA', grade: '10',
      condition_bucket: 'mint', best_offer_status: 'none',
      sale_price_cents: 1000 + i,
      parse_status: 'ok', review_status: 'active',
    }))
    fakeDB.seed('recent_sales', rows)
    const data = await getRecentSalesGroupedForCard(asSupa(fakeDB), '959616')
    expect(data.total).toBe(12)
    expect(data.groups.find(g => g.key === 'psa-10')!.rows.length).toBe(5)
    expect(data.groups.find(g => g.key === 'all')!.rows.length).toBe(5)
  })

  it('returns empty groups for an unknown slug', async () => {
    seedThree('959616')
    const data = await getRecentSalesGroupedForCard(asSupa(fakeDB), 'nope')
    expect(data).toEqual({ groups: [], total: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Flag gate
// ─────────────────────────────────────────────────────────────────────

describe('loadRecentSalesGroupedForCardIfEnabled — flag gate', () => {
  it('returns empty groups and DOES NOT touch the DB when flag is unset', async () => {
    seedThree('959616')
    const data = await loadRecentSalesGroupedForCardIfEnabled('959616')
    expect(data).toEqual({ groups: [], total: 0 })
    expect(supaCalls.calls).toBe(0)
  })

  it('returns empty groups for non-literal-true values (no DB call)', async () => {
    seedThree('959616')
    for (const v of ['1','yes','TRUE','True','enabled','false']) {
      supaCalls.calls = 0
      process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = v
      const data = await loadRecentSalesGroupedForCardIfEnabled('959616')
      expect(data, `value=${v}`).toEqual({ groups: [], total: 0 })
      expect(supaCalls.calls, `value=${v}`).toBe(0)
    }
  })

  it('queries when flag is literal "true"', async () => {
    process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = 'true'
    seedThree('959616')
    const data = await loadRecentSalesGroupedForCardIfEnabled('959616')
    expect(data.total).toBe(2)
    expect(data.groups.map(g => g.key)).toEqual(['all','raw','psa-10'])
    expect(supaCalls.calls).toBe(1)
  })

  it('returns empty groups when flag is on but the card has no rows', async () => {
    process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = 'true'
    seedThree('959616')
    const data = await loadRecentSalesGroupedForCardIfEnabled('does-not-exist')
    expect(data).toEqual({ groups: [], total: 0 })
  })
})
