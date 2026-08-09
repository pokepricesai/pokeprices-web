// Block 5A-W-53B / 53B.1 — species-page SEO + CTR regression pins.
//
// Covers the block's programmatic changes:
//   * getPokemonSeo title + description templates (53B.1 rewrite).
//   * page.tsx derives + forwards hasJapaneseCards, englishCards,
//     japaneseCards, distinctSetCount, year into getPokemonSeo.
//   * page.tsx H1 renders the "All {Name} Cards — English & Japanese
//     Prices" phrase (or "& Prices" when no JP).
//   * page.tsx renders the two server-rendered per-language
//     sections (English + Japanese Card Prices) with programmatic
//     copy from the existing payload.
//   * Catalogue H2 gains the "& Prices" suffix.
//   * pokemonSummary Represented sets fact prefers distinctSetCount.
//   * getPokemonFaqItems no longer over-claims "recent sold listings".

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPokemonSeo } from '@/lib/seo-helpers'
import { buildPokemonSummary } from '@/lib/seo/pokemonSummary'
import { getPokemonFaqItems } from '@/lib/faqs'

const PAGE   = readFileSync(join(process.cwd(), 'src', 'app', 'pokemon', '[slug]', 'page.tsx'), 'utf8')
const SECTION = readFileSync(join(process.cwd(), 'src', 'app', 'pokemon', '[slug]', 'SpeciesInteractiveSection.tsx'), 'utf8')

// ── getPokemonSeo — 53B.1 title / description ─────────

describe('53B.1 — getPokemonSeo template (title + description)', () => {
  it('title exact match: "{Name} Card Prices — All English & Japanese Cards ({year}) | PokePrices"', () => {
    const seo = getPokemonSeo({
      name: 'Pikachu', slug: 'pikachu', totalCards: 547,
      englishCards: 369, japaneseCards: 178, distinctSetCount: 134,
      hasPsa10Data: true, hasJapaneseCards: true, year: 2026,
    })
    expect(seo.title).toBe(
      'Pikachu Card Prices — All English & Japanese Cards (2026) | PokePrices',
    )
  })

  it('title fallback (no JP): "{Name} Card Prices — All Cards & Values ({year}) | PokePrices"', () => {
    const seo = getPokemonSeo({
      name: 'Zubat', slug: 'zubat', totalCards: 3, distinctSetCount: 2,
      hasPsa10Data: false, hasJapaneseCards: false, year: 2026,
    })
    expect(seo.title).toBe(
      'Zubat Card Prices — All Cards & Values (2026) | PokePrices',
    )
  })

  it('title carries every priority token (name / Card Prices / All / English & Japanese / year)', () => {
    const seo = getPokemonSeo({
      name: 'Charizard', slug: 'charizard', totalCards: 349,
      englishCards: 221, japaneseCards: 128, distinctSetCount: 98,
      hasPsa10Data: true, hasJapaneseCards: true, year: 2026,
    })
    for (const token of ['Charizard', 'Card Prices', 'All', 'English & Japanese', '(2026)']) {
      expect(seo.title).toContain(token)
    }
  })

  it('description exact match with real per-language counts', () => {
    const seo = getPokemonSeo({
      name: 'Pikachu', slug: 'pikachu', totalCards: 547,
      englishCards: 369, japaneseCards: 178, distinctSetCount: 134,
      hasPsa10Data: true, hasJapaneseCards: true, year: 2026,
    })
    expect(seo.description).toBe(
      'See prices for all 547 Pikachu cards across 134 sets, including 369 English and 178 Japanese cards. Compare raw and PSA 10 values and track your collection. Updated daily.',
    )
  })

  it('description drops the JP clause cleanly for species without JP cards', () => {
    const seo = getPokemonSeo({
      name: 'Zubat', slug: 'zubat', totalCards: 3, distinctSetCount: 2,
      hasPsa10Data: true, hasJapaneseCards: false, year: 2026,
    })
    expect(seo.description).toBe(
      'See prices for all 3 Zubat cards across 2 sets. Compare raw and PSA 10 values and track your collection. Updated daily.',
    )
  })
})

// ── page.tsx — SEO wiring ────────────────────────────

describe('53B.1 — page.tsx derives + forwards the 53B.1 inputs into getPokemonSeo', () => {
  it('derives hasJapaneseCards from the RPC jp_total_cards / language payload', () => {
    expect(PAGE).toMatch(/const hasJapaneseCards =/)
    expect(PAGE).toMatch(/sp\.jp_total_cards === 'number' && sp\.jp_total_cards > 0/)
    expect(PAGE).toMatch(/allCards\.some\(c => c\.language === 'jp'\)/)
  })

  it('derives englishCards / japaneseCards / distinctSetCount for the metadata call', () => {
    expect(PAGE).toMatch(/const enCountMeta =/)
    expect(PAGE).toMatch(/const jpCountMeta =/)
    expect(PAGE).toMatch(/const distinctSetCountMeta =/)
  })

  it('forwards englishCards / japaneseCards / distinctSetCount / year into getPokemonSeo', () => {
    const call = PAGE.slice(PAGE.indexOf('const seo = getPokemonSeo(')).slice(0, 800)
    expect(call).toMatch(/englishCards:\s*enCountMeta/)
    expect(call).toMatch(/japaneseCards:\s*jpCountMeta/)
    expect(call).toMatch(/distinctSetCount:\s*distinctSetCountMeta/)
    expect(call).toMatch(/year:\s+new Date\(\)\.getFullYear\(\)/)
  })
})

// ── H1 — new copy ────────────────────────────────────

describe('53B.1 — H1 is the human-readable "All {Name} Cards — English & Japanese Prices"', () => {
  it('H1 template is conditional on hasJapaneseCards', () => {
    expect(PAGE).toMatch(
      /const h1 = hasJapaneseCards\s*\n\s*\?\s*`All \$\{displayName\} Cards — English & Japanese Prices`\s*\n\s*:\s*`All \$\{displayName\} Cards & Prices`/,
    )
  })

  it('the old 53B "Card Prices & All {Name} Pokémon Cards" H1 template is gone', () => {
    expect(PAGE).not.toContain('Card Prices & All ${displayName} Pokémon Cards')
  })
})

// ── Server-rendered English + Japanese sections ────────

describe('53B.1 — server-rendered English + Japanese Card Prices sections', () => {
  it('renders both sections only when hasJapaneseCards and the language slice has cards', () => {
    expect(PAGE).toMatch(/const showEnglishSection\s*=\s*hasJapaneseCards && englishCards\.length > 0/)
    expect(PAGE).toMatch(/const showJapaneseSection\s*=\s*hasJapaneseCards && japaneseCards\.length > 0/)
  })

  it('English section heading is "English {Name} Card Prices"', () => {
    expect(PAGE).toMatch(/heading=\{`English \$\{displayName\} Card Prices`\}/)
  })

  it('Japanese section heading is "Japanese {Name} Card Prices"', () => {
    expect(PAGE).toMatch(/heading=\{`Japanese \$\{displayName\} Card Prices`\}/)
  })

  it('English intro programmatically states "PokePrices tracks N English {Name} cards across M sets"', () => {
    expect(PAGE).toMatch(
      /intro=\{`PokePrices tracks \$\{enCount\} English \$\{displayName\} card[^`]*across \$\{enSets\} set[^`]*Compare current raw and PSA values for English \$\{displayName\} cards below\.`\}/,
    )
  })

  it('Japanese intro programmatically states "PokePrices tracks N Japanese {Name} cards across M sets"', () => {
    expect(PAGE).toMatch(
      /intro=\{`PokePrices tracks \$\{jpCountSection\} Japanese \$\{displayName\} card[^`]*across \$\{jpSets\} set[^`]*Browse Japanese \$\{displayName\} cards with current raw and PSA price-guide values\.`\}/,
    )
  })

  it('per-section top lists are capped at 5 rows via slice(0, 5)', () => {
    expect(PAGE).toMatch(/const topEnglishCards = \[\.\.\.englishCards\]\.sort\(rankByValue\)\.slice\(0, 5\)/)
    expect(PAGE).toMatch(/const topJapaneseCards = \[\.\.\.japaneseCards\]\.sort\(rankByValue\)\.slice\(0, 5\)/)
  })

  it('per-section card links use the existing crawl path — no new URLs', () => {
    const helper = PAGE.slice(PAGE.indexOf('function LanguageSection'))
    expect(helper).toMatch(/`\/set\/\$\{encodeURIComponent\(c\.set_name\)\}\/card\/\$\{c\.card_url_slug\}`/)
  })

  it('sections are placed BEFORE the full catalogue (SpeciesInteractiveSection)', () => {
    const enIdx  = PAGE.indexOf('showEnglishSection')
    const jpIdx  = PAGE.indexOf('showJapaneseSection')
    // Match the rendered <SpeciesInteractiveSection opening tag, not
    // the import at the top of the file.
    const catIdx = PAGE.indexOf('<SpeciesInteractiveSection')
    expect(enIdx).toBeGreaterThan(0)
    expect(jpIdx).toBeGreaterThan(0)
    expect(catIdx).toBeGreaterThan(enIdx)
    expect(catIdx).toBeGreaterThan(jpIdx)
  })
})

// ── SpeciesInteractiveSection heading gains "& Prices" ─

describe('53B.1 — catalogue H2 gains "& Prices" suffix', () => {
  it('all three states (all / en / jp) end with "Cards & Prices"', () => {
    expect(SECTION).toMatch(/`All \$\{sortedCards\.length\} Japanese \$\{displayName\} Cards & Prices`/)
    expect(SECTION).toMatch(/`All \$\{sortedCards\.length\} English \$\{displayName\} Cards & Prices`/)
    expect(SECTION).toMatch(/`All \$\{sortedCards\.length\} \$\{displayName\} Cards & Prices`/)
  })

  it('no bare "Cards" (without "& Prices") in the heading branches', () => {
    // Anti-regression: previous 53B state emitted just "All N {Name}
    // Cards" without the "& Prices" close.
    expect(SECTION).not.toMatch(/`All \$\{sortedCards\.length\} \$\{displayName\} Cards`(?!\s*&)/)
  })
})

// ── Recent-sold wording correction (from 53B, still holds) ─

describe('53B / 53B.1 — species prose + FAQ do not claim "recent sold listings"', () => {
  it('page.tsx prose no longer says "by current sold-listing prices"', () => {
    expect(PAGE).not.toMatch(/by current sold-listing prices/)
    expect(PAGE).toMatch(/current PriceCharting price guide value/)
  })

  it('getPokemonFaqItems catalogue answer names PriceCharting instead of "recent sold listings"', () => {
    const items = getPokemonFaqItems({
      name: 'Pikachu',
      cards: [
        { card_name: 'Pikachu #1', set_name: 'Base Set', raw_usd: 5_000, psa10_usd: 30_000 },
      ],
      uniqueSets: 132,
    })
    const catalogue = items.find(i => i.question.startsWith('How many'))!
    expect(catalogue.answer).not.toContain('recent sold listings')
    expect(catalogue.answer).toContain('PriceCharting')
  })
})

// ── pokemonSummary "Represented sets" fix (from 53B, still holds) ─

describe('53B / 53B.1 — pokemonSummary "Represented sets" prefers distinctSetCount', () => {
  it('un-capped distinctSetCount wins over bySet.length', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ set_name: `Set ${i + 1}` }))
    const out = buildPokemonSummary({
      species: { name: 'pikachu', total_cards: 547 },
      topCards: [
        { card_name: 'X', set_name: 'Base Set', card_url_slug: 'x', current_raw: 5_000, current_psa10: 30_000 },
      ],
      bySet: twelve,
      distinctSetCount: 134,
    })
    expect(out.facts.find(f => f.key === 'set_count')?.value).toBe('134 sets')
  })

  it('falls back to bySet.length when distinctSetCount is missing', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ set_name: `Set ${i + 1}` }))
    const out = buildPokemonSummary({
      species: { name: 'greninja', total_cards: 63 },
      topCards: [{ card_name: 'X', set_name: 'Set 1', card_url_slug: 'x', current_raw: 5_000, current_psa10: 5_000 }],
      bySet: four,
    })
    expect(out.facts.find(f => f.key === 'set_count')?.value).toBe('4 sets')
  })
})
