// Block 5A-W-52B.2 — deterministic grading calculator tests.
//
// Includes the historical 52B fixtures, the 52B.1 profile-model
// regressions, and the 52B.2 corrections for verified PSA rates,
// eBay UK Collectables business fees (10.9% + 0.35% + tiered
// £0.30/£0.40), the tier-selection matrix, and the FX-rate
// provenance requirement.

import { describe, it, expect } from 'vitest'
import {
  analyzeGrading,
  buildGradingPromptBlock,
  type GradingAnalysisInput,
  type GradeTier,
} from '@/lib/grading/gradingAnalysis'
import {
  PSA_REGULAR_DIRECT,
  PSA_EXPRESS_DIRECT,
  PSA_SUPER_EXPRESS_DIRECT,
  PSA_VALUE_DIRECT_PAUSED,
  pickGradingService,
  ORDERED_AVAILABLE_PROFILES,
} from '@/lib/grading/gradingServiceProfiles'
import {
  UK_EBAY_PRIVATE,
  UK_EBAY_BUSINESS,
  GENERIC_SELLING,
  DEFAULT_SELLING_PROFILE,
  resolveFixedSellingFee,
} from '@/lib/grading/sellingProfiles'
import { UK_ANCILLARY_COSTS_GBP } from '@/lib/grading/gradingCostConfig'
import {
  convertCents,
  usdCentsToGbpPence,
  FALLBACK_USD_TO_GBP_RATE,
  TEST_USD_TO_GBP_RATE,
} from '@/lib/grading/currency'

function makeInput(overrides: Partial<GradingAnalysisInput> & Pick<GradingAnalysisInput, 'rawValue' | 'gradeValues'>): GradingAnalysisInput {
  const service = overrides.service ?? PSA_REGULAR_DIRECT
  const fxRate = overrides.fxRate ?? TEST_USD_TO_GBP_RATE
  const gradingFeeInCurrency = overrides.gradingFeeInCurrency
    ?? convertCents(service.gradingFee, service.feeCurrency, 'GBP', fxRate)
  const serviceMaxValueInCurrency = overrides.serviceMaxValueInCurrency !== undefined
    ? overrides.serviceMaxValueInCurrency
    : service.maxInsuredValue != null
      ? convertCents(service.maxInsuredValue, service.feeCurrency, 'GBP', fxRate)
      : null
  return {
    currency:                    'GBP',
    service,
    gradingFeeInCurrency,
    serviceMaxValueInCurrency,
    sellingProfile:              overrides.sellingProfile ?? DEFAULT_SELLING_PROFILE,
    ancillary:                   overrides.ancillary ?? UK_ANCILLARY_COSTS_GBP,
    intendedUse:                 overrides.intendedUse ?? 'resale',
    fxRate,
    ...overrides,
  }
}

// ── 52B.2 verified PSA service profiles ───────────────

describe('52B.2 — verified PSA direct service profiles', () => {
  it('PSA Regular is $79.99 with a $1,500 cap', () => {
    expect(PSA_REGULAR_DIRECT.gradingFee).toBe(7999)
    expect(PSA_REGULAR_DIRECT.maxInsuredValue).toBe(150000)
    expect(PSA_REGULAR_DIRECT.feeCurrency).toBe('USD')
    expect(PSA_REGULAR_DIRECT.available).toBe(true)
  })

  it('PSA Express is $149 with a $2,500 cap', () => {
    expect(PSA_EXPRESS_DIRECT.gradingFee).toBe(14900)
    expect(PSA_EXPRESS_DIRECT.maxInsuredValue).toBe(250000)
    expect(PSA_EXPRESS_DIRECT.available).toBe(true)
  })

  it('PSA Super Express is $349 with a $5,000 cap', () => {
    expect(PSA_SUPER_EXPRESS_DIRECT.gradingFee).toBe(34900)
    expect(PSA_SUPER_EXPRESS_DIRECT.maxInsuredValue).toBe(500000)
    expect(PSA_SUPER_EXPRESS_DIRECT.available).toBe(true)
  })

  it('PSA Value remains paused (available=false)', () => {
    expect(PSA_VALUE_DIRECT_PAUSED.available).toBe(false)
  })

  it('every profile carries a sourceUrl for future audit', () => {
    for (const p of [PSA_REGULAR_DIRECT, PSA_EXPRESS_DIRECT, PSA_SUPER_EXPRESS_DIRECT, PSA_VALUE_DIRECT_PAUSED]) {
      expect(p.sourceUrl).toMatch(/^https:\/\/www\.psacard\.com/)
      expect(p.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('ORDERED_AVAILABLE_PROFILES excludes the paused Value tier', () => {
    expect(ORDERED_AVAILABLE_PROFILES).not.toContain(PSA_VALUE_DIRECT_PAUSED)
    for (const p of ORDERED_AVAILABLE_PROFILES) expect(p.available).toBe(true)
  })
})

// ── 52B.2 tier-selection matrix ───────────────────────

describe('52B.2 — tier selection by expected value', () => {
  it('$1,000 → Regular eligible', () => {
    expect(pickGradingService(100000, 'USD')?.id).toBe('psa_regular_direct')
  })
  it('$1,700 → Regular ineligible, Express eligible', () => {
    expect(pickGradingService(170000, 'USD')?.id).toBe('psa_express_direct')
  })
  it('$3,000 → Express ineligible, Super Express eligible', () => {
    expect(pickGradingService(300000, 'USD')?.id).toBe('psa_super_express_direct')
  })
  it('$6,000 → no direct tier fits → null (analyzer emits INSUFFICIENT_COST_DATA)', () => {
    expect(pickGradingService(600000, 'USD')).toBeNull()
  })

  it('picks are cheapest-first (Regular preferred when both would fit)', () => {
    // $500 fits every tier. Cheapest wins.
    expect(pickGradingService(50000, 'USD')?.id).toBe('psa_regular_direct')
  })

  it('a scenario over the Regular cap is flagged exceedsServiceCap when Regular was chosen', () => {
    // Force Regular even though the graded value is over its cap.
    const r = analyzeGrading(makeInput({
      rawValue: 20000,     // £200
      // £1,300 PSA 10 is over Regular's £1,185 cap (≈$1,500 * 0.79).
      gradeValues: { psa10: 130000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      service: PSA_REGULAR_DIRECT,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    expect(s.exceedsServiceCap).toBe(true)
    expect(r.dataQuality.gradesExceedServiceCap).toContain(10)
  })
})

// ── 52B.2 UK Collectables business fee model ──────────

describe('52B.2 — UK eBay business seller fee model', () => {
  it('marketplace fee is 10.9% and regulatory fee is 0.35%', () => {
    expect(UK_EBAY_BUSINESS.marketplaceFeeRate).toBe(0.109)
    expect(UK_EBAY_BUSINESS.regulatoryFeeRate).toBe(0.0035)
    expect(UK_EBAY_BUSINESS.paymentFeeRate).toBe(0)
  })

  it('fixed fee is tiered — £0.30 for orders ≤ £10, £0.40 above', () => {
    const rule = UK_EBAY_BUSINESS.fixedSellingFeeRule
    expect(resolveFixedSellingFee(rule, 500)).toBe(30)    // £5 → £0.30
    expect(resolveFixedSellingFee(rule, 1000)).toBe(30)   // £10 → £0.30 (boundary)
    expect(resolveFixedSellingFee(rule, 1001)).toBe(40)   // £10.01 → £0.40
    expect(resolveFixedSellingFee(rule, 100000)).toBe(40) // £1000 → £0.40
  })

  it('applies 10.9% + 0.35% + tiered fixed fee — never a fictitious 15.9%', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,   // £100
      gradeValues: { psa10: 20000 },   // £200
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    expect(s.marketplaceFee).toBe(Math.round(20000 * 0.109))
    expect(s.regulatoryFee).toBe(Math.round(20000 * 0.0035))
    expect(s.paymentFee).toBe(0)
    expect(s.fixedSellingFee).toBe(40)   // £200 > £10 → £0.40
  })

  it('the same fee model is applied to the RAW side (both sides fair)', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 500,   // £5 → £0.30 fixed fee tier
      gradeValues: { psa10: 20000 },   // £200 → £0.40 fixed fee tier
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      // Pin the pre-VAT reconstruction so the fixture stays
      // stable — the dedicated VAT tests below cover the VAT path.
      sellerCanReclaimFeeVat: true,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    // rawValue £5 sits in the £0.30 tier. incrementalProfit
    // computation implicitly used that tier for the raw side.
    // We verify by reconstructing rawNet.
    const rawMarketFee = Math.round(500 * 0.109)
    const rawRegFee    = Math.round(500 * 0.0035)
    const rawFixedFee  = 30
    const rawNet = 500 - rawMarketFee - rawRegFee - rawFixedFee
    expect(s.incrementalProfit).toBe(s.netProceeds - rawNet)
  })

  it('break-even sale price uses the correct tier for its own value', () => {
    // High-cost scenario where break-even is > £10 → uses £0.40.
    // rawValue £50 also lands in the £0.40 tier — the raw-side
    // fixed fee follows the same rule.
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      // Pin the pre-VAT reconstruction; VAT path is covered
      // separately below.
      sellerCanReclaimFeeVat: true,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    // Reconstruct via the analyzer's public formulas.
    const fixedGrading =
      convertCents(PSA_REGULAR_DIRECT.gradingFee, 'USD', 'GBP', TEST_USD_TO_GBP_RATE) +
      UK_ANCILLARY_COSTS_GBP.outboundShipping +
      UK_ANCILLARY_COSTS_GBP.returnShipping +
      UK_ANCILLARY_COSTS_GBP.insurance +
      UK_ANCILLARY_COSTS_GBP.otherCosts
    // Raw side: £50 > £10 → fixed fee tier is £0.40.
    const rawNet = 5000 - Math.round(5000 * 0.109) - Math.round(5000 * 0.0035) - 40
    const rateSum = 0.109 + 0.0035
    // Graded break-even sits well above £10 → £0.40 tier wins.
    const expected = Math.ceil((fixedGrading + rawNet + 40) / (1 - rateSum))
    expect(s.breakEvenSalePrice).toBe(expected)
    expect(s.breakEvenSalePrice).toBeGreaterThan(1000)
  })
})

// ── 52B.2 UK private seller ────────────────────────

describe('52B.2 — UK eBay private seller (no fees)', () => {
  it('marketplace, regulatory, payment, and fixed all zero', () => {
    expect(UK_EBAY_PRIVATE.marketplaceFeeRate).toBe(0)
    expect(UK_EBAY_PRIVATE.regulatoryFeeRate).toBe(0)
    expect(UK_EBAY_PRIVATE.paymentFeeRate).toBe(0)
    expect(UK_EBAY_PRIVATE.fixedSellingFeeRule).toEqual({ kind: 'flat', flat: 0 })
  })

  it('does not receive any fictitious selling deduction', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa9: 15000, psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa9: 5, psa10: 5 },
    }))
    for (const s of r.scenarios) {
      expect(s.marketplaceFee).toBe(0)
      expect(s.regulatoryFee).toBe(0)
      expect(s.paymentFee).toBe(0)
      expect(s.fixedSellingFee).toBe(0)
    }
    expect(r.assumptionsSummary).toMatch(/£0 seller fees/)
    expect(r.assumptionsSummary).not.toMatch(/15\.9%/)
    expect(r.assumptionsSummary).not.toMatch(/13%/)
  })
})

// ── 52B (VAT correction) — eBay UK business fee VAT ─

describe('52B — eBay UK business fee VAT', () => {
  it('UK_EBAY_BUSINESS metadata declares fees are VAT-exclusive at 20%', () => {
    expect(UK_EBAY_BUSINESS.feesExcludeVat).toBe(true)
    expect(UK_EBAY_BUSINESS.feeVatRate).toBe(0.20)
  })

  it('UK_EBAY_PRIVATE does NOT declare VAT (private sellers pay no fees anyway)', () => {
    expect(UK_EBAY_PRIVATE.feesExcludeVat).toBeUndefined()
  })

  it('business seller with VAT reclaimable → NO fee VAT added (unchanged economics)', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: true,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    expect(s.feeVat).toBe(0)
    // Total costs unchanged from the base 10.9% + 0.35% + £0.40 model.
    const baseFees = Math.round(30000 * 0.109) + Math.round(30000 * 0.0035) + 40
    const expectedTotal = /* fixedGradingCosts */
      Math.round(PSA_REGULAR_DIRECT.gradingFee * TEST_USD_TO_GBP_RATE.rate)
      + UK_ANCILLARY_COSTS_GBP.outboundShipping + UK_ANCILLARY_COSTS_GBP.returnShipping
      + UK_ANCILLARY_COSTS_GBP.insurance + UK_ANCILLARY_COSTS_GBP.otherCosts
      + baseFees
    expect(s.totalCosts).toBe(expectedTotal)
    expect(r.assumptions.fee_vat_applied).toBe('false')
    expect(r.assumptionsSummary).toMatch(/excluding VAT; calculation assumes fee VAT is reclaimable/)
  })

  it('business seller with VAT NOT reclaimable → adds 20% VAT to aggregate fees', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: false,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    // Base fees: 10.9% + 0.35% on £300 + £0.40 = 3270 + 105 + 40 = 3415p.
    const baseFees = Math.round(30000 * 0.109) + Math.round(30000 * 0.0035) + 40
    // VAT applied to the aggregate base fee amount, at 20%.
    const expectedVat = Math.round(baseFees * 0.20)
    expect(s.feeVat).toBe(expectedVat)
    expect(s.totalCosts).toBe(
      Math.round(PSA_REGULAR_DIRECT.gradingFee * TEST_USD_TO_GBP_RATE.rate)
      + UK_ANCILLARY_COSTS_GBP.outboundShipping + UK_ANCILLARY_COSTS_GBP.returnShipping
      + UK_ANCILLARY_COSTS_GBP.insurance + UK_ANCILLARY_COSTS_GBP.otherCosts
      + baseFees + expectedVat,
    )
    expect(r.assumptions.fee_vat_applied).toBe('true')
    expect(r.assumptionsSummary).toMatch(/excluding VAT; calculation assumes fee VAT is not reclaimable/)
  })

  it('business seller VAT default is non-reclaimable (safer to bake VAT in)', () => {
    // No `sellerCanReclaimFeeVat` in input → applies VAT.
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    expect(s.feeVat).toBeGreaterThan(0)
    expect(r.assumptions.fee_vat_applied).toBe('true')
  })

  it('VAT applied to BOTH raw and graded sides (fair incremental comparison)', () => {
    // Same rate + fixed fee applied to both sides, so incremental
    // profit still reflects the delta after full VAT accounting.
    const withVat = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: false,
    }))
    const withoutVat = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: true,
    }))
    // Adding VAT only makes the graded side more expensive
    // relative to raw (graded fees are larger in absolute terms),
    // so incremental profit is LOWER when VAT applies.
    expect(withVat.scenarios[0].incrementalProfit).toBeLessThan(
      withoutVat.scenarios[0].incrementalProfit,
    )
  })

  it('private seller is unaffected by the sellerCanReclaimFeeVat flag', () => {
    const withFlag = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellerCanReclaimFeeVat: false,
    }))
    const withoutFlag = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellerCanReclaimFeeVat: true,
    }))
    expect(withFlag.scenarios[0].feeVat).toBe(0)
    expect(withoutFlag.scenarios[0].feeVat).toBe(0)
    expect(withFlag.scenarios[0].incrementalProfit).toBe(withoutFlag.scenarios[0].incrementalProfit)
    // Assumptions summary omits the VAT clause entirely.
    expect(withFlag.assumptionsSummary).not.toMatch(/VAT/)
  })

  it('break-even sale price grows when fee VAT is applied', () => {
    const noVat = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: true,
    }))
    const withVat = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
      sellerCanReclaimFeeVat: false,
    }))
    expect(withVat.scenarios[0].breakEvenSalePrice).toBeGreaterThan(
      noVat.scenarios[0].breakEvenSalePrice,
    )
  })
})

// ── 52B.2 realistic economic examples ────────────

describe('52B.2 — realistic economic examples', () => {
  it('Example A — private seller, raw £100, PSA 9 £150 is NOT obviously profitable', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa9: 15000 },
      salesVolumeByGrade: { ungraded: 5, psa9: 5 },
    }))
    const s = r.scenarios.find(x => x.grade === 9)!
    // £150 raw uplift is £50, but PSA Regular converted (£79.99 * 0.79 ≈ £63)
    // + shipping/insurance (£14) already exceeds it, so incremental
    // profit is negative and the verdict is LIKELY_NEGATIVE.
    expect(s.incrementalProfit).toBeLessThan(0)
    expect(s.breakEven).toBe(false)
    expect(r.recommendationCode).toBe('LIKELY_NEGATIVE')
  })

  it('Example B — business seller applies 10.9% + 0.35% + £0.30/£0.40 correctly', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,     // £50 sale → £0.40 tier
      gradeValues: { psa10: 30000 },   // £300 sale → £0.40 tier
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    // Exact accounting check.
    const marketFee = Math.round(30000 * 0.109)
    const regFee    = Math.round(30000 * 0.0035)
    const fixedFee  = 40
    expect(s.marketplaceFee).toBe(marketFee)
    expect(s.regulatoryFee).toBe(regFee)
    expect(s.paymentFee).toBe(0)
    expect(s.fixedSellingFee).toBe(fixedFee)
  })

  it('Example C — high-value PSA 10 requires the tier capable of covering that value', () => {
    // A PSA 10 worth £1,800 (≈$2,278 at the fixture rate) exceeds
    // Regular's $1,500 cap but fits Express's $2,500 cap.
    const psa10Gbp = 180000
    const usdValue = Math.round(psa10Gbp / TEST_USD_TO_GBP_RATE.rate)
    const service = pickGradingService(usdValue, 'USD')
    expect(service?.id).toBe('psa_express_direct')

    // Run the analyzer with Express selected + Express fee/cap.
    const r = analyzeGrading(makeInput({
      rawValue: 20000,
      gradeValues: { psa10: psa10Gbp },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      service: service!,
    }))
    const s = r.scenarios.find(x => x.grade === 10)!
    expect(s.exceedsServiceCap).toBe(false)
    // Express costs $149 USD → ~£117.71, dramatically changing
    // profitability vs a hypothetical Regular calc.
    const expectedGradingFeeGbp = Math.round(PSA_EXPRESS_DIRECT.gradingFee * TEST_USD_TO_GBP_RATE.rate)
    expect(r.assumptions.grading_fee_in_currency).toBe(expectedGradingFeeGbp)
  })

  it('a card above every direct tier cap → INSUFFICIENT_COST_DATA', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 100000,
      gradeValues: { psa10: 700000 },   // £7,000 above Super Express £3,950 cap
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      service: PSA_SUPER_EXPRESS_DIRECT,
    }))
    expect(r.recommendationCode).toBe('INSUFFICIENT_COST_DATA')
  })
})

// ── 52B.2 FX rate production path ────────────────

describe('52B.2 — FX rate provenance', () => {
  it('convertCents accepts an explicit UsdToGbpRateSource', () => {
    expect(convertCents(5000, 'USD', 'GBP', TEST_USD_TO_GBP_RATE)).toBe(3950)
    // Alternate rate → alternate result.
    const alt = { rate: 0.80, source: 'test_alt', effectiveDate: '2026-08-07' }
    expect(convertCents(5000, 'USD', 'GBP', alt)).toBe(4000)
  })

  it('FALLBACK_USD_TO_GBP_RATE is clearly labelled', () => {
    expect(FALLBACK_USD_TO_GBP_RATE.source).toBe('hardcoded_fallback')
    expect(TEST_USD_TO_GBP_RATE.source).toBe('test_fixture')
  })

  it('the analyzer returns the actual rate + source in assumptions', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
    }))
    expect(r.assumptions.fx_rate).toBe(0.79)
    expect(r.assumptions.fx_rate_source).toBe('test_fixture')
    expect(r.fxRate).toEqual(TEST_USD_TO_GBP_RATE)
  })

  it('assumptions phrase reads "assumed exchange rate" for the fallback/fixture', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
    }))
    expect(r.assumptionsSummary).toMatch(/assumed exchange rate/)
  })

  it('assumptions phrase reads "current exchange rate" for a live source', () => {
    const live = { rate: 0.79, source: 'openexchangerates_2026-08-07T12:00Z', effectiveDate: '2026-08-07' }
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      fxRate: live,
    }))
    expect(r.assumptionsSummary).toMatch(/current exchange rate/)
    expect(r.assumptions.fx_rate_source).toBe('openexchangerates_2026-08-07T12:00Z')
  })

  it('usdCentsToGbpPence accepts a rate override', () => {
    expect(usdCentsToGbpPence(7999, TEST_USD_TO_GBP_RATE)).toBe(Math.round(7999 * 0.79))
  })
})

// ── Historical 52B fixtures — must still pass ─────────

describe('historical 52B fixtures (still pass under 52B.2)', () => {
  it('#1: raw value exceeds PSA 9 → LIKELY_NEGATIVE', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 20000,
      gradeValues: { psa8: 12000, psa9: 15000, psa10: 18000 },
      salesVolumeByGrade: { ungraded: 5, psa8: 5, psa9: 5, psa10: 5 },
    }))
    for (const s of r.scenarios) expect(s.incrementalProfit).toBeLessThan(0)
    expect(r.recommendationCode).toBe('LIKELY_NEGATIVE')
    expect(r.breakEvenGrade).toBeNull()
  })

  it('#3: PSA 10 profitable but PSA 8/9 loss → CONDITION_DEPENDENT + breakEvenGrade=10', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 2000,
      gradeValues: { psa8: 3000, psa9: 4000, psa10: 30000 },
      salesVolumeByGrade: { ungraded: 10, psa8: 5, psa9: 5, psa10: 5 },
    }))
    expect(r.scenarios.find(s => s.grade === 8)!.breakEven).toBe(false)
    expect(r.scenarios.find(s => s.grade === 9)!.breakEven).toBe(false)
    expect(r.scenarios.find(s => s.grade === 10)!.breakEven).toBe(true)
    expect(r.breakEvenGrade).toBe(10)
    expect(r.recommendationCode).toBe('CONDITION_DEPENDENT')
  })

  it('#4: low-value raw card → LIKELY_NEGATIVE across every grade', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 200,
      gradeValues: { psa8: 400, psa9: 600, psa10: 800 },
      salesVolumeByGrade: { ungraded: 10, psa8: 5, psa9: 5, psa10: 5 },
    }))
    for (const s of r.scenarios) expect(s.breakEven).toBe(false)
    expect(r.recommendationCode).toBe('LIKELY_NEGATIVE')
  })

  it('#7: PSA 10 outlier at 1 sale/year → low confidence → INSUFFICIENT_*', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 100000 },
      salesVolumeByGrade: { ungraded: 8, psa10: 0 },
    }))
    expect(r.dataQuality.confidence).toBe('low')
    expect(['INSUFFICIENT_DATA', 'INSUFFICIENT_COST_DATA']).toContain(r.recommendationCode)
  })

  it('#8: missing raw price → INSUFFICIENT_DATA', () => {
    const r = analyzeGrading(makeInput({
      rawValue: null,
      gradeValues: { psa10: 30000 },
      salesVolumeByGrade: { psa10: 5 },
    }))
    expect(r.recommendationCode).toBe('INSUFFICIENT_DATA')
    expect(r.dataQuality.missingRawValue).toBe(true)
  })

  it('#9: collection intent adds separate advice; financial verdict unchanged', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 10000,
      gradeValues: { psa8: 10000, psa9: 11000, psa10: 12500 },
      salesVolumeByGrade: { ungraded: 8, psa8: 5, psa9: 5, psa10: 5 },
      intendedUse: 'collection',
    }))
    expect(r.recommendationCode).toBe('LIKELY_NEGATIVE')
    const block = buildGradingPromptBlock(r)
    expect(block).toMatch(/personal collection/)
    expect(block).toMatch(/Do NOT relabel a financially negative submission as profitable/)
  })

  it('missing grade prices are recorded and NOT interpolated', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
    }))
    expect(r.scenarios.map(s => s.grade)).toEqual([10])
    expect(r.dataQuality.missingGradeValues).toEqual([7, 8, 9])
  })

  it('estimatedPrices downgrade confidence to low', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa9: 8000, psa10: 15000 },
      salesVolumeByGrade: { ungraded: 20, psa9: 20, psa10: 20 },
      estimatedPriceGrades: [10],
    }))
    expect(r.dataQuality.estimatedPricesUsed).toBe(true)
    expect(r.dataQuality.confidence).toBe('low')
  })

  it('per-grade sales volume drives per-scenario confidence tiers', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa8: 10000, psa9: 15000, psa10: 25000 },
      salesVolumeByGrade: { ungraded: 20, psa8: 1, psa9: 5, psa10: 15 },
    }))
    expect(r.scenarios.find(s => s.grade === 8)!.confidence).toBe('low')
    expect(r.scenarios.find(s => s.grade === 9)!.confidence).toBe('medium')
    expect(r.scenarios.find(s => s.grade === 10)!.confidence).toBe('high')
  })
})

// ── Prompt block still bans loose phrasing ─────────

describe('buildGradingPromptBlock — 52B.2', () => {
  it('bans the loose phrases and emits fx_rate provenance', () => {
    const r = analyzeGrading(makeInput({
      rawValue: 5000,
      gradeValues: { psa10: 20000 },
      salesVolumeByGrade: { ungraded: 5, psa10: 5 },
      sellingProfile: UK_EBAY_BUSINESS,
    }))
    const b = buildGradingPromptBlock(r)
    expect(b).toMatch(/"sweet spot", "grading floor", "nearly doubles"/)
    expect(b).toMatch(/fx_rate=0\.79 \(test_fixture\)/)
    expect(b).toMatch(/comparison_basis=sell_raw/)
    expect(b).toMatch(/Compared with selling the card raw today/)
  })
})

// ── Registry sanity ────────────────────────────────

describe('registry sanity', () => {
  it('DEFAULT_SELLING_PROFILE is UK eBay private', () => {
    expect(DEFAULT_SELLING_PROFILE.id).toBe('uk_ebay_private')
  })

  it('every selling profile documents effectiveDate + sourceNote', () => {
    for (const p of [UK_EBAY_PRIVATE, UK_EBAY_BUSINESS, GENERIC_SELLING]) {
      expect(p.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.sourceNote.length).toBeGreaterThan(20)
    }
  })
})

// Unused import guard.
const _grade: GradeTier = 10
void _grade
