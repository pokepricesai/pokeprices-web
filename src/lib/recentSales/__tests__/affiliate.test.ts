// Block 4B-W-8A — pure mapping helper.
// Covers every key shape produced by deriveGradeKey in cardQueries.ts.

import { describe, it, expect } from 'vitest'
import { affiliateForGradeKey } from '../affiliate'

describe('affiliateForGradeKey — sponsored / canonical buckets', () => {
  it('returns a generic raw search for the all tab', () => {
    expect(affiliateForGradeKey('all')).toEqual({
      intent:    'raw',
      label:     'Find this card on eBay',
      placement: 'recent_sales_all',
    })
  })

  it('returns the raw search for the raw tab', () => {
    expect(affiliateForGradeKey('raw')).toEqual({
      intent:    'raw',
      label:     'Find raw copies on eBay',
      placement: 'recent_sales_raw',
    })
  })

  it('uses the dedicated psa10 intent for psa-10', () => {
    expect(affiliateForGradeKey('psa-10')).toEqual({
      intent:    'psa10',
      label:     'Find PSA 10 copies on eBay',
      placement: 'recent_sales_psa10',
    })
  })

  it('uses the dedicated psa9 intent for psa-9', () => {
    expect(affiliateForGradeKey('psa-9')).toEqual({
      intent:    'psa9',
      label:     'Find PSA 9 copies on eBay',
      placement: 'recent_sales_psa9',
    })
  })

  it('uses the dedicated psa8 intent for psa-8', () => {
    expect(affiliateForGradeKey('psa-8')).toEqual({
      intent:    'psa8',
      label:     'Find PSA 8 copies on eBay',
      placement: 'recent_sales_psa8',
    })
  })
})

describe('affiliateForGradeKey — other graded buckets', () => {
  it('maps psa-7 to the generic graded intent with company + grade', () => {
    expect(affiliateForGradeKey('psa-7')).toEqual({
      intent:         'graded',
      gradingCompany: 'PSA',
      grade:          '7',
      label:          'Find PSA 7 copies on eBay',
      placement:      'recent_sales_psa_7',
    })
  })

  it('maps cgc-10 to the generic graded intent with CGC + 10', () => {
    expect(affiliateForGradeKey('cgc-10')).toEqual({
      intent:         'graded',
      gradingCompany: 'CGC',
      grade:          '10',
      label:          'Find CGC 10 copies on eBay',
      placement:      'recent_sales_cgc_10',
    })
  })

  it('maps bgs-9.5 to the generic graded intent and embeds 9_5 in placement', () => {
    expect(affiliateForGradeKey('bgs-9.5')).toEqual({
      intent:         'graded',
      gradingCompany: 'BGS',
      grade:          '9.5',
      label:          'Find BGS 9.5 copies on eBay',
      placement:      'recent_sales_bgs_9_5',
    })
  })

  it('maps a bare company tag (cgc) to a company-only graded search', () => {
    expect(affiliateForGradeKey('cgc')).toEqual({
      intent:         'graded',
      gradingCompany: 'CGC',
      label:          'Find CGC copies on eBay',
      placement:      'recent_sales_cgc',
    })
  })

  it('maps the generic graded bucket to the engine graded intent', () => {
    expect(affiliateForGradeKey('graded')).toEqual({
      intent:    'graded',
      label:     'Find graded copies on eBay',
      placement: 'recent_sales_graded',
    })
  })
})

describe('affiliateForGradeKey — non-search keys', () => {
  it('returns null for an unknown bucket (other)', () => {
    expect(affiliateForGradeKey('other')).toBeNull()
  })

  it('returns null for an empty key', () => {
    expect(affiliateForGradeKey('')).toBeNull()
  })

  it('returns null for a malformed company-grade key', () => {
    expect(affiliateForGradeKey('not-a-company-10')).toBeNull()
  })

  it('ignores leading/trailing whitespace and case in the input', () => {
    expect(affiliateForGradeKey('  PSA-10  ')).toEqual({
      intent:    'psa10',
      label:     'Find PSA 10 copies on eBay',
      placement: 'recent_sales_psa10',
    })
  })
})
