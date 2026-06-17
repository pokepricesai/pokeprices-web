// Block 4B-W-1 — pure tests for the card-slug helper.

import { describe, it, expect } from 'vitest'
import {
  toBareCardSlug, toPriceCardSlug, isPriceCardSlug, extractPriceChartingProductId,
} from '../cardSlug'

describe('toBareCardSlug', () => {
  it('returns the bare slug for a bare numeric input', () => {
    expect(toBareCardSlug('959616')).toBe('959616')
    expect(toBareCardSlug('1')).toBe('1')
    expect(toBareCardSlug('12345678901234567890')).toBe('12345678901234567890')
  })

  it('strips the pc- prefix when present', () => {
    expect(toBareCardSlug('pc-959616')).toBe('959616')
    expect(toBareCardSlug('pc-1')).toBe('1')
  })

  it('trims surrounding whitespace and control characters', () => {
    expect(toBareCardSlug('  959616  ')).toBe('959616')
    expect(toBareCardSlug('  pc-959616  ')).toBe('959616')
    expect(toBareCardSlug('959616\x00')).toBe('959616')
  })

  it('rejects empty / whitespace-only', () => {
    expect(toBareCardSlug('')).toBeNull()
    expect(toBareCardSlug('   ')).toBeNull()
    expect(toBareCardSlug('\x00\x00')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(toBareCardSlug('959616x')).toBeNull()
    expect(toBareCardSlug('abc')).toBeNull()
    expect(toBareCardSlug('959-616')).toBeNull()
    expect(toBareCardSlug('959.616')).toBeNull()
    expect(toBareCardSlug('pc-')).toBeNull()
    expect(toBareCardSlug('pc-abc')).toBeNull()
    expect(toBareCardSlug('pc-pc-959616')).toBeNull()   // double-prefix rejected
    expect(toBareCardSlug('PC-959616')).toBeNull()       // case-sensitive
  })

  it('rejects non-string inputs', () => {
    expect(toBareCardSlug(null)).toBeNull()
    expect(toBareCardSlug(undefined)).toBeNull()
    expect(toBareCardSlug(42)).toBeNull()
    expect(toBareCardSlug({ slug: '959616' })).toBeNull()
    expect(toBareCardSlug(['959616'])).toBeNull()
    expect(toBareCardSlug(true)).toBeNull()
  })

  it('rejects unreasonably long inputs', () => {
    expect(toBareCardSlug('1'.repeat(33))).toBeNull()
  })
})

describe('toPriceCardSlug', () => {
  it('adds the pc- prefix for a bare numeric input', () => {
    expect(toPriceCardSlug('959616')).toBe('pc-959616')
    expect(toPriceCardSlug('1')).toBe('pc-1')
  })

  it('is idempotent — already-prefixed input round-trips unchanged', () => {
    expect(toPriceCardSlug('pc-959616')).toBe('pc-959616')
    expect(toPriceCardSlug(toPriceCardSlug('959616'))).toBe('pc-959616')
    expect(toPriceCardSlug(toPriceCardSlug(toPriceCardSlug('959616')))).toBe('pc-959616')
  })

  it('does not produce pc-pc-959616 under repeated application', () => {
    let slug: unknown = '959616'
    for (let i = 0; i < 5; i++) slug = toPriceCardSlug(slug)
    expect(slug).toBe('pc-959616')
  })

  it('returns null for the same malformed inputs as toBareCardSlug', () => {
    expect(toPriceCardSlug('')).toBeNull()
    expect(toPriceCardSlug('   ')).toBeNull()
    expect(toPriceCardSlug('pc-pc-959616')).toBeNull()
    expect(toPriceCardSlug('PC-959616')).toBeNull()
    expect(toPriceCardSlug('abc')).toBeNull()
    expect(toPriceCardSlug(null)).toBeNull()
    expect(toPriceCardSlug(42)).toBeNull()
  })
})

describe('isPriceCardSlug', () => {
  it('returns true for a valid pc-prefixed slug', () => {
    expect(isPriceCardSlug('pc-959616')).toBe(true)
    expect(isPriceCardSlug('pc-1')).toBe(true)
  })

  it('returns false for a bare slug', () => {
    expect(isPriceCardSlug('959616')).toBe(false)
  })

  it('returns false for malformed input', () => {
    expect(isPriceCardSlug('pc-')).toBe(false)
    expect(isPriceCardSlug('pc-abc')).toBe(false)
    expect(isPriceCardSlug('pc-pc-959616')).toBe(false)
    expect(isPriceCardSlug('PC-959616')).toBe(false)
    expect(isPriceCardSlug('')).toBe(false)
    expect(isPriceCardSlug(null)).toBe(false)
    expect(isPriceCardSlug(undefined)).toBe(false)
    expect(isPriceCardSlug(42)).toBe(false)
  })

  it('trims surrounding whitespace before checking', () => {
    expect(isPriceCardSlug('  pc-959616  ')).toBe(true)
  })
})

describe('extractPriceChartingProductId', () => {
  it('returns the bare slug when given one directly', () => {
    expect(extractPriceChartingProductId('959616')).toBe('959616')
  })

  it('strips the pc- prefix when given a prefixed slug', () => {
    expect(extractPriceChartingProductId('pc-959616')).toBe('959616')
  })

  it('extracts the numeric product id from a PriceCharting URL', () => {
    expect(extractPriceChartingProductId('https://www.pricecharting.com/game/pokemon-base-set/959616'))
      .toBe('959616')
    expect(extractPriceChartingProductId('https://www.pricecharting.com/game/pokemon-base-set/959616/'))
      .toBe('959616')
    expect(extractPriceChartingProductId('https://www.pricecharting.com/game/pokemon-base-set/959616?q=1'))
      .toBe('959616')
    expect(extractPriceChartingProductId('https://www.pricecharting.com/.../959616#section'))
      .toBe('959616')
  })

  it('extracts from a relative path', () => {
    expect(extractPriceChartingProductId('/some/path/959616/')).toBe('959616')
    expect(extractPriceChartingProductId('/959616')).toBe('959616')
  })

  it('returns null for a URL with no numeric id', () => {
    expect(extractPriceChartingProductId('https://example.com/no-id-here')).toBeNull()
    expect(extractPriceChartingProductId('https://www.pricecharting.com/game/pokemon-base-set/abcdef'))
      .toBeNull()
  })

  it('returns null for malformed / non-string input', () => {
    expect(extractPriceChartingProductId('')).toBeNull()
    expect(extractPriceChartingProductId(null)).toBeNull()
    expect(extractPriceChartingProductId(42)).toBeNull()
  })

  it('returns the LAST numeric segment when several are present', () => {
    // Real URLs sometimes carry a category id before the product id.
    expect(extractPriceChartingProductId('https://www.pricecharting.com/game/1234/959616'))
      .toBe('959616')
  })
})

describe('cross-helper invariants', () => {
  it('toBareCardSlug ∘ toPriceCardSlug is identity on valid input', () => {
    for (const v of ['1', '959616', '12345678', 'pc-959616']) {
      const round = toBareCardSlug(toPriceCardSlug(v))
      expect(round).toBe(toBareCardSlug(v))
    }
  })

  it('toPriceCardSlug ∘ toBareCardSlug is identity on valid pc- input', () => {
    expect(toPriceCardSlug(toBareCardSlug('pc-959616'))).toBe('pc-959616')
  })

  it('isPriceCardSlug ⇒ toBareCardSlug returns non-null', () => {
    for (const v of ['pc-1', 'pc-959616', 'pc-9000000']) {
      if (isPriceCardSlug(v)) expect(toBareCardSlug(v)).not.toBeNull()
    }
  })
})
