// Block 5A-W-50E — set page URL state tests. Preserves the exact
// existing SortOption values from SetPageClient.tsx.

import { describe, it, expect } from 'vitest'
import { parseSetUrl, serializeSetUrl, SET_DEFAULTS, __TEST__ } from '../setUrlState'

describe('parseSetUrl — existing sort identifiers', () => {
  const existingSetSorts = ['raw_desc', 'raw_asc', 'psa10_desc', 'name_asc', 'number_asc'] as const

  for (const s of existingSetSorts) {
    it(`accepts sort=${s} bookmarked from the pre-block set page`, () => {
      expect(parseSetUrl(new URLSearchParams(`sort=${s}`)).sort).toBe(s)
    })
  }

  it('falls back to default on unknown sort', () => {
    expect(parseSetUrl(new URLSearchParams('sort=hodor')).sort).toBe(SET_DEFAULTS.sort)
  })

  it('SORT list exactly matches the existing set page identifiers', () => {
    expect(new Set(__TEST__.SORTS)).toEqual(
      new Set(['raw_desc', 'raw_asc', 'psa10_desc', 'name_asc', 'number_asc']),
    )
  })
})

describe('serializeSetUrl', () => {
  it('omits default sort so /set/Foo stays canonical', () => {
    const out = serializeSetUrl({ sort: SET_DEFAULTS.sort }, new URLSearchParams())
    expect(out.toString()).toBe('')
  })

  it('preserves unrelated params', () => {
    const existing = new URLSearchParams('utm_source=twitter')
    const out = serializeSetUrl({ sort: 'name_asc' }, existing)
    expect(out.get('utm_source')).toBe('twitter')
    expect(out.get('sort')).toBe('name_asc')
  })
})
