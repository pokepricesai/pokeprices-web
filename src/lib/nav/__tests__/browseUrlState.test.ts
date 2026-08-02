// Block 5A-W-50E — browse URL state parser / serializer tests.
//
// Mandatory: the exact existing sort identifiers must continue to be
// recognised. Any invented sort name (e.g. name_asc, count_desc) is a
// regression and must not be introduced.

import { describe, it, expect } from 'vitest'
import {
  BROWSE_DEFAULTS,
  parseBrowseUrl,
  serializeBrowseUrl,
  __TEST__,
} from '../browseUrlState'

describe('parseBrowseUrl — existing sort identifiers', () => {
  const existingSorts = [
    'release_desc', 'release_asc', 'az', 'za',
    'price_desc', 'price_asc', 'cards_desc',
  ] as const

  for (const s of existingSorts) {
    it(`accepts sort=${s} bookmarked from the pre-block browse page`, () => {
      const params = new URLSearchParams(`sort=${s}`)
      const parsed = parseBrowseUrl(params, { canUseCompletion: false })
      expect(parsed.sort).toBe(s)
    })
  }

  it('accepts completion_desc only when canUseCompletion is true', () => {
    const params = new URLSearchParams('sort=completion_desc')
    expect(parseBrowseUrl(params, { canUseCompletion: true }).sort).toBe('completion_desc')
    expect(parseBrowseUrl(params, { canUseCompletion: false }).sort).toBe(BROWSE_DEFAULTS.sort)
  })

  it('does NOT accept invented sort identifiers', () => {
    // These names are NOT part of the existing browse page. Guarding
    // against a future refactor that quietly renames the enum.
    for (const bad of ['name_asc', 'count_desc', 'count_asc']) {
      expect(__TEST__.SORTS as readonly string[]).not.toContain(bad)
    }
  })

  it('falls back to default on unknown sort', () => {
    const params = new URLSearchParams('sort=hodor')
    expect(parseBrowseUrl(params, { canUseCompletion: true }).sort).toBe(BROWSE_DEFAULTS.sort)
  })
})

describe('parseBrowseUrl — language / era / q', () => {
  it('accepts each valid language', () => {
    for (const lang of ['en', 'jp', 'all']) {
      expect(parseBrowseUrl(new URLSearchParams(`language=${lang}`), { canUseCompletion: false }).language).toBe(lang)
    }
  })
  it('falls back to default on unknown language', () => {
    expect(parseBrowseUrl(new URLSearchParams('language=de'), { canUseCompletion: false }).language).toBe(BROWSE_DEFAULTS.language)
  })
  it('trims and caps q', () => {
    const long = 'a'.repeat(200)
    const parsed = parseBrowseUrl(new URLSearchParams(`q=  ${long}  `), { canUseCompletion: false })
    expect(parsed.q.length).toBeLessThanOrEqual(__TEST__.Q_MAX)
    expect(parsed.q.startsWith('a')).toBe(true)
  })
  it('treats empty era as default', () => {
    expect(parseBrowseUrl(new URLSearchParams(''), { canUseCompletion: false }).era).toBe(BROWSE_DEFAULTS.era)
  })
})

describe('serializeBrowseUrl', () => {
  it('omits keys equal to default so /browse stays canonical', () => {
    const out = serializeBrowseUrl(BROWSE_DEFAULTS, new URLSearchParams())
    expect(out.toString()).toBe('')
  })

  it('sets non-default keys', () => {
    const out = serializeBrowseUrl(
      { language: 'jp', era: BROWSE_DEFAULTS.era, sort: 'cards_desc', q: 'charizard' },
      new URLSearchParams(),
    )
    expect(out.get('language')).toBe('jp')
    expect(out.get('sort')).toBe('cards_desc')
    expect(out.get('q')).toBe('charizard')
    expect(out.get('era')).toBeNull()
  })

  it('preserves unrelated existing query parameters', () => {
    const existing = new URLSearchParams('utm_source=twitter&referrer=x')
    const out = serializeBrowseUrl(
      { language: 'jp', era: BROWSE_DEFAULTS.era, sort: BROWSE_DEFAULTS.sort, q: '' },
      existing,
    )
    expect(out.get('utm_source')).toBe('twitter')
    expect(out.get('referrer')).toBe('x')
    expect(out.get('language')).toBe('jp')
  })

  it('round-trips through parseBrowseUrl for all existing sorts', () => {
    for (const s of ['release_desc', 'release_asc', 'az', 'za', 'price_desc', 'price_asc', 'cards_desc'] as const) {
      const encoded = serializeBrowseUrl(
        { language: 'jp', era: BROWSE_DEFAULTS.era, sort: s, q: '' },
        new URLSearchParams(),
      )
      const parsed = parseBrowseUrl(new URLSearchParams(encoded.toString()), { canUseCompletion: false })
      expect(parsed.sort).toBe(s)
      expect(parsed.language).toBe('jp')
    }
  })
})
