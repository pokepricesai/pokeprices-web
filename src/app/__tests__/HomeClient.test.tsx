// Block 5A-W-40B — invariants for the restructured homepage.
//
// HomeClient does live DB reads on mount; a proper DOM-mount test is
// heavy for our vitest 'node' environment. Read the source and pin
// the structural invariants directly:
//
//   * <HomeQuickActions/> is imported and mounted inside the hero.
//   * <InlineChat/> is still on the homepage (moved into its own
//     "Ask the AI market assistant" section).
//   * id="market-movers" is applied to the weekly market report so
//     the QuickActions "Market Movers" pill scrolls into it.
//   * The yellow "✨ Ask me anything" hero pill is gone.
//   * The yellow "Explore Latest Set: Chaos Rising →" hero pill is
//     gone (Chaos Rising still gets a dedicated banner section
//     lower on the page).
//   * Cheap-looking emoji glyphs on the primary tiles have been
//     removed. The floating-background PokemonSilhouettes + Sparkles
//     SVG helpers are intentionally kept — decorative background is
//     outside the "primary UI labels" scope.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'HomeClient.tsx'), 'utf8')

describe('HomeClient — Block 5A-W-40B hero + section restructure', () => {
  it('imports and renders HomeQuickActions', () => {
    expect(SRC).toContain("import HomeQuickActions from '@/components/home/HomeQuickActions'")
    expect(SRC).toContain('<HomeQuickActions />')
  })

  it('still renders InlineChat somewhere on the page (moved out of the hero)', () => {
    expect(SRC).toContain("import InlineChat from '@/components/InlineChat'")
    expect(SRC).toContain('<InlineChat />')
  })

  it('surfaces the "Ask the AI market assistant" section', () => {
    expect(SRC).toContain('Ask the AI market assistant')
    expect(SRC).toContain('Open full AI assistant')
  })

  it('adds id="market-movers" so the QuickActions Market Movers pill has a target', () => {
    expect(SRC).toMatch(/<section\s+id="market-movers"/)
  })

  it('does NOT keep the yellow "Ask me anything" hero pill', () => {
    // Regression pin — the previous hero had a "✨ Ask me anything"
    // marker directly above InlineChat.
    expect(SRC).not.toContain('Ask me anything')
    expect(SRC).not.toContain('✨')
  })

  it('does NOT keep the duplicate "Explore Latest Set: Chaos Rising →" hero pill', () => {
    // Chaos Rising still gets a dedicated banner further down the
    // page. The compact hero drops the second CTA.
    expect(SRC).not.toContain('Explore Latest Set: Chaos Rising')
  })

  it('drops the primary emoji glyphs from the tools + features + newsletter tiles', () => {
    // These sat as leading icons on Featured Tools cards, Built
    // Different feature cards, and the Newsletter section. All are
    // now text-first.
    for (const glyph of ['🎯', '🎨', '📍', '📊', '📈', '🔒', '📬']) {
      expect(SRC).not.toContain(glyph)
    }
  })

  it('renders the Browse Discovery cards with clean text labels', () => {
    for (const label of [
      'Browse Cards & Sets',
      'Browse Pokémon',
      'Follow Market Movers',
      'Read Market Insights',
    ]) {
      expect(SRC).toContain(label)
    }
  })
})

describe('HomeClient — section order', () => {
  it('places sections in the W40B target order', () => {
    // Match on the section marker comments. Each subsequent marker
    // must appear AFTER the previous one in the file.
    const targetOrder = [
      '── HERO ──',
      '── MARKET INDEX BANNER ──',
      '── ASK THE AI MARKET ASSISTANT ──',
      '── WEEKLY MARKET REPORT',
      '── BROWSE DISCOVERY ──',
      '── FEATURED TOOLS ──',
      '── HIDDEN GEMS ──',
      '── JUST RELEASED',
      '── LATEST GUIDES ──',
      '── BUILT DIFFERENT ──',
      '── STATS BAR ──',
      '── NEWSLETTER ──',
      '── FAQ',
    ]
    let cursor = 0
    for (const marker of targetOrder) {
      const idx = SRC.indexOf(marker, cursor)
      expect(idx, `expected section "${marker}" after position ${cursor}`).toBeGreaterThan(-1)
      cursor = idx + marker.length
    }
  })
})
