// Block 5A-W-46C — pure tests for the Pokémon page summary builder.

import { describe, it, expect } from 'vitest'
import {
  buildPokemonSummary,
  computeRawRange,
  pickTopByRaw,
  pickTopByPsa10,
  pickTopMover,
  type PokemonSummaryCardRow,
} from '../pokemonSummary'

const greninjaSpecies = { name: 'greninja', total_cards: 63 }

const greninjaTop: PokemonSummaryCardRow[] = [
  {
    card_name: 'Greninja Gold Star', set_name: 'Celebrations',
    card_url_slug: 'greninja-gold-star-swsh144',
    current_raw: 1_840, current_psa10: 16_200, raw_pct_30d: -4.2,
  },
  {
    card_name: 'Greninja BREAK', set_name: 'BREAKpoint',
    card_url_slug: 'greninja-break-41',
    current_raw: 400, current_psa10: 5_500, raw_pct_30d: 0.2,
  },
]

const greninjaRisers: PokemonSummaryCardRow[] = [
  {
    card_name: 'Ash-Greninja', set_name: 'Steam Siege',
    card_url_slug: 'ash-greninja-xy',
    current_raw: 950, current_psa10: null, raw_pct_30d: 12.4,
  },
]

const greninjaBySet = [
  { set_name: 'Celebrations' }, { set_name: 'BREAKpoint' },
  { set_name: 'Steam Siege' }, { set_name: 'Chaos Rising' },
]

// ── computeRawRange ────────────────────────────────────────────

describe('computeRawRange', () => {
  it('returns null on empty / null / undefined / non-array', () => {
    expect(computeRawRange([])).toBeNull()
    expect(computeRawRange(null)).toBeNull()
    expect(computeRawRange(undefined)).toBeNull()
  })

  it('ignores non-positive / non-finite values', () => {
    expect(computeRawRange([
      { card_name: 'A', set_name: 'S', current_raw: 0 },
      { card_name: 'B', set_name: 'S', current_raw: null },
      { card_name: 'C', set_name: 'S', current_raw: Number.NaN },
    ])).toBeNull()
  })

  it('returns min + max in cents', () => {
    const r = computeRawRange(greninjaTop)
    expect(r).toEqual({ minCents: 400, maxCents: 1_840 })
  })
})

// ── pickTopByRaw / pickTopByPsa10 / pickTopMover ───────────────

describe('pickers', () => {
  it('pickTopByRaw picks the largest positive current_raw', () => {
    expect(pickTopByRaw(greninjaTop)?.card_name).toBe('Greninja Gold Star')
  })

  it('pickTopByRaw returns null when no row has a positive raw', () => {
    expect(pickTopByRaw([{ card_name: 'X', set_name: 'S', current_raw: 0 }])).toBeNull()
  })

  it('pickTopByPsa10 picks the largest positive current_psa10', () => {
    expect(pickTopByPsa10(greninjaTop)?.card_name).toBe('Greninja Gold Star')
  })

  it('pickTopMover uses absolute pct_30d', () => {
    expect(pickTopMover(greninjaRisers)?.card_name).toBe('Ash-Greninja')
    // Negative movers beat smaller positive movers.
    expect(pickTopMover([
      { card_name: 'A', set_name: 'S', raw_pct_30d: 5 },
      { card_name: 'B', set_name: 'S', raw_pct_30d: -20 },
    ])?.card_name).toBe('B')
  })
})

// ── buildPokemonSummary ────────────────────────────────────────

describe('buildPokemonSummary — assembly', () => {
  it('renders card count + set count + range + top valuable + top mover when present', () => {
    // W46C-FIX1: with the greninjaTop fixture (same card wins raw +
    // PSA 10) the summary now emits the combined `top_valuable` key
    // instead of separate `top_raw` + `top_psa10` facts.
    const out = buildPokemonSummary({
      species: greninjaSpecies,
      topCards: greninjaTop,
      risers: greninjaRisers,
      fallers: [],
      bySet: greninjaBySet,
      allCards: greninjaTop,
    })
    expect(out.render).toBe(true)
    expect(out.displayName).toBe('Greninja')
    const keys = out.facts.map(f => f.key)
    expect(keys).toContain('card_count')
    expect(keys).toContain('set_count')
    expect(keys).toContain('raw_range')
    expect(keys).toContain('top_valuable')
    expect(keys).toContain('top_mover_30d')
  })

  it('W46C-FIX1 — when the same card wins both categories, merges into a single "Most valuable card" fact with both prices', () => {
    // Top raw = Gold Star, top PSA10 = Gold Star.
    const out = buildPokemonSummary({
      species: greninjaSpecies,
      topCards: greninjaTop,
      risers: [],
      bySet: greninjaBySet,
      allCards: greninjaTop,
    })
    // Combined fact must exist.
    const combined = out.facts.find(f => f.key === 'top_valuable')
    expect(combined).toBeDefined()
    expect(combined?.label).toBe('Most valuable card')
    // Shows BOTH prices, not just one.
    expect(combined?.value).toMatch(/raw/)
    expect(combined?.value).toMatch(/PSA 10/)
    // And the split facts are absent.
    expect(out.facts.find(f => f.key === 'top_raw')).toBeUndefined()
    expect(out.facts.find(f => f.key === 'top_psa10')).toBeUndefined()
  })

  it('W46C-FIX1 — when raw + PSA 10 winners are different cards, renders BOTH facts', () => {
    const topCards: PokemonSummaryCardRow[] = [
      { card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000, current_psa10: 6_000 },
      { card_name: 'Y', set_name: 'S', card_url_slug: 'y', current_raw: 1_000, current_psa10: 25_000 },
    ]
    const out = buildPokemonSummary({
      species: greninjaSpecies, topCards, bySet: [{ set_name: 'S' }],
    })
    const topRaw   = out.facts.find(f => f.key === 'top_raw')
    const topPsa10 = out.facts.find(f => f.key === 'top_psa10')
    expect(topRaw?.value).toContain('X')
    expect(topPsa10?.value).toContain('Y')
    // Combined key must NOT appear.
    expect(out.facts.find(f => f.key === 'top_valuable')).toBeUndefined()
  })

  it('W46C-FIX1 — missing raw winner: only PSA 10 fact renders', () => {
    const topCards: PokemonSummaryCardRow[] = [
      { card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 0, current_psa10: 5_000 },
    ]
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 1 }, topCards, bySet: [{ set_name: 'S' }],
    })
    expect(out.facts.find(f => f.key === 'top_raw')).toBeUndefined()
    expect(out.facts.find(f => f.key === 'top_psa10')?.value).toContain('X')
    expect(out.facts.find(f => f.key === 'top_valuable')).toBeUndefined()
  })

  it('W46C-FIX1 — missing PSA 10 winner: only raw fact renders', () => {
    const topCards: PokemonSummaryCardRow[] = [
      { card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000, current_psa10: null },
    ]
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 1 }, topCards, bySet: [{ set_name: 'S' }],
    })
    expect(out.facts.find(f => f.key === 'top_raw')?.value).toContain('X')
    expect(out.facts.find(f => f.key === 'top_psa10')).toBeUndefined()
    expect(out.facts.find(f => f.key === 'top_valuable')).toBeUndefined()
  })

  it('W46C-FIX1 — never renders a duplicated or ambiguous "Most valuable" label', () => {
    // Same winner. There must be exactly ONE fact matching /^Most valuable/.
    const out = buildPokemonSummary({
      species: greninjaSpecies,
      topCards: greninjaTop, bySet: greninjaBySet, allCards: greninjaTop,
    })
    const mostValuableCount = out.facts.filter(f => /^Most valuable/.test(f.label)).length
    expect(mostValuableCount).toBe(1)
  })

  it('omits raw_range when max is within 5% of min (not a meaningful range)', () => {
    const flat: PokemonSummaryCardRow[] = [
      { card_name: 'A', set_name: 'S', card_url_slug: 'a', current_raw: 1_000 },
      { card_name: 'B', set_name: 'S', card_url_slug: 'b', current_raw: 1_020 },
    ]
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 2 },
      topCards: flat, bySet: [{ set_name: 'S' }], allCards: flat,
    })
    expect(out.facts.find(f => f.key === 'raw_range')).toBeUndefined()
  })

  it('does NOT render when fewer than 2 facts available', () => {
    // Only a species with 0 cards — no facts at all.
    const out = buildPokemonSummary({
      species: { name: 'zubat', total_cards: 0 },
      topCards: [], bySet: [], allCards: [],
    })
    expect(out.render).toBe(false)
  })

  it('never renders fabricated prices when data is empty', () => {
    const out = buildPokemonSummary({
      species: greninjaSpecies,
      topCards: [], bySet: greninjaBySet, allCards: [],
    })
    // Only 2 facts (card_count, set_count) — no top_raw / range.
    for (const f of out.facts) {
      expect(f.value).not.toMatch(/\$0(\.|$)/)
    }
  })

  it('W46C-FIX1 — biggest mover picks the largest ABSOLUTE pct_30d across risers AND fallers combined', () => {
    // +2% riser vs -35% faller → -35% wins.
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 2 },
      topCards: [
        { card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000, current_psa10: 5_000 },
      ],
      risers:  [{ card_name: 'Riser',  set_name: 'S', card_url_slug: 'r', raw_pct_30d:  2 }],
      fallers: [{ card_name: 'Faller', set_name: 'S', card_url_slug: 'f', raw_pct_30d: -35 }],
      bySet:   [{ set_name: 'S' }],
    })
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.value).toContain('Faller')
    expect(mover?.value).toContain('-35.0%')
    expect(mover?.variant).toBe('down')
  })

  it('W46C-FIX1 — biggest mover: +18% beats -12%', () => {
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 2 },
      topCards: [{ card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000 }],
      risers:  [{ card_name: 'R1', set_name: 'S', card_url_slug: 'r1', raw_pct_30d:  18 }],
      fallers: [{ card_name: 'F1', set_name: 'S', card_url_slug: 'f1', raw_pct_30d: -12 }],
      bySet:   [{ set_name: 'S' }],
    })
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.value).toContain('R1')
    expect(mover?.value).toContain('+18.0%')
    expect(mover?.variant).toBe('up')
  })

  it('W46C-FIX1 — biggest mover rejects NaN / Infinity / null / undefined pct_30d', () => {
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 3 },
      topCards: [{ card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000 }],
      risers: [
        { card_name: 'Bad1', set_name: 'S', card_url_slug: 'b1', raw_pct_30d: Number.NaN },
        { card_name: 'Bad2', set_name: 'S', card_url_slug: 'b2', raw_pct_30d: Number.POSITIVE_INFINITY },
        { card_name: 'Bad3', set_name: 'S', card_url_slug: 'b3', raw_pct_30d: null },
        { card_name: 'Good', set_name: 'S', card_url_slug: 'g',  raw_pct_30d: 4 },
      ],
      fallers: [],
      bySet: [{ set_name: 'S' }],
    })
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.value).toContain('Good')
  })

  it('W46C-FIX1 — biggest mover with ties: deterministic order (first row wins)', () => {
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 2 },
      topCards: [{ card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000 }],
      risers: [
        { card_name: 'A', set_name: 'S', card_url_slug: 'a', raw_pct_30d:  20 },
        { card_name: 'B', set_name: 'S', card_url_slug: 'b', raw_pct_30d: -20 },
      ],
      fallers: [],
      bySet: [{ set_name: 'S' }],
    })
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.value).toContain('A')
  })

  it('W46C-FIX1 — biggest mover: when only fallers exist, still surfaces a fall', () => {
    const out = buildPokemonSummary({
      species: { name: 'x', total_cards: 1 },
      topCards: [{ card_name: 'X', set_name: 'S', card_url_slug: 'x', current_raw: 5_000 }],
      risers: [],
      fallers: [{ card_name: 'F', set_name: 'S', card_url_slug: 'f', raw_pct_30d: -8 }],
      bySet: [{ set_name: 'S' }],
    })
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.value).toContain('F')
    expect(mover?.variant).toBe('down')
  })

  it('adds a link href to callable top-card facts', () => {
    // With the greninjaTop fixture the same card wins raw + PSA 10, so
    // the combined `top_valuable` fact carries the link. `top_mover_30d`
    // pulls from risers with a positive pct so its variant is 'up'.
    const out = buildPokemonSummary({
      species: greninjaSpecies, topCards: greninjaTop,
      bySet: greninjaBySet, risers: greninjaRisers, allCards: greninjaTop,
    })
    const combined = out.facts.find(f => f.key === 'top_valuable')
    expect(combined?.linkHref).toBe(`/set/${encodeURIComponent('Celebrations')}/card/greninja-gold-star-swsh144`)
    const mover = out.facts.find(f => f.key === 'top_mover_30d')
    expect(mover?.linkHref).toBe(`/set/${encodeURIComponent('Steam Siege')}/card/ash-greninja-xy`)
    expect(mover?.variant).toBe('up')
  })

  it('does not emit a link when card_url_slug is missing (avoid guessed URLs)', () => {
    const out = buildPokemonSummary({
      species: greninjaSpecies,
      topCards: [{ card_name: 'X', set_name: 'S', card_url_slug: null, current_raw: 5_000, current_psa10: null }],
      bySet: [{ set_name: 'S' }],
    })
    const topRaw = out.facts.find(f => f.key === 'top_raw')
    expect(topRaw?.linkHref).toBeNull()
  })
})

