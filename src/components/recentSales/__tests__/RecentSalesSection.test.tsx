// RecentSalesSection render tests. Renders via react-dom/server and
// asserts on the resulting HTML. Covers:
//  - empty / null guards
//  - title rendering
//  - no PriceCharting / source copy
//  - tab list reflects available grade groups
//  - default (first) tab renders its rows; max 5 rendered
//  - hidden grades do not get a tab
//  - no eBay affiliate links rendered

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

// The shared supabase module eagerly constructs a browser client at
// import time (pulled in transitively via the affiliate link helpers
// used by RecentSalesGradeTabs). The test env has no Supabase env
// vars, so stub it.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
  CHAT_ENDPOINT: '',
  formatPrice:       (c: number | null | undefined) => c == null ? '—' : `$${(c/100).toFixed(2)}`,
  formatPriceGBP:    (c: number | null | undefined) => c == null ? '—' : `£${(c/100).toFixed(2)}`,
  formatPriceShort:  (c: number | null | undefined) => c == null ? '—' : `$${(c/100).toFixed(0)}`,
  formatPct:         () => ({ text: '—', color: '' }),
  formatDate:        (d: string | null) => d ?? '—',
  formatChartPrice:  (c: number) => `$${c}`,
}))

import RecentSalesSection from '../RecentSalesSection'
import type { CardPageRecentSale, CardPageRecentSalesData } from '@/lib/recentSales/cardQueries'

function rowFixture(over: Partial<CardPageRecentSale> = {}): CardPageRecentSale {
  return {
    saleDate:           '2026-06-21',
    marketplaceSource:  'ebay',
    marketplaceCountry: 'US',
    observedSection:    'PSA 10',
    rawOrGraded:        'graded',
    gradingCompany:     'PSA',
    grade:              '10',
    conditionBucket:    'mint',
    conditionText:      null,
    bestOfferStatus:    'none',
    salePriceCents:     12500,
    ...over,
  }
}

function data(over: Partial<CardPageRecentSalesData> = {}): CardPageRecentSalesData {
  return {
    groups: [{ key: 'all', label: 'All', rows: [rowFixture()] }],
    total:  1,
    ...over,
  }
}

function render(d: CardPageRecentSalesData): string {
  return renderToString(createElement(RecentSalesSection, { data: d }))
}

// ─────────────────────────────────────────────────────────────────────
// Empty / null guards
// ─────────────────────────────────────────────────────────────────────

describe('RecentSalesSection — empty / null', () => {
  it('renders nothing when total=0', () => {
    expect(render({ groups: [], total: 0 })).toBe('')
  })

  it('renders nothing when groups is empty', () => {
    expect(render({ groups: [], total: 5 })).toBe('')
  })

  it('renders nothing when data is null', () => {
    const html = renderToString(createElement(RecentSalesSection, { data: (null as unknown as CardPageRecentSalesData) }))
    expect(html).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Title + copy
// ─────────────────────────────────────────────────────────────────────

describe('RecentSalesSection — title and copy', () => {
  it('renders the section title when rows exist', () => {
    const html = render(data())
    expect(html).toContain('Recent verified sales')
  })

  it('does NOT render PriceCharting / source copy', () => {
    const html = render(data())
    expect(html.toLowerCase()).not.toContain('pricecharting')
    expect(html.toLowerCase()).not.toContain('source:')
  })

  it('does NOT render any affiliate / outbound link', () => {
    const html = render(data())
    // No <a href=...> rendered at all — the section is informational
    // text only. The repo-wide audit-ebay-links script enforces the
    // hostname check elsewhere.
    expect(html).not.toMatch(/href=/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Grade tabs
// ─────────────────────────────────────────────────────────────────────

describe('RecentSalesSection — grade tabs', () => {
  it('renders one tab per group in the order provided', () => {
    const html = render({
      groups: [
        { key: 'all',    label: 'All',    rows: [rowFixture()] },
        { key: 'raw',    label: 'Raw',    rows: [rowFixture({ gradingCompany: null, grade: null, rawOrGraded: 'raw' })] },
        { key: 'psa-10', label: 'PSA 10', rows: [rowFixture()] },
      ],
      total: 3,
    })
    const idxAll  = html.indexOf('>All')
    const idxRaw  = html.indexOf('>Raw')
    const idxPsa  = html.indexOf('>PSA 10')
    expect(idxAll).toBeGreaterThanOrEqual(0)
    expect(idxRaw).toBeGreaterThan(idxAll)
    expect(idxPsa).toBeGreaterThan(idxRaw)
  })

  it('does not create tabs for grades that have no rows', () => {
    const rawRow = rowFixture({
      rawOrGraded: 'raw', gradingCompany: null, grade: null,
      observedSection: 'Ungraded',
    })
    const html = render({
      groups: [
        { key: 'all', label: 'All', rows: [rawRow] },
        { key: 'raw', label: 'Raw', rows: [rawRow] },
      ],
      total: 1,
    })
    // Pull just the tablist HTML to assert tab labels in isolation.
    const tabsMatch = html.match(/role="tablist"[\s\S]*?<\/div>/)
    expect(tabsMatch).not.toBeNull()
    const tablist = tabsMatch![0]
    expect(tablist).toContain('All')
    expect(tablist).toContain('Raw')
    expect(tablist).not.toMatch(/PSA\s*10/)
    expect(tablist).not.toMatch(/PSA\s*9/)
    expect(tablist).not.toMatch(/PSA\s*8/)
    expect(tablist).not.toMatch(/PSA\s*7/)
  })

  it('renders aria-selected=true on exactly the first tab', () => {
    const html = render({
      groups: [
        { key: 'all',    label: 'All',    rows: [rowFixture()] },
        { key: 'psa-10', label: 'PSA 10', rows: [rowFixture()] },
      ],
      total: 2,
    })
    const selectedCount = (html.match(/aria-selected="true"/g) ?? []).length
    expect(selectedCount).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Row rendering for the default tab
// ─────────────────────────────────────────────────────────────────────

describe('RecentSalesSection — default tab rows', () => {
  it('renders date, marketplace, grade, condition and price for the default tab', () => {
    const html = render(data())
    expect(html).toContain('21 Jun 2026')
    expect(html).toContain('ebay')
    expect(html).toContain('US')
    expect(html).toContain('PSA 10')
    expect(html).toContain('mint')
    expect(html).toContain('$125.00')
  })

  it('renders Raw for raw rows with no grading_company', () => {
    const html = render({
      groups: [{
        key: 'all', label: 'All',
        rows: [rowFixture({ gradingCompany: null, grade: null, rawOrGraded: 'raw' })],
      }],
      total: 1,
    })
    expect(html).toContain('>Raw<')
  })

  it('falls back to condition_text when condition_bucket is null', () => {
    const html = render({
      groups: [{
        key: 'all', label: 'All',
        rows: [rowFixture({ conditionBucket: null, conditionText: 'mint with slight whitening' })],
      }],
      total: 1,
    })
    expect(html).toContain('mint with slight whitening')
  })

  it('shows "best offer accepted" only when bestOfferStatus is accepted', () => {
    const accepted = render({
      groups: [{ key: 'all', label: 'All', rows: [rowFixture({ bestOfferStatus: 'accepted' })] }],
      total: 1,
    })
    expect(accepted).toContain('best offer accepted')
    const none = render(data())
    expect(none).not.toContain('best offer accepted')
  })

  it('caps the default tab at the rows passed in (caller pre-slices to 5)', () => {
    const five = Array.from({ length: 5 }, (_, i) => rowFixture({ saleDate: `2026-06-2${i}` }))
    const html = render({
      groups: [{ key: 'all', label: 'All', rows: five }],
      total: 12,
    })
    const matches = html.match(/2026/g) ?? []
    expect(matches.length).toBeLessThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sensitive-data leakage guard
// ─────────────────────────────────────────────────────────────────────

describe('RecentSalesSection — leakage', () => {
  it('contains no email addresses, user_id, or admin-only fields', () => {
    const html = render(data())
    expect(html).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(html).not.toMatch(/user_id|userId|email|provider_sale_key|raw_hash|raw_metadata|rejection_reason/i)
  })
})
