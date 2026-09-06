// src/lib/editorial/research/__tests__/quarantine.test.ts
//
// Block 6B — regressions for the three evidence-integrity failure
// modes exposed by the Block 6 live run:
//   1. population = 0 AND current PSA 10 price > 0
//   2. stale population snapshot must force explicit as-of framing
//   3. extreme monthly mover must be quarantined, not top-of-list
//
// Recipes are tested through their `computeQuality` / quarantine
// logic here by running them against mocked Supabase clients rather
// than the real service.

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

type Row = Record<string, any>
const tables: Record<string, Row[]> = { psa_population: [], cards: [], card_latest_prices: [], daily_prices: [] }
const counts:  Record<string, number> = { daily_prices_2026_08_01: 0, daily_prices_2026_08_31: 0 }

function makeQuery(rows: Row[]) {
  const state = { rows: rows.slice(), rangeFrom: null as number | null, rangeTo: null as number | null, wantCount: false, dateFilter: null as string | null }
  const chain: any = {
    select(_c?: any, opts?: any) { if (opts && opts.count === 'exact' && opts.head) state.wantCount = true; return chain },
    eq(col: string, val: any)    { if (col === 'date') state.dateFilter = String(val); state.rows = state.rows.filter(r => r[col] === val); return chain },
    in(col: string, vals: any[]) { state.rows = state.rows.filter(r => vals.includes(r[col])); return chain },
    not(col: string, _op: string, val: any) { state.rows = state.rows.filter(r => r[col] !== val); return chain },
    gte(col: string, val: any)   { state.rows = state.rows.filter(r => r[col] != null && r[col] >= val); return chain },
    lte(col: string, val: any)   { state.rows = state.rows.filter(r => r[col] != null && r[col] <= val); return chain },
    lt(col: string, val: any)    { state.rows = state.rows.filter(r => r[col] != null && r[col] <  val); return chain },
    order()                       { return chain },
    limit()                       { return chain },
    range(from: number, to: number) { state.rangeFrom = from; state.rangeTo = to; return chain },
    then(resolve: (v: any) => any) {
      if (state.wantCount) {
        const key = `daily_prices_${state.dateFilter?.replace(/-/g, '_')}`
        const forced = key && counts[key] != null ? counts[key] : state.rows.length
        return Promise.resolve({ count: forced, data: null, error: null }).then(resolve)
      }
      let out = state.rows
      if (state.rangeFrom != null && state.rangeTo != null) out = out.slice(state.rangeFrom, state.rangeTo + 1)
      return Promise.resolve({ data: out, error: null }).then(resolve)
    },
  }
  return chain
}

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({ from(name: string) { return makeQuery(tables[name] ?? []) } }),
}))

import { runPopulationScarcityRecipe } from '../populationScarcity'
import { runMonthlyMarketReportRecipe } from '../monthlyMarketReport'

const TODAY = '2026-09-06'
const FRESH_POP = TODAY  // same day for the freshness tests where staleness must not fire

function pop(overrides: Row = {}): Row {
  return {
    set_name: 'Pokemon Base Set', card_number: '4', card_name: 'Charizard-Holo', variant: '',
    psa_9: 100, psa_10: 5, total_graded: 200, gem_rate: 2.5,
    scraped_date: FRESH_POP, psa_spec_id: 'spec-x',
    ...overrides,
  }
}
function reset() {
  for (const k of Object.keys(tables)) tables[k] = []
  for (const k of Object.keys(counts))  counts[k]  = 0
}
beforeEach(reset)

// ─────────────────────────────────────────────────────────────────
// 1. population = 0 + current PSA10 price > 0 → quarantined
// ─────────────────────────────────────────────────────────────────

describe('population scarcity — zero-pop-with-price contradiction', () => {
  it('quarantines a candidate with psa_10=0 and psa10_usd>0 and keeps it OUT of the ranking', async () => {
    // Enough clean rows to reach the CANDIDATE_MIN of 10 so the pack
    // is not blocked for insufficient-sample reasons.
    const clean = Array.from({ length: 12 }, (_, i) => pop({
      psa_spec_id: `clean-${i}`, card_number: String(100 + i), card_name: `Clean${i}-Holo`,
      psa_10: 3, total_graded: 150,
    }))
    const dirty = pop({
      psa_spec_id: 'dirty-1', card_number: '2',
      card_name: 'Dusknoir-Holo', set_name: 'Pokemon Diamond & Pearl',
      psa_10: 0, total_graded: 137,
    })
    tables.psa_population = [...clean, dirty]
    tables.cards = [
      ...clean.map((r, i) => ({ card_slug: `sc-${i}`, set_name: 'Base Set', card_number: String(100 + i), url_slug: `slug-${i}`, language: 'en' })),
      { card_slug: 'dusk-slug', set_name: 'Diamond & Pearl', card_number: '2', url_slug: 'dusknoir-2-diamond-pearl-2', language: 'en' },
    ]
    tables.card_latest_prices = [
      ...clean.map((_, i) => ({ card_slug: `pc-sc-${i}`, price_date: TODAY, raw_usd: 200, psa10_usd: 30000 })),
      { card_slug: 'pc-dusk-slug', price_date: TODAY, raw_usd: 399, psa10_usd: 1271107 },  // $12,711.07 PSA10
    ]

    const pack = await runPopulationScarcityRecipe(
      { id: 1, title: 'Scarcity study', angle: null, articleType: 'data_study', targetPublishAt: null },
      { today: TODAY },
    )
    const quarantinedIds = pack.quarantinedRows.map(q => q.id)
    expect(quarantinedIds.some(id => id.includes('dirty-1'))).toBe(true)

    const rankingRows = pack.dataTables[0].rows
    const dusknoirInRanking = rankingRows.some(r => r.cardName === 'Dusknoir-Holo')
    expect(dusknoirInRanking).toBe(false)
    // The clean rows are still in.
    expect(rankingRows.length).toBe(12)
  })
})

// ─────────────────────────────────────────────────────────────────
// 2. stale population snapshot must gate quality + framing rules
// ─────────────────────────────────────────────────────────────────

describe('population scarcity — stale-snapshot handling', () => {
  it('produces needs_review + required-caveat framing when population is > 60 days old', async () => {
    // 116-day-old snapshot (mirrors the live 2026-05-13 -> 2026-09-06 gap).
    const stalePop = Array.from({ length: 12 }, (_, i) => pop({
      psa_spec_id: `stale-${i}`, card_number: String(200 + i), card_name: `Stale${i}-Holo`,
      psa_10: 5, total_graded: 200,
      scraped_date: '2026-05-13',
    }))
    tables.psa_population = stalePop
    tables.cards = stalePop.map((_, i) => ({ card_slug: `st-${i}`, set_name: 'Base Set', card_number: String(200 + i), url_slug: `stale-slug-${i}`, language: 'en' }))
    tables.card_latest_prices = stalePop.map((_, i) => ({ card_slug: `pc-st-${i}`, price_date: TODAY, raw_usd: 200, psa10_usd: 30000 }))

    const pack = await runPopulationScarcityRecipe(
      { id: 2, title: 'Stale study', angle: null, articleType: 'data_study', targetPublishAt: null },
      { today: TODAY },
    )
    expect(pack.quality.status).toBe('needs_review')
    expect(pack.quality.freshness.isStale).toBe(true)
    // Reason string mentions the framing requirement.
    const reasonBlob = pack.quality.reasons.join(' ')
    expect(reasonBlob).toMatch(/PSA population as of/)
    // rejectedClaims forbids current-state wording.
    expect(pack.rejectedClaims.some(r => /Only <N> PSA 10 copies exist today/i.test(r.claim))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// 3. extreme monthly mover quarantine
// ─────────────────────────────────────────────────────────────────

describe('monthly market report — extreme-mover quarantine', () => {
  it('quarantines a +27,755% row and keeps it OUT of the top-mover table', async () => {
    const startDate = '2026-08-01'
    const endDate   = '2026-08-31'
    // Enough clean rows to clear MIN_INTERSECTION=20,000. Use one
    // fixture per intersection row; make endpoint counts pass the
    // MIN_ROWS_PER_ENDPOINT gate by forcing the count via `counts`.
    counts.daily_prices_2026_08_01 = 60_000
    counts.daily_prices_2026_08_31 = 60_000

    const start: Row[] = []
    const end:   Row[] = []
    for (let i = 0; i < 21_000; i++) {
      const slug = `pc-${100000 + i}`
      start.push({ card_slug: slug, date: startDate, raw_usd: 5000, psa10_usd: null, psa9_usd: null })
      end  .push({ card_slug: slug, date: endDate,   raw_usd: 5100, psa10_usd: null, psa9_usd: null })
    }
    // The suspicious mover.
    start.push({ card_slug: 'pc-extreme', date: startDate, raw_usd: 11070, psa10_usd: null, psa9_usd: null })
    end  .push({ card_slug: 'pc-extreme', date: endDate,   raw_usd: 3083563, psa10_usd: null, psa9_usd: null })  // 27,755%

    tables.daily_prices = [...start, ...end]
    tables.cards = [{ card_slug: 'extreme', card_name: 'Extreme Card', set_name: 'Fake Set', card_number: '1', url_slug: 'extreme-slug' }]

    const pack = await runMonthlyMarketReportRecipe(
      { id: 3, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const quarantined = pack.quarantinedRows
    expect(quarantined.some(q => q.rowSnapshot.cardSlug === 'pc-extreme')).toBe(true)
    const riserRows = pack.dataTables.find(t => t.id.startsWith('mover-risers'))!.rows
    expect(riserRows.some((r: any) => r.cardSlug === 'pc-extreme')).toBe(false)
    // Aggregate figures still available (unaffected by outlier).
    expect(pack.verifiedFacts.some(f => f.statement.includes('cards have a raw price on both dates'))).toBe(true)
  })
})
