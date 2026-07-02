// Block 5A-W-41A — invariants for the shell-replaced homepage.
//
// The classic centred hero is gone. The homepage now opens with a
// full-width market ticker followed by a three-panel dashboard
// (left rail = Search & Browse, main workspace = This Week in the
// Market, right rail = AI + Account). Lower sections are unchanged.
//
// Tests read the source of HomeClient directly — the live component
// has DB reads on mount and a heavy render tree, and the invariants
// we care about are structural, not behavioural.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'HomeClient.tsx'), 'utf8')

describe('HomeClient — Block 5A-W-41A dashboard opening', () => {
  it('imports and renders the market ticker at the top of the layout', () => {
    expect(SRC).toContain("import HomeMarketTicker from '@/components/home/HomeMarketTicker'")
    expect(SRC).toMatch(/<HomeMarketTicker\b/)
  })

  it('imports and renders the account rail on the right', () => {
    expect(SRC).toContain("import HomeAccountRail from '@/components/home/HomeAccountRail'")
    expect(SRC).toMatch(/<HomeAccountRail\b/)
  })

  it('no longer references the deleted HomeQuickActions component', () => {
    expect(SRC).not.toContain('HomeQuickActions')
  })

  it('still renders SearchBar and InlineChat somewhere on the page', () => {
    expect(SRC).toContain("import SearchBar from '@/components/SearchBar'")
    expect(SRC).toMatch(/<SearchBar\b/)
    expect(SRC).toContain("import InlineChat from '@/components/InlineChat'")
    expect(SRC).toContain('<InlineChat />')
  })

  it('preserves the H1 with "The numbers behind every Pokémon card"', () => {
    expect(SRC).toMatch(/<h1[\s\S]*?The numbers behind every Pokémon card[\s\S]*?<\/h1>/)
  })

  it('mounts a section with id="market-movers" for the anchor target', () => {
    expect(SRC).toMatch(/id="market-movers"/)
  })

  it('renders the Search & Browse directory rail with the 5 required links', () => {
    for (const [label, href] of [
      ['Cards & Sets',   '/browse'        ],
      ['Pokémon Index',  '/pokemon'       ],
      ['Market Movers',  '#market-movers' ],
      ['Insights',       '/insights'      ],
      ['Tools',          '/tools'         ],
    ]) {
      expect(SRC).toContain(`label: '${label}'`)
      expect(SRC).toContain(`href: '${href}'`)
    }
  })

  it('drops the centred blue-gradient hero opening block', () => {
    // The old hero used this exact gradient string as the section
    // background. Its removal is the primary structural change.
    expect(SRC).not.toContain("linear-gradient(170deg, #1a5fad 0%, #3b8fe8 35%")
  })

  it('drops the old standalone "Ask me anything" / market-index-banner slots', () => {
    // Pin two regressions from earlier iterations of the homepage.
    expect(SRC).not.toContain('Ask me anything')
    expect(SRC).not.toContain('✨')
    expect(SRC).not.toContain('Pokémon TCG Market Index')
  })

  it('does not carry the primary-emoji cheap-glyph set on any homepage label', () => {
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '🎯', '🎨', '📍', '📬', '🔒', '🛒']) {
      expect(SRC).not.toContain(glyph)
    }
  })
})

describe('HomeClient — W41A opening section order', () => {
  it('opens with the ticker, then the dashboard opening, then the lower sections', () => {
    // Each marker must appear AFTER the previous one in the file.
    const markers = [
      'HomeMarketTicker',
      '── DASHBOARD OPENING ──',
      '── LEFT RAIL: Search & Browse ──',
      '── MAIN WORKSPACE: This week in the market ──',
      '── RIGHT RAIL: AI + Account ──',
      '── BROWSE DISCOVERY ──',
      '── FEATURED TOOLS ──',
      '── HIDDEN GEMS ──',
      '── JUST RELEASED',
      '── LATEST GUIDES',
      '── BUILT DIFFERENT ──',
      '── STATS BAR ──',
      '── NEWSLETTER ──',
      '── FAQ',
    ]
    let cursor = 0
    for (const marker of markers) {
      const idx = SRC.indexOf(marker, cursor)
      expect(idx, `expected marker "${marker}" after position ${cursor}`).toBeGreaterThan(-1)
      cursor = idx + marker.length
    }
  })
})
