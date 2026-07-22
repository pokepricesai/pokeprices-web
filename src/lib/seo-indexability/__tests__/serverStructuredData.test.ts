// Block 5A-W-46B (with W46B-FIX1) — pin the server-side emission of
// structured data.
//
// BUG THIS FIXES
//   CardPageClient + SetPageClient are `'use client'` components that
//   fetch their data via useEffect. Both used to import
//   CardStructuredData / SetStructuredData / BreadcrumbSchema and emit
//   them from the client render. Result: the initial server-rendered
//   HTML shipped with `card = null` and `cards = []`, so the JSON-LD
//   graphs were either absent (component returns null for a nullish
//   input) or referenced empty fields. Google + Bing crawl the initial
//   HTML — they don't wait for React hydration — so no BreadcrumbList
//   rich results were ever produced from those pages.
//
// SCOPE OF THE FIX (as amended by W46B-FIX1)
//   * BreadcrumbSchema is server-emitted on card + set pages.
//   * CardStructuredData is NOT server-emitted — its Dataset graph
//     would materially expand Dataset markup coverage from ~0 to
//     ~29k card pages, and a single card price snapshot has not
//     been established as a genuine Dataset under our intended schema
//     model. That decision is deferred to a dedicated structured-data
//     review block.
//   * The client component (…Client.tsx) does NOT re-emit any of the
//     schema helpers (would produce a duplicate BreadcrumbList and
//     invalidate the rich result).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const CARD_SERVER = read('src/app/set/[slug]/card/[cardSlug]/page.tsx')
const CARD_CLIENT = read('src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx')
const SET_SERVER  = read('src/app/set/[slug]/page.tsx')
const SET_CLIENT  = read('src/app/set/[slug]/SetPageClient.tsx')
const POKE_SERVER = read('src/app/pokemon/[slug]/page.tsx')
const INSIGHTS_SERVER = read('src/app/insights/[slug]/page.tsx')

// ── Card page — server-emits BreadcrumbList only (W46B-FIX1) ────────

describe('Card page — server-emitted BreadcrumbList (W46B + W46B-FIX1)', () => {
  it('page.tsx imports BreadcrumbSchema (server-emit path)', () => {
    expect(CARD_SERVER).toContain("import BreadcrumbSchema from '@/components/BreadcrumbSchema'")
  })

  it('page.tsx renders <BreadcrumbSchema /> with Home → Sets → Set → Card hierarchy', () => {
    // BreadcrumbSchema prepends the Home level itself; the caller
    // supplies Sets → set_name → card_name in that order.
    expect(CARD_SERVER).toMatch(/<BreadcrumbSchema[\s\S]*?name: 'Sets'[\s\S]*?card\.set_name[\s\S]*?card\.card_name/)
  })

  it('W46B-FIX1 — page.tsx does NOT import CardStructuredData', () => {
    // Card Dataset markup is deferred to a dedicated structured-data
    // review block. Server-rendering it here would push Dataset onto
    // ~29k card pages in one deploy.
    expect(CARD_SERVER).not.toContain("from '@/components/CardStructuredData'")
  })

  it('W46B-FIX1 — page.tsx does NOT render <CardStructuredData /> anywhere', () => {
    expect(CARD_SERVER).not.toMatch(/<CardStructuredData\b/)
  })

  it('W46B-FIX1 — no new Dataset markup path is introduced by page.tsx', () => {
    // Regression guard: page.tsx must not directly emit Dataset markup
    // (e.g. by inlining a JSON-LD script tag) as a shortcut for
    // CardStructuredData.
    expect(CARD_SERVER).not.toMatch(/@type["']?\s*:\s*["']Dataset["']/)
    expect(CARD_SERVER).not.toContain('application/ld+json')
  })

  it('W46B-FIX1 — no Product / Offer / AggregateOffer / MerchantListing markup is introduced', () => {
    // PokePrices is not the merchant. These schemas must NEVER be
    // server-emitted on card pages; the CardStructuredData helper
    // deliberately avoids Product/Offer to prevent false "In Stock"
    // snippets. This test locks that in at the server-page layer too.
    for (const banned of ['Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(CARD_SERVER).not.toMatch(new RegExp(`["']${banned}["']`))
    }
  })

  it('CardPageClient no longer imports CardStructuredData or BreadcrumbSchema', () => {
    // Regression guard: the client component must NOT re-emit these,
    // otherwise the page ships two BreadcrumbList JSON-LD blocks and
    // Google's rich-result parser refuses both.
    expect(CARD_CLIENT).not.toContain("from '@/components/CardStructuredData'")
    expect(CARD_CLIENT).not.toContain("from '@/components/BreadcrumbSchema'")
  })

  it('CardPageClient no longer renders <CardStructuredData /> or <BreadcrumbSchema />', () => {
    expect(CARD_CLIENT).not.toMatch(/<CardStructuredData\b/)
    expect(CARD_CLIENT).not.toMatch(/<BreadcrumbSchema\b/)
  })

  it('card page has exactly one BreadcrumbList source across server + client', () => {
    // Count opening tags. There should be one on the server side and
    // none on the client side after W46B-FIX1.
    const serverMatches = CARD_SERVER.match(/<BreadcrumbSchema\b/g) || []
    const clientMatches = CARD_CLIENT.match(/<BreadcrumbSchema\b/g) || []
    expect(serverMatches).toHaveLength(1)
    expect(clientMatches).toHaveLength(0)
  })
})

// ── Set page — server-emits BreadcrumbSchema only ───────────────────

describe('Set page — server-emitted BreadcrumbList (W46B)', () => {
  it('page.tsx imports BreadcrumbSchema', () => {
    expect(SET_SERVER).toContain("import BreadcrumbSchema from '@/components/BreadcrumbSchema'")
  })

  it('page.tsx renders <BreadcrumbSchema /> with Home → Sets → Set hierarchy', () => {
    expect(SET_SERVER).toMatch(/<BreadcrumbSchema[\s\S]*?name: 'Sets'[\s\S]*?name: setName/)
  })

  it('SetPageClient no longer imports BreadcrumbSchema (avoids duplicate BreadcrumbList)', () => {
    expect(SET_CLIENT).not.toContain("from '@/components/BreadcrumbSchema'")
  })

  it('SetPageClient no longer renders <BreadcrumbSchema />', () => {
    expect(SET_CLIENT).not.toMatch(/<BreadcrumbSchema\b/)
  })

  it('set page has exactly one BreadcrumbList source across server + client', () => {
    const serverMatches = SET_SERVER.match(/<BreadcrumbSchema\b/g) || []
    const clientMatches = SET_CLIENT.match(/<BreadcrumbSchema\b/g) || []
    expect(serverMatches).toHaveLength(1)
    expect(clientMatches).toHaveLength(0)
  })

  it('W46B-FIX1 — the set page does NOT introduce Product / Offer / AggregateOffer / MerchantListing markup', () => {
    for (const banned of ['Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(SET_SERVER).not.toMatch(new RegExp(`["']${banned}["']`))
    }
  })
})

// ── Pokémon page — already server-emitted (regression pin) ──────────

describe('Pokémon page — schema stays server-emitted (unchanged by W46B-FIX1)', () => {
  it('page.tsx renders <PokemonStructuredData /> and <BreadcrumbSchema />', () => {
    // These were already fine pre-W46B. Pin the behaviour so a future
    // refactor doesn't accidentally move them into a client child.
    expect(POKE_SERVER).toMatch(/<PokemonStructuredData\b/)
    expect(POKE_SERVER).toMatch(/<BreadcrumbSchema\b/)
  })

  it('Pokémon breadcrumb uses Home → Pokémon → Species hierarchy', () => {
    // The Home level is prepended by BreadcrumbSchema itself.
    expect(POKE_SERVER).toMatch(/<BreadcrumbSchema[\s\S]*?name: 'Pokémon'[\s\S]*?name: displayName/)
  })

  it('W46B-FIX1 — no Product / Offer / AggregateOffer / MerchantListing markup was added', () => {
    for (const banned of ['Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(POKE_SERVER).not.toMatch(new RegExp(`["']${banned}["']`))
    }
  })
})

// ── Insights article — article passed as prop, initial HTML is fine ─

describe('Insights article — schema arrives via server-passed prop (unchanged by W46B-FIX1)', () => {
  it('page.tsx passes the article to InsightsArticleClient as a prop (not fetched again in the client)', () => {
    expect(INSIGHTS_SERVER).toMatch(/<InsightsArticleClient article=\{article\}\s*\/>/)
  })

  it('W46B-FIX1 — no Product / Offer / AggregateOffer / MerchantListing markup was added to the insights server route', () => {
    for (const banned of ['Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'MerchantListing']) {
      expect(INSIGHTS_SERVER).not.toMatch(new RegExp(`["']${banned}["']`))
    }
  })
})
