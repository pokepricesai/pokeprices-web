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

// ── 53A.1 loader shape — via card_pokemon, not primary_pokemon_slug ─

describe('loadPokemonCompletion — 53A.1 membership via card_pokemon', () => {
  // Source-contract check: the loader must query the `card_pokemon`
  // table for species membership. The pre-53A.1 code queried
  // `cards.primary_pokemon_slug` which under-counted secondary-
  // Pokémon cards (e.g. "Ditto (Pikachu)", "Squirtle Vs Pikachu"
  // — 14 such cards for Pikachu at block time).
  it('queries card_pokemon.species_slug for membership', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'pokemonCompletion.ts'), 'utf8')
    expect(src).toMatch(/\.from\('card_pokemon'\)/)
    expect(src).toMatch(/\.eq\('species_slug', pokemonSlug\)/)
    expect(src).toMatch(/\.in\('card_slug', uniqueOwned\)/)
  })

  it('no longer filters ownership by cards.primary_pokemon_slug', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'pokemonCompletion.ts'), 'utf8')
    // The 53A version used .eq('primary_pokemon_slug', pokemonSlug)
    // on the cards query. The 53A.1 rewrite drops that filter — the
    // cards query only resolves language + is_sealed for the
    // membership-filtered slug set.
    expect(src).not.toMatch(/\.eq\('primary_pokemon_slug', pokemonSlug\)/)
  })

  it('applies is_sealed=false to match the RPC denominator eligibility rule', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'pokemonCompletion.ts'), 'utf8')
    expect(src).toMatch(/\.eq\('is_sealed', false\)/)
  })

  it('deduplicates the membership rows into a Set (so a single card_slug counts once)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'pokemonCompletion.ts'), 'utf8')
    expect(src).toMatch(/\[\.\.\.new Set\(\(membershipRows \?\? \[\]\)\.map\(r => r\.card_slug\)/)
  })
})

// ── 53A.1 secondary-Pokémon ownership fixture ───────

describe('aggregateOwnedByLanguage — secondary-Pokémon fixture', () => {
  // Fixture: a user owns a "Ditto (Pikachu)" card where the
  // primary Pokémon is Ditto but Pikachu is a secondary
  // card_pokemon association. The 53A.1 loader intersects owned
  // slugs against card_pokemon for the Pikachu species page, so
  // the card increments Pikachu's owned count.
  it('a secondary-Pokémon card counts toward completion (Ditto-Pikachu on Pikachu page)', () => {
    // Simulated: loader has already resolved ownedInSpecies via
    // card_pokemon(species=pikachu). We only need to verify the
    // aggregator treats the resulting slug like any other.
    const dittoPikachuSlug = 'ditto-pikachu-63'
    const language: Record<string, 'en'> = { [dittoPikachuSlug]: 'en' }
    const { en, jp } = aggregateOwnedByLanguage([dittoPikachuSlug], language)
    expect(en.has(dittoPikachuSlug)).toBe(true)
    expect(jp.size).toBe(0)
  })

  it('duplicate card_slugs from raw + graded holdings collapse to one owned entry', () => {
    // portfolio_items can carry the same card_slug twice (once
    // ungraded, once PSA 10). The Set-of-slug aggregation drops
    // the duplicate.
    const slugs = ['pc-1', 'pc-1', 'pc-1']
    const { en } = aggregateOwnedByLanguage(slugs, { 'pc-1': 'en' })
    expect(en.size).toBe(1)
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
