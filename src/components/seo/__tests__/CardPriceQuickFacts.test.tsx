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

  it('the panel is gated on W35 isCardIndexable(card) (W46D-FIX1: only on the ok branch)', () => {
    // W46D-FIX1 — the gate is now conditional on `card` being non-null
    // because the discriminated result may return an error branch.
    expect(CARD_SERVER).toContain('const indexable = card ? isCardIndexable(card) : false')
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
    // W46D-FIX1 — the slot is now null on BOTH the not-indexable
    // path AND the card-side error path (card === null).
    expect(CARD_SERVER).toMatch(/<CardPageClient[\s\S]*?quickFactsSlot=\{card && indexable \? \(/)
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
    // W46D-FIX1 — the same mapping now also short-circuits when
    // `card == null` (the card-side error branch), so the trend
    // fallback stays in lockstep with the card fallback.
    expect(CARD_SERVER).toMatch(/const initialTrendData[\s\S]*?card == null \? undefined[\s\S]*?trendResult\.ok\s*\?\s*trendResult\.data\s*:\s*undefined/)
  })

  it('W46C-FIX1 — non-indexable pages never call getTrend but still let the client fall back', () => {
    // Non-indexable path constructs { ok: true, data: null } inline so
    // initialTrendData becomes null → client also skips. This matches
    // the pre-FIX1 behaviour for non-indexable pages and does NOT
    // introduce a new RPC call on those pages.
    // W46D-FIX1 — the guard now also short-circuits on `card == null`
    // so the trend RPC is never called on the error branch.
    expect(CARD_SERVER).toMatch(/card && indexable\s*[\s\S]*?await getTrend/)
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

  // ── W46D — initialCardData bypasses the loading skeleton ──────────

  it('W46D — CardPageClient accepts initialCardData in its props', () => {
    expect(CARD_CLIENT).toContain('initialCardData')
    expect(CARD_CLIENT).toMatch(/initialCardData\?\:\s*unknown/)
  })

  it('W46D — CardPageClient card state initialises from initialCardData when supplied', () => {
    // The `serverProvidedCard` guard treats any non-null / non-undefined
    // value as "server supplied a card row", and useState(card) is
    // seeded from it.
    expect(CARD_CLIENT).toMatch(/const serverProvidedCard = initialCardData !== undefined && initialCardData !== null/)
    expect(CARD_CLIENT).toMatch(/useState<any>\(serverProvidedCard \? initialCardData : null\)/)
  })

  it('W46D — loading skeleton is bypassed when server supplied a card row', () => {
    // The loading flag starts FALSE when we already have the server
    // card, so the initial render goes straight to the hero + slot.
    expect(CARD_CLIENT).toMatch(/useState\(!serverProvidedCard\)/)
  })

  it('W46D — CardPageClient SKIPS the duplicate get_card_detail_by_url_slug call when server card was provided', () => {
    // The `if (serverProvidedCard) { cardData = initialCardData }` branch
    // is the marker: no supabase.rpc call for card-detail on this path.
    expect(CARD_CLIENT).toMatch(/if \(serverProvidedCard\)\s*\{[\s\S]*?cardData = initialCardData[\s\S]*?\}/)
    // The client-side get_card_detail_by_url_slug call is still allowed
    // as a fallback for the "no server card" branch — regression pin
    // that it exists and lives under an `else` after the fast path.
    expect(CARD_CLIENT).toMatch(/} else \{[\s\S]*?supabase\.rpc\(['"]get_card_detail_by_url_slug['"]/)
  })

  it('W46D — undefined initialCardData preserves the client fallback (no permanent empty page)', () => {
    // When `serverProvidedCard` is false, we still run the client fetch
    // + still fall through the `setCard(cardData)` + `setLoading(false)`
    // path. Regression-tested by grepping for both branches.
    expect(CARD_CLIENT).toMatch(/if \(!cardData\)\s*\{\s*setLoading\(false\);\s*return\s*\}/)
  })

  it('W46D — server page.tsx passes initialCardData into CardPageClient (nullish-coerced to undefined on the error branch)', () => {
    // W46D-FIX1 — on the ok branch we pass `card` (a real row); on the
    // error branch `card` is null and we coerce to `undefined` so the
    // client fallback fetch fires.
    expect(CARD_SERVER).toMatch(/<CardPageClient[\s\S]*?initialCardData=\{card \?\? undefined\}/)
  })

  it('W46D-FIX1 — server page.tsx invokes notFound() ONLY on the not-found branch, never on error', () => {
    // Discriminated result: notFound() is called iff status === 'not-found'.
    expect(CARD_SERVER).toMatch(/if \(result\.status === 'not-found'\) notFound\(\)/)
    // And critically: notFound must NOT be called on the error branch.
    // The old `if (!card) notFound()` was the exact bug — it 404-ed on
    // BOTH branches.
    expect(CARD_SERVER).not.toMatch(/if \(!card\) notFound\(\)/)
  })

  it('W46D — quickFactsSlot still lands AFTER the H1 hero and BEFORE the Price History Chart', () => {
    // Regression-guard the render order after the loading-skeleton
    // removal. Index comparison already established under FIX1.
    const slotIdx = CARD_CLIENT.indexOf('{quickFactsSlot}')
    const h1Idx   = CARD_CLIENT.indexOf('<h1 style')
    const chartIdx = CARD_CLIENT.indexOf('Price History Chart')
    expect(h1Idx).toBeLessThan(slotIdx)
    expect(slotIdx).toBeLessThan(chartIdx)
  })

  it('W46D — CardPageClient renders exactly ONE H1 for the card (single visible headline)', () => {
    // The client has TWO <h1 tags across the file — one for the
    // "Card not found" no-data branch, one for the loaded card hero.
    // Both are behind mutually-exclusive branches (early return vs
    // main render), so the visible DOM never contains both at once.
    // Test the source count = 2 exactly (regression guard against
    // a third H1 sneaking in during a future refactor).
    const h1Count = (CARD_CLIENT.match(/<h1\b/g) || []).length
    expect(h1Count).toBe(2)
  })

  it('W46D — the server page still renders exactly ONE Quick Facts slot', () => {
    // Regression-pin the single-source rule. The slot lives inside
    // CardPageClient via the prop; the server page renders it once.
    const slotOccurrences = (CARD_SERVER.match(/<CardPriceQuickFacts\b/g) || []).length
    expect(slotOccurrences).toBe(1)
  })

  // ── W46D-FIX1 — three-way outcome + safe metadata error branch ────

  it('W46D-FIX1 — getCard returns a DISCRIMINATED result: ok / not-found / error', () => {
    expect(CARD_SERVER).toContain('type GetCardResult')
    expect(CARD_SERVER).toMatch(/status:\s*['"]ok['"]/)
    expect(CARD_SERVER).toMatch(/status:\s*['"]not-found['"]/)
    expect(CARD_SERVER).toMatch(/status:\s*['"]error['"]/)
  })

  it('W46D-FIX1 — getCard maps RPC error AND caught exceptions to status:"error"', () => {
    // Both exit paths must land on the same failure marker so a
    // transient Supabase blip can never be converted to a 404.
    expect(CARD_SERVER).toMatch(/if \(error\) return \{ status: 'error' \}/)
    expect(CARD_SERVER).toMatch(/catch\s*\{\s*return \{ status: 'error' \}/)
  })

  it('W46D-FIX1 — getCard maps a null result (no matching row) to status:"not-found"', () => {
    expect(CARD_SERVER).toMatch(/if \(!data\) return \{ status: 'not-found' \}/)
  })

  it('W46D-FIX1 — getCard is wrapped in React.cache so metadata + page share ONE backend RPC', () => {
    // The React.cache() wrapper is what de-dupes the two callers
    // (generateMetadata + CardPage) into a single backend request per
    // request. This is a build-time guarantee, not a runtime one, so
    // the test pins the source shape.
    expect(CARD_SERVER).toContain("import { cache } from 'react'")
    expect(CARD_SERVER).toMatch(/const getCard = cache\(async/)
    // Both consumers must call the same getCard(); regression-guard
    // against a future refactor introducing a second uncached loader.
    const getCardCalls = (CARD_SERVER.match(/await getCard\(setName, cardSlug\)/g) || []).length
    // generateMetadata + CardPage = exactly 2 source-level invocations.
    expect(getCardCalls).toBe(2)
    // And no direct .rpc('get_card_detail_by_url_slug') call OUTSIDE
    // the cached loader.
    const directRpcCalls = (CARD_SERVER.match(/rpc\(['"]get_card_detail_by_url_slug['"]/g) || []).length
    expect(directRpcCalls).toBe(1)
  })

  it('W46D-FIX1 — generateMetadata returns SAFE fallback metadata on the error branch (no fake title)', () => {
    // The error branch must return an object literal with a
    // generic-but-honest title, a canonical, and robots noindex,follow.
    // It MUST NOT call notFound() and MUST NOT invent card-specific text.
    expect(CARD_SERVER).toMatch(/if \(result\.status === 'error'\) \{[\s\S]*?return \{[\s\S]*?robots:\s*\{ index: false, follow: true \}[\s\S]*?\}/)
    // The generic title must NOT resemble a real card title (no dollar
    // amounts, no "PSA 10", no card-name interpolation).
    const errorBranch = CARD_SERVER.match(/if \(result\.status === 'error'\) \{[\s\S]*?\}\n/)
    if (errorBranch) {
      const body = errorBranch[0]
      expect(body).not.toMatch(/\$\d/)
      expect(body).not.toMatch(/PSA 10/)
      expect(body).not.toContain('${name')
      expect(body).not.toContain('${card.')
    }
  })

  it('W46D-FIX1 — generateMetadata canonical for the error branch is derived from route params only', () => {
    // The canonical is built from `slug` + `cardSlug` (URL params),
    // NOT from card data, so a transient error does not leak a fake
    // canonical.
    expect(CARD_SERVER).toMatch(/if \(result\.status === 'error'\) \{[\s\S]*?const canonical = `https:\/\/www\.pokeprices\.io\/set\/\$\{slug\}\/card\/\$\{cardSlug\}`/)
  })

  it('W46D-FIX1 — page passes initialCardData undefined on the error branch, allowing client fallback', () => {
    // `card ?? undefined` is the coercion; the client fallback is
    // then gated on `!serverProvidedCard`.
    expect(CARD_SERVER).toMatch(/const card: CardRow \| null = result\.status === 'ok' \? result\.card : null/)
    expect(CARD_SERVER).toMatch(/<CardPageClient[\s\S]*?initialCardData=\{card \?\? undefined\}/)
  })

  it('W46D-FIX1 — page does NOT emit Quick Facts on the error branch (no fabricated content)', () => {
    // The slot is `card && indexable ? (…) : null` — both null on error.
    expect(CARD_SERVER).toMatch(/quickFactsSlot=\{card && indexable \? \(/)
    // And the breadcrumb only renders when we have a real card row —
    // an error-branch render must not fake a breadcrumb from route params.
    expect(CARD_SERVER).toMatch(/\{card && \(\s*<BreadcrumbSchema/)
  })

  it('W46D-FIX1 — CardPageClient fallback runs exactly one card RPC when initialCardData is undefined', () => {
    // The `else` branch of `if (serverProvidedCard) { … } else { … }`
    // is the ONE fallback call. No parallel duplicate.
    expect(CARD_CLIENT).toMatch(/if \(serverProvidedCard\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?supabase\.rpc\(['"]get_card_detail_by_url_slug['"]/)
    // The direct call to get_card_detail_by_url_slug appears exactly
    // once in CardPageClient (inside the else-branch fallback).
    const rpcCount = (CARD_CLIENT.match(/rpc\(['"]get_card_detail_by_url_slug['"]/g) || []).length
    expect(rpcCount).toBe(1)
  })

  it('W46D-FIX1 — CardPageClient fallback path exits loading state safely on a null client fetch', () => {
    // If the client fallback ALSO returns null (double failure), we
    // must still call setLoading(false) so the page settles rather
    // than spinning forever.
    expect(CARD_CLIENT).toMatch(/if \(!cardData\)\s*\{\s*setLoading\(false\);\s*return\s*\}/)
  })

  it('W46C-FIX1 — server page.tsx has exactly ONE <CardPriceQuickFacts (nested inside the slot prop)', () => {
    const matches = CARD_SERVER.match(/<CardPriceQuickFacts\b/g) || []
    expect(matches).toHaveLength(1)
  })

  it('W46C-FIX1 — the trend RPC is server-fetched via getTrend only when the card is indexable', () => {
    // W46D-FIX1 — the guard now also short-circuits when card is null.
    expect(CARD_SERVER).toMatch(/const trendResult:\s*TrendResult\s*=\s*card && indexable[\s\S]*?await getTrend/)
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
