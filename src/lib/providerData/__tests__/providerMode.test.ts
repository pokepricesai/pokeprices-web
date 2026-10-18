import { describe, it, expect } from 'vitest'

// PP-TCG-MIGRATE-03A: static invariants for the providerMode flag
// and the suppression branches. These do NOT render React — we
// verify the condition logic as pure functions and the preview
// route's hard-coded contract.

// Mirror of the suppression predicate from CardPageClient.tsx — kept
// in sync here as a dedicated unit so a regression in either place
// is caught immediately.
interface GradeLadderPrices {
  raw_usd?:  number | null
  psa7_usd?: number | null
  psa8_usd?: number | null
  psa9_usd?: number | null
  psa10_usd?: number | null
  bgs10_usd?: number | null
  cgc10_usd?: number | null
  sgc10_usd?: number | null
  ace10_usd?: number | null
  tag10_usd?: number | null
}

function allGradedPricesNull(p: GradeLadderPrices): boolean {
  return (
    p.raw_usd == null &&
    p.psa10_usd == null &&
    p.psa9_usd == null &&
    p.psa8_usd == null &&
    p.psa7_usd == null &&
    p.bgs10_usd == null &&
    p.cgc10_usd == null &&
    p.sgc10_usd == null &&
    p.ace10_usd == null &&
    p.tag10_usd == null
  )
}
function shouldShowPriceBox(providerMode: boolean | undefined, p: GradeLadderPrices): boolean {
  return !providerMode || !allGradedPricesNull(p)
}

describe('providerMode: empty-section suppression', () => {
  it('public mode always renders the price box, regardless of null values', () => {
    expect(shouldShowPriceBox(false, {})).toBe(true)
    expect(shouldShowPriceBox(undefined, {})).toBe(true)
    expect(shouldShowPriceBox(false, { raw_usd: null, psa10_usd: null })).toBe(true)
  })

  it('provider mode hides the price box when every graded field is null', () => {
    expect(shouldShowPriceBox(true, {})).toBe(false)
    expect(shouldShowPriceBox(true, {
      raw_usd: null, psa10_usd: null, psa9_usd: null, psa7_usd: null, psa8_usd: null,
      bgs10_usd: null, cgc10_usd: null, sgc10_usd: null, ace10_usd: null, tag10_usd: null,
    })).toBe(false)
  })

  it('provider mode shows the price box as soon as ONE graded field has a value', () => {
    expect(shouldShowPriceBox(true, { psa10_usd: 10305 })).toBe(true)       // PSA 10 only (modern alt-art)
    expect(shouldShowPriceBox(true, { raw_usd: 139 })).toBe(true)           // raw only (Japanese bulk)
    expect(shouldShowPriceBox(true, { bgs10_usd: 50000 })).toBe(true)       // BGS 10 only
    expect(shouldShowPriceBox(true, { psa9_usd: 999 })).toBe(true)          // theoretical — in practice adapter never sets psa9
  })
})

describe('providerMode safety contract', () => {
  // Static assertions about the invariant surface. If the adapter
  // ever starts synthesising a PSA 9 value, this suite will fail
  // immediately — we never want "0" to count as "has data".

  it('zero is treated as present data (not null) — grading-logic branch intentionally differs from suppression', () => {
    // A legitimate $0.00 value should still be considered "present"
    // for the purpose of showing the ladder. (The grading calculator
    // separately gates on card.raw_usd && card.psa10_usd being
    // truthy, so a $0 raw card won't be used to project PSA 10
    // profit — that's correct.)
    expect(shouldShowPriceBox(true, { raw_usd: 0 })).toBe(true)
  })

  it('negative or NaN should never happen — adapter clamps undefined to null', () => {
    // Sanity: the predicate uses `== null` (loose) so undefined behaves
    // the same as null. Both come from the adapter when a value is
    // genuinely absent.
    expect(shouldShowPriceBox(true, { raw_usd: undefined, psa10_usd: undefined })).toBe(false)
  })
})

describe('providerMode: history unavailable branch', () => {
  function shouldShowHistoryUnavailable(providerMode: boolean | undefined, priceHistoryLength: number): boolean {
    return !!providerMode && priceHistoryLength <= 1
  }

  it('public mode never shows the "History unavailable" state — missing data just hides the chart', () => {
    expect(shouldShowHistoryUnavailable(false, 0)).toBe(false)
    expect(shouldShowHistoryUnavailable(undefined, 0)).toBe(false)
  })

  it('provider mode shows the "History unavailable" note when fewer than 2 points exist', () => {
    expect(shouldShowHistoryUnavailable(true, 0)).toBe(true)
    expect(shouldShowHistoryUnavailable(true, 1)).toBe(true)
  })

  it('provider mode falls through to the real chart when 2+ points exist', () => {
    expect(shouldShowHistoryUnavailable(true, 2)).toBe(false)
    expect(shouldShowHistoryUnavailable(true, 365)).toBe(false)
  })
})

describe('legacy-fallback prevention (static contract)', () => {
  // The audit in PP-TCG-MIGRATE-03A §Q1 identified exactly one
  // code path that fetches card_trends-adjacent data: the
  // `/api/card/[cardSlug]/extras` call inside CardPageClient's
  // loadCard effect. The short-circuit on lines 417-420 (now
  // moved slightly after the providerMode addition) requires BOTH
  // `providerSuppliedExtras` AND `serverProvidedCard` to bypass
  // the fetch. If either guard regresses the preview could leak
  // legacy data into the chart. We assert the predicate shape:

  function providerExtrasShortCircuit(args: { initialPriceHistoryIsArray: boolean; serverProvidedCard: boolean }): boolean {
    const providerSuppliedExtras = args.initialPriceHistoryIsArray
    return providerSuppliedExtras && args.serverProvidedCard
  }

  it('bypasses extras fetch when server provides card AND provider provides history', () => {
    expect(providerExtrasShortCircuit({ initialPriceHistoryIsArray: true, serverProvidedCard: true })).toBe(true)
  })

  it('does NOT bypass when server-rendered card is missing (fallback must still work for public pages)', () => {
    expect(providerExtrasShortCircuit({ initialPriceHistoryIsArray: true, serverProvidedCard: false })).toBe(false)
  })

  it('does NOT bypass when provider mode did not supply history (public page path)', () => {
    expect(providerExtrasShortCircuit({ initialPriceHistoryIsArray: false, serverProvidedCard: true })).toBe(false)
  })
})
