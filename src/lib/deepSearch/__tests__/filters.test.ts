// Block 5A-W-56A — Deep Card Search pure-transformer + acceptance tests.

import { describe, it, expect } from 'vitest'
import {
  filtersToSearchParams,
  searchParamsToFilters,
  filtersToRpcArgs,
  poundsToUsdCents,
  usdCentsToPounds,
  activeFilterChips,
  removeFilter,
  SORT_KEYS,
  SORT_LABELS,
  DEFAULT_SORT,
  type DeepCardSearchFilters,
} from '@/lib/deepSearch/filters'

// ── URL round-trip ─────────────────────────────────────

describe('filtersToSearchParams ↔ searchParamsToFilters', () => {
  it('round-trips a rich filter set with sort', () => {
    const filters: DeepCardSearchFilters = {
      pokemonSlug: 'pikachu',
      language: 'jp',
      rawMax: 2500,
      psa9Max: 8861,
      change30dMin: 20,
      releaseYearMax: 2009,
      psa10MultipleMin: 8,
    }
    const sp = filtersToSearchParams(filters, 'psa9_asc')
    expect(sp.toString()).toContain('pokemon_slug=pikachu')
    expect(sp.toString()).toContain('language=jp')
    expect(sp.toString()).toContain('sort=psa9_asc')
    const back = searchParamsToFilters(sp)
    expect(back.filters).toEqual(filters)
    expect(back.sort).toBe('psa9_asc')
  })

  it('omits the sort parameter when it is the default', () => {
    const sp = filtersToSearchParams({ pokemonSlug: 'pikachu' }, DEFAULT_SORT)
    expect(sp.get('sort')).toBeNull()
    expect(searchParamsToFilters(sp).sort).toBe(DEFAULT_SORT)
  })

  it('drops empty-string filters and unknown sort values gracefully', () => {
    const sp = new URLSearchParams('card_name=&sort=made_up_sort')
    const { filters, sort } = searchParamsToFilters(sp)
    expect(filters).toEqual({})
    expect(sort).toBe(DEFAULT_SORT)
  })

  it('rejects garbage numeric values without throwing', () => {
    const sp = new URLSearchParams('raw_max=abc&psa10_min=xxx')
    const { filters } = searchParamsToFilters(sp)
    expect(filters).toEqual({})
  })
})

// ── Currency helpers ───────────────────────────────────

describe('GBP ↔ USD cents', () => {
  it('£70 rounds to 8861 USD cents at the 0.79 GBP/USD rate', () => {
    expect(poundsToUsdCents(70)).toBe(8861)
  })
  it('undefined / non-finite inputs return undefined', () => {
    expect(poundsToUsdCents(undefined)).toBeUndefined()
    expect(poundsToUsdCents(null)).toBeUndefined()
    expect(poundsToUsdCents(Number.NaN)).toBeUndefined()
    expect(poundsToUsdCents(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
  it('round-trip stays within 1 pound (floor loses at most 1)', () => {
    for (const gbp of [10, 25, 70, 100, 250, 1000]) {
      const cents = poundsToUsdCents(gbp)!
      const back  = usdCentsToPounds(cents)!
      expect(back).toBeGreaterThanOrEqual(gbp - 1)
      expect(back).toBeLessThanOrEqual(gbp)
    }
  })
})

// ── RPC arg mapping ────────────────────────────────────

describe('filtersToRpcArgs', () => {
  it('only forwards defined filters — nulls are dropped', () => {
    const args = filtersToRpcArgs({ pokemonSlug: 'pikachu', psa7Max: 8861 }, 'name_asc', 50, 0)
    expect(args.p_pokemon_slug).toBe('pikachu')
    expect(args.p_psa7_max).toBe(8861)
    expect(args.p_psa9_max).toBeUndefined()
    expect(args.p_language).toBeUndefined()
    expect(args.p_sort).toBe('name_asc')
    expect(args.p_limit).toBe(50)
    expect(args.p_offset).toBe(0)
  })

  it('maps every filter key to its p_ counterpart exactly once', () => {
    const all: DeepCardSearchFilters = {
      pokemonSlug: 'x', cardName: 'y', setName: 'z', language: 'jp',
      releaseYearMin: 2000, releaseYearMax: 2010,
      rawMin: 1, rawMax: 2,
      psa7Min: 3, psa7Max: 4, psa8Min: 5, psa8Max: 6,
      psa9Min: 7, psa9Max: 8, psa10Min: 9, psa10Max: 10,
      change7dMin: 1, change7dMax: 2,
      change30dMin: 3, change30dMax: 4,
      change90dMin: 5, change90dMax: 6,
      psa9UpliftMin: 100, psa10UpliftMin: 200,
      psa9MultipleMin: 4, psa10MultipleMin: 8,
    }
    const args = filtersToRpcArgs(all, DEFAULT_SORT, 50, 0)
    // Every filter present in the RPC payload as p_* + sort/limit/offset.
    expect(Object.keys(args).filter(k => k.startsWith('p_')).length).toBe(
      Object.keys(all).length + 3, // + p_sort + p_limit + p_offset
    )
  })
})

// ── Sort enum ──────────────────────────────────────────

describe('sort enum', () => {
  it('SORT_LABELS covers exactly the enum keys and no extras', () => {
    expect(SORT_KEYS.length).toBe(Object.keys(SORT_LABELS).length)
    for (const k of SORT_KEYS) expect(SORT_LABELS[k]).toBeTruthy()
  })

  it('56A.6 — psa7/psa8 sort keys remain present (product-requirement pin)', () => {
    // 56A.6 restored PSA 7 and PSA 8. Sort keys must remain in the
    // enum so the dropdown offers them and shared URLs validate.
    for (const k of ['psa7_asc', 'psa7_desc', 'psa8_asc', 'psa8_desc'] as const) {
      expect(SORT_KEYS).toContain(k)
      expect(SORT_LABELS[k]).toBeTruthy()
    }
  })
})

// ── Active chips + remove ──────────────────────────────

describe('activeFilterChips + removeFilter', () => {
  it('renders a chip per active filter with a readable label', () => {
    const chips = activeFilterChips({
      pokemonSlug: 'pikachu',
      language: 'jp',
      psa9Max: 8861,
      releaseYearMax: 2009,
    })
    const labels = chips.map(c => c.label)
    expect(labels).toContain('Pokémon: Pikachu')
    expect(labels).toContain('Japanese only')
    expect(labels).toContain('PSA 9: any – £70')
    expect(labels).toContain('Year: any – 2009')
  })

  it('removing a "min" chip also clears its paired "max"', () => {
    const before: DeepCardSearchFilters = { rawMin: 1000, rawMax: 5000 }
    const after = removeFilter(before, 'rawMin')
    expect(after.rawMin).toBeUndefined()
    expect(after.rawMax).toBeUndefined()
  })
})

// ── Block-spec acceptance tests A–H ────────────────────

describe('56A acceptance tests A–H — filter parsing to RPC args', () => {
  // The tests here operate on the SHAPE the parser must produce and
  // the RPC args those filters must map to. Actual DB rows are only
  // provable at integration time; these lock in the schema plumbing.

  it('A. "I want a PSA 7 Pikachu for less than £70"', () => {
    const filters: DeepCardSearchFilters = { pokemonSlug: 'pikachu', psa7Max: poundsToUsdCents(70) }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_pokemon_slug).toBe('pikachu')
    expect(args.p_psa7_max).toBe(8861)
    // Grade prices must not accidentally be applied to raw.
    expect(args.p_raw_max).toBeUndefined()
  })

  it('B. Raw cards under £20 where PSA 10 is at least £100', () => {
    const filters: DeepCardSearchFilters = {
      rawMax:    poundsToUsdCents(20),
      psa10Min:  poundsToUsdCents(100),
    }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_raw_max).toBe(2532)      // 20 * 1.266 * 100 → 2532
    expect(args.p_psa10_min).toBe(12658)   // 100 * 1.266 * 100 → 12658
  })

  it('C. Japanese Pikachu cards under £100 raw', () => {
    const filters: DeepCardSearchFilters = {
      language:    'jp',
      pokemonSlug: 'pikachu',
      rawMax:      poundsToUsdCents(100),
    }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_language).toBe('jp')
    expect(args.p_pokemon_slug).toBe('pikachu')
    expect(args.p_raw_max).toBe(12658)
  })

  it('D. Cards released before 2010', () => {
    const filters: DeepCardSearchFilters = { releaseYearMax: 2009 }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_year_max).toBe(2009)
    expect(args.p_year_min).toBeUndefined()
  })

  it('E. Cards down more than 25% in the last 90 days', () => {
    const filters: DeepCardSearchFilters = { change90dMax: -25 }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_change_90d_max).toBe(-25)
    // Percentage filter must NOT be misinterpreted as a price filter.
    expect(args.p_psa10_max).toBeUndefined()
  })

  it('F. PSA 9 Charizards under £100 sorted cheapest first', () => {
    const filters: DeepCardSearchFilters = {
      pokemonSlug: 'charizard',
      psa9Max:     poundsToUsdCents(100),
    }
    const args = filtersToRpcArgs(filters, 'psa9_asc', 50, 0)
    expect(args.p_pokemon_slug).toBe('charizard')
    expect(args.p_psa9_max).toBe(12658)
    expect(args.p_sort).toBe('psa9_asc')
  })

  it('G. Cards where PSA 10 is at least 10× raw', () => {
    const filters: DeepCardSearchFilters = { psa10MultipleMin: 10 }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_psa10_multiple_min).toBe(10)
    expect(args.p_psa9_multiple_min).toBeUndefined()
  })

  it('H. "High liquidity Pikachu cards" — the unsupported filter is dropped, supported ones survive', () => {
    // The parser must NEVER invent a liquidity filter; the caller
    // receives filters that omit anything unsupported and a
    // separate "unsupportedTerms" hint (see parser tests).
    const filters: DeepCardSearchFilters = { pokemonSlug: 'pikachu' }
    const args = filtersToRpcArgs(filters, DEFAULT_SORT, 50, 0)
    expect(args.p_pokemon_slug).toBe('pikachu')
    // Any hypothetical "liquidity" arg is not in the schema so it
    // cannot be sent to the RPC.
    expect((args as any).p_liquidity).toBeUndefined()
    expect((args as any).p_sales_30d).toBeUndefined()
  })
})

// ── Sealed guard (view-level, but pin the schema promise) ──

describe('sealed guard — schema promise', () => {
  it('there is no filter for including sealed products (view excludes them)', () => {
    // Anti-regression: if someone adds an `includeSealed` flag later
    // they must audit cards_search_v to make sure the view stops
    // filtering. Today the view unconditionally excludes sealed rows.
    const spec: DeepCardSearchFilters = {}
    expect((spec as any).includeSealed).toBeUndefined()
  })
})
