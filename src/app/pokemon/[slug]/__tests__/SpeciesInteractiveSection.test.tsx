// Block 5A-W-53A — source-contract tests for the Pokémon page
// language filter, completion bars, and logged-out CTA.
//
// The repo's vitest config uses `environment: 'node'` and does not
// carry a React Testing Library dep, so component-render tests
// aren't available. Instead we lock down behaviour by:
//   * unit-testing the pure helpers used by the section (see
//     src/lib/__tests__/pokemonCompletion.test.ts), and
//   * asserting the wired-up JSX + props + copy on this
//     source-contract layer here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SECTION = readFileSync(join(process.cwd(), 'src', 'app', 'pokemon', '[slug]', 'SpeciesInteractiveSection.tsx'), 'utf8')
const PAGE = readFileSync(join(process.cwd(), 'src', 'app', 'pokemon', '[slug]', 'page.tsx'), 'utf8')
const COMPLETION = readFileSync(join(process.cwd(), 'src', 'lib', 'pokemonCompletion.ts'), 'utf8')
const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '2026-08-05-pokemon-species-language.sql'), 'utf8')

// ── Filter tabs + counts ────────────────────────────

describe('SpeciesInteractiveSection — language filter tabs', () => {
  it('imports filterCardsByLanguage + countCardsByLanguage from the pure helper', () => {
    expect(SECTION).toMatch(/filterCardsByLanguage/)
    expect(SECTION).toMatch(/countCardsByLanguage/)
  })

  it('accepts enTotal + jpTotal props from the RPC (falls back to payload counts)', () => {
    expect(SECTION).toMatch(/enTotal\?: number/)
    expect(SECTION).toMatch(/jpTotal\?: number/)
    expect(SECTION).toMatch(/const totalEn = enTotal \?\? payloadCounts\.en/)
    expect(SECTION).toMatch(/const totalJp = jpTotal \?\? payloadCounts\.jp/)
  })

  it('renders All / English / Japanese tabs with counts, guarded by hasJp', () => {
    expect(SECTION).toMatch(/\{hasJp && \(\s*<div role="tablist"/)
    expect(SECTION).toMatch(/label=\{`All \(\$\{totalAll\}\)`\}/)
    expect(SECTION).toMatch(/label=\{`English \(\$\{totalEn\}\)`\}/)
    expect(SECTION).toMatch(/label=\{`Japanese \(\$\{totalJp\}\)`\}/)
  })

  it('defaults to "all" and never re-adds the same card across filters', () => {
    // filterCardsByLanguage returns a strict `.filter(...)` over the
    // input array, so a card cannot appear in both en and jp.
    expect(SECTION).toMatch(/useState<LanguageFilter>\('all'\)/)
    expect(COMPLETION).toMatch(/return cards\.filter\(c => \(c\.language \?\? 'en'\) === language\)/)
  })
})

// ── Empty-state copy ────────────────────────────────

describe('SpeciesInteractiveSection — empty states', () => {
  it('shows a clean per-language empty message (never a broken 0/0 bar)', () => {
    // These messages live inside template literals (backticks), so
    // the interpolation uses ${displayName} — with dollar-sign.
    expect(SECTION).toMatch(/No Japanese cards are currently listed for \$\{displayName\}/)
    expect(SECTION).toMatch(/No English cards are currently listed for \$\{displayName\}/)
    expect(SECTION).toMatch(/No \$\{displayName\} cards are currently listed/)
  })

  it('the CompletionBar renders no bar fill when total is 0', () => {
    // "zero" is derived from total <= 0 and gates the bar+percentage.
    expect(SECTION).toMatch(/const zero = total <= 0/)
    expect(SECTION).toMatch(/\{!zero &&/)
  })
})

// ── Logged-out CTA ──────────────────────────────────

describe('SpeciesInteractiveSection — logged-out CTA', () => {
  it('shows the block-spec CTA copy for signed-out users', () => {
    expect(SECTION).toMatch(/Create a free account to track your English and Japanese \{displayName\} collection progress\./)
  })

  it('CTA link points at the existing sign-up flow with a returnTo back to this Pokémon page', () => {
    expect(SECTION).toMatch(/\/dashboard\/login\?returnTo=\$\{encodeURIComponent\(`\/pokemon\/\$\{pokemonSlug \?\? ''\}`\)\}/)
  })

  it('is guarded so signed-out users still see the card list (no hidden content)', () => {
    // The CTA sits above the card grid. Match on the specific card
    // grid fingerprint (auto-fill, 150px min column) — the earlier
    // completion-bar container is also a grid, but it uses
    // `1fr 1fr` so it doesn't collide with this fingerprint.
    const ctaIdx = SECTION.indexOf('Create a free account to track')
    const gridIdx = SECTION.indexOf('repeat(auto-fill, minmax(150px')
    expect(ctaIdx).toBeGreaterThan(0)
    expect(gridIdx).toBeGreaterThan(ctaIdx)
  })
})

// ── Logged-in completion bars ───────────────────────

describe('SpeciesInteractiveSection — logged-in completion', () => {
  it('renders both bars only when both totals > 0', () => {
    // Labels are template literals inside `label={`English ${displayName} cards owned`}`.
    expect(SECTION).toMatch(/hasEn && hasJp \? '1fr 1fr' : '1fr'/)
    expect(SECTION).toMatch(/\{hasEn && \(\s*<CompletionBar[\s\S]{0,400}English \$\{displayName\} cards owned/)
    expect(SECTION).toMatch(/\{hasJp && \(\s*<CompletionBar[\s\S]{0,400}Japanese \$\{displayName\} cards owned/)
  })

  it('displays the block-spec "X% complete" phrasing', () => {
    expect(SECTION).toMatch(/\{percentage\}% complete/)
  })

  it('shows the "you don\'t own any" message when the loader returned null', () => {
    expect(SECTION).toMatch(/You don't own any \{displayName\} cards yet\./)
  })

  it('loads completion via the pure helper (paginated portfolio + narrowed cards lookup)', () => {
    expect(SECTION).toMatch(/loadPokemonCompletion\(supabase, user\.id, pokemonSlug, \{ en: totalEn, jp: totalJp \}\)/)
    // Anonymous users must not hit the DB. The effect early-exits.
    expect(SECTION).toMatch(/if \(!user\?\.id \|\| !pokemonSlug\) \{[\s\S]{0,80}setCompletion\(null\)/)
  })
})

// ── JP card ribbon ──────────────────────────────────

describe('SpeciesInteractiveSection — JP card ribbon', () => {
  it('renders a "JP" corner ribbon on Japanese card tiles for at-a-glance scanning', () => {
    expect(SECTION).toMatch(/card\.language === 'jp'/)
    expect(SECTION).toMatch(/>JP</)
  })
})

// ── Server page wires up the RPC → SpeciesInteractiveSection props ─

describe('Pokémon server page — wires the new props', () => {
  it('passes pokemonSlug, enTotal, jpTotal to the client section', () => {
    expect(PAGE).toMatch(/<SpeciesInteractiveSection[\s\S]{0,400}pokemonSlug=\{sp\?\.name \?\? slug\}[\s\S]{0,200}enTotal=\{sp\?\.en_total_cards\}[\s\S]{0,200}jpTotal=\{sp\?\.jp_total_cards\}/)
  })

  it('SpeciesRow type carries the RPC per-language totals (optional for backward compat)', () => {
    expect(PAGE).toMatch(/en_total_cards\?: number/)
    expect(PAGE).toMatch(/jp_total_cards\?: number/)
  })

  it('CardRow carries the RPC language projection', () => {
    expect(PAGE).toMatch(/language\?:\s*'en' \| 'jp' \| null/)
  })
})

// ── Migration contract ─────────────────────────────

describe('get_pokemon_species_detail — language migration', () => {
  it('projects language on every card list', () => {
    // Four projections: top_cards, risers_30d, fallers_30d, all_cards.
    const langOccurrences = (MIGRATION.match(/^\s*c\.language,?$/gm) ?? []).length
    expect(langOccurrences).toBeGreaterThanOrEqual(4)
  })

  it('returns en_total_cards + jp_total_cards on species', () => {
    expect(MIGRATION).toMatch(/COUNT\(DISTINCT c\.card_slug\) FILTER \(WHERE c\.language = 'en'\)/)
    expect(MIGRATION).toMatch(/COUNT\(DISTINCT c\.card_slug\) FILTER \(WHERE c\.language = 'jp'\)/)
    expect(MIGRATION).toMatch(/'en_total_cards',\s+COALESCE\(en_total, 0\)/)
    expect(MIGRATION).toMatch(/'jp_total_cards',\s+COALESCE\(jp_total, 0\)/)
  })

  it('all_cards LIMIT raised to 800 (Pikachu now exceeds 500 with JP cards)', () => {
    expect(MIGRATION).toMatch(/LIMIT 800/)
  })

  it('is additive (CREATE OR REPLACE FUNCTION only, no destructive DDL)', () => {
    // No ALTER TABLE / DROP TABLE / DROP COLUMN outside comments.
    for (const line of MIGRATION.split(/\r?\n/)) {
      if (/^\s*(ALTER TABLE|DROP TABLE|DROP COLUMN)/i.test(line)) {
        throw new Error(`unexpected destructive DDL: ${line}`)
      }
    }
  })
})

// ── filterCardsByLanguage / countCardsByLanguage ────

describe('filterCardsByLanguage + countCardsByLanguage', () => {
  // These behavioural tests use the actual imported helpers so a
  // future change to their signature breaks here.
  it('filterCardsByLanguage passes "all" through unchanged', async () => {
    const { filterCardsByLanguage } = await import('@/lib/pokemonCompletion')
    const cards = [{ language: 'en' as const }, { language: 'jp' as const }]
    expect(filterCardsByLanguage(cards, 'all')).toEqual(cards)
  })

  it('filterCardsByLanguage "en" excludes Japanese cards', async () => {
    const { filterCardsByLanguage } = await import('@/lib/pokemonCompletion')
    const cards = [{ language: 'en' as const }, { language: 'jp' as const }]
    expect(filterCardsByLanguage(cards, 'en')).toEqual([{ language: 'en' }])
  })

  it('filterCardsByLanguage "jp" excludes English cards', async () => {
    const { filterCardsByLanguage } = await import('@/lib/pokemonCompletion')
    const cards = [{ language: 'en' as const }, { language: 'jp' as const }]
    expect(filterCardsByLanguage(cards, 'jp')).toEqual([{ language: 'jp' }])
  })

  it('countCardsByLanguage reports total = en + jp', async () => {
    const { countCardsByLanguage } = await import('@/lib/pokemonCompletion')
    const cards = [{ language: 'en' as const }, { language: 'jp' as const }, { language: 'jp' as const }]
    const c = countCardsByLanguage(cards)
    expect(c.en).toBe(1)
    expect(c.jp).toBe(2)
    expect(c.total).toBe(3)
  })
})
