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

describe('Navbar — Block 5A-W-47B top-level nav with Community restored', () => {
  const navBlock = extractNavBlock()

  it('lists the 6 required top-level items in priority order (W47B — Community restored between Insights and Ask AI)', () => {
    // W40A-FIX pruned to 5 items. W47B restores the Community
    // dropdown between Insights and Ask AI — the same slot it held
    // pre-W40A. Total is 6 top-level items.
    const required = ['Cards & Sets', 'Pokémon', 'Tools', 'Insights', 'Community', 'Ask AI']
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

  it('W47B — Community is a dropdown group (has an items array, no direct href on the group header)', () => {
    // Locate the Community entry and confirm it opens a dropdown
    // rather than being a direct link. The group header itself must
    // not carry a href; the four child items are the destinations.
    const communityStart = navBlock.indexOf("label: 'Community'")
    expect(communityStart, 'Community entry present').toBeGreaterThan(-1)
    // The section from `label: 'Community'` to the opening `items: [`
    // must NOT contain a `href:` — that would put a direct link on
    // the group header. Item hrefs come AFTER the `items: [` token
    // and are validated by the next test.
    const itemsOpen = navBlock.indexOf('items:', communityStart)
    expect(itemsOpen, 'items: array present on the Community group').toBeGreaterThan(-1)
    const headerSlice = navBlock.slice(communityStart, itemsOpen)
    expect(headerSlice).not.toMatch(/href:/)
  })

  it('W47B — Community dropdown contains the 4 restored items in the exact pre-W40A order', () => {
    const required = [
      ["Content Creators",    "/creators"],
      ["Vendors & Dealers",   "/vendors"],
      ["Upcoming Card Shows", "/card-shows"],
      ["Submit a Listing",    "/creators/submit"],
    ] as const
    const communityStart = navBlock.indexOf("label: 'Community'")
    const communityEnd   = navBlock.indexOf(']', communityStart)
    const communitySlice = navBlock.slice(communityStart, communityEnd)
    let cursor = 0
    for (const [label, href] of required) {
      const idx = communitySlice.indexOf(`label: '${label}',`, cursor)
      expect(idx, `expected Community item "${label}" at/after position ${cursor}`).toBeGreaterThan(-1)
      // The href must appear on the same line entry.
      const line = communitySlice.slice(idx, idx + 200)
      expect(line).toContain(`href: '${href}'`)
      cursor = idx + label.length
    }
  })

  it('W47B — Community label appears exactly once in the NAV block (no duplicate button)', () => {
    const matches = navBlock.match(/label:\s*'Community'/g) || []
    expect(matches.length).toBe(1)
  })
})

describe('Navbar — removed top-level items (pre-existing regressions)', () => {
  const navBlock = extractNavBlock()

  it('no top-level "Prices" group', () => {
    expect(navBlock).not.toMatch(/label:\s*'Prices'/)
  })
  it('no top-level "Games" link', () => {
    // Games remains in the mobile "More" section only.
    expect(navBlock).not.toMatch(/label:\s*'Games'/)
  })
  it('no separate top-level "Cards" item (merged into "Cards & Sets")', () => {
    expect(navBlock).not.toMatch(/label:\s*'Cards'(?!\s*&)/)
  })
  it('no separate top-level "Sets" item (merged into "Cards & Sets")', () => {
    expect(navBlock).not.toMatch(/label:\s*'Sets'/)
  })
  it('no top-level "Market" item (deferred)', () => {
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

describe('Navbar — mobile "More" section (W47B)', () => {
  // Isolate the MOBILE_MORE_LINKS block so the assertions here don't
  // accidentally match text inside the top-level NAV block.
  const start = NAVBAR_SRC.indexOf('const MOBILE_MORE_LINKS')
  const end   = NAVBAR_SRC.indexOf('\n]', start)
  const moreBlock = NAVBAR_SRC.slice(start, end + 2)

  it('Games is still surfaced in MOBILE_MORE_LINKS', () => {
    expect(moreBlock).toContain(`label: 'Games'`)
    expect(moreBlock).toMatch(/href:\s*'\/games'/)
  })
  it('W47B — Community items are NO LONGER in MOBILE_MORE_LINKS (they returned to top-level)', () => {
    for (const label of ['Content Creators', 'Vendors & Dealers', 'Upcoming Card Shows', 'Submit a Listing']) {
      expect(moreBlock).not.toContain(`label: '${label}'`)
    }
  })
})

describe('Navbar — Community routes (W47B)', () => {
  // Confirm the source file references each restored destination
  // exactly once (inside the Community group above).
  it('references /creators, /vendors, /card-shows, /creators/submit', () => {
    for (const href of ['/creators', '/vendors', '/card-shows', '/creators/submit']) {
      expect(NAVBAR_SRC).toContain(`href: '${href}'`)
    }
  })
  it('no unsafe / private / admin route leaked into the Community group', () => {
    const navBlock = extractNavBlock()
    const communityStart = navBlock.indexOf("label: 'Community'")
    const communityEnd   = navBlock.indexOf(']', communityStart)
    const slice = navBlock.slice(communityStart, communityEnd)
    for (const bad of ['/admin', '/api', '/dashboard', '/intel', '/scan-test']) {
      expect(slice).not.toContain(`href: '${bad}`)
    }
    // No external / protocol-relative / unsafe protocols either.
    expect(slice).not.toMatch(/href:\s*'https?:/)
    expect(slice).not.toMatch(/href:\s*'\/\//)
    expect(slice).not.toMatch(/href:\s*'javascript:/)
    expect(slice).not.toMatch(/\?/)  // no query strings
  })
})
