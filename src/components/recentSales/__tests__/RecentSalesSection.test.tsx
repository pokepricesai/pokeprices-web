// Block 4B-W-4A — RecentSalesSection render tests.
// Uses react-dom/server to render the component to a string and
// asserts on the resulting HTML. No DOM library required.

import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import RecentSalesSection from '../RecentSalesSection'
import type { CardPageRecentSale } from '@/lib/recentSales/cardQueries'

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

function render(rows: CardPageRecentSale[]): string {
  return renderToString(createElement(RecentSalesSection, { rows }))
}

describe('RecentSalesSection — empty / null rows', () => {
  it('renders nothing for an empty rows array', () => {
    const html = render([])
    expect(html).toBe('')
  })

  it('renders nothing for a non-array', () => {
    // bypass the type system to confirm runtime guard
    const html = renderToString(createElement(RecentSalesSection, { rows: (null as unknown as CardPageRecentSale[]) }))
    expect(html).toBe('')
  })
})

describe('RecentSalesSection — rendered table', () => {
  it('renders the section title when rows exist', () => {
    const html = render([rowFixture()])
    expect(html).toContain('Recent verified sales')
  })

  it('does NOT render the previous data-source / honesty copy', () => {
    const html = render([rowFixture()])
    // These strings were removed per the operator copy change. The
    // section title is the only descriptive text rendered now.
    expect(html).not.toContain('Recent sales captured from PriceCharting completed-sale sections.')
    expect(html).not.toContain('Source: PriceCharting marketplace tracking.')
  })

  it('renders each row with date, marketplace, grade, condition, price', () => {
    const html = render([rowFixture()])
    expect(html).toContain('21 Jun 2026')         // formatted date
    expect(html).toContain('ebay')                // marketplace
    expect(html).toContain('US')                  // country
    expect(html).toContain('PSA 10')              // grade label
    expect(html).toContain('mint')                // condition bucket
    expect(html).toContain('$125.00')             // price (cents → dollars)
  })

  it('shows "best offer accepted" only when bestOfferStatus is accepted', () => {
    const accepted = render([rowFixture({ bestOfferStatus: 'accepted' })])
    expect(accepted).toContain('best offer accepted')

    const none = render([rowFixture({ bestOfferStatus: 'none' })])
    expect(none).not.toContain('best offer accepted')

    const unknown = render([rowFixture({ bestOfferStatus: 'unknown' })])
    expect(unknown).not.toContain('best offer accepted')
  })

  it('renders "Raw" when grading_company is null and raw_or_graded=raw', () => {
    const html = render([rowFixture({
      gradingCompany: null, grade: null, rawOrGraded: 'raw',
    })])
    expect(html).toContain('>Raw<')
  })

  it('falls back to condition_text when condition_bucket is null', () => {
    const html = render([rowFixture({
      conditionBucket: null, conditionText: 'mint condition with slight whitening',
    })])
    expect(html).toContain('mint condition with slight whitening')
  })

  it('renders the observed_section under the marketplace cell', () => {
    const html = render([rowFixture({ observedSection: 'Sealed' })])
    expect(html).toContain('Sealed')
  })

  it('contains no email addresses, no user_id, no admin-only fields', () => {
    const html = render([rowFixture()])
    expect(html).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(html).not.toMatch(/user_id|userId|email|provider_sale_key|raw_hash|raw_metadata|rejection_reason/i)
  })

  it('renders multiple rows in order', () => {
    const html = render([
      rowFixture({ saleDate: '2026-06-21', salePriceCents: 12500 }),
      rowFixture({ saleDate: '2026-06-18', salePriceCents: 4500, gradingCompany: null, grade: null, rawOrGraded: 'raw', bestOfferStatus: 'none' }),
    ])
    const idx21 = html.indexOf('21 Jun 2026')
    const idx18 = html.indexOf('18 Jun 2026')
    expect(idx21).toBeGreaterThanOrEqual(0)
    expect(idx18).toBeGreaterThan(idx21)
  })
})
