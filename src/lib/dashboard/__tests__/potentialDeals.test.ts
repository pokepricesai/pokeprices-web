// Block 5A-W-43A / 5A-W-43B — invariants for the potential-deals
// loader.
//
// Behavioural tests use a lightweight stub SupabaseClient that models
// the chained builder supabase-js returns. Source-invariant tests
// pin the query surface (filters, TOPPS exclusion, item-URL/ID
// requirement, order, watchlist scoping).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadPotentialDeals,
  loadWatchlistSlugs,
  computeDealsCutoff,
  computeListingsCutoff,
  containsJunkTerm,
  isJunkRow,
  toUsdCents,
  isDiscountCoherent,
  POTENTIAL_DEALS_COLUMNS,
  EBAY_LISTINGS_ENRICH_COLUMNS,
  MIN_DISCOUNT_PCT,
  MAX_DISCOUNT_PCT,
  SCRAPER_USD_TO_GBP,
  JUNK_TERMS,
  type PotentialDeal,
} from '../potentialDeals'

const SRC = readFileSync(join(__dirname, '..', 'potentialDeals.ts'), 'utf8')

// ── Chain stub for daily_deals + ebay_listings ─────────────────────

type StubResult<T> = { data: T[] | null; error: unknown }

type TableCall = {
  table:      string
  select:     string
  order:      any
  limit:      number
  filters:    any[]
  notFilters: any[]
  ins:        any[]
}

function emptyCall(): TableCall {
  return { table: '', select: '', order: null, limit: 0, filters: [], notFilters: [], ins: [] }
}

/** W43E — construct an ebay_listings row that will "match" a given
 *  daily_deals row. Useful when a test only cares about the deal
 *  side but the loader now needs a matching listing to enrich. */
function makeMatchingListing(deal: PotentialDeal, over: Partial<any> = {}): any {
  return {
    ebay_item_id:          deal.ebay_item_id,
    marketplace:           deal.marketplace,
    title:                 deal.card_name ?? 'Charizard',
    buying_option:         'FIXED_PRICE',
    item_web_url:          deal.item_web_url,
    item_image_url:        deal.item_image_url,
    scraped_at:            '2026-07-03T12:00:00.000Z',
    listed_date:           null,
    match_confidence:      'high',
    seller_feedback_score: deal.seller_feedback_score,
    seller_feedback_pct:   null,
    seller_country:        null,
    currency:              deal.currency,
    total_cost_cents:      deal.total_cost_cents,
    price_cents:           null,
    shipping_cents:        null,
    condition:             deal.condition,
    ...over,
  }
}

type MakeDealsStubOpts = {
  listingsRows?: any[] | null
  error?:        unknown
}

function makeDealsStub(
  dealsRows: PotentialDeal[] | null,
  opts: MakeDealsStubOpts = {},
) {
  const listingsProvided = opts.listingsRows !== undefined
  const err = opts.error ?? null
  const chain: any = {
    _last:         emptyCall(),  // daily_deals call (back-compat)
    _listingsCall: emptyCall(),
    from(table: string) {
      const call = table === 'daily_deals'
        ? chain._last
        : table === 'ebay_listings'
          ? chain._listingsCall
          : emptyCall()
      call.table = table
      const rows = table === 'daily_deals'
        ? dealsRows
        : table === 'ebay_listings'
          ? (listingsProvided ? opts.listingsRows : (dealsRows ?? []).map(d => makeMatchingListing(d)))
          : null
      const inner: any = {
        select(cols: string) { call.select = cols; return inner },
        eq(col: string, val: unknown)  { call.filters.push(['eq', col, val]);  return inner },
        gte(col: string, val: unknown) { call.filters.push(['gte', col, val]); return inner },
        lte(col: string, val: unknown) { call.filters.push(['lte', col, val]); return inner },
        not(col: string, op: string, val: unknown) { call.notFilters.push([col, op, val]); return inner },
        in(col: string, vals: unknown[]) { call.ins.push([col, vals]); return inner },
        order(col: string, opts?: { ascending?: boolean }) {
          call.order = { col, ascending: opts?.ascending ?? true }
          return inner
        },
        limit(n: number) { call.limit = n; return inner },
        then(resolve: (r: StubResult<any>) => unknown) {
          return Promise.resolve({ data: rows, error: err }).then(resolve)
        },
      }
      return inner
    },
  }
  return { chain, client: chain as any }
}

/** W43G — coherent baseRow: USD-native with total_cost / fair_value /
 *  discount_pct that all agree. 10_000 / 12_500 = 0.80 → 20% discount,
 *  matching the recorded discount_pct=20. Tests that override
 *  discount_pct within [15, 30] stay within the loader's 15pp coherence
 *  tolerance (see isDiscountCoherent). */
const baseRow: PotentialDeal = {
  card_slug:             'charizard-base',
  card_name:             'Charizard',
  set_name:              'Base Set',
  marketplace:           'EBAY_US',
  total_cost_cents:      10_000,
  currency:              'USD',
  fair_value_cents:      12_500,
  // In-range discount (15 <= x <= 30) so the row survives the W43C clamp.
  discount_pct:          20,
  confidence:            'high',
  seller_feedback_score: 500,
  item_web_url:          'https://www.ebay.com/itm/123456789012',
  item_image_url:        'https://i.ebayimg.com/img/x.jpg',
  condition:             'Raw',
  detected_at:           '2026-07-03',
  ebay_item_id:          '123456789012',
}

// ── loadPotentialDeals — behavioural ───────────────────────────────

describe('loadPotentialDeals — behavioural', () => {
  it('returns [] when the client returns null', async () => {
    const { client } = makeDealsStub(null)
    expect(await loadPotentialDeals(client)).toEqual([])
  })

  it('returns [] when the client returns an error', async () => {
    const { client } = makeDealsStub(null, { error: { message: 'boom' } })
    expect(await loadPotentialDeals(client)).toEqual([])
  })

  it('short-circuits to [] on empty watchlist without hitting the DB', async () => {
    const { client, chain } = makeDealsStub([baseRow])
    const out = await loadPotentialDeals(client, { cardSlugFilter: [] })
    expect(out).toEqual([])
    expect(chain._last.table).toBe('')  // .from() never called
  })

  it('adds .in("card_slug", …) when a non-empty watchlist filter is supplied', async () => {
    const { client, chain } = makeDealsStub([baseRow])
    await loadPotentialDeals(client, { cardSlugFilter: ['charizard-base', 'blastoise'] })
    expect(chain._last.ins).toEqual([['card_slug', ['charizard-base', 'blastoise']]])
  })

  it('excludes rows with missing ebay_item_id even if URL is present (defensive)', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: null,             discount_pct: 22 }, // dropped
      { ...baseRow, ebay_item_id: '123456789012',   discount_pct: 20 }, // kept
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].ebay_item_id).toBe('123456789012')
  })

  it('excludes rows with missing item_web_url', async () => {
    const rows = [
      { ...baseRow, item_web_url: null, discount_pct: 22, ebay_item_id: '111111111' }, // dropped
      { ...baseRow,                     discount_pct: 20, ebay_item_id: '222222222' }, // kept
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].ebay_item_id).toBe('222222222')
  })

  it('excludes rows with malformed ebay_item_id (< 6 digits)', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '12345',          discount_pct: 22 }, // dropped
      { ...baseRow, ebay_item_id: '123456789012',   discount_pct: 20 }, // kept
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
  })

  it('dedupes by ebay_item_id', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '123456789012', discount_pct: 25 },
      { ...baseRow, ebay_item_id: '123456789012', discount_pct: 24 }, // dup
      { ...baseRow, ebay_item_id: '999888777666', discount_pct: 20 },
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(2)
    expect(out.map(r => r.ebay_item_id)).toEqual(['123456789012', '999888777666'])
  })

  it('caps the visible window at the requested limit', async () => {
    // Rows within the discount clamp only (15..30).
    const rows = Array.from({ length: 60 }, (_, i) => ({
      ...baseRow,
      ebay_item_id: `12345678901${i}`,
      discount_pct: 15 + (i % 16),
    }))
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client, { limit: 5 })
    expect(out).toHaveLength(5)
  })

  it('applies the chain in the correct shape (Best deals path)', async () => {
    const { client, chain } = makeDealsStub([baseRow])
    await loadPotentialDeals(client, { limit: 30 })
    expect(chain._last.table).toBe('daily_deals')
    expect(chain._last.select).toBe(POTENTIAL_DEALS_COLUMNS)
    // Positive filters — W43C added the discount clamp.
    expect(chain._last.filters).toEqual(expect.arrayContaining([
      ['eq',  'confidence',            'high'],
      ['gte', 'seller_feedback_score', 100],
      ['gte', 'discount_pct',          MIN_DISCOUNT_PCT],
      ['lte', 'discount_pct',          MAX_DISCOUNT_PCT],
    ]))
    // Negative filters — TOPPS exclusion + item id/URL presence
    expect(chain._last.notFilters).toEqual(expect.arrayContaining([
      ['card_name',    'ilike', '%topps%'],
      ['set_name',     'ilike', '%topps%'],
      ['ebay_item_id', 'is',    null],
      ['item_web_url', 'is',    null],
    ]))
    // Order
    expect(chain._last.order).toEqual({ col: 'discount_pct', ascending: false })
    // Over-fetch is limit * 2
    expect(chain._last.limit).toBe(60)
  })

  // ── W43C new behavioural tests ──────────────────────────────────

  it('drops rows below the discount floor (< 15%)', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '111111111111', discount_pct: 10 }, // dropped
      { ...baseRow, ebay_item_id: '222222222222', discount_pct: 15 }, // kept (boundary)
      { ...baseRow, ebay_item_id: '333333333333', discount_pct: 14.9 }, // dropped
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['222222222222'])
  })

  it('drops rows above the discount ceiling (> 30%)', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '444444444444', discount_pct: 70 }, // dropped (suspicious)
      { ...baseRow, ebay_item_id: '555555555555', discount_pct: 30 }, // kept (boundary)
      { ...baseRow, ebay_item_id: '666666666666', discount_pct: 30.1 }, // dropped
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['555555555555'])
  })

  it('drops rows whose card_name / set_name / condition contain a junk term', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '111111111111', card_name: 'Fan art Charizard',    discount_pct: 25 }, // dropped
      { ...baseRow, ebay_item_id: '222222222222', set_name:  'Custom Base Set',      discount_pct: 24 }, // dropped
      { ...baseRow, ebay_item_id: '333333333333', condition: 'PSA 10 (Proxy print)', discount_pct: 23 }, // dropped
      { ...baseRow, ebay_item_id: '444444444444',                                    discount_pct: 22 }, // kept
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['444444444444'])
  })

  it('drops rows with an unrecognised marketplace value', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: '111111111111', marketplace: 'EBAY_XX' }, // dropped
      { ...baseRow, ebay_item_id: '222222222222', marketplace: null       }, // dropped
      { ...baseRow, ebay_item_id: '333333333333', marketplace: 'EBAY_GB', item_web_url: 'https://www.ebay.co.uk/itm/333333333333' }, // kept
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['333333333333'])
  })

  it('drops rows where the marketplace and item_web_url domain disagree', async () => {
    const rows = [
      // Claims UK but URL is .com — dropped.
      { ...baseRow, ebay_item_id: '111111111111', marketplace: 'EBAY_GB', item_web_url: 'https://www.ebay.com/itm/111111111111' },
      // Claims US but URL is .co.uk — dropped.
      { ...baseRow, ebay_item_id: '222222222222', marketplace: 'EBAY_US', item_web_url: 'https://www.ebay.co.uk/itm/222222222222' },
      // Aligned — kept.
      { ...baseRow, ebay_item_id: '333333333333', marketplace: 'EBAY_US', item_web_url: 'https://www.ebay.com/itm/333333333333' },
    ]
    const { client } = makeDealsStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['333333333333'])
  })
})

describe('isJunkRow — pure', () => {
  it('detects every documented junk term case-insensitively across card_name / set_name / condition', () => {
    for (const term of JUNK_TERMS) {
      const upperCased = term.toUpperCase()
      expect(isJunkRow({ ...baseRow, card_name: `Charizard ${upperCased} variant` })).toBe(true)
      expect(isJunkRow({ ...baseRow, set_name:  `Set ${upperCased} edition`      })).toBe(true)
      expect(isJunkRow({ ...baseRow, condition: `PSA 10 · ${upperCased}`         })).toBe(true)
    }
  })

  it('returns false for a clean row', () => {
    expect(isJunkRow({ ...baseRow, card_name: 'Charizard', set_name: 'Base Set', condition: 'Raw' })).toBe(false)
  })
})

describe('containsJunkTerm — pure', () => {
  it('is case-insensitive', () => {
    expect(containsJunkTerm('CHARIZARD TOPPS variant')).toBe(true)
    expect(containsJunkTerm('Fan Art foil')).toBe(true)
  })

  it('returns false for null / empty / clean strings', () => {
    expect(containsJunkTerm(null)).toBe(false)
    expect(containsJunkTerm(undefined)).toBe(false)
    expect(containsJunkTerm('')).toBe(false)
    expect(containsJunkTerm('Charizard Base Set PSA 10')).toBe(false)
  })
})

// ── W43E — ebay_listings enrichment ───────────────────────────────

describe('loadPotentialDeals — W43E ebay_listings enrichment', () => {
  it('queries ebay_listings with the pinned filter set after fetching daily_deals candidates', async () => {
    const { client, chain } = makeDealsStub([baseRow])
    await loadPotentialDeals(client)
    expect(chain._listingsCall.table).toBe('ebay_listings')
    expect(chain._listingsCall.select).toBe(EBAY_LISTINGS_ENRICH_COLUMNS)
    expect(chain._listingsCall.filters).toEqual(expect.arrayContaining([
      ['eq',  'match_confidence',      'high'],
      ['eq',  'buying_option',         'FIXED_PRICE'],
      ['gte', 'seller_feedback_score', 100],
    ]))
    const scrapedFilter = chain._listingsCall.filters.find((f: any[]) => f[0] === 'gte' && f[1] === 'scraped_at')
    expect(scrapedFilter).toBeDefined()
    expect(typeof scrapedFilter[2]).toBe('string')
    // W43F — the scraped_at cutoff value passed to the DB is ~7 days
    // in the past (small tolerance for test-execution latency).
    const cutoffMs   = Date.parse(scrapedFilter[2])
    const ageMs      = Date.now() - cutoffMs
    const sevenDays  = 7 * 24 * 60 * 60 * 1000
    const toleranceMs = 60_000
    expect(ageMs).toBeGreaterThan(sevenDays - toleranceMs)
    expect(ageMs).toBeLessThan(sevenDays + toleranceMs)
    expect(chain._listingsCall.notFilters).toEqual(expect.arrayContaining([
      ['item_web_url', 'is', null],
    ]))
    // Joined by ebay_item_id — passes the candidate IDs from Step A.
    expect(chain._listingsCall.ins.length).toBeGreaterThan(0)
    const idIn = chain._listingsCall.ins.find((i: any[]) => i[0] === 'ebay_item_id')
    expect(idIn).toBeDefined()
    expect(idIn[1]).toContain('123456789012')
  })

  it('drops candidates when ebay_listings returns no matching fresh row', async () => {
    // dealsRows has a valid candidate but listingsRows explicitly []
    const { client } = makeDealsStub([baseRow], { listingsRows: [] })
    const out = await loadPotentialDeals(client)
    expect(out).toEqual([])
  })

  it('drops candidates whose matching ebay_listings.title contains a junk term (fan art / topps / etc.)', async () => {
    const deals = [
      { ...baseRow, ebay_item_id: '111111111111', card_name: 'Charizard' },
    ]
    const listings = [
      makeMatchingListing(deals[0], { title: 'TOPPS Charizard fan art custom' }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toEqual([])
  })

  it('W43G — keeps daily_deals.item_web_url even when ebay_listings offers a different URL', async () => {
    // W43G REVERSES W43E's behaviour: the loader must not swap in
    // ebay_listings.item_web_url. The daily_deals URL was captured at
    // the exact moment the discount was computed, so preserving it
    // keeps the deep-link CTA on the same listing basis as the claim.
    const deals = [
      { ...baseRow, ebay_item_id: '222222222222',
        marketplace: 'EBAY_US',
        item_web_url: 'https://www.ebay.com/itm/222222222222' },
    ]
    const listings = [
      makeMatchingListing(deals[0], {
        item_web_url: 'https://www.ebay.com/itm/222222222222?fresher=1',
      }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].item_web_url).toBe('https://www.ebay.com/itm/222222222222')
  })

  it('surfaces title, scraped_at, buying_option on the enriched output', async () => {
    const deals = [{ ...baseRow, ebay_item_id: '333333333333' }]
    const listings = [
      makeMatchingListing(deals[0], {
        title:         'Charizard Base Set PSA 10',
        scraped_at:    '2026-07-03T10:00:00.000Z',
        buying_option: 'FIXED_PRICE',
      }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Charizard Base Set PSA 10')
    expect(out[0].scraped_at).toBe('2026-07-03T10:00:00.000Z')
    expect(out[0].buying_option).toBe('FIXED_PRICE')
  })

  it('keeps daily_deals as the source of truth for fair_value_cents and discount_pct', async () => {
    // Coherent trio: total 14_040 USD / fair 18_000 USD = ratio 0.78 → 22% discount.
    const deals = [{
      ...baseRow,
      ebay_item_id:     '444444444444',
      fair_value_cents: 18_000,
      total_cost_cents: 14_040,
      currency:         'USD',
      discount_pct:     22,
    }]
    const listings = [
      makeMatchingListing(deals[0], {
        // Even if ebay_listings had different values, the loader must
        // ignore them for the fair-value / discount fields (W43G — and
        // now also for price / currency / marketplace / URL).
        total_cost_cents: 999_999_999,
      }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].fair_value_cents).toBe(18_000)
    expect(out[0].discount_pct).toBe(22)
  })

  it('W43G — only enriches with a same-marketplace ebay_listings row; extras in other marketplaces are ignored', async () => {
    const deals = [{
      ...baseRow,
      ebay_item_id: '555555555555',
      marketplace:  'EBAY_GB',
      // baseRow currency=USD leaves the coherence math intact
      // (10000 USD / 12500 USD = 20% discount) even though the
      // marketplace is UK; the loader does not enforce currency ↔
      // marketplace coupling, only URL/host and coherence.
      item_web_url: 'https://www.ebay.co.uk/itm/555555555555',
    }]
    // Two ebay_listings rows for the same item — one UK, one US.
    const listings = [
      makeMatchingListing(deals[0], { marketplace: 'EBAY_GB' }),
      makeMatchingListing(deals[0], {
        marketplace:  'EBAY_US',
        item_web_url: 'https://www.ebay.com/itm/555555555555',
      }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    // Same-marketplace requirement: only the UK listing validates
    // the UK deal, and the row emits marketplace=EBAY_GB from
    // daily_deals (source of truth) rather than the ebay_listings side.
    expect(out).toHaveLength(1)
    expect(out[0].marketplace).toBe('EBAY_GB')
  })

  it('W43G — drops candidates whose only ebay_listings match is a different marketplace', async () => {
    const deals = [{
      ...baseRow,
      ebay_item_id: '666666666666',
      marketplace:  'EBAY_US',
      item_web_url: 'https://www.ebay.com/itm/666666666666',
    }]
    // Only a UK listing is fresh — no US match — so the loader must
    // drop this candidate rather than substitute a wrong-marketplace row.
    const listings = [
      makeMatchingListing(deals[0], {
        marketplace:  'EBAY_GB',
        item_web_url: 'https://www.ebay.co.uk/itm/666666666666',
      }),
    ]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toEqual([])
  })

  it('W43G — coherence guard drops a row whose displayed values do not re-derive to discount_pct (Typhlosion-shape)', async () => {
    // Mirror of the live report: GBP total_cost that, once converted
    // to USD, sits ABOVE the USD market ref — so a "15% below" claim
    // is not truthful. Coherence guard's ratio check catches this.
    const deals = [{
      ...baseRow,
      ebay_item_id:     '777777777777',
      marketplace:      'EBAY_GB',
      item_web_url:     'https://www.ebay.co.uk/itm/777777777777',
      currency:         'GBP',
      total_cost_cents: 20_106, // £201.06 → ≈ $254.51 USD
      fair_value_cents: 24_249, // $242.49 USD market ref
      discount_pct:     15.1,
    }]
    const listings = [makeMatchingListing(deals[0], { marketplace: 'EBAY_GB' })]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toEqual([])
  })

  it('W43G — keeps a GBP row whose USD conversion IS below the market ref', async () => {
    // £158.00 → ≈ $200 USD, market ref $242.49 → ≈ 17.5% below.
    const deals = [{
      ...baseRow,
      ebay_item_id:     '888888888888',
      marketplace:      'EBAY_GB',
      item_web_url:     'https://www.ebay.co.uk/itm/888888888888',
      currency:         'GBP',
      total_cost_cents: 15_800,
      fair_value_cents: 24_249,
      discount_pct:     17.5,
    }]
    const listings = [makeMatchingListing(deals[0], { marketplace: 'EBAY_GB' })]
    const { client } = makeDealsStub(deals, { listingsRows: listings })
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].currency).toBe('GBP')
    expect(out[0].total_cost_cents).toBe(15_800)
    expect(out[0].marketplace).toBe('EBAY_GB')
  })
})

// ── loadWatchlistSlugs — behavioural ───────────────────────────────

function makeWatchlistStub(rows: Array<{ card_slug: string | null }> | null, error: unknown = null) {
  const chain: any = {
    _last: { table: '', select: '', filters: [] as any[] },
    from(t: string)  { this._last.table = t;    return this },
    select(c: string){ this._last.select = c;   return this },
    eq(col: string, val: unknown) { this._last.filters.push([col, val]); return this },
    then(resolve: (r: StubResult<{ card_slug: string | null }>) => unknown) {
      return Promise.resolve({ data: rows, error }).then(resolve)
    },
  }
  return { chain, client: chain as any }
}

describe('loadWatchlistSlugs — behavioural', () => {
  it('returns [] for an empty userId', async () => {
    const { client } = makeWatchlistStub([])
    expect(await loadWatchlistSlugs(client, '')).toEqual([])
  })

  it('returns the card_slug list, filtering nulls', async () => {
    const { client } = makeWatchlistStub([
      { card_slug: 'charizard-base' },
      { card_slug: null },
      { card_slug: 'blastoise-base' },
    ])
    expect(await loadWatchlistSlugs(client, 'user-1')).toEqual(['charizard-base', 'blastoise-base'])
  })

  it('reads from the watchlist table filtered by user_id', async () => {
    const { client, chain } = makeWatchlistStub([])
    await loadWatchlistSlugs(client, 'user-abc')
    expect(chain._last.table).toBe('watchlist')
    expect(chain._last.select).toBe('card_slug')
    expect(chain._last.filters).toEqual([['user_id', 'user-abc']])
  })

  it('returns [] on error', async () => {
    const { client } = makeWatchlistStub(null, { message: 'boom' })
    expect(await loadWatchlistSlugs(client, 'user-1')).toEqual([])
  })
})

// ── computeDealsCutoff — pure ──────────────────────────────────────

describe('computeDealsCutoff — pure', () => {
  it('returns a YYYY-MM-DD string 48h before the provided time', () => {
    const now = Date.parse('2026-07-03T12:00:00Z')
    expect(computeDealsCutoff(now)).toBe('2026-07-01')
  })

  it('handles month boundaries correctly', () => {
    const now = Date.parse('2026-07-02T00:00:00Z')
    expect(computeDealsCutoff(now)).toBe('2026-06-30')
  })
})

// ── Source invariants ─────────────────────────────────────────────

describe('loadPotentialDeals — source invariants', () => {
  it('exports the loader plus the columns constant + watchlist loader', () => {
    expect(SRC).toContain('export async function loadPotentialDeals')
    expect(SRC).toContain('export async function loadWatchlistSlugs')
    expect(SRC).toContain('export const POTENTIAL_DEALS_COLUMNS')
  })

  it('reads from daily_deals with the pinned column projection', () => {
    expect(SRC).toContain("from('daily_deals')")
    expect(SRC).toContain('.select(POTENTIAL_DEALS_COLUMNS)')
    for (const col of [
      'card_slug', 'card_name', 'set_name', 'marketplace',
      'total_cost_cents', 'currency', 'fair_value_cents', 'discount_pct',
      'confidence', 'seller_feedback_score', 'item_web_url', 'item_image_url',
      'condition', 'detected_at', 'ebay_item_id',
    ]) {
      expect(POTENTIAL_DEALS_COLUMNS).toContain(col)
    }
  })

  it('applies confidence = high and seller_feedback_score >= 100', () => {
    expect(SRC).toContain(".eq('confidence', 'high')")
    expect(SRC).toContain(".gte('seller_feedback_score', 100)")
  })

  it('applies the W43C discount clamp [15, 30] at the DB layer', () => {
    expect(SRC).toContain('MIN_DISCOUNT_PCT = 15')
    expect(SRC).toContain('MAX_DISCOUNT_PCT = 30')
    expect(SRC).toContain(".gte('discount_pct', MIN_DISCOUNT_PCT)")
    expect(SRC).toContain(".lte('discount_pct', MAX_DISCOUNT_PCT)")
  })

  it('exposes JUNK_TERMS covering every documented fake / fan-art token', () => {
    for (const t of [
      'topps', 'fan art', 'custom', 'proxy', 'replica', 'reprint',
      'metal card', 'gold plated', 'handmade', 'extended art', 'artwork',
      'sticker', 'coin', 'jumbo', 'oversized', 'empty', 'no cards',
      'case only', 'box only', 'pick your card', 'u pick',
    ]) {
      expect(JUNK_TERMS).toContain(t)
    }
  })

  it('post-filters rows via isJunkRow before rendering', () => {
    expect(SRC).toContain('if (isJunkRow(row)) continue')
  })

  it('post-filters rows whose marketplace ↔ URL host disagree', () => {
    expect(SRC).toContain('expectedHostFor')
    expect(SRC).toContain('if (host !== expected) continue')
  })

  it('W43E — reads ebay_listings for enrichment with the required filter set', () => {
    expect(SRC).toContain("from('ebay_listings')")
    expect(SRC).toContain('.select(EBAY_LISTINGS_ENRICH_COLUMNS)')
    expect(SRC).toContain(".in('ebay_item_id', candidateIds)")
    expect(SRC).toContain(".eq('match_confidence', 'high')")
    expect(SRC).toContain(".eq('buying_option',    'FIXED_PRICE')")
    expect(SRC).toContain(".gte('seller_feedback_score', 100)")
    expect(SRC).toContain(".gte('scraped_at', listingsCutoff)")
    expect(SRC).toContain(".not('item_web_url', 'is', null)")
  })

  it('W43E — applies the containsJunkTerm filter against ebay_listings.title', () => {
    expect(SRC).toContain('if (containsJunkTerm(match.title)) continue')
  })

  it('W43G — keeps daily_deals as source of truth for marketplace + item_web_url + price + currency', () => {
    // W43G REPLACED W43E's ebay_listings-preferred model — the field
    // that feeds the discount claim must all come from daily_deals so
    // the displayed listing price and the recorded discount_pct never
    // sit on different currency bases.
    expect(SRC).toContain('const finalMarketplace = deal.marketplace')
    expect(SRC).toContain('const finalUrl         = deal.item_web_url')
    expect(SRC).toContain('currency:              deal.currency')
    expect(SRC).toContain('total_cost_cents:      deal.total_cost_cents')
    // Regression guard against W43E's substitution pattern coming back.
    expect(SRC).not.toContain('match.marketplace ?? deal.marketplace')
    expect(SRC).not.toContain('match.item_web_url ?? deal.item_web_url')
    expect(SRC).not.toContain('match.currency       ?? deal.currency')
    expect(SRC).not.toContain('match.total_cost_cents ?? deal.total_cost_cents')
  })

  it('W43G — requires a same-marketplace ebay_listings match; no any-marketplace fallback', () => {
    // Old W43E line `.find(...) ?? available[0]` must be gone.
    expect(SRC).toContain('available.find(l => l.marketplace === deal.marketplace)')
    expect(SRC).not.toContain('?? available[0]')
    // And the loader must bail out when no same-marketplace match exists.
    expect(SRC).toMatch(/if \(!match\) continue/)
  })

  it('W43G — calls the coherence guard against daily_deals values before enriching', () => {
    expect(SRC).toContain('isDiscountCoherent(')
    // Must be called with deal-side (daily_deals) values, not match-side.
    expect(SRC).toMatch(/isDiscountCoherent\(\s*deal\.total_cost_cents,\s*deal\.currency,\s*deal\.fair_value_cents,\s*deal\.discount_pct/)
  })

  it('W43E — dedupes enriched rows by (ebay_item_id, marketplace) so a listing renders once per marketplace', () => {
    expect(SRC).toContain('`${idStr}::${finalMarketplace}`')
    expect(SRC).toContain('seenByIdMarket')
  })

  it('W43F — scraped_at cutoff is 7 days back and returned as a full ISO timestamp', () => {
    // W43F loosened the cutoff from 36h (W43E) to 7 days after the
    // diagnostic showed the ebay_listings scraper actually revisits
    // items on a weekly cadence — 36h dropped 100% of otherwise-valid
    // candidates.
    expect(SRC).toContain('7 * 24 * 60 * 60 * 1000')
    // W43E's 36-hour claim must not linger anywhere in the loader.
    expect(SRC).not.toContain('36 * 60 * 60 * 1000')
    // The helper still returns full ISO (not date-only) so PostgREST
    // compares as timestamp, matching how ebay_listings.scraped_at
    // is stored.
    expect(SRC).toMatch(/computeListingsCutoff[\s\S]*?\.toISOString\(\)\s*$/m)
  })

  it('excludes TOPPS rows via case-insensitive ilike on card_name and set_name', () => {
    expect(SRC).toContain(".not('card_name', 'ilike', '%topps%')")
    expect(SRC).toContain(".not('set_name',  'ilike', '%topps%')")
  })

  it('requires item_web_url and ebay_item_id to be non-null', () => {
    expect(SRC).toContain(".not('ebay_item_id', 'is', null)")
    expect(SRC).toContain(".not('item_web_url', 'is', null)")
  })

  it('applies a 48-hour detected_at cutoff', () => {
    // W43E — the cutoff variable was renamed to `dealsCutoff` when
    // the second (ebay_listings) cutoff was introduced.
    expect(SRC).toContain(".gte('detected_at', dealsCutoff)")
    expect(SRC).toContain('48 * 60 * 60 * 1000')
  })

  it('orders by discount_pct descending', () => {
    expect(SRC).toContain(".order('discount_pct', { ascending: false })")
  })

  it('accepts a cardSlugFilter for the Watchlist tab', () => {
    expect(SRC).toContain('cardSlugFilter?: string[] | null')
    expect(SRC).toContain(".in('card_slug', cardSlugFilter)")
  })

  it('defaults limit to 30 and over-fetches for dedupe', () => {
    expect(SRC).toContain('DEFAULT_LIMIT       = 30')
    expect(SRC).toContain('limit * 2')
  })

  it('fails closed — never throws, always returns an array', () => {
    expect(SRC).toContain('} catch {')
    expect(SRC).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return \[\]/)
  })
})

describe('computeListingsCutoff — pure', () => {
  it('returns an ISO timestamp 7 days / 168 hours before the provided time (W43F)', () => {
    const now = Date.parse('2026-07-10T12:00:00Z')
    // 7d before 12:00Z on Jul 10 = 12:00Z on Jul 3
    expect(computeListingsCutoff(now)).toBe('2026-07-03T12:00:00.000Z')
  })

  it('handles month boundaries correctly', () => {
    const now = Date.parse('2026-07-04T09:30:00Z')
    // 7d before 09:30Z on Jul 4 = 09:30Z on Jun 27
    expect(computeListingsCutoff(now)).toBe('2026-06-27T09:30:00.000Z')
  })
})

// ── W43G — pure conversion + coherence helpers ─────────────────────

describe('toUsdCents — pure (W43G)', () => {
  it('converts GBP cents to USD cents using the scraper rate (0.79)', () => {
    // Uses the SAME rate as detect_deals.py::convert_to_usd_cents.
    expect(toUsdCents(20_106, 'GBP')).toBe(Math.round(20_106 / SCRAPER_USD_TO_GBP))
  })

  it('passes USD cents through unchanged', () => {
    expect(toUsdCents(10_000, 'USD')).toBe(10_000)
  })

  it('treats unknown currency as USD (pass-through)', () => {
    expect(toUsdCents(10_000, null)).toBe(10_000)
    expect(toUsdCents(10_000, undefined)).toBe(10_000)
    expect(toUsdCents(10_000, 'EUR')).toBe(10_000)
  })

  it('returns null for null or negative input', () => {
    expect(toUsdCents(null, 'GBP')).toBeNull()
    expect(toUsdCents(undefined, 'USD')).toBeNull()
    expect(toUsdCents(-5, 'USD')).toBeNull()
  })
})

describe('isDiscountCoherent — pure (W43G)', () => {
  it('accepts a scraper-shaped USD row (20% below market)', () => {
    expect(isDiscountCoherent(10_000, 'USD', 12_500, 20)).toBe(true)
  })

  it('accepts a GBP row whose USD conversion is within the [0.30, 0.85] ratio window', () => {
    // £158.00 → ≈ $200 USD, market ref $242.49 → ratio 0.825 → 17.5% below.
    expect(isDiscountCoherent(15_800, 'GBP', 24_249, 17.5)).toBe(true)
  })

  it('REJECTS the live Typhlosion-shape row (GBP price above USD market ref)', () => {
    // £201.06 → ≈ $254.51 USD, market ref $242.49 → ratio 1.05 → fails ratio check.
    expect(isDiscountCoherent(20_106, 'GBP', 24_249, 15.1)).toBe(false)
  })

  it('REJECTS a row whose recomputed ratio is above 0.85 (not actually below market)', () => {
    // 12_000 USD / 12_500 USD = 0.96 → outside [0.30, 0.85].
    expect(isDiscountCoherent(12_000, 'USD', 12_500, 15)).toBe(false)
  })

  it('REJECTS a row whose recomputed ratio is below 0.30 (suspicious wrong-card match)', () => {
    // 2_000 USD / 12_500 USD = 0.16 → outside [0.30, 0.85].
    expect(isDiscountCoherent(2_000, 'USD', 12_500, 84)).toBe(false)
  })

  it('REJECTS when stored discount_pct is further from recomputed than tolerance', () => {
    // Recomputed = 20%; stored = 40%; tolerance 15pp → 20pp delta → reject.
    expect(isDiscountCoherent(10_000, 'USD', 12_500, 40)).toBe(false)
  })

  it('honours an explicit tolerance override', () => {
    // Same numbers as above but tolerance=25 → accept.
    expect(isDiscountCoherent(10_000, 'USD', 12_500, 40, 25)).toBe(true)
  })

  it('returns false on nullish / non-positive inputs', () => {
    expect(isDiscountCoherent(null, 'USD', 12_500, 20)).toBe(false)
    expect(isDiscountCoherent(10_000, 'USD', null, 20)).toBe(false)
    expect(isDiscountCoherent(10_000, 'USD', 12_500, null)).toBe(false)
    expect(isDiscountCoherent(10_000, 'USD', 0, 20)).toBe(false)
  })
})
