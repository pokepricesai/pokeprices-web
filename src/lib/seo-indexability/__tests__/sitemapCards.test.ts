// Block 5A-W-35 — tests for the shared sitemap-cards helper.
//
// Uses a tiny in-memory fake supabase client that mimics the surface
// the helper actually calls: from().select().eq()/.not()/.in()/.or()
// /.order()/.range()/.limit(). No real DB access.

import { describe, it, expect } from 'vitest'
import {
  fetchIndexableCardBatch,
  renderCardSitemapXml,
  type CardBatchRow,
} from '../sitemapCards'

// ── Fake Supabase client ────────────────────────────────────────────

type Row = Record<string, unknown>
type Err = { message: string } | null

function makeFake(opts: {
  cards:        Row[]
  dailyPrices:  Row[]
  failCards?:   boolean
  failDaily?:   boolean
}) {
  const state = { ...opts }
  function fromCards() {
    let rangeStart = 0
    let rangeEnd   = 999
    const builder = {
      select: () => builder,
      not:    () => builder,
      order:  () => builder,
      range: (s: number, e: number) => { rangeStart = s; rangeEnd = e; return builder },
      // Await triggers this via the thenable pattern.
      then: (resolve: (v: { data: Row[] | null; error: Err }) => unknown) => {
        if (state.failCards) return resolve({ data: null, error: { message: 'fake cards error' } })
        const slice = state.cards.slice(rangeStart, rangeEnd + 1)
        return resolve({ data: slice, error: null })
      },
    }
    return builder
  }
  function fromDaily() {
    let inValues: string[] = []
    // Note: the helper uses .or() to combine price predicates; we
    // simulate the effect by filtering rows where AT LEAST ONE known
    // price field is > 0. That mirrors the real query semantics.
    const priceFields = ['raw_usd', 'psa9_usd', 'psa10_usd', 'psa8_usd', 'psa7_usd']
    function anyPricePositive(r: Row): boolean {
      for (const f of priceFields) {
        const v = r[f]
        if (typeof v === 'number' && v > 0) return true
      }
      return false
    }
    const builder = {
      select: () => builder,
      in: (_col: string, values: string[]) => { inValues = values; return builder },
      or:    () => builder,
      limit: () => builder,
      then: (resolve: (v: { data: Row[] | null; error: Err }) => unknown) => {
        if (state.failDaily) return resolve({ data: null, error: { message: 'fake daily error' } })
        const hits = state.dailyPrices.filter(r =>
          inValues.includes(String(r.card_slug ?? '')) && anyPricePositive(r),
        )
        return resolve({ data: hits, error: null })
      },
    }
    return builder
  }
  return {
    from(table: string) {
      if (table === 'cards')          return fromCards()
      if (table === 'daily_prices')   return fromDaily()
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

// ── fetchIndexableCardBatch ────────────────────────────────────────

describe('fetchIndexableCardBatch', () => {
  it('emits only cards with at least one positive price on any tier', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'a', card_url_slug: 'alpha-1',   set_name: 'Base Set' },
        { card_slug: 'b', card_url_slug: 'bravo-2',   set_name: 'Base Set' },
        { card_slug: 'c', card_url_slug: 'charlie-3', set_name: 'Base Set' },
      ],
      dailyPrices: [
        { card_slug: 'pc-a', raw_usd: 100 },     // has signal
        { card_slug: 'pc-b', raw_usd: 0, psa10_usd: 0 },  // no signal
        // 'c' has no daily_prices row at all
      ],
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.filteringSkipped).toBe(false)
    expect(result.totalScanned).toBe(3)
    expect(result.totalEmitted).toBe(1)
    expect(result.cards.map(c => c.card_url_slug)).toEqual(['alpha-1'])
  })

  it('respects psa10_usd, psa9_usd, and other tiers — any positive value counts', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'raw',   card_url_slug: 'raw',   set_name: 'S' },
        { card_slug: 'psa9',  card_url_slug: 'psa9',  set_name: 'S' },
        { card_slug: 'psa10', card_url_slug: 'psa10', set_name: 'S' },
        { card_slug: 'psa8',  card_url_slug: 'psa8',  set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-raw',   raw_usd:   50 },
        { card_slug: 'pc-psa9',  psa9_usd:  90 },
        { card_slug: 'pc-psa10', psa10_usd: 300 },
        { card_slug: 'pc-psa8',  psa8_usd:  40 },
      ],
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.totalEmitted).toBe(4)
  })

  it('excludes cards whose only prices are all zero', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'zero', card_url_slug: 'z', set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-zero', raw_usd: 0, psa10_usd: 0, psa9_usd: 0 },
      ],
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.totalEmitted).toBe(0)
  })

  it('fail-open when daily_prices query errors — emits unfiltered batch', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'a', card_url_slug: 'alpha', set_name: 'S' },
        { card_slug: 'b', card_url_slug: 'bravo', set_name: 'S' },
      ],
      dailyPrices: [],
      failDaily:   true,
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.filteringSkipped).toBe(true)
    expect(result.errorNote).toContain('daily_prices fetch failed')
    // Fail-open: every card with slug + set gets emitted.
    expect(result.totalEmitted).toBe(2)
  })

  it('empty batch when the cards query fails', async () => {
    const supa = makeFake({
      cards:       [],
      dailyPrices: [],
      failCards:   true,
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.cards).toEqual([])
    expect(result.filteringSkipped).toBe(true)
    expect(result.errorNote).toContain('cards fetch failed')
  })

  it('handles cards with null card_slug (cannot join → excluded)', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: null, card_url_slug: 'noslug', set_name: 'S' },
        { card_slug: 'x',  card_url_slug: 'x',      set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-x', raw_usd: 100 },
      ],
    })
    const result = await fetchIndexableCardBatch(supa as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.cards.map(c => c.card_url_slug)).toEqual(['x'])
  })
})

// ── renderCardSitemapXml ───────────────────────────────────────────

describe('renderCardSitemapXml', () => {
  const cards: CardBatchRow[] = [
    { card_url_slug: 'greninja-gold-star-swsh144', set_name: 'Celebrations' },
    { card_url_slug: 'umbreon-vmax-215',           set_name: 'Evolving Skies' },
  ]

  it('emits a well-formed <urlset> with encoded set names', () => {
    const xml = renderCardSitemapXml('https://www.pokeprices.io', cards)
    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('https://www.pokeprices.io/set/Celebrations/card/greninja-gold-star-swsh144')
    // "Evolving Skies" has a space — must be URL-encoded.
    expect(xml).toContain('https://www.pokeprices.io/set/Evolving%20Skies/card/umbreon-vmax-215')
    expect(xml).toContain('<changefreq>daily</changefreq>')
    expect(xml).toContain('<priority>0.75</priority>')
  })

  it('handles an empty card list without emitting URLs', () => {
    const xml = renderCardSitemapXml('https://www.pokeprices.io', [])
    expect(xml).not.toContain('<loc>')
    expect(xml).toContain('<urlset')
  })
})
