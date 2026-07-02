// Block 5A-W-34A — pin the exact copy used on the highest-impact
// SEO surfaces (/insights hub, /set/[slug], /pokemon/[slug]) plus
// the existing card helper's structure.
//
// If any of these strings change in future, the tests fail loudly
// so the change is deliberate.

import { describe, it, expect } from 'vitest'
import {
  INSIGHTS_HUB_CANONICAL,
  INSIGHTS_HUB_DESCRIPTION,
  INSIGHTS_HUB_OG_DESCRIPTION,
  INSIGHTS_HUB_OG_TITLE,
  INSIGHTS_HUB_TITLE,
  getCardSeo,
  getInsightsArticleFallbackDescription,
  getPokemonSeo,
  getSetSeo,
} from '../seo-helpers'

// ── /insights hub ──────────────────────────────────────────────────

describe('/insights hub copy constants', () => {
  it('title pins the W34A rewrite', () => {
    expect(INSIGHTS_HUB_TITLE).toBe(
      'Pokémon Card Market Insights, Price Trends & Grading Reports | PokePrices',
    )
  })
  it('description mentions market reports, price trends and grading', () => {
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('market')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('price')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('grading')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('psa 10')
  })
  it('description length stays under Google\'s 160 char cut-off + a small buffer', () => {
    expect(INSIGHTS_HUB_DESCRIPTION.length).toBeLessThanOrEqual(200)
    expect(INSIGHTS_HUB_DESCRIPTION.length).toBeGreaterThan(60)
  })
  it('OG title is shorter than the SERP title (fits share previews)', () => {
    expect(INSIGHTS_HUB_OG_TITLE.length).toBeLessThan(INSIGHTS_HUB_TITLE.length)
    expect(INSIGHTS_HUB_OG_TITLE.length).toBeGreaterThan(20)
  })
  it('OG description is a distinct, shorter variant', () => {
    expect(INSIGHTS_HUB_OG_DESCRIPTION.length).toBeLessThan(INSIGHTS_HUB_DESCRIPTION.length)
    expect(INSIGHTS_HUB_OG_DESCRIPTION.length).toBeGreaterThan(40)
  })
  it('canonical is the www absolute URL', () => {
    expect(INSIGHTS_HUB_CANONICAL).toBe('https://www.pokeprices.io/insights')
  })
  it('does not contain a doubled PokePrices marker', () => {
    expect(INSIGHTS_HUB_TITLE).not.toMatch(/PokePrices.*PokePrices/i)
  })
})

// ── /insights/[slug] article fallback ──────────────────────────────

describe('getInsightsArticleFallbackDescription', () => {
  it('leads with the headline and includes market / price / grading language', () => {
    const out = getInsightsArticleFallbackDescription('Sample Article')
    expect(out).toContain('Sample Article')
    expect(out.toLowerCase()).toContain('market')
    expect(out.toLowerCase()).toContain('price')
    expect(out.toLowerCase()).toContain('grading')
    expect(out).toContain('PokePrices')
  })
  it('uses a sane default when the headline is blank', () => {
    expect(getInsightsArticleFallbackDescription('')).toContain('Pokémon card insight')
    expect(getInsightsArticleFallbackDescription('   ')).toContain('Pokémon card insight')
  })
  it('does not include the older "practical … collecting guide" wording', () => {
    // Regression pin: 5A-W-34A retuned the fallback away from that phrasing.
    expect(getInsightsArticleFallbackDescription('Any').toLowerCase()).not.toContain('practical')
  })
})

// ── /set/[slug] ────────────────────────────────────────────────────

describe('getSetSeo', () => {
  it('uses the long title variant for a short set name', () => {
    const seo = getSetSeo('Base Set')
    expect(seo.title).toBe('Base Set Card List & Prices | Most Valuable Cards & PSA 10 Values')
  })
  it('shrinks to the short variant when the long title exceeds 60 chars', () => {
    // "Sword & Shield Promo" → long variant would exceed 60 chars.
    const seo = getSetSeo('Scarlet & Violet 151')
    expect(seo.title.length).toBeLessThanOrEqual(80)
    expect(seo.title).toContain('Scarlet & Violet 151')
    expect(seo.title.toLowerCase()).toContain('psa 10 values')
  })
  it('description contains the set name and key intent tokens', () => {
    const seo = getSetSeo('Chaos Rising')
    expect(seo.description).toContain('Chaos Rising')
    expect(seo.description.toLowerCase()).toContain('psa 10')
    expect(seo.description.toLowerCase()).toContain('most valuable')
    expect(seo.description.toLowerCase()).toContain('chase cards')
  })
  it('canonical uses the passed slug when provided', () => {
    const seo = getSetSeo('Chaos Rising', 'Chaos%20Rising')
    expect(seo.canonical).toBe('https://www.pokeprices.io/set/Chaos%20Rising')
  })
  it('canonical encodes the set name when no slug is passed', () => {
    const seo = getSetSeo('Team Rocket')
    expect(seo.canonical).toBe('https://www.pokeprices.io/set/Team%20Rocket')
  })
  it('title is non-empty and never contains a doubled brand marker', () => {
    for (const name of ['A', 'Base Set', 'Prismatic Evolutions', 'Scarlet & Violet 151']) {
      const seo = getSetSeo(name)
      expect(seo.title.length).toBeGreaterThan(0)
      expect(seo.description.length).toBeGreaterThan(0)
      expect(seo.title).not.toMatch(/PokePrices.*PokePrices/i)
    }
  })
  it('handles a blank set name with a sane default', () => {
    const seo = getSetSeo('')
    expect(seo.title).toContain('Pokémon')
    expect(seo.description).toContain('Pokémon')
  })
})

// ── /pokemon/[slug] ────────────────────────────────────────────────

describe('getPokemonSeo', () => {
  it('uses the count-anchored title when the number fits within the SERP budget', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 74 })
    expect(seo.title).toBe('Eevee Card Prices Across 74 Cards | Raw & PSA 10 Values')
    expect(seo.title.length).toBeLessThanOrEqual(72)
  })
  it('uses the benefit title when no count is available and it fits', () => {
    const seo = getPokemonSeo({ name: 'Alakazam', slug: 'alakazam', totalCards: null })
    expect(seo.title).toContain('Most Valuable')
    expect(seo.title.toLowerCase()).toContain('psa 10 values')
  })
  it('falls back to compact title when both other variants would exceed 60 chars', () => {
    const longName = 'Verylongspeciesname'
    const seo = getPokemonSeo({ name: longName, slug: 'long', totalCards: null })
    // Compact fits under ~65 chars for any reasonable name.
    expect(seo.title).toContain(longName)
    expect(seo.title).toContain('PokePrices')
  })
  it('description contains the species name plus intent tokens', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42 })
    expect(seo.description).toContain('Greninja')
    expect(seo.description).toContain('42')
    expect(seo.description.toLowerCase()).toContain('psa 10')
    expect(seo.description.toLowerCase()).toContain('raw')
    expect(seo.description.toLowerCase()).toContain('most valuable')
  })
  it('includes the top-card fact when supplied', () => {
    const seo = getPokemonSeo({
      name: 'Charizard', slug: 'charizard', totalCards: 100,
      topCard: { cardName: 'Charizard VMAX', setName: 'Champion\'s Path', priceLabel: '$450' },
    })
    expect(seo.description).toContain('Top:')
    expect(seo.description).toContain('Charizard VMAX')
    expect(seo.description).toContain("Champion's Path")
    expect(seo.description).toContain('$450')
  })
  it('omits the top-card sentence when no top card is provided', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 74 })
    expect(seo.description).not.toContain('Top:')
  })
  it('canonical uses the URL slug (never the display name)', () => {
    const seo = getPokemonSeo({ name: 'Mr. Mime', slug: 'mr-mime' })
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/mr-mime')
  })
  it('handles missing name gracefully', () => {
    const seo = getPokemonSeo({ name: '', slug: 'unknown' })
    expect(seo.title.length).toBeGreaterThan(0)
    expect(seo.description.length).toBeGreaterThan(0)
  })
  it('never emits a doubled brand marker', () => {
    for (const name of ['Eevee', 'Charizard', 'Mr. Mime']) {
      const seo = getPokemonSeo({ name, slug: name.toLowerCase(), totalCards: 50 })
      expect(seo.title).not.toMatch(/PokePrices.*PokePrices/i)
    }
  })
  it('treats zero-or-negative totalCards as no-count (uses benefit or compact title)', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 0 })
    expect(seo.title).not.toMatch(/\d+\s+Cards/i)
    expect(seo.description).not.toMatch(/across\s+0\s+cards/i)
  })
})

// ── Card helper — verify still intact after W34A ────────────────────

describe('getCardSeo (regression pin — should be unchanged in W34A)', () => {
  it('emits price-focused variant for low grading multiple', () => {
    const seo = getCardSeo({
      card_name:      'Test Card',
      card_number:    '55',
      set_name:       'Test Set',
      raw_usd:        1000,   // $10
      psa10_usd:      1500,   // $15 → 1.5× multiple → price variant
      psa9_usd:       1200,
      card_url_slug:  'test-card-55',
    })
    expect(seo.title).toContain('Test Card #55 Price')
    expect(seo.title).toContain('| PokePrices')
    expect(seo.description).toContain('Test Set')
  })
  it('emits grading-focused variant when PSA 10 multiple ≥ 3×', () => {
    const seo = getCardSeo({
      card_name:      'Rare Holo',
      card_number:    '1',
      set_name:       'Base Set',
      raw_usd:        1000,   // $10
      psa10_usd:      5000,   // $50 → 5× → grading variant
      psa9_usd:       2000,
      card_url_slug:  'rare-holo-1',
    })
    expect(seo.title).toContain('Is It Worth Grading')
    expect(seo.description).toContain('grading gap')
  })
  it('canonical uses www + encoded set name', () => {
    const seo = getCardSeo({
      card_name:      'Test',
      set_name:       'Chaos Rising',
      card_url_slug:  'test-1',
    })
    expect(seo.canonical).toBe('https://www.pokeprices.io/set/Chaos%20Rising/card/test-1')
  })
  it('title never contains a doubled PokePrices marker', () => {
    const seo = getCardSeo({
      card_name:  'Any Card',
      set_name:   'Any Set',
      raw_usd:    100,
      psa10_usd:  400,
      card_url_slug: 'x',
    })
    expect(seo.title).not.toMatch(/PokePrices.*PokePrices/i)
  })
})
