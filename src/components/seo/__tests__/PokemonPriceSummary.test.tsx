// Block 5A-W-46C — source-invariant tests for PokemonPriceSummary
// (server component) + its wiring into pokemon/[slug]/page.tsx.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'PokemonPriceSummary.tsx'), 'utf8')
const POKE_SERVER = readFileSync(
  join(__dirname, '..', '..', '..', 'app', 'pokemon', '[slug]', 'page.tsx'), 'utf8',
)

describe('PokemonPriceSummary — component invariants', () => {
  it('is a SERVER component (no "use client" directive)', () => {
    expect(SRC.startsWith("'use client'")).toBe(false)
    expect(SRC).not.toMatch(/^\s*['"]use client['"]/)
  })

  it('never uses React state hooks', () => {
    expect(SRC).not.toMatch(/\buseState\b/)
    expect(SRC).not.toMatch(/\buseEffect\b/)
    expect(SRC).not.toMatch(/\buseMemo\b/)
  })

  it('uses the pure buildPokemonSummary helper', () => {
    expect(SRC).toContain("import {")
    expect(SRC).toContain('buildPokemonSummary')
    expect(SRC).toContain("from '@/lib/seo/pokemonSummary'")
  })

  it('returns null when the builder reports insufficient data', () => {
    expect(SRC).toMatch(/if \(!out\.render\) return null/)
  })

  it('renders a semantic h2 with the "card prices at a glance" heading', () => {
    expect(SRC).toContain('card prices at a glance')
    expect(SRC).toMatch(/<h2[^>]*>/)
  })

  it('never emits Dataset / Product / Offer / AggregateOffer / MerchantListing schema', () => {
    for (const banned of ['Dataset', 'Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(SRC).not.toMatch(new RegExp(`["']${banned}["']`))
    }
    expect(SRC).not.toContain('application/ld+json')
  })

  it('never emits Pokémon lore keywords (this is a pricing surface)', () => {
    const banned = [
      'evolves from', 'legendary trio', 'kanto region', 'ability to',
      'known for its', 'in the pokedex',
    ]
    for (const b of banned) expect(SRC.toLowerCase()).not.toContain(b)
  })

  it('never emits investment / grading advice keywords', () => {
    for (const b of ['great investment', 'you should grade', 'guaranteed', 'undervalued']) {
      expect(SRC.toLowerCase()).not.toContain(b)
    }
  })
})

describe('PokemonPriceSummary — wiring into the Pokémon server page', () => {
  it('page.tsx imports the component and renders it in the JSX tree', () => {
    expect(POKE_SERVER).toContain("import PokemonPriceSummary from '@/components/seo/PokemonPriceSummary'")
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary\b/)
  })

  it('the component receives species + topCards + risers + fallers + bySet + allCards from existing RPC output', () => {
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?species=/)
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?topCards=/)
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?risers=/)
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?fallers=/)
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?bySet=/)
    expect(POKE_SERVER).toMatch(/<PokemonPriceSummary[\s\S]*?allCards=/)
  })

  it('does not introduce a new RPC — species detail is still get_pokemon_species_detail', () => {
    // Regression pin: the RPC allowlist for this page stays at one.
    const rpcMatches = POKE_SERVER.match(/get_[a-z_]+/g) || []
    const allowlist = new Set(['get_pokemon_species_detail'])
    for (const name of rpcMatches) {
      if (name.startsWith('get_card_')) continue // may reference card RPCs in comments
      expect(allowlist.has(name)).toBe(true)
    }
  })

  it('pokemon page.tsx does NOT introduce Dataset schema outside the pre-existing PokemonStructuredData', () => {
    // Pin: no NEW JSON-LD script tags were inlined.
    const scriptTags = (POKE_SERVER.match(/application\/ld\+json/g) || []).length
    // Zero — PokemonStructuredData emits its own tag from inside its
    // component file, not from page.tsx directly.
    expect(scriptTags).toBe(0)
  })

  it('the existing BreadcrumbSchema stays server-rendered on the Pokémon page', () => {
    expect(POKE_SERVER).toContain('<BreadcrumbSchema')
    expect(POKE_SERVER).toContain("name: 'Pokémon'")
  })

  it('does not link to dashboard / admin / api routes from the summary component', () => {
    for (const bad of ['/dashboard', '/admin', '/intel', '/api']) {
      expect(SRC).not.toContain(`href="${bad}`)
    }
  })
})
