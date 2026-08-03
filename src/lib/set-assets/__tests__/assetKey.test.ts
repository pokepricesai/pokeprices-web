// Block 5A-W-50H — stable asset-key unit tests.

import { describe, it, expect } from 'vitest'
import {
  assetKeyForJpSet,
  detectKeyCollisions,
  slugify,
  stripJapanesePrefix,
} from '../assetKey'

describe('stripJapanesePrefix', () => {
  it('removes the leading "Japanese " token', () => {
    expect(stripJapanesePrefix('Japanese Battle Partners')).toBe('Battle Partners')
  })
  it('is case sensitive on the exact leading token', () => {
    expect(stripJapanesePrefix('japanese Battle Partners')).toBe('japanese Battle Partners')
  })
  it('leaves non-prefixed names alone', () => {
    expect(stripJapanesePrefix('Battle Partners')).toBe('Battle Partners')
  })
})

describe('slugify', () => {
  it('produces filesystem-safe ASCII', () => {
    expect(slugify('Battle Partners')).toBe('battle-partners')
  })
  it('collapses runs of non-alnum', () => {
    expect(slugify('  Hello / World !!')).toBe('hello-world')
  })
  it('drops smart apostrophes cleanly', () => {
    expect(slugify("Leaders’ Stadium")).toBe('leaders-stadium')
  })
  it('harmonises ampersand as "and"', () => {
    expect(slugify('Wild Force & Cyber Judge')).toBe('wild-force-and-cyber-judge')
  })
  it('is deterministic', () => {
    for (const input of ['Battle Partners', "Leaders’ Stadium", '2002 McDonald’s Collection']) {
      expect(slugify(input)).toBe(slugify(input))
    }
  })
  it('trims to a bounded length', () => {
    const long = 'x'.repeat(1000)
    expect(slugify(long).length).toBeLessThanOrEqual(80)
  })
})

describe('assetKeyForJpSet', () => {
  it('strips Japanese prefix + slugifies', () => {
    expect(assetKeyForJpSet('Japanese Battle Partners')).toBe('battle-partners')
  })
  it('handles punctuation-heavy names', () => {
    expect(assetKeyForJpSet("Japanese Leaders’ Stadium")).toBe('leaders-stadium')
    expect(assetKeyForJpSet("Japanese 2002 McDonald's Collection")).toBe('2002-mcdonalds-collection')
  })
  it('handles Japanese Old Maid (the 127th set that was missing from the earlier RPC-based flow)', () => {
    expect(assetKeyForJpSet('Japanese Old Maid')).toBe('old-maid')
  })
  it('throws when the derived key would be empty', () => {
    // Set name that becomes empty after prefix strip + slug.
    expect(() => assetKeyForJpSet('Japanese ???')).toThrow(/could not derive/)
  })
})

describe('detectKeyCollisions', () => {
  it('returns empty when every name maps to a unique key', () => {
    expect(detectKeyCollisions([
      'Japanese Battle Partners',
      'Japanese Wild Force',
      'Japanese Cyber Judge',
    ])).toEqual([])
  })

  it('reports colliding groups', () => {
    // Hypothetical: two set names that only differ by punctuation
    // would slugify to the same key. This is exactly what the
    // scaffold must catch loudly rather than pick one arbitrarily.
    const c = detectKeyCollisions([
      "Japanese Leaders’ Stadium",
      'Japanese Leaders Stadium',
    ])
    expect(c).toHaveLength(1)
    expect(c[0].key).toBe('leaders-stadium')
    expect(c[0].setNames).toHaveLength(2)
  })

  it('empty input has no collisions', () => {
    expect(detectKeyCollisions([])).toEqual([])
  })
})
