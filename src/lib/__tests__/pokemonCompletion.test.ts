// Block 5A-W-53A — per-Pokémon completion helper tests.

import { describe, it, expect } from 'vitest'
import {
  computePercentage,
  aggregateOwnedByLanguage,
  buildPokemonCompletion,
} from '@/lib/pokemonCompletion'

describe('computePercentage', () => {
  it('returns 0 when total is 0 (never a division-by-zero)', () => {
    expect(computePercentage(0, 0)).toBe(0)
    expect(computePercentage(5, 0)).toBe(0)
  })
  it('returns 0 when owned is 0', () => {
    expect(computePercentage(0, 100)).toBe(0)
  })
  it('rounds to the nearest integer', () => {
    expect(computePercentage(1, 3)).toBe(33)
    expect(computePercentage(2, 3)).toBe(67)
    expect(computePercentage(48, 163)).toBe(29)
    expect(computePercentage(12, 85)).toBe(14)
  })
  it('clamps to 100 if the numerator is over-full', () => {
    expect(computePercentage(200, 100)).toBe(100)
  })
})

describe('aggregateOwnedByLanguage', () => {
  it('separates English and Japanese owned card_slugs by their language', () => {
    const slugs = ['pc-1', 'pc-2', 'pc-3', 'pc-4']
    const lang: Record<string, 'en' | 'jp'> = {
      'pc-1': 'en',
      'pc-2': 'jp',
      'pc-3': 'en',
      'pc-4': 'jp',
    }
    const { en, jp } = aggregateOwnedByLanguage(slugs, lang)
    expect([...en].sort()).toEqual(['pc-1', 'pc-3'])
    expect([...jp].sort()).toEqual(['pc-2', 'pc-4'])
  })

  it('counts a card owned in both raw and graded form only once (Set semantics)', () => {
    // The portfolio_items row list may contain the same slug
    // twice (once ungraded, once PSA 10). Aggregating them into
    // a Set collapses to a single distinct-card entry.
    const slugs = ['pc-1', 'pc-1', 'pc-1']
    const { en } = aggregateOwnedByLanguage(slugs, { 'pc-1': 'en' })
    expect(en.size).toBe(1)
  })

  it('excludes slugs with unknown language (would be a mis-map)', () => {
    const slugs = ['pc-1', 'pc-2']
    const lang: Record<string, 'en' | 'jp' | null> = {
      'pc-1': 'en',
      'pc-2': null,
    }
    const { en, jp } = aggregateOwnedByLanguage(slugs, lang)
    expect(en.size).toBe(1)
    expect(jp.size).toBe(0)
  })
})

describe('buildPokemonCompletion', () => {
  it('produces the two-bar completion object with independent English + Japanese denominators', () => {
    const owned = {
      en: new Set(['pc-1', 'pc-2', 'pc-3']),
      jp: new Set(['pc-4', 'pc-5']),
    }
    const totals = { en: 163, jp: 85 }
    const c = buildPokemonCompletion(owned, totals)
    expect(c.en).toEqual({ ownedDistinct: 3, totalEligible: 163, percentage: 2 })
    expect(c.jp).toEqual({ ownedDistinct: 2, totalEligible: 85, percentage: 2 })
  })

  it('handles 0/0 cleanly (no NaN, no misleading 100%)', () => {
    const owned = { en: new Set<string>(), jp: new Set<string>() }
    const totals = { en: 0, jp: 0 }
    const c = buildPokemonCompletion(owned, totals)
    expect(c.en).toEqual({ ownedDistinct: 0, totalEligible: 0, percentage: 0 })
    expect(c.jp).toEqual({ ownedDistinct: 0, totalEligible: 0, percentage: 0 })
  })

  it('handles a Pokémon with only English cards (no Japanese) cleanly', () => {
    const owned = { en: new Set(['pc-1']), jp: new Set<string>() }
    const totals = { en: 10, jp: 0 }
    const c = buildPokemonCompletion(owned, totals)
    expect(c.en.percentage).toBe(10)
    expect(c.jp.percentage).toBe(0)
    expect(c.jp.totalEligible).toBe(0)
  })

  it('handles a Pokémon with only Japanese cards cleanly', () => {
    const owned = { en: new Set<string>(), jp: new Set(['pc-1']) }
    const totals = { en: 0, jp: 5 }
    const c = buildPokemonCompletion(owned, totals)
    expect(c.en.totalEligible).toBe(0)
    expect(c.jp.percentage).toBe(20)
  })
})

// ── Regression: block spec examples ────────────────

describe('block spec fixtures — Pikachu completion', () => {
  it('reproduces the spec numbers: English 48/163 = 29%, Japanese 12/85 = 14%', () => {
    const owned = {
      en: new Set(Array.from({ length: 48 }, (_, i) => `pc-en-${i}`)),
      jp: new Set(Array.from({ length: 12 }, (_, i) => `pc-jp-${i}`)),
    }
    const totals = { en: 163, jp: 85 }
    const c = buildPokemonCompletion(owned, totals)
    expect(c.en.ownedDistinct).toBe(48)
    expect(c.en.totalEligible).toBe(163)
    expect(c.en.percentage).toBe(29)
    expect(c.jp.ownedDistinct).toBe(12)
    expect(c.jp.totalEligible).toBe(85)
    expect(c.jp.percentage).toBe(14)
  })
})
