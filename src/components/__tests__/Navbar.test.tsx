// Block 5A-W-40A — pin the nav restructure.
//
// The Navbar module transitively imports the module-level supabase
// browser client and a couple of client-only utilities. Reading the
// component source as a text file bypasses that whole hydration
// dance while still letting us pin the invariants that matter:
//   * the NAV list contains the 7 required top-level items in order
//     (Cards, Sets, Pokémon, Market, Tools, Insights, Ask AI);
//   * old groups (Prices, Community as a group, Games as a top-level
//     link) are gone;
//   * emoji-led labels (✨ Ask me anything, 🃏 Cards, etc.) are gone;
//   * the demoted Community + Games items are surfaced in the
//     mobile-only MOBILE_MORE_LINKS block;
//   * the logged-in path renders a Dashboard direct link.
//
// Route fallbacks:
//   * Sets → /browse#sets  (no /sets route yet)
//   * Market → /#market-movers  (W40B adds the anchor id)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NAVBAR_SRC = readFileSync(
  join(__dirname, '..', 'Navbar.tsx'),
  'utf8',
)

// Grab the primary NAV array as source text so we can inspect ordering.
function extractNavBlock(): string {
  const start = NAVBAR_SRC.indexOf('const NAV: NavGroup[] = [')
  const end   = NAVBAR_SRC.indexOf('\n]', start)
  if (start < 0 || end < 0) throw new Error('NAV block not found in Navbar.tsx')
  return NAVBAR_SRC.slice(start, end + 2)
}

describe('Navbar — Block 5A-W-40A-FIX consolidated top-level nav', () => {
  const navBlock = extractNavBlock()

  it('lists the 5 required top-level items in priority order', () => {
    // W40A-FIX trimmed the nav from 7 to 5 items:
    //   * "Cards" and "Sets" merged into "Cards & Sets" (both used
    //     to point at /browse — no dedicated /sets route yet).
    //   * "Market" removed until W40B adds the matching homepage
    //     anchor or a dedicated /market route.
    const required = ['Cards & Sets', 'Pokémon', 'Tools', 'Insights', 'Ask AI']
    let cursor = 0
    for (const label of required) {
      const idx = navBlock.indexOf(`label: '${label}'`, cursor)
      expect(idx, `expected NAV item "${label}" after position ${cursor}`).toBeGreaterThan(-1)
      cursor = idx + label.length
    }
  })

  it('routes Cards & Sets to /browse', () => {
    expect(navBlock).toMatch(/label:\s*'Cards & Sets',\s*href:\s*'\/browse'/)
  })
  it('routes Pokémon to /pokemon', () => {
    expect(navBlock).toMatch(/label:\s*'Pokémon',\s*href:\s*'\/pokemon'/)
  })
  it('routes Insights to /insights', () => {
    expect(navBlock).toMatch(/label:\s*'Insights',\s*href:\s*'\/insights'/)
  })
  it('routes Ask AI to /ai-assistant', () => {
    expect(navBlock).toMatch(/label:\s*'Ask AI',\s*href:\s*'\/ai-assistant'/)
  })

  it('Tools stays a dropdown group with /tools as the header link', () => {
    expect(navBlock).toMatch(/label:\s*'Tools',\s*href:\s*'\/tools',[\s\S]*items:\s*\[/)
  })
})

describe('Navbar — removed / demoted top-level items', () => {
  const navBlock = extractNavBlock()

  it('no top-level "Prices" group', () => {
    // The Prices group used to hide Cards/Pokémon under a dropdown.
    expect(navBlock).not.toMatch(/label:\s*'Prices'/)
  })
  it('no top-level "Community" group', () => {
    // Community items live in the footer + mobile "More" now.
    expect(navBlock).not.toMatch(/label:\s*'Community'/)
  })
  it('no top-level "Games" link', () => {
    // Games moved to footer + mobile "More".
    expect(navBlock).not.toMatch(/label:\s*'Games'/)
  })

  it('no separate top-level "Cards" item (merged into "Cards & Sets")', () => {
    // W40A-FIX regression pin — the split Cards / Sets pair went away.
    // "label: 'Cards & Sets'" is allowed; "label: 'Cards'" is not.
    expect(navBlock).not.toMatch(/label:\s*'Cards'(?!\s*&)/)
  })
  it('no separate top-level "Sets" item (merged into "Cards & Sets")', () => {
    expect(navBlock).not.toMatch(/label:\s*'Sets'/)
  })
  it('no top-level "Market" item (deferred until a real target exists)', () => {
    // W40A pointed Market at /#market-movers before the anchor was
    // built. W40A-FIX removed it. W40B may reintroduce it once the
    // matching homepage anchor or a dedicated /market route lands.
    expect(navBlock).not.toMatch(/label:\s*'Market'/)
  })
})

describe('Navbar — no emoji-led primary labels', () => {
  it('does NOT contain "Ask me anything" (regression pin for the removed AI pill)', () => {
    // The yellow "✨ Ask me anything" pill was replaced by the
    // plain-text "Ask AI" top-level nav item. The exact old string
    // must not exist anywhere in the file, comments included.
    expect(NAVBAR_SRC).not.toContain('Ask me anything')
    expect(NAVBAR_SRC).not.toContain('✨')
  })

  it('does NOT put emoji glyphs on any top-level NAV label', () => {
    // The constraint from the W40 design brief targets primary UI
    // labels — nav items, buttons, CTAs. Search-dropdown result-row
    // icons and the search-input magnifier are functional interface
    // affordances outside that scope, so we scope this check to the
    // NAV block specifically.
    const navBlock = extractNavBlock()
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨']) {
      expect(navBlock, `emoji "${glyph}" leaked into a NAV label`).not.toContain(glyph)
    }
  })

  it('MOBILE_MORE_LINKS labels are text-only (no emoji glyphs)', () => {
    // The demoted items surface in the mobile drawer's "More" section.
    // They must also stay text-only.
    const start = NAVBAR_SRC.indexOf('const MOBILE_MORE_LINKS')
    const end   = NAVBAR_SRC.indexOf('\n]', start)
    const block = NAVBAR_SRC.slice(start, end + 2)
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨']) {
      expect(block).not.toContain(glyph)
    }
  })
})

describe('Navbar — Dashboard direct link for logged-in users', () => {
  it('renders a Dashboard link under the logged-in auth branch', () => {
    // Look for the exact link + surrounding className marker we added.
    expect(NAVBAR_SRC).toMatch(/className=["']dashboard-link["']/)
    expect(NAVBAR_SRC).toMatch(/href=["']\/dashboard["']/)
  })
})

describe('Navbar — mobile "More" section', () => {
  it('surfaces the demoted Community + Games items in MOBILE_MORE_LINKS', () => {
    for (const label of [
      'Content Creators',
      'Vendors & Dealers',
      'Upcoming Card Shows',
      'Submit a Listing',
      'Games',
    ]) {
      // These appear inside the MOBILE_MORE_LINKS array below the NAV.
      expect(NAVBAR_SRC).toContain(`label: '${label}'`)
    }
  })
})
