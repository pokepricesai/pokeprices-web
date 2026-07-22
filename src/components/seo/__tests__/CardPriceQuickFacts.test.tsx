// Block 5A-W-46C — source-invariant tests for CardPriceQuickFacts
// (server component). The rendered output is exercised via source
// grep + the underlying pure builder tests (see quickFacts.test.ts)
// — mounting a server component in vitest would require a JSDOM
// setup we don't currently maintain, and the pure builder already
// covers every derivation path.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'CardPriceQuickFacts.tsx'), 'utf8')
const CARD_SERVER = readFileSync(
  join(__dirname, '..', '..', '..', 'app', 'set', '[slug]', 'card', '[cardSlug]', 'page.tsx'), 'utf8',
)
const CARD_CLIENT = readFileSync(
  join(__dirname, '..', '..', '..', 'app', 'set', '[slug]', 'card', '[cardSlug]', 'CardPageClient.tsx'), 'utf8',
)

describe('CardPriceQuickFacts — component invariants', () => {
  it('is a SERVER component (no "use client" directive)', () => {
    expect(SRC.startsWith("'use client'")).toBe(false)
    expect(SRC).not.toMatch(/^\s*['"]use client['"]/)
  })

  it('never invokes useState / useEffect / useMemo (server component invariant)', () => {
    // Server components must not use React state hooks; the render
    // is pure. Match the invocation `hook(` rather than the bare word
    // so a code comment mentioning the hook name doesn't trip.
    expect(SRC).not.toMatch(/\buseState\s*\(/)
    expect(SRC).not.toMatch(/\buseEffect\s*\(/)
    expect(SRC).not.toMatch(/\buseMemo\s*\(/)
  })

  it('uses the pure buildCardQuickFacts + hasEnoughFacts helpers', () => {
    expect(SRC).toContain("import {")
    expect(SRC).toContain('buildCardQuickFacts')
    expect(SRC).toContain('hasEnoughFacts')
    expect(SRC).toContain("from '@/lib/seo/quickFacts'")
  })

  it('returns null when the builder reports insufficient data', () => {
    expect(SRC).toMatch(/if \(!hasEnoughFacts\(out\)\) return null/)
  })

  it('renders a semantic h2 with the "Quick price facts" heading', () => {
    expect(SRC).toContain('Quick price facts')
    expect(SRC).toMatch(/<h2[^>]*>/)
  })

  it('emits a dl for the facts list (screen readers get label/value pairs)', () => {
    expect(SRC).toContain('<dl')
    expect(SRC).toContain('<dt')
    expect(SRC).toContain('<dd')
  })

  it('never emits Dataset / Product / Offer / AggregateOffer / MerchantListing schema', () => {
    for (const banned of ['Dataset', 'Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(SRC).not.toMatch(new RegExp(`["']${banned}["']`))
    }
    // Also guard against a raw JSON-LD script tag being inlined.
    expect(SRC).not.toContain('application/ld+json')
  })

  it('never emits investment / grading advice keywords', () => {
    const banned = [
      'you should grade',
      'buy now',
      'great investment',
      'guaranteed profit',
      'guaranteed value',
      'undervalued',
      'could explode',
      'will explode',
    ]
    for (const b of banned) expect(SRC.toLowerCase()).not.toContain(b)
  })

  it('does not guess a Pokémon species link — pokemonHref is passed by the caller', () => {
    // The component surface exposes `pokemonHref` + `pokemonName` and
    // only renders the "View all X card prices" link when BOTH are
    // truthy. The card page currently passes null for both, i.e. we
    // do not guess a species slug from a partial card name.
    expect(SRC).toContain('pokemonHref')
    expect(SRC).toContain('pokemonName')
    expect(SRC).toMatch(/pokemonHref && pokemonName/)
  })

  it('View-all-set link is descriptive (not "click here")', () => {
    expect(SRC).toContain('View all cards from')
  })
})

describe('CardPriceQuickFacts — wiring into the card server page', () => {
  it('card page.tsx imports the component and renders it in the JSX tree', () => {
    expect(CARD_SERVER).toContain("import CardPriceQuickFacts from '@/components/seo/CardPriceQuickFacts'")
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts\b/)
  })

  it('the panel is gated on W35 isCardIndexable(card)', () => {
    expect(CARD_SERVER).toContain('const indexable = isCardIndexable(card)')
  })

  it('the panel receives card + trend + setHref props, with null Pokémon link (no guess)', () => {
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?card=\{card\}/)
    // W46C-FIX1 — trend is now unwrapped into `trendForPanel` so the
    // panel never sees a `{ ok: false }` discriminated-result object.
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?trend=\{trendForPanel\}/)
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?setHref=\{setHref\}/)
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?pokemonHref=\{null\}/)
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?pokemonName=\{null\}/)
  })

  it('trend loader uses the EXISTING get_card_trends_detail RPC (no new RPC added)', () => {
    expect(CARD_SERVER).toContain('get_card_trends_detail')
  })

  it('CardPageClient (client) still does not import the new quick-facts component (avoid double render)', () => {
    expect(CARD_CLIENT).not.toContain("from '@/components/seo/CardPriceQuickFacts'")
    expect(CARD_CLIENT).not.toMatch(/<CardPriceQuickFacts\b/)
  })

  // ── W46C-FIX1 — server slot + no duplicate trend fetch ────────────

  it('W46C-FIX1 — CardPageClient accepts initialTrendData + quickFactsSlot props', () => {
    expect(CARD_CLIENT).toContain('initialTrendData')
    expect(CARD_CLIENT).toContain('quickFactsSlot')
    expect(CARD_CLIENT).toMatch(/quickFactsSlot\?:\s*React\.ReactNode/)
  })

  it('W46C-FIX1 — CardPageClient initialises trend state from initialTrendData', () => {
    expect(CARD_CLIENT).toMatch(/useState<any>\(initialTrendData \?\? null\)/)
  })

  it('W46C-FIX1 — CardPageClient SKIPS the client trend RPC when initialTrendData is supplied', () => {
    // The `Promise.resolve({ data: null })` fast-path is the marker.
    expect(CARD_CLIENT).toMatch(/initialTrendData !== undefined[\s\S]*?Promise\.resolve\(\{ data: null \}\)/)
  })

  it('W46C-FIX1 — quickFactsSlot renders AFTER the H1 hero block and BEFORE the Price History Chart', () => {
    const slotIdx = CARD_CLIENT.indexOf('{quickFactsSlot}')
    const h1Idx   = CARD_CLIENT.indexOf('<h1 style')
    const chartIdx = CARD_CLIENT.indexOf('Price History Chart')
    expect(slotIdx).toBeGreaterThan(-1)
    expect(h1Idx).toBeGreaterThan(-1)
    expect(chartIdx).toBeGreaterThan(-1)
    expect(h1Idx).toBeLessThan(slotIdx)
    expect(slotIdx).toBeLessThan(chartIdx)
  })

  it('W46C-FIX1 — server page.tsx passes the slot + initialTrendData into CardPageClient (gated on indexable)', () => {
    expect(CARD_SERVER).toMatch(/<CardPageClient[\s\S]*?initialTrendData=\{initialTrendData\}/)
    expect(CARD_SERVER).toMatch(/<CardPageClient[\s\S]*?quickFactsSlot=\{indexable \? \(/)
  })

  // ── W46C-FIX1 pre-commit — trend server-error fallback ────────────

  it('W46C-FIX1 — getTrend returns a discriminated result so callers can tell success from failure', () => {
    // Success shape: { ok: true, data: <row-or-null> }
    // Failure shape: { ok: false }
    expect(CARD_SERVER).toContain('type TrendResult')
    expect(CARD_SERVER).toMatch(/\{ ok: true;\s*data: TrendRow \| null \}/)
    expect(CARD_SERVER).toMatch(/\{ ok: false \}/)
  })

  it('W46C-FIX1 — getTrend returns { ok: false } on RPC error path AND on catch path', () => {
    // Both exit paths must land on the same failure marker.
    expect(CARD_SERVER).toMatch(/if \(error\) return \{ ok: false \}/)
    expect(CARD_SERVER).toMatch(/catch\s*\{\s*return \{ ok: false \}/)
  })

  it('W46C-FIX1 — server page maps success → data, failure → undefined for initialTrendData', () => {
    // On success (including a legitimate null row) the client SKIPS
    // its RPC. On failure (undefined) the client falls back to one
    // client call.
    expect(CARD_SERVER).toMatch(/const initialTrendData[\s\S]*?trendResult\.ok\s*\?\s*trendResult\.data\s*:\s*undefined/)
  })

  it('W46C-FIX1 — non-indexable pages never call getTrend but still let the client fall back', () => {
    // Non-indexable path constructs { ok: true, data: null } inline so
    // initialTrendData becomes null → client also skips. This matches
    // the pre-FIX1 behaviour for non-indexable pages and does NOT
    // introduce a new RPC call on those pages.
    expect(CARD_SERVER).toMatch(/indexable\s*\?\s*await getTrend/)
    expect(CARD_SERVER).toMatch(/:\s*\{ ok: true, data: null \}/)
  })

  it('W46C-FIX1 — quick-facts panel receives the unwrapped trend row, never the discriminated wrapper', () => {
    // `trendForPanel` narrows to `TrendRow | null` before the panel
    // sees it, so buildCardQuickFacts never encounters `{ ok: false }`.
    expect(CARD_SERVER).toMatch(/const trendForPanel: TrendRow \| null/)
    expect(CARD_SERVER).toMatch(/<CardPriceQuickFacts[\s\S]*?trend=\{trendForPanel\}/)
  })

  it('W46C-FIX1 — CardPageClient allows a fallback trend RPC when initialTrendData is undefined', () => {
    // The single-source condition in CardPageClient: `initialTrendData
    // !== undefined` triggers the fast-path skip. Everything else
    // (including undefined from a server error) falls through to the
    // real RPC call. This is the ONE-fallback-call guarantee.
    expect(CARD_CLIENT).toMatch(/initialTrendData !== undefined/)
    expect(CARD_CLIENT).toMatch(/supabase\.rpc\(['"]get_card_trends_detail['"]/)
  })

  it('W46C-FIX1 — server page.tsx has exactly ONE <CardPriceQuickFacts (nested inside the slot prop)', () => {
    const matches = CARD_SERVER.match(/<CardPriceQuickFacts\b/g) || []
    expect(matches).toHaveLength(1)
  })

  it('W46C-FIX1 — the trend RPC is server-fetched via getTrend only when the card is indexable', () => {
    expect(CARD_SERVER).toMatch(/const trendResult:\s*TrendResult\s*=\s*indexable[\s\S]*?await getTrend/)
  })

  it('card page.tsx does NOT introduce Dataset / Product / Offer / AggregateOffer / MerchantListing schema', () => {
    for (const banned of ['Dataset', 'Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(CARD_SERVER).not.toMatch(new RegExp(`["']${banned}["']`))
    }
    expect(CARD_SERVER).not.toContain('application/ld+json')
  })

  it('canonical + robots emission remains from generateMetadata (structure preserved)', () => {
    // Regression pin: FIX1's canonical + noindex-thin behaviour must
    // survive the W46C additions.
    expect(CARD_SERVER).toContain('alternates: { canonical }')
    expect(CARD_SERVER).toContain('robots: indexable ? undefined')
  })
})
