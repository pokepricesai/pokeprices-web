// src/lib/editorial/research/__tests__/dispatch.test.ts
//
// Block 6 — recipe-selection tests.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { chooseRecipe } from '../dispatch'

const base = { id: 1, angle: null, targetPublishAt: null }

describe('chooseRecipe', () => {
  it('selects monthly_market_report for article_type=monthly_market_report', () => {
    expect(chooseRecipe({ ...base, title: 'Anything', articleType: 'monthly_market_report' })).toBe('monthly_market_report')
  })
  it('selects monthly_market_report when title mentions "Market Report" + a month', () => {
    expect(chooseRecipe({ ...base, title: 'Pokemon Card Market Report — August 2026', articleType: 'evergreen' })).toBe('monthly_market_report')
  })
  it('selects population_scarcity for data_study projects mentioning population', () => {
    expect(chooseRecipe({ ...base, title: '20 cards with low PSA 10 populations', articleType: 'data_study' })).toBe('population_scarcity')
  })
  it('selects population_scarcity when angle mentions scarcity even without keyword in title', () => {
    expect(chooseRecipe({ ...base, title: 'Interesting study', angle: 'Very low PSA 10 population scarcity',   articleType: 'data_study' })).toBe('population_scarcity')
  })
  it('falls back to generic_fallback for unrecognised shapes', () => {
    expect(chooseRecipe({ ...base, title: 'New set launch guide', articleType: 'new_set' })).toBe('generic_fallback')
  })
})
