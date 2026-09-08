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

describe('monthly market report — Final Data Trust methodology', () => {
  const START_DAYS = ['2026-07-31', '2026-08-01', '2026-08-02']
  const END_DAYS   = ['2026-08-30', '2026-08-31', '2026-09-02']
  const POST_DAYS  = ['2026-09-03', '2026-09-04', '2026-09-05']   // persistence window

  function seedFullSnapshotCounts() {
    for (const d of [...START_DAYS, ...END_DAYS, ...POST_DAYS]) counts[`daily_prices_${d.replace(/-/g, '_')}`] = 60_000
  }
  function makeCleanCards(n: number, startCents: number, endCents: number, opts: { includePost?: boolean } = { includePost: true }) {
    const rows: Row[] = []
    const meta: Row[] = []
    for (let i = 0; i < n; i++) {
      const slug = `pc-${100000 + i}`
      for (const d of START_DAYS) rows.push({ card_slug: slug, date: d, raw_usd: startCents })
      for (const d of END_DAYS)   rows.push({ card_slug: slug, date: d, raw_usd: endCents })
      if (opts.includePost !== false) for (const d of POST_DAYS) rows.push({ card_slug: slug, date: d, raw_usd: endCents })
      meta.push({ card_slug: `${100000 + i}`, card_name: `Clean${i}`, set_name: 'Aquapolis', card_number: String(i), url_slug: `clean-${i}`, is_sealed: false, language: 'en' })
    }
    return { rows, meta }
  }
  function addCard(cardsRows: Row[], slug: string, name: string, setName: string, extras: Partial<Row> = {}) {
    cardsRows.push({ card_slug: slug.replace(/^pc-/, ''), card_name: name, set_name: setName, card_number: '1', url_slug: name.toLowerCase(), is_sealed: false, language: 'en', ...extras })
  }
  function addObs(rows: Row[], slug: string, days: string[], cents: number) {
    for (const d of days) rows.push({ card_slug: slug, date: d, raw_usd: cents })
  }

  it('excludes a card whose ONE bad endpoint day would otherwise create a 5× move', async () => {
    seedFullSnapshotCounts()
    const { rows: clean, meta } = makeCleanCards(1_500, 5000, 5100)
    const shaky = 'pc-shaky-end'
    addObs(clean, shaky, START_DAYS, 500)
    clean.push({ card_slug: shaky, date: END_DAYS[0], raw_usd: 500 })
    clean.push({ card_slug: shaky, date: END_DAYS[1], raw_usd: 500 })
    clean.push({ card_slug: shaky, date: END_DAYS[2], raw_usd: 10_000 })
    addObs(clean, shaky, POST_DAYS, 500)
    addCard(meta, shaky, 'ShakyEnd', 'Base Set')
    tables.daily_prices = clean
    tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 3, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    // The important guarantee: a card whose endpoint wobbles this
    // hard NEVER appears in ANY publishable mover ranking. It may or
    // may not appear under Quarantined Data (extreme wobbles are
    // filtered at the aggregate stage before the mover candidate
    // pool even considers them).
    for (const t of pack.dataTables) {
      expect(t.rows.some((r: any) => r.cardSlug === shaky)).toBe(false)
    }
  })

  it('excludes a stable +500% move (outside editorial band) from publishable rankings', async () => {
    seedFullSnapshotCounts()
    const { rows: clean, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(clean, 'pc-huge-rise', START_DAYS, 1000)
    addObs(clean, 'pc-huge-rise', END_DAYS,   6000)
    addObs(clean, 'pc-huge-rise', POST_DAYS,  6000)
    addCard(meta, 'pc-huge-rise', 'HugeRise', 'Base Set')
    tables.daily_prices = clean; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 4, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const riserRows = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    expect(riserRows.some((r: any) => r.cardSlug === 'pc-huge-rise')).toBe(false)
    expect(pack.quarantinedRows.some(q => q.rowSnapshot.cardSlug === 'pc-huge-rise')).toBe(true)
  })

  it('routes a +100% mover to the manual-review table, NOT the auto-publish table', async () => {
    seedFullSnapshotCounts()
    const { rows: clean, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(clean, 'pc-big-rise', START_DAYS, 1000)
    addObs(clean, 'pc-big-rise', END_DAYS,   2000)   // +100% (>75% auto ceiling)
    addObs(clean, 'pc-big-rise', POST_DAYS,  2000)   // persistent
    addCard(meta, 'pc-big-rise', 'BigRise', 'Base Set')
    tables.daily_prices = clean; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 41, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const risers = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    const review = pack.dataTables.find(t => t.id.startsWith('mover-review-risers-'))!.rows
    expect(risers.some((r: any) => r.cardSlug === 'pc-big-rise')).toBe(false)
    expect(review.some((r: any) => r.cardSlug === 'pc-big-rise')).toBe(true)
  })

  it('excludes a card that fails the persistence check even inside the auto band', async () => {
    seedFullSnapshotCounts()
    const { rows: clean, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(clean, 'pc-spike', START_DAYS, 1000)
    addObs(clean, 'pc-spike', END_DAYS,   1600)  // +60% at end
    addObs(clean, 'pc-spike', POST_DAYS,  1000)  // snaps back to start
    addCard(meta, 'pc-spike', 'Spike', 'Base Set')
    tables.daily_prices = clean; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 42, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const risers = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    expect(risers.some((r: any) => r.cardSlug === 'pc-spike')).toBe(false)
    expect(pack.quarantinedRows.some(q => q.rowSnapshot.cardSlug === 'pc-spike')).toBe(true)
  })

  it('excludes sealed products (is_sealed=true) from the mover rankings', async () => {
    seedFullSnapshotCounts()
    const { rows, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(rows, 'pc-sealed', START_DAYS, 1000)
    addObs(rows, 'pc-sealed', END_DAYS,   1500)  // +50%
    addObs(rows, 'pc-sealed', POST_DAYS,  1500)
    addCard(meta, 'pc-sealed', 'Booster Pack', 'Japanese Set', { is_sealed: true })
    tables.daily_prices = rows; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 43, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const risers = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    expect(risers.some((r: any) => r.cardSlug === 'pc-sealed')).toBe(false)
    // sealed exclusions are silent (they don't need to show under quarantine — they aren't anomalies)
  })

  it('excludes non-English cards from the default mover rankings', async () => {
    seedFullSnapshotCounts()
    const { rows, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(rows, 'pc-jp', START_DAYS, 2000)
    addObs(rows, 'pc-jp', END_DAYS,   3400)  // +70%
    addObs(rows, 'pc-jp', POST_DAYS,  3400)
    addCard(meta, 'pc-jp', 'Charizard JP', 'Japanese Split Earth', { language: 'jp' })
    tables.daily_prices = rows; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 44, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const risers = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    expect(risers.some((r: any) => r.cardSlug === 'pc-jp')).toBe(false)
  })

  it('excludes Topps sets from mover rankings', async () => {
    seedFullSnapshotCounts()
    const { rows, meta } = makeCleanCards(1_500, 5000, 5100)
    addObs(rows, 'pc-topps', START_DAYS, 3000)
    addObs(rows, 'pc-topps', END_DAYS,   4500)  // +50%
    addObs(rows, 'pc-topps', POST_DAYS,  4500)
    addCard(meta, 'pc-topps', 'Omastar', '2000 Topps Chrome')
    tables.daily_prices = rows; tables.cards = meta

    const pack = await runMonthlyMarketReportRecipe(
      { id: 45, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    const risers = pack.dataTables.find(t => t.id.startsWith('mover-risers-'))!.rows
    expect(risers.some((r: any) => r.cardSlug === 'pc-topps')).toBe(false)
  })

  it('classifies a near-zero market as marketSignalStrength=weak', async () => {
    seedFullSnapshotCounts()
    const { rows, meta } = makeCleanCards(1_500, 5000, 5000)
    tables.daily_prices = rows; tables.cards = meta
    const pack = await runMonthlyMarketReportRecipe(
      { id: 6, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null },
      { today: '2026-09-06' },
    )
    expect(pack.marketSignalStrength).toBe('weak')
    expect(pack.rejectedClaims.some(r => /big story|major shift/i.test(r.claim))).toBe(true)
  })
})
