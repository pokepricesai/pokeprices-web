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
  isJunkRow,
  POTENTIAL_DEALS_COLUMNS,
  MIN_DISCOUNT_PCT,
  MAX_DISCOUNT_PCT,
  JUNK_TERMS,
  type PotentialDeal,
} from '../potentialDeals'

const SRC = readFileSync(join(__dirname, '..', 'potentialDeals.ts'), 'utf8')

// ── Chain stub for daily_deals ─────────────────────────────────────

type StubResult<T> = { data: T[] | null; error: unknown }

function makeDealsStub(rows: PotentialDeal[] | null, error: unknown = null) {
  const chain: any = {
    _last: {
      table: '', select: '', order: null as any, limit: 0,
      filters: [] as any[], notFilters: [] as any[], ins: [] as any[],
    },
    from(table: string) { this._last.table = table; return this },
    select(cols: string) { this._last.select = cols; return this },
    eq(col: string, val: unknown)  { this._last.filters.push(['eq', col, val]);  return this },
    gte(col: string, val: unknown) { this._last.filters.push(['gte', col, val]); return this },
    lte(col: string, val: unknown) { this._last.filters.push(['lte', col, val]); return this },
    not(col: string, op: string, val: unknown) {
      this._last.notFilters.push([col, op, val]); return this
    },
    in(col: string, vals: unknown[]) { this._last.ins.push([col, vals]); return this },
    order(col: string, opts?: { ascending?: boolean }) {
      this._last.order = { col, ascending: opts?.ascending ?? true }
      return this
    },
    limit(n: number) { this._last.limit = n; return this },
    then(resolve: (r: StubResult<PotentialDeal>) => unknown) {
      return Promise.resolve({ data: rows, error }).then(resolve)
    },
  }
  return { chain, client: chain as any }
}

const baseRow: PotentialDeal = {
  card_slug:             'charizard-base',
  card_name:             'Charizard',
  set_name:              'Base Set',
  marketplace:           'EBAY_GB',
  total_cost_cents:      10_000,
  currency:              'GBP',
  fair_value_cents:      12_500,
  // In-range discount (15 <= x <= 30) so the row survives the W43C clamp.
  discount_pct:          20,
  confidence:            'high',
  seller_feedback_score: 500,
  item_web_url:          'https://www.ebay.co.uk/itm/123456789012',
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
    const { client } = makeDealsStub(null, { message: 'boom' })
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

  it('excludes TOPPS rows via case-insensitive ilike on card_name and set_name', () => {
    expect(SRC).toContain(".not('card_name', 'ilike', '%topps%')")
    expect(SRC).toContain(".not('set_name',  'ilike', '%topps%')")
  })

  it('requires item_web_url and ebay_item_id to be non-null', () => {
    expect(SRC).toContain(".not('ebay_item_id', 'is', null)")
    expect(SRC).toContain(".not('item_web_url', 'is', null)")
  })

  it('applies a 48-hour detected_at cutoff', () => {
    expect(SRC).toContain(".gte('detected_at', cutoff)")
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
