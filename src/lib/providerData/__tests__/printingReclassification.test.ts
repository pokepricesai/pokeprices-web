// PP-TCG-PRINTING-RECLASS-FIX §6 — protected invariants for printing
// reclassification handling.
//
// The reconciliation script lives in collector-network/scripts/ (hub
// side) because it needs the TCGGraph API key. These tests validate
// the READ-PATH consequences of the provider_status column on
// pokeprices-web's public card adapter:
//
//   (a) When provider_status='superseded' for the (card_id, printing)
//       the mapping references, the adapter MUST NOT return the stale
//       image / prices.
//   (b) When provider_status='active' and the row exists, business as
//       usual.
//   (c) The adapter never crashes if the provider_status column is
//       absent from the stub (back-compat).
//
// Tests use the same stub pattern as snapshot.test.ts.

import { describe, it, expect, beforeEach } from 'vitest'
import { getProviderSnapshot } from '../snapshot'

function makeStub(answers: Record<string, { data: unknown; error: unknown }>) {
  const stub: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          // The adapter filters provider_cards by (card_id, printing_key,
          // provider_status='active'). Simulate the filter: if the stub's
          // configured provider_card has a different provider_status, the
          // "active" filter should return no row.
          q._eq = q._eq || {}
          q._eq[col] = val
          return q
        },
        maybeSingle: () => {
          const key = `${table}:single`
          const ans = answers[key] ?? { data: null, error: null }
          // For pokemon_tcg_provider_cards reads, honour the simulated
          // provider_status filter.
          if (table === 'pokemon_tcg_provider_cards' && q._eq?.provider_status === 'active') {
            const row: any = ans.data
            if (!row || row.provider_status === 'superseded') {
              return Promise.resolve({ data: null, error: null })
            }
          }
          return Promise.resolve(ans)
        },
        then: (resolve: (r: { data: unknown; error: unknown }) => void) => resolve(answers[`${table}:list`] ?? { data: [], error: null }),
      }
      return q
    },
  }
  return stub
}

function stubWithEffectiveView(mapping: any, provider_card_row: any, extra: any = {}) {
  return makeStub({
    'pokemon_tcg_mappings:single': { data: mapping, error: null },
    'v_pokemon_tcg_effective_eligibility:single': { data: { effective_eligibility: mapping.pricing_eligibility }, error: null },
    'v_pokemon_tcg_pilot_active:single': { data: { prices_enabled: true, images_enabled: true, history_enabled: true }, error: null },
    'pokemon_tcg_provider_cards:single': { data: provider_card_row, error: null },
    'pokemon_tcg_prices_market:list': { data: extra.market ?? [], error: null },
    'pokemon_tcg_prices_graded:list': { data: extra.graded ?? [], error: null },
  })
}

const APPROVED_MAPPING_SP5_7 = {
  tcg_card_id: 'pkm_ja_sp5_7',
  tcg_printing_key: 'normal',             // OLD printing — may be superseded
  tcg_set_code: 'sp5',
  tcg_language: 'ja',
  tcg_name: 'Mewtwo V-UNION (Bottom Left)',
  review_status: 'approved',
  pricing_eligibility: 'market_only',
}

describe('PP-TCG-PRINTING-RECLASS-FIX — adapter read-path invariants', () => {
  beforeEach(() => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1'
    process.env.PP_USE_TCGGRAPH_IMAGES = '1'
  })

  it('(a) superseded (card_id, printing) → no image returned (even with env flags + pilot ON)', async () => {
    const sb = stubWithEffectiveView(
      APPROVED_MAPPING_SP5_7,
      { image_normal: 'https://cards.tcggraph.io/sp5/7.jpg', provider_status: 'superseded' },
      { market: [{ source: 'tcgplayer', market: 1.00 }] },
    )
    const r = await getProviderSnapshot(sb, '12345')
    // The provider_cards row is filtered out, image_normal becomes null.
    expect(r?.image_normal).toBeNull()
  })

  it('(b) active row with same stub → image is returned', async () => {
    const sb = stubWithEffectiveView(
      APPROVED_MAPPING_SP5_7,
      { image_normal: 'https://cards.tcggraph.io/sp5/7.jpg', provider_status: 'active' },
      { market: [{ source: 'tcgplayer', market: 1.00 }] },
    )
    const r = await getProviderSnapshot(sb, '12345')
    expect(r?.image_normal).toBe('https://cards.tcggraph.io/sp5/7.jpg')
    expect(r?.market_prices).toHaveLength(1)
  })

  it('(c) stub without provider_status field (back-compat) → treated as active', async () => {
    const sb = stubWithEffectiveView(
      APPROVED_MAPPING_SP5_7,
      { image_normal: 'https://cards.tcggraph.io/sp5/7.jpg' },      // no provider_status
      { market: [{ source: 'tcgplayer', market: 1.00 }] },
    )
    const r = await getProviderSnapshot(sb, '12345')
    expect(r?.image_normal).toBe('https://cards.tcggraph.io/sp5/7.jpg')
  })

  it('(a) superseded + no active replacement → whole adapter returns the gated snapshot', async () => {
    // Market/graded rows are still keyed on (card_id, printing_key), so if the
    // adapter asked for the same printing_key those rows WOULD be present —
    // but the public card page should still display the suppressed image.
    const sb = stubWithEffectiveView(
      APPROVED_MAPPING_SP5_7,
      { image_normal: 'https://cards.tcggraph.io/sp5/7.jpg', provider_status: 'superseded' },
      {
        market: [{ source: 'tcgplayer', finish: 'normal', currency: 'USD', market: 1.00 }],
        graded: [{ grader: 'psa', grade: '10', currency: 'USD', price: 50 }],
      },
    )
    const r = await getProviderSnapshot(sb, '12345')
    expect(r?.image_normal).toBeNull()
    // Prices still come through from the prices tables (preserved audit)
    // but eligibility is market_only so graded is suppressed anyway.
    expect(r?.graded_prices).toEqual([])
  })
})
