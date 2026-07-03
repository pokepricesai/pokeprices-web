// Block 5A-W-43A — invariants for the potential-deals loader.
//
// Two layers:
//   * Behavioural — lightweight stub SupabaseClient models the
//     chained builder that supabase-js returns; the stub returns
//     pre-canned rows so the loader's dedupe + limit paths can be
//     exercised end-to-end without mocking the whole client.
//   * Source-invariant — pins the query surface (table name, columns,
//     filter thresholds, order, over-fetch, cutoff computation).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadPotentialDeals,
  computeDealsCutoff,
  POTENTIAL_DEALS_COLUMNS,
  type PotentialDeal,
} from '../potentialDeals'

const SRC = readFileSync(join(__dirname, '..', 'potentialDeals.ts'), 'utf8')

// ── Chain stub ─────────────────────────────────────────────────────
// PostgREST builders in supabase-js are thenable. Every chain method
// returns `this` until the final await, so a plain object with each
// method returning itself works. `then` resolves with the stub's
// pre-canned result.

function makeStub(rows: PotentialDeal[] | null, error: unknown = null) {
  const chain: any = {
    _last: { table: '', select: '', order: null as any, limit: 0, filters: [] as any[] },
    from(table: string) { this._last.table = table; return this },
    select(cols: string) { this._last.select = cols; return this },
    eq(col: string, val: unknown)  { this._last.filters.push(['eq', col, val]);  return this },
    gte(col: string, val: unknown) { this._last.filters.push(['gte', col, val]); return this },
    order(col: string, opts?: { ascending?: boolean }) {
      this._last.order = { col, ascending: opts?.ascending ?? true }
      return this
    },
    limit(n: number) { this._last.limit = n; return this },
    then(resolve: (r: { data: PotentialDeal[] | null; error: unknown }) => unknown) {
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
  fair_value_cents:      18_000,
  discount_pct:          44.4,
  confidence:            'high',
  seller_feedback_score: 500,
  item_web_url:          'https://www.ebay.co.uk/itm/1234567890',
  item_image_url:        'https://i.ebayimg.com/img/x.jpg',
  condition:             'Raw',
  detected_at:           '2026-07-03',
  ebay_item_id:          '1234567890',
}

describe('loadPotentialDeals — behavioural', () => {
  it('returns [] when the client returns null', async () => {
    const { client } = makeStub(null)
    expect(await loadPotentialDeals(client)).toEqual([])
  })

  it('returns [] when the client returns an error', async () => {
    const { client } = makeStub(null, { message: 'boom' })
    expect(await loadPotentialDeals(client)).toEqual([])
  })

  it('returns rows up to the requested limit after dedupe', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: 'a', discount_pct: 40 },
      { ...baseRow, ebay_item_id: 'b', discount_pct: 30 },
      { ...baseRow, ebay_item_id: 'c', discount_pct: 25 },
    ]
    const { client } = makeStub(rows)
    const out = await loadPotentialDeals(client, { limit: 5 })
    expect(out).toHaveLength(3)
    expect(out.map(r => r.ebay_item_id)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes by ebay_item_id (keeps first occurrence)', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: 'a', discount_pct: 40 },
      { ...baseRow, ebay_item_id: 'a', discount_pct: 39 },   // dup
      { ...baseRow, ebay_item_id: 'b', discount_pct: 30 },
    ]
    const { client } = makeStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out.map(r => r.ebay_item_id)).toEqual(['a', 'b'])
  })

  it('falls back to item_web_url for dedupe when ebay_item_id is null', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: null, item_web_url: 'https://ebay/itm/1', discount_pct: 40 },
      { ...baseRow, ebay_item_id: null, item_web_url: 'https://ebay/itm/1', discount_pct: 39 }, // dup
      { ...baseRow, ebay_item_id: null, item_web_url: 'https://ebay/itm/2', discount_pct: 30 },
    ]
    const { client } = makeStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(2)
    expect(out[0].item_web_url).toBe('https://ebay/itm/1')
    expect(out[1].item_web_url).toBe('https://ebay/itm/2')
  })

  it('skips rows with no dedupe key at all', async () => {
    const rows = [
      { ...baseRow, ebay_item_id: null, item_web_url: null,   discount_pct: 40 }, // skip
      { ...baseRow, ebay_item_id: 'b',  item_web_url: null,   discount_pct: 30 },
    ]
    const { client } = makeStub(rows)
    const out = await loadPotentialDeals(client)
    expect(out).toHaveLength(1)
    expect(out[0].ebay_item_id).toBe('b')
  })

  it('caps the visible window at the requested limit', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      ...baseRow, ebay_item_id: `id-${i}`, discount_pct: 60 - i,
    }))
    const { client } = makeStub(rows)
    const out = await loadPotentialDeals(client, { limit: 5 })
    expect(out).toHaveLength(5)
  })

  it('applies the chain in the correct shape (from → select → filters → order → limit)', async () => {
    const { client, chain } = makeStub([baseRow])
    await loadPotentialDeals(client, { limit: 5 })
    expect(chain._last.table).toBe('daily_deals')
    expect(chain._last.select).toBe(POTENTIAL_DEALS_COLUMNS)
    // Filters
    expect(chain._last.filters).toEqual(expect.arrayContaining([
      ['eq',  'confidence',            'high'],
      ['gte', 'seller_feedback_score', 100],
    ]))
    const detected = chain._last.filters.find((f: any[]) => f[0] === 'gte' && f[1] === 'detected_at')
    expect(detected).toBeDefined()
    expect(typeof detected[2]).toBe('string')
    expect(detected[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Order
    expect(chain._last.order).toEqual({ col: 'discount_pct', ascending: false })
    // Over-fetch (limit * 3)
    expect(chain._last.limit).toBe(15)
  })
})

describe('computeDealsCutoff — pure', () => {
  it('returns a YYYY-MM-DD string 48h before the provided time', () => {
    // A known fixed time: 2026-07-03T12:00:00Z minus 48h = 2026-07-01
    const now = Date.parse('2026-07-03T12:00:00Z')
    expect(computeDealsCutoff(now)).toBe('2026-07-01')
  })

  it('handles month boundaries correctly', () => {
    // 2026-07-02T00:00:00Z minus 48h = 2026-06-30
    const now = Date.parse('2026-07-02T00:00:00Z')
    expect(computeDealsCutoff(now)).toBe('2026-06-30')
  })
})

describe('loadPotentialDeals — source invariants', () => {
  it('exports the loader plus its columns constant', () => {
    expect(SRC).toContain('export async function loadPotentialDeals')
    expect(SRC).toContain('export const POTENTIAL_DEALS_COLUMNS')
  })

  it('reads from daily_deals with the pinned column projection', () => {
    expect(SRC).toContain("from('daily_deals')")
    expect(SRC).toContain('.select(POTENTIAL_DEALS_COLUMNS)')
    // Pin every required field is in the projection constant.
    for (const col of [
      'card_slug', 'card_name', 'set_name', 'marketplace',
      'total_cost_cents', 'currency', 'fair_value_cents', 'discount_pct',
      'confidence', 'seller_feedback_score', 'item_web_url', 'item_image_url',
      'condition', 'detected_at', 'ebay_item_id',
    ]) {
      expect(POTENTIAL_DEALS_COLUMNS).toContain(col)
    }
  })

  it('applies confidence = high and seller_feedback_score >= 100 (stricter than the producer)', () => {
    expect(SRC).toContain(".eq('confidence', 'high')")
    expect(SRC).toContain(".gte('seller_feedback_score', 100)")
  })

  it('applies a 48-hour detected_at cutoff', () => {
    expect(SRC).toContain(".gte('detected_at', cutoff)")
    expect(SRC).toContain('48 * 60 * 60 * 1000')
  })

  it('orders by discount_pct descending', () => {
    expect(SRC).toContain(".order('discount_pct', { ascending: false })")
  })

  it('defaults limit to 5 and over-fetches for dedupe', () => {
    expect(SRC).toContain('DEFAULT_LIMIT       = 5')
    expect(SRC).toContain('OVERFETCH_MULTIPLIER = 3')
    expect(SRC).toContain('limit * OVERFETCH_MULTIPLIER')
  })

  it('dedupes by ebay_item_id with item_web_url fallback', () => {
    expect(SRC).toMatch(/row\.ebay_item_id\s*\?\?\s*row\.item_web_url/)
  })

  it('fails closed — never throws, always returns an array', () => {
    // Two catch sites: the outer try/catch and the error-branch return.
    expect(SRC).toContain('} catch {')
    expect(SRC).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return \[\]/)
  })
})
