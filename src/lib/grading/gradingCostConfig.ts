// src/lib/grading/gradingCostConfig.ts
//
// Block 5A-W-52B.1 — ancillary (non-grading-fee, non-selling-fee)
// cost defaults.
//
// The 52B version of this file bundled EVERY cost into one
// GradingCostConfig — grading fee, shipping, marketplace fee,
// payment fee. 52B.1 splits those concerns:
//
//   * Grading fee            → GradingServiceProfile (per-tier)
//     in ./gradingServiceProfiles.ts
//   * Marketplace / payment  → SellingProfile (per-marketplace)
//     in ./sellingProfiles.ts
//   * Shipping / insurance / supplies  → this file (mostly
//     stable across services within a country)
//
// The analyzer composes the three at call time, so a UK collector
// with a private-seller eBay account can be modeled without any
// double-counted or invented fees.

export type AncillaryCurrency = 'GBP' | 'USD'

export interface AncillaryCostConfig {
  /** All amounts are integer cents / pence in `currency`. */
  outboundShipping: number
  returnShipping: number
  insurance: number
  otherCosts: number
  currency: AncillaryCurrency
  effectiveDate: string
  sourceNote: string
}

/**
 * Typical UK ancillaries for a small (1-5 card) PSA submission
 * booked through a UK-based dealer/aggregator or shipped directly
 * to PSA International. Numbers are per-card and integer pence.
 */
export const UK_ANCILLARY_COSTS_GBP: AncillaryCostConfig = {
  // Ship to PSA (UK aggregator or direct international) — typical
  // £15-20 tracked bundle for ~5 cards.
  outboundShipping: 400,
  // Return shipping — PSA charges tracked/insured based on
  // declared value; ~£6/card at the low end.
  returnShipping: 600,
  // Insurance — approximately 1% of a mid-market card (~£200-500).
  insurance: 300,
  // Sleeves, semi-rigids, submission form, PSA card sleeve.
  otherCosts: 100,
  currency: 'GBP',
  effectiveDate: '2026-08-07',
  sourceNote:
    'Typical UK ancillary costs for a small PSA submission. ' +
    'Users with a UK aggregator relationship (Ludkins, GetGraded, ' +
    'CGA, etc.) will see different figures — supply overrides via ' +
    'the analyzer input when known.',
}
