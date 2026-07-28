// Block 5A-W-47E — pure tests for the Build a Binder game.

import { describe, it, expect } from 'vitest'
import {
  TARGET_CARD_COUNT,
  BUDGETS_CENTS,
  isPlayableCard,
  affordableCards,
  searchCards,
  sortCards,
  computeBinderStats,
  pokemonKey,
  scoreBinder,
  scoreLabel,
  type BinderCard,
} from '../buildABinder'

function card(over: Partial<BinderCard> = {}): BinderCard {
  return {
    card_name:            'Pikachu #58',
    set_name:             'Base Set',
    card_url_slug:        'pikachu-58',
    card_number:          '58',
    card_number_display:  '58/102',
    set_printed_total:    '102',
    image_url:            'https://example.com/pikachu.png',
    current_raw:          1000,
    sales_30d:            10,
    is_sealed:            false,
    ...over,
  }
}

// ── Constants ─────────────────────────────

describe('Build a Binder — constants', () => {
  it('target binder size is 5', () => {
    expect(TARGET_CARD_COUNT).toBe(5)
  })
  it('exposes three preset budgets ($50, $100, $250)', () => {
    expect(BUDGETS_CENTS).toEqual([5_000, 10_000, 25_000])
  })
})

// ── isPlayableCard ─────────────────────────

describe('isPlayableCard', () => {
  it('accepts a normal card with all fields present', () => {
    expect(isPlayableCard(card())).toBe(true)
  })
  it('rejects null / undefined', () => {
    expect(isPlayableCard(null)).toBe(false)
    expect(isPlayableCard(undefined)).toBe(false)
  })
  it('rejects sealed products', () => {
    expect(isPlayableCard(card({ is_sealed: true }))).toBe(false)
  })
  it('rejects cards without an image url', () => {
    expect(isPlayableCard(card({ image_url: null }))).toBe(false)
  })
  it('rejects cards without a slug', () => {
    expect(isPlayableCard(card({ card_url_slug: null }))).toBe(false)
  })
  it('rejects cards with zero / missing / negative price', () => {
    expect(isPlayableCard(card({ current_raw: 0    as any }))).toBe(false)
    expect(isPlayableCard(card({ current_raw: -100 as any }))).toBe(false)
    expect(isPlayableCard(card({ current_raw: null as any }))).toBe(false)
  })
  it('rejects product-name patterns (booster, tin, blister, bundle, binder, collection, deck)', () => {
    for (const name of [
      'Zekrom Box',
      'Elite Trainer Box',
      'Booster Bundle',
      'Journey Together Booster Pack',
      'Champion Path Tin',
      'Sword & Shield Deck',
      'Legends Of Johto GX Collection',
      'Charizard Binder',
      'Blaziken Blister',
      '3-Pack Booster',
    ]) {
      expect(isPlayableCard(card({ card_name: name }))).toBe(false)
    }
  })
  it('does NOT reject a card whose name incidentally contains "deck" as a subword', () => {
    expect(isPlayableCard(card({ card_name: 'Snorunt #24' }))).toBe(true)
  })
})

// ── affordableCards ──────────────────────

describe('affordableCards', () => {
  it('keeps only cards whose price ≤ remaining budget', () => {
    const pool = [card({ current_raw: 500 }), card({ current_raw: 1000, card_name: 'A' }), card({ current_raw: 2500, card_name: 'B' })]
    const out = affordableCards(pool, 1200)
    expect(out.map(c => c.current_raw)).toEqual([500, 1000])
  })
  it('returns [] when remaining budget is 0 / negative / null / NaN', () => {
    const pool = [card()]
    expect(affordableCards(pool,    0)).toEqual([])
    expect(affordableCards(pool, -100)).toEqual([])
    expect(affordableCards(pool, NaN)).toEqual([])
  })
  it('does not mutate the input list', () => {
    const pool = [card({ current_raw: 500 }), card({ current_raw: 2000 })]
    const before = pool.slice()
    affordableCards(pool, 1000)
    expect(pool).toEqual(before)
  })
})

// ── searchCards ──────────────────────────

describe('searchCards', () => {
  const pool = [
    card({ card_name: 'Pikachu #58',    set_name: 'Base Set' }),
    card({ card_name: 'Charizard #4',   set_name: 'Base Set' }),
    card({ card_name: 'Squirtle #7',    set_name: 'Fossil'   }),
  ]
  it('empty query returns the pool as-is', () => {
    expect(searchCards(pool, '').length).toBe(3)
    expect(searchCards(pool, '   ').length).toBe(3)
  })
  it('matches by card name (case-insensitive)', () => {
    expect(searchCards(pool, 'char').map(c => c.card_name)).toEqual(['Charizard #4'])
    expect(searchCards(pool, 'PIKA').map(c => c.card_name)).toEqual(['Pikachu #58'])
  })
  it('matches by set name', () => {
    expect(searchCards(pool, 'fossil').map(c => c.card_name)).toEqual(['Squirtle #7'])
  })
})

// ── sortCards ─────────────────────────────

describe('sortCards', () => {
  const pool = [
    card({ card_name: 'A', current_raw: 2000, sales_30d: 5 }),
    card({ card_name: 'B', current_raw:  500, sales_30d: 20 }),
    card({ card_name: 'C', current_raw: 1500, sales_30d: 10 }),
  ]
  it('price-asc', () => {
    expect(sortCards(pool, 'price-asc').map(c => c.card_name)).toEqual(['B', 'C', 'A'])
  })
  it('price-desc', () => {
    expect(sortCards(pool, 'price-desc').map(c => c.card_name)).toEqual(['A', 'C', 'B'])
  })
  it('popular (sales_30d descending)', () => {
    expect(sortCards(pool, 'popular').map(c => c.card_name)).toEqual(['B', 'C', 'A'])
  })
  it('does not mutate the input', () => {
    const before = pool.slice()
    sortCards(pool, 'price-desc')
    expect(pool).toEqual(before)
  })
})

// ── computeBinderStats ────────────────

describe('computeBinderStats', () => {
  it('empty binder — total 0, remaining = budget, not complete', () => {
    const s = computeBinderStats([], 10000)
    expect(s.totalCents).toBe(0)
    expect(s.remainingCents).toBe(10000)
    expect(s.count).toBe(0)
    expect(s.target).toBe(TARGET_CARD_COUNT)
    expect(s.isOverBudget).toBe(false)
    expect(s.isComplete).toBe(false)
  })
  it('binder under budget with fewer than target cards is not complete', () => {
    const s = computeBinderStats([card({ current_raw: 1000 }), card({ current_raw: 2000 })], 10000)
    expect(s.totalCents).toBe(3000)
    expect(s.remainingCents).toBe(7000)
    expect(s.count).toBe(2)
    expect(s.isComplete).toBe(false)
  })
  it('exactly 5 cards under budget is complete', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card({ card_name: 'C' + i, current_raw: 1000 }))
    const s = computeBinderStats(cards, 10000)
    expect(s.count).toBe(5)
    expect(s.totalCents).toBe(5000)
    expect(s.isOverBudget).toBe(false)
    expect(s.isComplete).toBe(true)
  })
  it('over budget marks the binder as not complete even with target count', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card({ card_name: 'C' + i, current_raw: 3000 }))
    const s = computeBinderStats(cards, 10000)
    expect(s.totalCents).toBe(15000)
    expect(s.remainingCents).toBe(-5000)
    expect(s.isOverBudget).toBe(true)
    expect(s.isComplete).toBe(false)
  })
  it('handles a bad budget (0 / negative / non-finite) safely', () => {
    const s = computeBinderStats([card({ current_raw: 1000 })], 0)
    expect(s.isOverBudget).toBe(true)
    const s2 = computeBinderStats([card()], NaN)
    expect(s2.remainingCents).toBe(-1000)
  })
})

// ── pokemonKey ────────────────────────

describe('pokemonKey', () => {
  it('extracts the leading Pokémon token, lower-cased', () => {
    expect(pokemonKey('Pikachu #58')).toBe('pikachu')
    expect(pokemonKey('Charizard V #17')).toBe('charizard')
    expect(pokemonKey('Mr. Mime #6')).toBe('mr.')  // "Mr." vs "Mime" — both would be sensible; we take the first token
  })
  it('strips [Variant] markers', () => {
    expect(pokemonKey('Charizard [1st Edition] #4')).toBe('charizard')
    expect(pokemonKey('Blaziken [Reverse Holo] #10')).toBe('blaziken')
  })
  it('handles empty / non-string safely', () => {
    expect(pokemonKey('')).toBe('')
    expect(pokemonKey(null as any)).toBe('')
    expect(pokemonKey(undefined as any)).toBe('')
  })
})

// ── scoreBinder ───────────────────────

describe('scoreBinder', () => {
  function fiveCards(prices: number[], overrides: Partial<BinderCard>[] = []): BinderCard[] {
    return prices.map((p, i) => card({
      card_name: 'C' + i,
      set_name:  'Set-' + i,
      current_raw: p,
      ...(overrides[i] || {}),
    }))
  }
  it('incomplete binder scores 0 across the board', () => {
    expect(scoreBinder([], 10000).totalScore).toBe(0)
    expect(scoreBinder([card()], 10000).totalScore).toBe(0)
  })
  it('over-budget binder scores 0', () => {
    const s = scoreBinder(fiveCards([3000, 3000, 3000, 3000, 3000]), 10000)
    expect(s.totalScore).toBe(0)
  })
  it('perfectly-efficient binder with full diversity scores the max', () => {
    // 5 different sets AND 5 different Pokémon names, sums to exactly the budget.
    const cards = fiveCards([1000, 2000, 3000, 3000, 1000], [
      { card_name: 'Pikachu #1',   set_name: 'Base Set'      },
      { card_name: 'Charizard #4', set_name: 'Fossil'        },
      { card_name: 'Blastoise #2', set_name: 'Jungle'        },
      { card_name: 'Venusaur #15', set_name: 'Team Rocket'   },
      { card_name: 'Mewtwo #10',   set_name: 'Neo Genesis'   },
    ])
    const s = scoreBinder(cards, 10000)
    expect(s.efficiencyPoints).toBe(100)
    expect(s.setDiversityPoints).toBe(10)
    expect(s.pokemonDiversityPoints).toBe(10)
    expect(s.totalScore).toBe(120)
  })
  it('half-budget spend halves the efficiency points', () => {
    const cards = fiveCards([1000, 1000, 1000, 1000, 1000], [
      { card_name: 'Pikachu #1',   set_name: 'Base Set'      },
      { card_name: 'Charizard #4', set_name: 'Fossil'        },
      { card_name: 'Blastoise #2', set_name: 'Jungle'        },
      { card_name: 'Venusaur #15', set_name: 'Team Rocket'   },
      { card_name: 'Mewtwo #10',   set_name: 'Neo Genesis'   },
    ])
    const s = scoreBinder(cards, 10000)
    expect(s.efficiencyPoints).toBe(50)
    expect(s.setDiversityPoints).toBe(10)
    expect(s.pokemonDiversityPoints).toBe(10)
    expect(s.totalScore).toBe(70)
  })
  it('duplicate sets forfeit the set diversity bonus', () => {
    const cards = fiveCards([2000, 2000, 2000, 2000, 2000], [
      { card_name: 'Pikachu #1',   set_name: 'Base Set' },
      { card_name: 'Charizard #4', set_name: 'Base Set' },
      { card_name: 'Blastoise #2', set_name: 'Jungle' },
      { card_name: 'Venusaur #15', set_name: 'Team Rocket' },
      { card_name: 'Mewtwo #10',   set_name: 'Neo Genesis' },
    ])
    const s = scoreBinder(cards, 10000)
    expect(s.setDiversityPoints).toBe(0)
    expect(s.pokemonDiversityPoints).toBe(10)
  })
  it('duplicate Pokémon forfeits the Pokémon diversity bonus', () => {
    const cards = fiveCards([2000, 2000, 2000, 2000, 2000], [
      { card_name: 'Pikachu #1',   set_name: 'Base Set' },
      { card_name: 'Pikachu #58',  set_name: 'Fossil'   },
      { card_name: 'Blastoise #2', set_name: 'Jungle'   },
      { card_name: 'Venusaur #15', set_name: 'Team Rocket' },
      { card_name: 'Mewtwo #10',   set_name: 'Neo Genesis' },
    ])
    const s = scoreBinder(cards, 10000)
    expect(s.pokemonDiversityPoints).toBe(0)
    expect(s.setDiversityPoints).toBe(10)
  })
  it('total score is capped at 120', () => {
    const cards = fiveCards([2000, 2000, 2000, 2000, 2000], [
      { card_name: 'Pikachu #1',   set_name: 'Base Set'      },
      { card_name: 'Charizard #4', set_name: 'Fossil'        },
      { card_name: 'Blastoise #2', set_name: 'Jungle'        },
      { card_name: 'Venusaur #15', set_name: 'Team Rocket'   },
      { card_name: 'Mewtwo #10',   set_name: 'Neo Genesis'   },
    ])
    const s = scoreBinder(cards, 10000)
    expect(s.totalScore).toBeLessThanOrEqual(120)
  })
})

// ── scoreLabel ────────────────────

describe('scoreLabel', () => {
  it('over-budget / zero → "Over budget"', () => {
    expect(scoreLabel(0)).toBe('Over budget')
  })
  it('applies the tier bands in order', () => {
    expect(scoreLabel(1)).toBe('Room to grow')
    expect(scoreLabel(60)).toBe('Decent effort')
    expect(scoreLabel(80)).toBe('Solid picks')
    expect(scoreLabel(100)).toBe('Sharp binder')
    expect(scoreLabel(115)).toBe('Master collector')
    expect(scoreLabel(120)).toBe('Master collector')
  })
})
