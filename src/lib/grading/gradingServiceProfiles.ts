// src/lib/grading/gradingServiceProfiles.ts
//
// Block 5A-W-52B.2 — corrected verified PSA direct-submission
// service profiles.
//
// The pre-52B.2 numbers were wrong: Regular was set to $50/$499,
// Express $75/$999, Super Express $150/$1,499. Those were guessed
// figures. This file now carries PSA's published direct-submission
// schedule as of Aug 2026, with each fee/cap sourced from the
// official PSA services page and every profile carrying a
// sourceUrl for future audit.
//
// This module is DATA, not logic. Grading arithmetic lives in
// gradingAnalysis.ts. When PSA revises rates, update the fields
// below + bump `effectiveDate` and re-run:
//   npx vitest run src/lib/grading

export type SubmissionMethod = 'direct' | 'dealer'
export type GradingFeeCurrency = 'USD' | 'GBP'

export interface GradingServiceProfile {
  /** Stable identifier for logging + selection. */
  id: string
  company: 'PSA'
  serviceName: string
  submissionMethod: SubmissionMethod
  /** Fee per card in the service's native currency, integer cents. */
  gradingFee: number
  feeCurrency: GradingFeeCurrency
  /** Max declared/insured value the tier accepts, native cents. Null = no cap. */
  maxInsuredValue: number | null
  turnaroundNote: string | null
  /** True when the service is currently accepting new submissions. */
  available: boolean
  effectiveDate: string
  sourceNote: string
  /** Official PSA page or announcement that documents these values. */
  sourceUrl: string
}

// ── PSA direct-entry tiers (native USD) ────────────────
//
// Fee amounts and value caps are the verified official PSA
// published rates. Do NOT edit without a corresponding sourceUrl
// bump and effectiveDate refresh.

/**
 * PSA Regular — verified direct-entry tier, Aug 2026.
 * $79.99/card, max declared value $1,500.
 */
export const PSA_REGULAR_DIRECT: GradingServiceProfile = {
  id: 'psa_regular_direct',
  company: 'PSA',
  serviceName: 'PSA Regular (Direct)',
  submissionMethod: 'direct',
  gradingFee: 7999,          // $79.99 USD
  feeCurrency: 'USD',
  maxInsuredValue: 150000,   // $1,500.00 USD
  turnaroundNote: 'PSA Regular estimated turnaround per current PSA services page.',
  available: true,
  effectiveDate: '2026-08-07',
  sourceNote:
    'Verified against PSA\'s official direct-submission services page (Aug 2026). ' +
    'PSA revises pricing periodically — re-verify at time of submission.',
  sourceUrl: 'https://www.psacard.com/services/tcggrading',
}

/**
 * PSA Express — verified direct-entry tier, Aug 2026.
 * $149/card, max declared value $2,500.
 */
export const PSA_EXPRESS_DIRECT: GradingServiceProfile = {
  id: 'psa_express_direct',
  company: 'PSA',
  serviceName: 'PSA Express (Direct)',
  submissionMethod: 'direct',
  gradingFee: 14900,         // $149.00 USD
  feeCurrency: 'USD',
  maxInsuredValue: 250000,   // $2,500.00 USD
  turnaroundNote: 'PSA Express estimated turnaround per current PSA services page.',
  available: true,
  effectiveDate: '2026-08-07',
  sourceNote:
    'Verified against PSA\'s official direct-submission services page (Aug 2026).',
  sourceUrl: 'https://www.psacard.com/services/tcggrading',
}

/**
 * PSA Super Express — verified direct-entry tier, Aug 2026.
 * $349/card, max declared value $5,000.
 */
export const PSA_SUPER_EXPRESS_DIRECT: GradingServiceProfile = {
  id: 'psa_super_express_direct',
  company: 'PSA',
  serviceName: 'PSA Super Express (Direct)',
  submissionMethod: 'direct',
  gradingFee: 34900,         // $349.00 USD
  feeCurrency: 'USD',
  maxInsuredValue: 500000,   // $5,000.00 USD
  turnaroundNote: 'PSA Super Express estimated turnaround per current PSA services page.',
  available: true,
  effectiveDate: '2026-08-07',
  sourceNote:
    'Verified against PSA\'s official direct-submission services page (Aug 2026).',
  sourceUrl: 'https://www.psacard.com/services/tcggrading',
}

/**
 * PSA Value — paused for new direct submissions since 2 June 2026.
 * Retained in this module ONLY so the analyzer can label it
 * explicitly rather than silently substituting an old number.
 * `available: false`.
 *
 * The historical published $25/card is a reference point; it is
 * not used in any live calculation.
 */
export const PSA_VALUE_DIRECT_PAUSED: GradingServiceProfile = {
  id: 'psa_value_direct_paused',
  company: 'PSA',
  serviceName: 'PSA Value (Direct) — paused',
  submissionMethod: 'direct',
  gradingFee: 2500,          // Historical $25.00 USD
  feeCurrency: 'USD',
  maxInsuredValue: 49900,    // Historical $499.00 USD
  turnaroundNote: 'Paused for new direct submissions as of 2 June 2026.',
  available: false,
  effectiveDate: '2026-08-07',
  sourceNote:
    'PSA announced a pause on Value tier direct submissions effective 2 June 2026. ' +
    'Retained here for reference; the analyzer will not select it while available=false.',
  sourceUrl: 'https://www.psacard.com/services/tcggrading',
}

// ── Registry + selection ───────────────────────────────

export const GRADING_SERVICE_PROFILES: Record<string, GradingServiceProfile> = {
  psa_regular_direct:       PSA_REGULAR_DIRECT,
  psa_value_direct_paused:  PSA_VALUE_DIRECT_PAUSED,
  psa_express_direct:       PSA_EXPRESS_DIRECT,
  psa_super_express_direct: PSA_SUPER_EXPRESS_DIRECT,
}

/**
 * Currently-bookable direct profiles, ordered from cheapest fee
 * to most expensive. `pickGradingService` walks this list and
 * returns the first tier whose cap accommodates the card.
 */
export const ORDERED_AVAILABLE_PROFILES: readonly GradingServiceProfile[] = [
  PSA_REGULAR_DIRECT,
  PSA_EXPRESS_DIRECT,
  PSA_SUPER_EXPRESS_DIRECT,
]

/**
 * Pick the lowest currently-available service whose value cap
 * accommodates the target card value. Returns null when no
 * profile fits (over-cap card) — the analyzer then produces
 * `INSUFFICIENT_COST_DATA`.
 *
 * `targetValueNative` is integer cents in `profile.feeCurrency`.
 * Callers must pre-convert their target value; this module
 * intentionally has no FX knowledge.
 */
export function pickGradingService(
  targetValueNative: number,
  targetCurrency: GradingFeeCurrency,
  profiles: readonly GradingServiceProfile[] = ORDERED_AVAILABLE_PROFILES,
): GradingServiceProfile | null {
  for (const p of profiles) {
    if (!p.available) continue
    if (p.feeCurrency !== targetCurrency) continue
    if (p.maxInsuredValue == null || targetValueNative <= p.maxInsuredValue) return p
  }
  return null
}
