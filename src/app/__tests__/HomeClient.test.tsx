// Block 5A-W-41A-RETRY — invariants for the subtle split-hero homepage.
//
// The W41A market-dashboard shell was reverted. The retry keeps the
// blue Pokémon-flavoured homepage feel and just breaks the centred
// SaaS stack into a two-column split hero: brand + primary CTAs on
// the left, AI panel + market pulse card on the right. The two
// standalone sections directly below the old hero (Market Index
// Banner, Ask the AI Market Assistant) are folded into the hero's
// right column. Every lower section is unchanged.
//
// Tests read the source of HomeClient directly — the live component
// has DB reads on mount and a heavy render tree, and the invariants
// we care about are structural, not behavioural.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'HomeClient.tsx'), 'utf8')

describe('HomeClient — Block 5A-W-41A-RETRY split hero', () => {
  it('renders the SearchBar and InlineChat somewhere on the page', () => {
    expect(SRC).toContain("import SearchBar from '@/components/SearchBar'")
    expect(SRC).toMatch(/<SearchBar\b/)
    expect(SRC).toContain("import InlineChat from '@/components/InlineChat'")
    expect(SRC).toContain('<InlineChat />')
  })

  it('places InlineChat inside the right-column AI panel of the hero', () => {
    // The AI panel must sit before the "This week in the market"
    // section (which is currently the first section after the hero).
    // If InlineChat drifts back below the market movers, this fails.
    const chatIdx  = SRC.indexOf('<InlineChat />')
    const weekIdx  = SRC.indexOf('── WEEKLY MARKET REPORT')
    expect(chatIdx).toBeGreaterThan(-1)
    expect(weekIdx).toBeGreaterThan(-1)
    expect(chatIdx).toBeLessThan(weekIdx)
    // …and it should live inside the right column marker, not the left.
    const rightIdx = SRC.indexOf('── RIGHT COLUMN')
    expect(rightIdx).toBeGreaterThan(-1)
    expect(chatIdx).toBeGreaterThan(rightIdx)
  })

  it('has the single-colour H1 "The numbers behind every Pokémon card" with no accent-word split', () => {
    // Full sentence appears in one flat text node — no <span> or
    // <br /> splitting "Pokémon" onto its own accent-coloured line.
    expect(SRC).toMatch(/>\s*The numbers behind every Pokémon card\s*</)
    // Regression guard: no yellow accent wrap around the word Pokémon.
    expect(SRC).not.toMatch(/style=\{\{\s*color:\s*'var\(--accent\)'\s*\}\}\s*>Pokémon</)
    // Regression guard: no line-break splitting the H1.
    expect(SRC).not.toContain('behind every<br />')
  })

  it('mounts a section with id="market-movers" for the anchor target', () => {
    expect(SRC).toMatch(/id="market-movers"/)
  })

  it('renders the 4 hero browse links with correct hrefs', () => {
    for (const [label, href] of [
      ['Browse Cards & Sets', '/browse'        ],
      ['Browse Pokémon',      '/pokemon'       ],
      ['Market Movers',       '#market-movers' ],
      ['Insights',            '/insights'      ],
    ]) {
      expect(SRC).toContain(`label: '${label}'`)
      expect(SRC).toContain(`href: '${href}'`)
    }
  })

  it('includes both auth-state CTA sets (signed-out + signed-in) inline in the hero', () => {
    // Signed-out
    expect(SRC).toContain('/dashboard/login?mode=signup')
    expect(SRC).toContain('>Sign up free<')
    expect(SRC).toContain('/dashboard/login')
    expect(SRC).toContain('>Log in →<')
    expect(SRC).toContain('Track cards, follow sets, build your own collector dashboard.')

    // Signed-in
    expect(SRC).toContain('>My Dashboard<')
    expect(SRC).toContain('/dashboard/watchlist-alerts')
    expect(SRC).toContain('>My Watchlist →<')
    expect(SRC).toContain('/dashboard/portfolio')
    expect(SRC).toContain('>My Portfolio →<')
  })

  it('drops the deleted HomeQuickActions component entirely', () => {
    expect(SRC).not.toContain('HomeQuickActions')
  })

  it('drops the W41A dashboard-shell artefacts', () => {
    // These belonged to the reverted market-terminal attempt.
    // (We intentionally don't check for "Top Riser" here — that
    // string is a legitimate category label used by the weekly
    // market report grid, not a dashboard artefact.)
    expect(SRC).not.toContain('HomeMarketTicker')
    expect(SRC).not.toContain('HomeAccountRail')
    expect(SRC).not.toContain('Mkt Index')
    expect(SRC).not.toContain('MarketTickerInput')
  })

  it('folds the standalone Market Index Banner into the hero pulse card', () => {
    // The standalone banner used this exact kicker; the pulse card uses
    // "Market pulse" instead. If someone reinstates the banner as its
    // own section, this fires.
    expect(SRC).not.toContain('Pokémon TCG Market Index')
    expect(SRC).toContain('Market pulse')
  })

  it('folds the standalone AI section — no separate "Ask the AI market assistant" header block', () => {
    // The standalone section's header text; the hero panel uses
    // "Ask the market assistant" (no "AI ").
    expect(SRC).not.toContain('Ask the AI market assistant')
    expect(SRC).toContain('Ask the market assistant')
    // Regression guard: no "Ask me anything" placeholder.
    expect(SRC).not.toContain('Ask me anything')
  })

  it('does not carry the primary-emoji cheap-glyph set on any homepage label', () => {
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🎯', '🎨', '📍', '📬', '🔒', '🛒']) {
      expect(SRC).not.toContain(glyph)
    }
  })

  it('widens the hero container beyond the old centred 760px well', () => {
    // Pin the wider desktop container the retry brief asked for.
    expect(SRC).toMatch(/maxWidth:\s*1200/)
    // Regression guard: the old narrow centred well is gone.
    expect(SRC).not.toContain("maxWidth: 760, margin: '0 auto', textAlign: 'center'")
  })

  it('carries a scoped responsive rule for the split hero grid', () => {
    expect(SRC).toContain('.pp-split-hero')
    expect(SRC).toContain('@media (min-width: 1024px)')
    expect(SRC).toContain('grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr)')
  })
})

describe('HomeClient — W41A-RETRY section order', () => {
  it('opens with the split hero, then the lower sections in the same order as W40B', () => {
    const markers = [
      '── SPLIT HERO ──',
      '── LEFT COLUMN',
      '── RIGHT COLUMN',
      '── WEEKLY MARKET REPORT',
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
