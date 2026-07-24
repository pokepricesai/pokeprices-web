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
  pokeApiEnglishDisplayName,
} from '../seo-helpers'

// ── /insights hub ──────────────────────────────────────────────────

describe('/insights hub copy constants (W46E-Lite rewrite)', () => {
  it('title pins the W46E-Lite rewrite', () => {
    expect(INSIGHTS_HUB_TITLE).toBe(
      'Pokémon Card Market Trends, Prices & Insights | PokePrices',
    )
    // Regression guard against the older W34A wording.
    expect(INSIGHTS_HUB_TITLE).not.toContain('Grading Reports')
  })
  it('description pins the W46E-Lite rewrite', () => {
    expect(INSIGHTS_HUB_DESCRIPTION).toBe(
      'Track Pokémon card market trends, price movements, grading premiums and data-led analysis of popular cards and sets.',
    )
  })
  it('description mentions market trends, price movements and grading', () => {
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('market')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('price')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('grading')
    expect(INSIGHTS_HUB_DESCRIPTION.toLowerCase()).toContain('trends')
  })
  it('title contains no year token', () => {
    expect(INSIGHTS_HUB_TITLE).not.toMatch(/\b20\d\d\b/)
  })
  it('description length stays under Google\'s 160 char cut-off + a small buffer', () => {
    expect(INSIGHTS_HUB_DESCRIPTION.length).toBeLessThanOrEqual(200)
    expect(INSIGHTS_HUB_DESCRIPTION.length).toBeGreaterThan(60)
  })
  it('OG title is shorter than the SERP title (fits share previews)', () => {
    expect(INSIGHTS_HUB_OG_TITLE.length).toBeLessThan(INSIGHTS_HUB_TITLE.length)
    expect(INSIGHTS_HUB_OG_TITLE.length).toBeGreaterThan(20)
  })
  it('OG description is the same or shorter than the SERP description', () => {
    expect(INSIGHTS_HUB_OG_DESCRIPTION.length).toBeLessThanOrEqual(INSIGHTS_HUB_DESCRIPTION.length)
    expect(INSIGHTS_HUB_OG_DESCRIPTION.length).toBeGreaterThan(40)
  })
  it('canonical is the www absolute URL (unchanged)', () => {
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

describe('getPokemonSeo (W46E-Lite shared brand-tail template)', () => {
  it('emits the primary "{Name} Pokémon Card Prices & Values | PokePrices" title', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42, hasPsa10Data: true, hasMovementData: true })
    expect(seo.title).toBe('Greninja Pokémon Card Prices & Values | PokePrices')
  })
  it('no card count in the title (moved to description)', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 74 })
    expect(seo.title).not.toMatch(/74/)
    expect(seo.title).not.toMatch(/\d+\s*Cards/)
  })
  it('no year token in the title or description', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 74 })
    expect(seo.title).not.toMatch(/\b20\d\d\b/)
    expect(seo.description).not.toMatch(/\b20\d\d\b/)
  })
  it('brand tail present in the title', () => {
    const seo = getPokemonSeo({ name: 'Vaporeon', slug: 'vaporeon', totalCards: 30 })
    expect(seo.title.endsWith('| PokePrices')).toBe(true)
  })
  it('"Pokémon" appears at most once in the title', () => {
    const seo = getPokemonSeo({ name: 'Alakazam', slug: 'alakazam', totalCards: 40 })
    const matches = (seo.title.match(/Pokémon/g) || []).length
    expect(matches).toBeLessThanOrEqual(1)
  })
  it('no raw/PSA keyword stuffing in the title', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42 })
    expect(seo.title.toLowerCase()).not.toContain('psa 10')
    expect(seo.title.toLowerCase()).not.toContain('raw')
  })

  it('long-name fallback drops "Pokémon" first (still fits brand tail)', () => {
    // 32-char name — primary (name + 42 = 74) blows past the 72-char
    // budget; the "Pokémon"-dropping fallback (name + 34 = 66) fits.
    const name = 'Thirtytwocharactersspeciesnameok'
    expect(name.length).toBe(32)
    const seo = getPokemonSeo({ name, slug: 'long-1' })
    expect(seo.title).toBe(`${name} Card Prices & Values | PokePrices`)
    expect(seo.title.endsWith('| PokePrices')).toBe(true)
  })
  it('long-name fallback drops "& Values" second (still fits brand tail)', () => {
    // Name length that fits t3 ("{Name} Card Prices | PokePrices" =
    // name + 24) but not t2 (name + 34). 39..48 chars is the target.
    const name = 'FortyTwoCharacterSpeciesNameOkOkOkOkOkOkOK'
    expect(name.length).toBe(42)
    const seo = getPokemonSeo({ name, slug: 'long-2' })
    expect(seo.title).toBe(`${name} Card Prices | PokePrices`)
    expect(seo.title.endsWith('| PokePrices')).toBe(true)
  })
  it('final fallback drops the brand tail only when nothing else fits (species name still whole)', () => {
    const veryLong = 'Verylongspeciesnamethatdefinitelyexceedsseventytwochars extra'
    const seo = getPokemonSeo({ name: veryLong, slug: 'long' })
    expect(seo.title).toContain(veryLong)
    expect(seo.title).toBe(`${veryLong} Card Prices`)
    expect(seo.title).not.toContain('…')
  })
  it('species name is NEVER truncated or ellipsised, at any length', () => {
    const cases = ['A', 'Verylongspeciesnamethatdefinitelyexceedsseventytwochars extra', 'X'.repeat(200)]
    for (const name of cases) {
      const seo = getPokemonSeo({ name, slug: 'x' })
      expect(seo.title).not.toContain('…')
      expect(seo.title).toContain(name)
    }
  })

  it('description contains the real card count', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42, hasPsa10Data: true, hasMovementData: true })
    expect(seo.description).toContain('42')
    expect(seo.description).toContain('Greninja Pokémon cards')
  })
  it('description grammar matches the pinned template with full data', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42, hasPsa10Data: true, hasMovementData: true })
    expect(seo.description).toBe(
      'See current prices for 42 Greninja Pokémon cards, including raw and PSA 10 values, the most valuable cards, recent movers and represented sets.',
    )
  })
  it('description omits PSA 10 when hasPsa10Data is false', () => {
    const seo = getPokemonSeo({ name: 'Zubat', slug: 'zubat', totalCards: 3, hasPsa10Data: false, hasMovementData: false })
    expect(seo.description.toLowerCase()).not.toContain('psa 10')
    expect(seo.description).toBe(
      'See current prices for 3 Zubat Pokémon cards, including raw values, the most valuable cards and represented sets.',
    )
  })
  it('description omits recent-movers when hasMovementData is false', () => {
    const seo = getPokemonSeo({ name: 'Zubat', slug: 'zubat', totalCards: 3, hasPsa10Data: true, hasMovementData: false })
    expect(seo.description.toLowerCase()).not.toContain('recent movers')
  })
  it('description falls back gracefully without a card count', () => {
    const seo = getPokemonSeo({ name: 'Farfetch’d', slug: 'farfetchd', totalCards: null })
    expect(seo.description).toContain('Pokémon cards')
    expect(seo.description).not.toMatch(/\bnull\b/)
    expect(seo.description).not.toMatch(/across\s+0/)
  })
  it('does not use live-prices, investment or grading-advice language', () => {
    const seo = getPokemonSeo({ name: 'Greninja', slug: 'greninja', totalCards: 42, hasPsa10Data: true, hasMovementData: true })
    for (const banned of ['live prices', 'guaranteed', 'invest', 'flip', 'profit', 'undervalued', 'evolves from', 'legendary']) {
      expect(seo.title.toLowerCase()).not.toContain(banned)
      expect(seo.description.toLowerCase()).not.toContain(banned)
    }
  })
  it('canonical uses the URL slug and is unchanged (never the display name)', () => {
    const seo = getPokemonSeo({ name: 'Mr. Mime', slug: 'mr-mime' })
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/mr-mime')
  })
  it('canonical unchanged for a Farfetch\'d-shaped input', () => {
    const seo = getPokemonSeo({ name: 'Farfetch’d', slug: 'farfetchd' })
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/farfetchd')
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
  it('treats zero-or-negative totalCards as no-count', () => {
    const seo = getPokemonSeo({ name: 'Eevee', slug: 'eevee', totalCards: 0 })
    expect(seo.description).not.toMatch(/across\s+0\s+cards/i)
    expect(seo.description).not.toMatch(/0 Eevee/)
  })
})

// ── W46E-Lite-FIX1 — PokeAPI authoritative display-name extractor ──

describe('pokeApiEnglishDisplayName (W46E-Lite-FIX1)', () => {
  it('preserves the "Mr. Mime" period + space', () => {
    const speciesData = { names: [
      { language: { name: 'ja' }, name: 'バリヤード' },
      { language: { name: 'en' }, name: 'Mr. Mime' },
    ] }
    expect(pokeApiEnglishDisplayName(speciesData)).toBe('Mr. Mime')
  })
  it('preserves the curly apostrophe in "Farfetch’d"', () => {
    const speciesData = { names: [{ language: { name: 'en' }, name: 'Farfetch’d' }] }
    expect(pokeApiEnglishDisplayName(speciesData)).toBe('Farfetch’d')
  })
  it('preserves hyphenated capitals like "Ho-Oh" and "Porygon-Z"', () => {
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Ho-Oh' }] })).toBe('Ho-Oh')
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Porygon-Z' }] })).toBe('Porygon-Z')
  })
  it('preserves gender symbols in Nidoran♀ / Nidoran♂', () => {
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Nidoran♀' }] })).toBe('Nidoran♀')
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Nidoran♂' }] })).toBe('Nidoran♂')
  })
  it('preserves colon + space in "Type: Null"', () => {
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Type: Null' }] })).toBe('Type: Null')
  })
  it('preserves the trailing period in "Mime Jr."', () => {
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Mime Jr.' }] })).toBe('Mime Jr.')
  })
  it('returns null when the English entry is missing', () => {
    const speciesData = { names: [
      { language: { name: 'ja' }, name: 'バリヤード' },
      { language: { name: 'fr' }, name: 'M. Mime' },
    ] }
    expect(pokeApiEnglishDisplayName(speciesData)).toBeNull()
  })
  it('returns null for missing / null / undefined / malformed inputs (safe fallback)', () => {
    expect(pokeApiEnglishDisplayName(null)).toBeNull()
    expect(pokeApiEnglishDisplayName(undefined)).toBeNull()
    expect(pokeApiEnglishDisplayName({})).toBeNull()
    expect(pokeApiEnglishDisplayName({ names: null } as any)).toBeNull()
    expect(pokeApiEnglishDisplayName({ names: [] })).toBeNull()
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' } }] } as any)).toBeNull()
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: '' }] })).toBeNull()
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: '   ' }] })).toBeNull()
  })
  it('trims surrounding whitespace when the entry is otherwise valid', () => {
    expect(pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: '  Charizard  ' }] })).toBe('Charizard')
  })
})

describe('W46E-Lite-FIX1 — authoritative name flows through getPokemonSeo', () => {
  it('produces the correct Mr. Mime title when the authoritative name is passed', () => {
    const seo = getPokemonSeo({
      name: pokeApiEnglishDisplayName({ names: [{ language: { name: 'en' }, name: 'Mr. Mime' }] }) as string,
      slug: 'mr-mime', totalCards: 71, hasPsa10Data: true, hasMovementData: true,
    })
    expect(seo.title).toBe('Mr. Mime Pokémon Card Prices & Values | PokePrices')
    expect(seo.description).toContain('Mr. Mime Pokémon cards')
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/mr-mime')
  })
  it('produces the correct Farfetch’d title (curly apostrophe preserved)', () => {
    const seo = getPokemonSeo({
      name: 'Farfetch’d', slug: 'farfetchd', totalCards: 45, hasPsa10Data: true, hasMovementData: true,
    })
    expect(seo.title).toBe('Farfetch’d Pokémon Card Prices & Values | PokePrices')
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/farfetchd')
  })
  it('produces the correct Ho-Oh title (hyphen preserved)', () => {
    const seo = getPokemonSeo({ name: 'Ho-Oh', slug: 'ho-oh', totalCards: 60, hasPsa10Data: true, hasMovementData: true })
    expect(seo.title).toBe('Ho-Oh Pokémon Card Prices & Values | PokePrices')
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/ho-oh')
  })
  it('produces the correct Nidoran♀ title (gender symbol preserved)', () => {
    const seo = getPokemonSeo({ name: 'Nidoran♀', slug: 'nidoran-f', totalCards: 8, hasPsa10Data: true, hasMovementData: true })
    expect(seo.title).toBe('Nidoran♀ Pokémon Card Prices & Values | PokePrices')
    expect(seo.canonical).toBe('https://www.pokeprices.io/pokemon/nidoran-f')
  })
  it('canonical URL uses the slug (never the display name)', () => {
    for (const [name, slug] of [
      ['Mr. Mime',       'mr-mime'],
      ['Farfetch’d', 'farfetchd'],
      ['Ho-Oh',           'ho-oh'],
      ['Nidoran♀',   'nidoran-f'],
      ['Type: Null',      'type-null'],
    ] as const) {
      const seo = getPokemonSeo({ name, slug, totalCards: 1 })
      expect(seo.canonical).toBe(`https://www.pokeprices.io/pokemon/${slug}`)
    }
  })
  it('templates approved in W46E-Lite remain unchanged (regression pin)', () => {
    // Full-data path — string equality with the W46E-Lite pinned template.
    const seo = getPokemonSeo({
      name: 'Greninja', slug: 'greninja', totalCards: 42, hasPsa10Data: true, hasMovementData: true,
    })
    expect(seo.title).toBe('Greninja Pokémon Card Prices & Values | PokePrices')
    expect(seo.description).toBe(
      'See current prices for 42 Greninja Pokémon cards, including raw and PSA 10 values, the most valuable cards, recent movers and represented sets.',
    )
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
