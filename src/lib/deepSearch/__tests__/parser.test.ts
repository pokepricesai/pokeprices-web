// Block 5A-W-56A — validate the pure output-validator of the Deep
// Card Search AI parser. Network + Claude interactions are not tested
// here (integration surface).

import { describe, it, expect } from 'vitest'
import { validateParsedOutput } from '@/app/api/deep-search/parse/route'

describe('validateParsedOutput — 56A parser output validator', () => {
  it('converts GBP price keys to USD cents and drops the *Gbp suffix', () => {
    const out = validateParsedOutput({
      filters: { pokemonSlug: 'Pikachu', psa7MaxGbp: 70 },
    })
    expect(out.filters).toEqual({
      pokemonSlug: 'pikachu',
      psa7Max: 8861,
    })
  })

  it('accepts language only when it is "en" or "jp"', () => {
    expect(validateParsedOutput({ filters: { language: 'jp' } }).filters.language).toBe('jp')
    expect(validateParsedOutput({ filters: { language: 'en' } }).filters.language).toBe('en')
    expect(validateParsedOutput({ filters: { language: 'fr' } }).filters.language).toBeUndefined()
  })

  it('drops unknown keys the model invented', () => {
    const out = validateParsedOutput({
      filters: { pokemonSlug: 'pikachu', liquidityMin: 999, madeUpKey: 'x' } as any,
    })
    expect(out.filters).toEqual({ pokemonSlug: 'pikachu' })
    expect((out.filters as any).liquidityMin).toBeUndefined()
    expect((out.filters as any).madeUpKey).toBeUndefined()
  })

  it('drops non-finite numerics (NaN / Infinity / strings)', () => {
    const out = validateParsedOutput({
      filters: {
        rawMaxGbp: 'abc' as any,
        psa10MinGbp: Number.NaN,
        change30dMax: Number.POSITIVE_INFINITY,
      },
    })
    expect(out.filters).toEqual({})
  })

  it('accepts sort only from the closed enum', () => {
    expect(validateParsedOutput({ sort: 'psa9_asc' }).sort).toBe('psa9_asc')
    expect(validateParsedOutput({ sort: 'made_up' }).sort).toBeUndefined()
    expect(validateParsedOutput({}).sort).toBeUndefined()
  })

  it('surfaces unsupported_terms as strings (dropping non-strings)', () => {
    const out = validateParsedOutput({
      unsupported_terms: ['liquidity', 42 as any, '', '  volume  '],
    })
    expect(out.unsupported_terms).toEqual(['liquidity', 'volume'])
  })

  it('block-spec H — a "liquidity" query keeps supported filters and lists liquidity as unsupported', () => {
    const out = validateParsedOutput({
      filters: { pokemonSlug: 'pikachu' },
      unsupported_terms: ['liquidity'],
    })
    expect(out.filters).toEqual({ pokemonSlug: 'pikachu' })
    expect(out.unsupported_terms).toContain('liquidity')
    // Belt-and-braces: no sales-volume or liquidity keys sneak into
    // the output regardless of what the model returns.
    expect((out.filters as any).liquidity).toBeUndefined()
    expect((out.filters as any).sales30d).toBeUndefined()
  })

  it('block-spec A — "PSA 7 Pikachu under £70" round-trips through the validator', () => {
    const out = validateParsedOutput({
      filters: { pokemonSlug: 'pikachu', psa7MaxGbp: 70 },
    })
    expect(out.filters).toEqual({ pokemonSlug: 'pikachu', psa7Max: 8861 })
  })

  it('block-spec B — raw < £20 AND PSA 10 >= £100', () => {
    const out = validateParsedOutput({
      filters: { rawMaxGbp: 20, psa10MinGbp: 100 },
    })
    expect(out.filters).toEqual({ rawMax: 2532, psa10Min: 12658 })
  })

  it('block-spec E — "down more than 25% in 90 days" maps to change90dMax = -25', () => {
    const out = validateParsedOutput({
      filters: { change90dMax: -25 },
    })
    expect(out.filters).toEqual({ change90dMax: -25 })
  })
})
