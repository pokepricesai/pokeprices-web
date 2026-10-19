// PP-TCG-CUTOVER-PREP-02 §4 — protected test coverage for the four
// pilot-cohort × eligibility combinations.
//
// We DO NOT connect to live Supabase. The stub returns pre-canned
// responses that mirror the shape the production tables produce for
// representative pilot slugs. Expectations encode the adapter's
// invariants under each gate configuration.
//
// Invariants under test:
//   (A) bulk_safe + normal printing + pilot ON → graded + market both
//       returned (ONLY when env flag is ON).
//   (B) market_only + variant printing + pilot ON → market returned,
//       GRADED SUPPRESSED (never leak aggregate graded onto a variant).
//   (C) bulk_safe + normal + pilot OFF → everything suppressed, flag
//       on or off.
//   (D) market_only + pilot ON + env flag OFF → everything suppressed.

import { describe, it, expect, beforeEach } from 'vitest'
import { getProviderSnapshot } from '../snapshot'

type StubAnswer = { data: unknown; error: unknown }

function makeStub(answers: Record<string, StubAnswer>) {
  const stub: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve(answers[`${table}:single`] ?? { data: null, error: null }),
        then: (resolve: (r: StubAnswer) => void) => resolve(answers[`${table}:list`] ?? { data: [], error: null }),
      }
      return q
    },
  }
  return stub
}

// Mirror of the four fixtures: name-only identifiers for readability.
const PILOT_NORMAL_BULK_SAFE_MAPPING = {
  tcg_card_id: 'pkm_tot23_89',
  tcg_printing_key: 'normal',
  tcg_set_code: 'tot23',
  tcg_language: 'en',
  tcg_name: 'Sinistea',
  review_status: 'approved',
  pricing_eligibility: 'bulk_safe',
}

const PILOT_FOIL_BULK_SAFE_MAPPING = {
  tcg_card_id: 'pkm_rsv10pt5_30',
  tcg_printing_key: 'foil',
  tcg_set_code: 'rsv10pt5',
  tcg_language: 'en',
  tcg_name: 'Keldeo ex',
  review_status: 'approved',
  pricing_eligibility: 'bulk_safe',
}

// Not currently in the pilot (all 18 picks are bulk_safe) but the
// adapter must behave correctly if an operator adds a market_only
// slug to the cohort later. These invariants protect that path.
const HYPOTHETICAL_MARKET_ONLY_MAPPING = {
  tcg_card_id: 'pkm_base3_16',
  tcg_printing_key: '1st-edition',
  tcg_set_code: 'base3',
  tcg_language: 'en',
  tcg_name: 'Aerodactyl',
  review_status: 'approved',
  pricing_eligibility: 'market_only',
}

describe('PP-TCG pilot cohort — bulk_safe normal printing (fixture: Sinistea #89)', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES
    delete process.env.PP_USE_TCGGRAPH_IMAGES
  })

  it('(A) env flag ON + pilot ON (prices+images) → graded + market both returned', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1'
    process.env.PP_USE_TCGGRAPH_IMAGES = '1'
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PILOT_NORMAL_BULK_SAFE_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'bulk_safe' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: true, history_enabled: true }, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/tot23/89.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [
        { source: 'tcgplayer', finish: 'normal', list_type: 'retail', currency: 'USD', market: 0.42, low: 0.25, trend: 0.44, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
      'pokemon_tcg_prices_graded:list': { data: [
        { grader: 'psa', grade: '10', currency: 'USD', price: 65.00, sales_volume: 4, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
    })
    const r = await getProviderSnapshot(sb, '5732721')
    expect(r?.market_prices).toHaveLength(1)
    expect(r?.graded_prices).toHaveLength(1)
    expect(r?.graded_prices[0]!.grade).toBe('10')
    expect(r?.image_normal).toContain('cards.tcggraph.io')
  })

  it('(C.1) env flag ON + pilot OFF → everything blocked (allowlist wins)', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1'
    process.env.PP_USE_TCGGRAPH_IMAGES = '1'
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PILOT_NORMAL_BULK_SAFE_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'bulk_safe' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: null, error: null },         // not in pilot
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/tot23/89.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 0.42 }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 65.00 }], error: null },
    })
    const r = await getProviderSnapshot(sb, '5732721')
    expect(r?.market_prices).toEqual([])
    expect(r?.graded_prices).toEqual([])
    expect(r?.image_normal).toBeNull()
  })

  it('(C.2) env flag OFF + pilot ON → everything blocked (flag wins)', async () => {
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PILOT_NORMAL_BULK_SAFE_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'bulk_safe' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: true, history_enabled: true }, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/tot23/89.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 0.42 }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 65.00 }], error: null },
    })
    const r = await getProviderSnapshot(sb, '5732721')
    expect(r?.market_prices).toEqual([])
    expect(r?.graded_prices).toEqual([])
    expect(r?.image_normal).toBeNull()
  })
})

describe('PP-TCG pilot cohort — bulk_safe foil printing (fixture: Keldeo ex #30)', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES
    delete process.env.PP_USE_TCGGRAPH_IMAGES
  })

  it('bulk_safe foil + pilot ON + flag ON → graded + market both returned', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1'
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PILOT_FOIL_BULK_SAFE_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'bulk_safe' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: false, history_enabled: false }, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/rsv10pt5/30.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [
        { source: 'tcgplayer', finish: 'holofoil', currency: 'USD', market: 5.99, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
      'pokemon_tcg_prices_graded:list': { data: [
        { grader: 'psa', grade: '10', currency: 'USD', price: 42, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
    })
    const r = await getProviderSnapshot(sb, '6903541')
    expect(r?.market_prices).toHaveLength(1)
    expect(r?.graded_prices).toHaveLength(1)
    // images_enabled was false even though PP_USE_TCGGRAPH_IMAGES isn't set
    expect(r?.image_normal).toBeNull()
  })
})

describe('PP-TCG pilot cohort — market_only variant printing (hypothetical: Aerodactyl 1st Ed #16)', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES
    delete process.env.PP_USE_TCGGRAPH_IMAGES
  })

  it('(B) market_only + 1st-edition + pilot prices ON + flag ON → market only, graded SUPPRESSED', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1'
    process.env.PP_USE_TCGGRAPH_IMAGES = '1'
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: HYPOTHETICAL_MARKET_ONLY_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'market_only' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: true, history_enabled: false }, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/base3/16.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [
        { source: 'cardmarket', finish: '1st-edition', currency: 'EUR', market: 240, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
      // Graded data IS present in the DB (card-level) but the adapter MUST
      // not expose it on a variant printing — the aggregate pools 1st Ed +
      // normal + shadowless. Protected invariant.
      'pokemon_tcg_prices_graded:list': { data: [
        { grader: 'psa', grade: '10', currency: 'USD', price: 1500, source_updated_at: '2026-10-19T04:00:00Z' },
      ], error: null },
    })
    const r = await getProviderSnapshot(sb, '715593')
    expect(r?.market_prices).toHaveLength(1)
    expect(r?.graded_prices).toEqual([])    // THE INVARIANT
    expect(r?.image_normal).toContain('cards.tcggraph.io')
    expect(r?.pricing_eligibility).toBe('market_only')
  })

  it('(D) market_only + pilot prices ON + env flag OFF → everything blocked', async () => {
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: HYPOTHETICAL_MARKET_ONLY_MAPPING, error: null },
      'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: 'market_only' }, error: null },
      'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: true, history_enabled: true }, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'https://cards.tcggraph.io/base3/16.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'cardmarket', market: 240 }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 1500 }], error: null },
    })
    const r = await getProviderSnapshot(sb, '715593')
    expect(r?.market_prices).toEqual([])
    expect(r?.graded_prices).toEqual([])
    expect(r?.image_normal).toBeNull()
  })
})
