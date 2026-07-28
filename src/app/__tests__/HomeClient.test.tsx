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

// ═════════════════════════════════════════════════════════════════════════════
// Block 5A-W-47D — replaced upcoming-releases list + Pitch Black feature.
//
// Pitch Black shipped 2026-07-17, so it moved out of the "coming next"
// list into a dedicated compact feature under the hero's left-column
// auth-aware CTA row. The upcoming list now carries three real future
// releases with the exact dates, descriptions and CTA wording supplied
// as the editorial source of truth. Source-text pins are used here for
// the same reason the block above uses them — the runtime tree is
// heavy and none of these assertions are behavioural.
// ═════════════════════════════════════════════════════════════════════════════

const SETASSETS_SRC = readFileSync(
  join(__dirname, '..', '..', 'lib', 'setAssets.ts'),
  'utf8',
)

// Slice the upcomingReleases array literal so name/date checks cannot
// be satisfied by an unrelated mention elsewhere in the file (Chaos
// Rising still lives in the "Just Released" banner above, for
// example; Pitch Black still lives in the New Release feature block).
function upcomingArraySource(): string {
  const match = SRC.match(
    /const upcomingReleases:\s*UpcomingRelease\[\]\s*=\s*\[[\s\S]*?\n\]/,
  )
  if (!match) throw new Error('upcomingReleases array not found in HomeClient.tsx')
  return match[0]
}

describe('HomeClient — upcoming releases (Block 5A-W-47D)', () => {
  it('no longer surfaces Pitch Black as an upcoming release', () => {
    const arr = upcomingArraySource()
    expect(arr).not.toContain('Pitch Black')
    expect(arr).not.toMatch(/Mega Evolution\s*—\s*Pitch Black/)
    expect(arr).not.toContain('Journey Together 2')
  })

  it('lists First Partner Illustration Collection – Series 3 for 7 August 2026', () => {
    const arr = upcomingArraySource()
    expect(arr).toContain('First Partner Illustration Collection – Series 3')
    expect(arr).toContain('7 August 2026')
    expect(arr).toContain('starters from Hoenn, Kalos and Paldea')
  })

  it('lists the 30th Anniversary Set for 16 September 2026 with the Worldwide context', () => {
    const arr = upcomingArraySource()
    expect(arr).toContain('30th Anniversary Set')
    expect(arr).toContain('16 September 2026')
    expect(arr).toContain('Worldwide')
    expect(arr).toContain('30th Celebration Premium Deck Set')
    expect(arr).toContain('Ultra-Premium Collection')
  })

  it('lists Delta Reign for 6 November 2026', () => {
    const arr = upcomingArraySource()
    expect(arr).toContain('Delta Reign')
    expect(arr).toContain('6 November 2026')
    expect(arr).toContain('sixth Mega Evolution set')
    expect(arr).toContain('Mega Rayquaza ex')
  })

  it('carries the supplied CTA wording verbatim for each release', () => {
    const arr = upcomingArraySource()
    expect(arr).toContain('Shop Presale on TCGPlayer')
    expect(arr).toContain('Preview the 30th Anniversary Card List')
    expect(arr).toContain('Preview the Delta Reign Card List as it becomes available')
  })
})

describe('HomeClient — upcoming CTA destinations degrade safely', () => {
  it('does not link the two card-list CTAs to unbuilt preview routes', () => {
    expect(SRC).not.toMatch(/href=[^"]*\/preview\//)
    expect(SRC).not.toMatch(/href=[^"]*\/upcoming\//)
  })

  it('two of three upcoming release entries ship with ctaHref: null today', () => {
    // Block 5A-W-47D-FIX1 — the First Partner entry now carries a
    // real TCGPlayer product URL; the other two remain null while no
    // valid PokePrices preview route exists.
    const arr = upcomingArraySource()
    const nulls = arr.match(/ctaHref:\s*null/g) ?? []
    expect(nulls.length).toBe(2)
  })

  it('renders a disabled "Coming soon" fallback when ctaHref is null', () => {
    expect(SRC).toContain('Coming soon')
    expect(SRC).toMatch(/aria-disabled="true"/)
  })

  it('leaves the two preview CTAs safely disabled (no invented URLs)', () => {
    const arr = upcomingArraySource()

    // 30th Anniversary — ctaHref null
    const thirtieth = arr.match(
      /\{[^{}]*30th Anniversary Set[\s\S]*?ctaHref:\s*null[\s\S]*?\}/,
    )
    expect(thirtieth, 'expected 30th Anniversary Set entry to carry ctaHref: null').toBeTruthy()

    // Delta Reign — ctaHref null
    const delta = arr.match(
      /\{[^{}]*Delta Reign[\s\S]*?ctaHref:\s*null[\s\S]*?\}/,
    )
    expect(delta, 'expected Delta Reign entry to carry ctaHref: null').toBeTruthy()
  })
})

// ── Block 5A-W-47D-FIX1: First Partner presale CTA promoted to a real link ───

describe('HomeClient — First Partner presale CTA (Block 5A-W-47D-FIX1)', () => {
  const EXPECTED_URL = 'https://www.tcgplayer.com/product/695400/pokemon-first-partner-collection-2026-first-partner-illustration-collection-series-3'

  it('carries the exact clean TCGPlayer product URL in the entry', () => {
    const arr = upcomingArraySource()
    // First Partner block sits before "30th Anniversary" in the array;
    // isolate it so the URL assertion cannot be satisfied elsewhere.
    const firstPartner = arr.match(
      /\{[^{}]*First Partner Illustration Collection [–-] Series 3[\s\S]*?\}/,
    )
    expect(firstPartner, 'First Partner entry not found').toBeTruthy()
    expect(firstPartner![0]).toContain(`ctaHref: '${EXPECTED_URL}'`)
    // Regression: no null CTA on the First Partner entry any more.
    expect(firstPartner![0]).not.toMatch(/ctaHref:\s*null/)
  })

  it('preserves the exact CTA label wording', () => {
    const arr = upcomingArraySource()
    const firstPartner = arr.match(
      /\{[^{}]*First Partner Illustration Collection [–-] Series 3[\s\S]*?\}/,
    )
    expect(firstPartner![0]).toContain("ctaLabel: 'Shop Presale on TCGPlayer'")
  })

  it('renders it as a real outbound <a>, not a Next.js <Link>', () => {
    // The render branch keys off an absolute-URL check and emits a
    // plain <a> with the outbound href. Pin the URL and the presence
    // of a raw <a href={r.ctaHref}> element.
    expect(SRC).toContain(EXPECTED_URL)
    expect(SRC).toMatch(/<a\s[\s\S]*?href=\{r\.ctaHref\}/)
  })

  it('opens in a new tab with rel="noopener noreferrer"', () => {
    // These attributes must live on the same <a> element as the
    // outbound href — enforce it by pinning the render block ordering.
    const renderBlock = SRC.match(
      /<a[\s\S]*?href=\{r\.ctaHref\}[\s\S]*?<\/a>/,
    )
    expect(renderBlock, 'external CTA <a> render block not found').toBeTruthy()
    expect(renderBlock![0]).toContain('target="_blank"')
    expect(renderBlock![0]).toContain('rel="noopener noreferrer"')
  })

  it('adds NO tracking or search-engine query string to the URL', () => {
    const arr = upcomingArraySource()
    const firstPartner = arr.match(
      /\{[^{}]*First Partner Illustration Collection [–-] Series 3[\s\S]*?\}/,
    )
    const ctaLine = firstPartner![0].match(/ctaHref:\s*'([^']+)'/)
    expect(ctaLine, 'ctaHref value not parseable').toBeTruthy()
    const url = ctaLine![1]
    expect(url).toBe(EXPECTED_URL)
    // The URL string carries no query, fragment, or common tracking
    // parameters (srsltid, utm_*, ref, partner, camref, etc.).
    expect(url.includes('?')).toBe(false)
    expect(url.includes('#')).toBe(false)
    expect(url).not.toMatch(/srsltid/i)
    expect(url).not.toMatch(/utm_/i)
    expect(url).not.toMatch(/\bref=|\bpartner=|\bcamref=|\baffiliate=/i)
  })

  it('does not describe itself as an affiliate link (no disclosure needed)', () => {
    // This is a plain outbound link, not part of any affiliate
    // programme yet. If a real TCGPlayer affiliate integration lands,
    // both the disclosure wording and this test should be revisited
    // in the same PR.
    //
    // We check the display-facing fields (name, description,
    // ctaLabel) rather than the whole entry, because inline code
    // comments legitimately mention the word "affiliate" while
    // explaining why this link is NOT one.
    const arr = upcomingArraySource()
    const firstPartner = arr.match(
      /\{[^{}]*First Partner Illustration Collection [–-] Series 3[\s\S]*?\}/,
    )!
    const nameLine     = firstPartner[0].match(/name:\s*'[^']*'/)![0]
    const descLine     = firstPartner[0].match(/description:\s*'[^']*'/)![0]
    const ctaLabelLine = firstPartner[0].match(/ctaLabel:\s*'[^']*'/)![0]
    expect(nameLine    ).not.toMatch(/affiliate/i)
    expect(descLine    ).not.toMatch(/affiliate/i)
    expect(ctaLabelLine).not.toMatch(/affiliate/i)
  })

  it('displays the title with exactly one en dash and no accidental "Series – Series 3"', () => {
    const arr = upcomingArraySource()
    // Exact title string — one en dash between Collection and Series 3.
    expect(arr).toContain("name: 'First Partner Illustration Collection – Series 3'")
    // Regression guards for accidental duplication of "Series".
    expect(arr).not.toMatch(/Series\s*[–-]\s*Series 3/)
    expect(arr).not.toMatch(/Series 3\s*[–-]\s*Series 3/)
    // The title contains exactly one U+2013 en dash.
    const enDashes = ("First Partner Illustration Collection – Series 3".match(/–/g) ?? [])
    expect(enDashes.length).toBe(1)
    const displayed = arr.match(/name:\s*'([^']*First Partner[^']*)'/)![1]
    expect((displayed.match(/–/g) ?? []).length).toBe(1)
  })
})

describe('HomeClient — Pitch Black "New Release" feature (Block 5A-W-47D)', () => {
  it('renders a "New Release" eyebrow (restrained label, not a NEW! badge)', () => {
    expect(SRC).toContain('New Release')
    expect(SRC).not.toContain('NEW!')
  })

  it('mentions Pitch Black and its release date in UK format', () => {
    expect(SRC).toContain('Released 17 July 2026')
    expect(SRC).toMatch(/>Pitch Black<\/span>/)
  })

  it('links to the canonical Pitch Black set route (URL-encoded space)', () => {
    expect(SRC).toContain('/set/Pitch%20Black')
    expect(SRC).not.toMatch(/href="\/set\/pitch-black"/i)
    expect(SRC).not.toMatch(/href="\/set\/Pitch Black"/)
  })

  it('uses the local Pitch Black logo with meaningful alt text', () => {
    expect(SRC).toContain('/set-assets/logos/Pitch Black.webp')
    expect(SRC).toMatch(/alt="Pitch Black[^"]*"/)
    // Never point the "set logo" slot at a card image.
    expect(SRC).not.toMatch(/alt="Pitch Black[^"]*"[^>]*src=[^>]*pricecharting/i)
  })

  it('has surfacing text so the feature is not image-only for screen readers', () => {
    expect(SRC).toContain('View the set →')
  })

  it('exposes the Pitch Black route exactly once from the homepage (no duplicate feature)', () => {
    const matches = SRC.match(/\/set\/Pitch%20Black/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('sits inside the hero left column, ahead of the right column marker', () => {
    const featureIdx = SRC.indexOf('── PITCH BLACK NEW-RELEASE FEATURE ──')
    const leftIdx    = SRC.indexOf('── LEFT COLUMN')
    const rightIdx   = SRC.indexOf('── RIGHT COLUMN')
    expect(featureIdx).toBeGreaterThan(-1)
    expect(leftIdx).toBeGreaterThan(-1)
    expect(rightIdx).toBeGreaterThan(-1)
    expect(featureIdx).toBeGreaterThan(leftIdx)
    expect(featureIdx).toBeLessThan(rightIdx)
  })
})

describe('HomeClient — Block 5A-W-47D regression pins', () => {
  it('keeps Dashboard, Watchlist and Portfolio destinations unchanged', () => {
    expect(SRC).toContain('href="/dashboard"')
    expect(SRC).toContain('href="/dashboard/watchlist-alerts"')
    expect(SRC).toContain('href="/dashboard/portfolio"')
  })

  it('keeps the Chaos Rising "Just Released" banner intact', () => {
    expect(SRC).toContain('/set/Chaos%20Rising')
    expect(SRC).toContain('Just Released')
    expect(SRC).toContain('/set-assets/logos/Chaos Rising.webp')
  })
})

describe('setAssets — Pitch Black is now registered (Block 5A-W-47D)', () => {
  it('has a LOGO_MAP entry pointing to the local webp', () => {
    expect(SETASSETS_SRC).toMatch(/'Pitch Black':\s+'Pitch Black\.webp'/)
  })

  it('has a SYMBOL_MAP entry pointing to the local png', () => {
    expect(SETASSETS_SRC).toMatch(/'Pitch Black':\s+'Pitch Black\.png'/)
  })

  it('maps Pitch Black to the Mega Evolution era in ERA_MAP', () => {
    expect(SETASSETS_SRC).toMatch(/'Pitch Black':\s+'Mega Evolution'/)
  })
})
