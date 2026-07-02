// Block 5A-W-35 — tests for the shared sitemap-cards helper.
//
// Uses a tiny in-memory fake supabase client that mimics the surface
// the helper actually calls: from().select().eq()/.not()/.in()/.or()
// /.order()/.range()/.limit().  No real DB access.
//
// Block 5A-W-35B additions:
//   * the fake now records the `.gte('date', X)` bound and the
//     `.limit()` value the helper passes to daily_prices;
//   * a `serverRowCap` option simulates PostgREST's max-rows cap so
//     we can pin the regression that broke the live sitemap.

import { describe, it, expect } from 'vitest'
import {
  RECENT_PRICE_WINDOW_DAYS,
  fetchIndexableCardBatch,
  recentPriceLowerBound,
  renderCardSitemapXml,
  type CardBatchRow,
} from '../sitemapCards'

// ── Fake Supabase client ────────────────────────────────────────────

type Row = Record<string, unknown>
type Err = { message: string } | null

type FakeSpy = {
  /** Every daily_prices .gte('date', X) bound the helper sent. */
  gteBounds:  string[]
  /** Every .limit(N) value the helper sent to daily_prices. */
  limits:     number[]
  /** Every chunk length passed to .in(). */
  chunkSizes: number[]
}

function makeFake(opts: {
  cards:        Row[]
  dailyPrices:  Row[]
  failCards?:   boolean
  failDaily?:   boolean
  /** Simulate PostgREST max-rows: if set, each daily_prices response
   *  is truncated to the first `serverRowCap` matching rows regardless
   *  of the client-side .limit() value. */
  serverRowCap?: number
}) {
  const state = { ...opts }
  const spy: FakeSpy = { gteBounds: [], limits: [], chunkSizes: [] }
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
    let gteDate: string | null = null
    let clientLimit: number | null = null
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
      in: (_col: string, values: string[]) => {
        inValues = values
        spy.chunkSizes.push(values.length)
        return builder
      },
      gte: (_col: string, val: string) => {
        gteDate = val
        spy.gteBounds.push(val)
        return builder
      },
      or:    () => builder,
      limit: (n: number) => {
        clientLimit = n
        spy.limits.push(n)
        return builder
      },
      then: (resolve: (v: { data: Row[] | null; error: Err }) => unknown) => {
        if (state.failDaily) return resolve({ data: null, error: { message: 'fake daily error' } })
        let hits = state.dailyPrices.filter(r =>
          inValues.includes(String(r.card_slug ?? '')) && anyPricePositive(r),
        )
        if (gteDate !== null) {
          hits = hits.filter(r => {
            const d = typeof r.date === 'string' ? r.date : null
            if (d === null) return true  // rows without a date are treated as recent by the fake
            return d >= gteDate!
          })
        }
        // Server-side cap kicks in BEFORE client-side .limit() when
        // simulating the W35 production regression.
        if (typeof state.serverRowCap === 'number' && hits.length > state.serverRowCap) {
          hits = hits.slice(0, state.serverRowCap)
        }
        if (clientLimit !== null && hits.length > clientLimit) {
          hits = hits.slice(0, clientLimit)
        }
        return resolve({ data: hits, error: null })
      },
    }
    return builder
  }
  return {
    fake: {
      from(table: string) {
        if (table === 'cards')          return fromCards()
        if (table === 'daily_prices')   return fromDaily()
        throw new Error(`unexpected table: ${table}`)
      },
    },
    spy,
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
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
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.cards.map(c => c.card_url_slug)).toEqual(['x'])
  })
})

// ── Block 5A-W-35B — date-bound + row-cap safety ───────────────────
//
// These tests pin the fix for the live regression that shrank the
// card sitemap from ~41k URLs to 655. The daily_prices query must
// (a) always send a `.gte('date', X)` bound, (b) use small chunk
// sizes so a PostgREST max-rows cap can't hide unique card_slugs
// behind long price histories, and (c) still fail-open when the
// daily_prices query itself errors.

describe('W35B — daily_prices date bound + chunk-size + cap safety', () => {
  function daysAgoIso(n: number): string {
    return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10)
  }

  it('recentPriceLowerBound returns yyyy-mm-dd for now − 7 days', () => {
    const bound = recentPriceLowerBound()
    expect(bound).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The value should be the same or very close to what we compute here.
    const expected = daysAgoIso(RECENT_PRICE_WINDOW_DAYS)
    expect(bound).toBe(expected)
  })

  it('window constant is 7 days', () => {
    // Regression pin so a future change is a conscious call, not an accident.
    expect(RECENT_PRICE_WINDOW_DAYS).toBe(7)
  })

  it('always passes a .gte("date", …) bound to daily_prices', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'a', card_url_slug: 'a', set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-a', raw_usd: 100, date: daysAgoIso(1) },
      ],
    })
    await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(supa.spy.gteBounds.length).toBeGreaterThan(0)
    // All chunks share the same bound in a single call.
    for (const b of supa.spy.gteBounds) expect(b).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Set(supa.spy.gteBounds).size).toBe(1)
  })

  it('chunk size stays under 200 (safely under the PostgREST default cap × recent days)', async () => {
    // Build 500 fake priced cards so at least 3+ chunks are exercised.
    const cards: Row[] = []
    const daily: Row[] = []
    for (let i = 0; i < 500; i++) {
      cards.push({ card_slug: `k${i}`, card_url_slug: `slug-${i}`, set_name: 'S' })
      daily.push({ card_slug: `pc-k${i}`, raw_usd: 10, date: daysAgoIso(1) })
    }
    const supa = makeFake({ cards, dailyPrices: daily })
    await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 500)
    expect(supa.spy.chunkSizes.length).toBeGreaterThanOrEqual(3)
    for (const n of supa.spy.chunkSizes) expect(n).toBeLessThanOrEqual(200)
  })

  it('includes a card with a recent positive price', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'greninja-gold-star-swsh144', card_url_slug: 'greninja-gold-star-swsh144', set_name: 'Celebrations' },
      ],
      dailyPrices: [
        { card_slug: 'pc-greninja-gold-star-swsh144', psa10_usd: 190000, date: daysAgoIso(1) },
      ],
    })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.totalEmitted).toBe(1)
    expect(result.cards[0]!.card_url_slug).toBe('greninja-gold-star-swsh144')
  })

  it('excludes a card whose recent rows are all zero even if older rows had prices', async () => {
    const supa = makeFake({
      cards: [
        { card_slug: 'stale', card_url_slug: 'stale', set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-stale', raw_usd: 0, psa10_usd: 0, date: daysAgoIso(1) }, // recent but zero
        { card_slug: 'pc-stale', raw_usd: 500, date: daysAgoIso(120) },           // old but positive
      ],
    })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.totalEmitted).toBe(0)
  })

  it('excludes a card whose ONLY positive prices are older than the window', async () => {
    // Trade-off documented in the module header: stale >7-day cards
    // are treated as non-indexable until the scraper fills in fresh data.
    const supa = makeFake({
      cards: [
        { card_slug: 'old', card_url_slug: 'old', set_name: 'S' },
      ],
      dailyPrices: [
        { card_slug: 'pc-old', raw_usd: 500, date: daysAgoIso(120) },
      ],
    })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.totalEmitted).toBe(0)
  })

  it('regression pin — simulated PostgREST 1000-row cap does NOT hide priced cards', async () => {
    // The W35 live sitemap collapsed from ~41k → 655 URLs because a
    // 500-slug chunk asked for many months of daily_prices history
    // per card. A ~1000-row response cap surfaced only the first 10
    // cards' worth of rows and hid the other 490. Here we recreate
    // that exact scenario and assert every priced card survives.
    const cards: Row[] = []
    const daily: Row[] = []
    for (let i = 0; i < 300; i++) {
      cards.push({ card_slug: `k${i}`, card_url_slug: `slug-${i}`, set_name: 'S' })
      // Give each card 30 recent daily rows to simulate history. With
      // 300 cards × 30 rows = 9,000 rows total. A 1000-row cap on the
      // legacy code path would only surface the first ~33 cards.
      for (let d = 0; d < 30; d++) {
        daily.push({ card_slug: `pc-k${i}`, raw_usd: 100, date: daysAgoIso(d) })
      }
    }
    const supa = makeFake({ cards, dailyPrices: daily, serverRowCap: 1000 })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 300)
    // With chunks of 100 × 7-day window × cap 1000, each response is
    // easily under the cap and all 300 cards must survive.
    expect(result.totalEmitted).toBe(300)
    for (const n of supa.spy.chunkSizes) expect(n).toBeLessThanOrEqual(200)
  })

  it('daily_prices error STILL fails open under W35B', async () => {
    // Fail-open is preserved by the fix.
    const supa = makeFake({
      cards: [
        { card_slug: 'a', card_url_slug: 'alpha', set_name: 'S' },
        { card_slug: 'b', card_url_slug: 'bravo', set_name: 'S' },
      ],
      dailyPrices: [],
      failDaily:   true,
    })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    expect(result.filteringSkipped).toBe(true)
    expect(result.errorNote).toContain('daily_prices fetch failed')
    expect(result.totalEmitted).toBe(2)
  })

  it('emits the well-known W33B opportunity URLs when they have any recent priced row', async () => {
    // Canary: the 5 URLs that were missing from the live sitemap MUST
    // come through the helper when their daily_prices have recent
    // positive data. Values here mirror the ones the live route shows
    // in the card title (`$1.9k PSA 10`, `$4.5k PSA 10`, etc.).
    const cards: Row[] = [
      { card_slug: 'greninja-gold-star-swsh144', card_url_slug: 'greninja-gold-star-swsh144', set_name: 'Celebrations' },
      { card_slug: 'umbreon-vmax-215',           card_url_slug: 'umbreon-vmax-215',           set_name: 'Evolving Skies' },
      { card_slug: 'pikachu-birthday-24',        card_url_slug: 'pikachu-birthday-24',        set_name: 'Celebrations' },
      { card_slug: 'giratina-vstar-gg69',        card_url_slug: 'giratina-vstar-gg69',        set_name: 'Crown Zenith' },
      { card_slug: 'jacinthe-122',               card_url_slug: 'jacinthe-122',               set_name: 'Perfect Order' },
    ]
    const daily: Row[] = [
      { card_slug: 'pc-greninja-gold-star-swsh144', psa10_usd: 190000, date: daysAgoIso(1) },
      { card_slug: 'pc-umbreon-vmax-215',           psa10_usd: 450000, date: daysAgoIso(2) },
      { card_slug: 'pc-pikachu-birthday-24',        psa10_usd:  29200, date: daysAgoIso(1) },
      { card_slug: 'pc-giratina-vstar-gg69',        psa10_usd:  72800, date: daysAgoIso(3) },
      { card_slug: 'pc-jacinthe-122',               psa10_usd:  33000, date: daysAgoIso(1) },
    ]
    const supa = makeFake({ cards, dailyPrices: daily })
    const result = await fetchIndexableCardBatch(supa.fake as unknown as Parameters<typeof fetchIndexableCardBatch>[0], 0, 100)
    const slugs = result.cards.map(c => c.card_url_slug).sort()
    expect(slugs).toEqual([
      'giratina-vstar-gg69',
      'greninja-gold-star-swsh144',
      'jacinthe-122',
      'pikachu-birthday-24',
      'umbreon-vmax-215',
    ])
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
