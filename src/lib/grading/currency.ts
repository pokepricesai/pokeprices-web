// src/lib/grading/currency.ts
//
// Block 5A-W-52B.2 — FX helper with explicit rate provenance.
//
// The 52B.1 file exposed `USD_TO_GBP_RATE = 0.79` as if it were
// a live figure. It isn't — 0.79 is a manual multiplier that
// happens to match the smart-endpoint edge function's display
// convention. Production grading assumptions must not claim
// "current exchange rate" when a hard-coded constant is in use.
//
// This module now:
//   * exposes the fallback rate as `FALLBACK_USD_TO_GBP_RATE`
//     with explicit source metadata (`source: 'hardcoded_fallback'`);
//   * provides `convertCents(cents, from, to, rate?)` that
//     defaults to the fallback but accepts a live rate;
//   * documents that the grading analyzer must receive a
//     `UsdToGbpRateSource` in its input so the returned
//     assumptions can name the actual rate used.
//
// A future block should populate `UsdToGbpRateSource` from a
// real FX feed (Bank of England midpoint, OpenExchangeRates,
// etc.). For now the edge function passes the same fallback and
// the assumptions block labels it truthfully.

export type SupportedCurrency = 'USD' | 'GBP'

/**
 * A rate with provenance metadata. Included in the analyzer's
 * returned `assumptions` so audits can see whether a live rate
 * or the fallback was used.
 */
export interface UsdToGbpRateSource {
  /** Decimal rate — 0.79 means 1 USD = 0.79 GBP. */
  rate: number
  /**
   * Where the rate came from. `'hardcoded_fallback'` for the
   * current default; a future FX feed should use e.g.
   * `'bank_of_england_daily'` or `'openexchangerates_2026-08-07T12:00Z'`.
   */
  source: string
  /** ISO date the rate was captured / considered valid. */
  effectiveDate: string
}

/**
 * The pre-52B.2 hardcoded rate, retained as a labelled fallback.
 * Callers should pass a live rate when one is available.
 *
 * The rate value matches the smart-endpoint edge function's
 * `GBP_RATE` constant so browser + edge stay in sync until both
 * are migrated to a live feed.
 */
export const FALLBACK_USD_TO_GBP_RATE: UsdToGbpRateSource = {
  rate: 0.79,
  source: 'hardcoded_fallback',
  effectiveDate: '2026-08-07',
}

/**
 * Unit-test fixture rate. Numeric value identical to the
 * fallback so tests remain deterministic; the `source` field
 * makes it obvious the rate isn't live.
 */
export const TEST_USD_TO_GBP_RATE: UsdToGbpRateSource = {
  rate: 0.79,
  source: 'test_fixture',
  effectiveDate: '2026-08-07',
}

/**
 * Convert an integer-cent amount between currencies. When
 * `rate` is omitted the fallback rate is used and the caller
 * loses the ability to attribute the FX source in its outputs
 * — prefer passing an explicit `UsdToGbpRateSource`.
 */
export function convertCents(
  cents: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rate: UsdToGbpRateSource = FALLBACK_USD_TO_GBP_RATE,
): number {
  if (from === to) return cents
  if (from === 'USD' && to === 'GBP') return Math.round(cents * rate.rate)
  if (from === 'GBP' && to === 'USD') return Math.round(cents / rate.rate)
  throw new Error(`convertCents: unsupported ${from} → ${to}`)
}

/**
 * Convenience: USD cents → GBP pence with an explicit rate.
 * Returns null for null / non-positive input.
 */
export function usdCentsToGbpPence(
  cents: number | null | undefined,
  rate: UsdToGbpRateSource = FALLBACK_USD_TO_GBP_RATE,
): number | null {
  if (cents == null || cents <= 0) return null
  return convertCents(cents, 'USD', 'GBP', rate)
}
