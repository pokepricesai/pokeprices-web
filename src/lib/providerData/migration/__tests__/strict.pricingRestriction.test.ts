// PP-TCG — pricing_restriction acceptance tests.
//
// `pricing_restriction` means identity is verified but the TCG card has
// multiple printings (reverse-holo / pokemon-center / prize-pack
// siblings). The TCGGraph graded_prices feed has no printing dimension,
// so graded aggregates would be contaminated.
//
// Safe migration rule: accept pricing_restriction ONLY when
// effective_eligibility=market_only (adapter suppresses graded surface).
// The v_pokemon_tcg_effective_eligibility view guarantees market_only
// under pricing_restriction via its "most restrictive of (matcher, QA)"
// rank function. These tests pin the belt-and-braces check in TS.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { strictRecheckOne } from '../strict'

const PASS_ROW = {
  pp_card_slug: 'x', pp_card_name: 'X', pp_set_name: 'Set', pp_language: 'en',
  outcome: 'approved_active',
  risk_class: 'catalogue_corroborated',
  confidence: 'verified',
  review_status: 'approved',
  printing_active_status: 'active',
  has_image: true,
  has_market_prices: true,
  has_graded_prices: true,
  effective_eligibility: 'bulk_safe',
  gsc_rank: 1,
}

function makeStubReturning(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as unknown as never
}

describe('strictRecheckOne — risk_class gate', () => {
  it('accepts catalogue_corroborated + bulk_safe + graded', async () => {
    const r = await strictRecheckOne(makeStubReturning({ ...PASS_ROW }), 'x')
    expect(r.ok).toBe(true)
  })

  it('accepts catalogue_corroborated + market_only (no graded needed)', async () => {
    const r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW, effective_eligibility: 'market_only', has_graded_prices: false,
    }), 'x')
    expect(r.ok).toBe(true)
  })

  it('rejects catalogue_corroborated + bulk_safe when graded missing', async () => {
    const r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW, has_graded_prices: false,
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('bulk_safe_without_graded')
  })

  it('accepts pricing_restriction + market_only (new rule)', async () => {
    const r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'market_only',
      has_graded_prices: false,  // irrelevant for market_only
    }), 'x')
    expect(r.ok).toBe(true)
  })

  it('rejects pricing_restriction + bulk_safe (unsafe — would show contaminated graded)', async () => {
    const r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'bulk_safe',
      has_graded_prices: true,
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('pricing_restriction_without_market_only')
  })

  it('rejects every other risk_class value', async () => {
    for (const rc of ['ambiguous_variant', 'conflicting_identity', 'unverifiable', 'internally_consistent', 'verified_independent']) {
      const r = await strictRecheckOne(makeStubReturning({ ...PASS_ROW, risk_class: rc }), 'x')
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toBe(`risk=${rc}`)
    }
  })

  it('still enforces the other identity gates even under pricing_restriction', async () => {
    // review_status must be approved
    let r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'market_only',
      review_status: 'pending_review',
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('review=pending_review')

    // printing_active_status must be active
    r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'market_only',
      printing_active_status: 'superseded',
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('printing=superseded')

    // market prices must exist
    r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'market_only',
      has_market_prices: false,
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('no_market')

    // image must exist
    r = await strictRecheckOne(makeStubReturning({
      ...PASS_ROW,
      risk_class: 'pricing_restriction',
      effective_eligibility: 'market_only',
      has_image: false,
    }), 'x')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('no_image')
  })
})
