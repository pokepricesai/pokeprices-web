// src/lib/grading/gradingAnalysis.ts
//
// Block 5A-W-52B.2 — deterministic grading economics calculator
// with the corrected verified fee model:
//   * PSA Regular / Express / Super Express with real published
//     fees + value caps (see ./gradingServiceProfiles.ts);
//   * UK eBay Collectables business seller with 10.9% marketplace
//     + 0.35% regulatory + tiered £0.30/£0.40 per-order fee (see
//     ./sellingProfiles.ts);
//   * FX rate carried as `UsdToGbpRateSource` with provenance so
//     the returned `assumptions` name the actual rate used
//     (see ./currency.ts).
//
// All arithmetic is integer cents in the analyzer's declared
// `currency` field. Callers pre-convert PSA's native USD fee
// via ./currency.ts before invoking the analyzer.

import type { GradingServiceProfile } from './gradingServiceProfiles'
import type { SellingProfile, FixedSellingFeeRule } from './sellingProfiles'
import { resolveFixedSellingFee } from './sellingProfiles'
import type { AncillaryCostConfig } from './gradingCostConfig'
import { FALLBACK_USD_TO_GBP_RATE, type UsdToGbpRateSource } from './currency'

// ── Types ─────────────────────────────────────────────

export type GradeTier = 7 | 8 | 9 | 10
export type GradingConfidence = 'high' | 'medium' | 'low'
export type IntendedUse = 'resale' | 'collection'
export type ComparisonBasis = 'sell_raw'

export interface GradingAnalysisInput {
  rawValue: number | null
  gradeValues: {
    psa7?: number | null
    psa8?: number | null
    psa9?: number | null
    psa10?: number | null
  }
  currency: 'GBP' | 'USD'
  service: GradingServiceProfile
  /** Grading fee expressed in `currency`. Pre-converted via ./currency.ts. */
  gradingFeeInCurrency: number
  /** Service cap expressed in `currency`. Pre-converted. Null when no cap. */
  serviceMaxValueInCurrency: number | null
  sellingProfile: SellingProfile
  ancillary: AncillaryCostConfig
  intendedUse: IntendedUse
  comparisonBasis?: ComparisonBasis
  estimatedGrade?: GradeTier | null
  salesVolumeByGrade?: Partial<Record<`psa${GradeTier}` | 'ungraded', number | null>>
  estimatedPriceGrades?: GradeTier[]
  /**
   * FX rate metadata used to convert PSA's native USD fee into
   * `currency`. Included in the returned `assumptions` so audits
   * can attribute the rate source. Defaults to the fallback
   * constant with source='hardcoded_fallback'.
   */
  fxRate?: UsdToGbpRateSource
  /**
   * Block 5A-W-52B (VAT correction) — eBay UK business fees are
   * published excluding VAT. A UK VAT-registered seller can
   * reclaim the input VAT on eBay fees (so the VAT isn't a real
   * cost); everyone else bears it. Defaults to false — safer to
   * bake VAT into the numbers than to quietly claim reclaim
   * without the user asking for it. Ignored for profiles whose
   * `feesExcludeVat` is not set.
   */
  sellerCanReclaimFeeVat?: boolean
}

export interface GradingScenario {
  grade: GradeTier
  gradedValue: number
  marketplaceFee: number
  regulatoryFee: number
  paymentFee: number
  fixedSellingFee: number
  /**
   * VAT on eBay fees when the profile is VAT-exclusive and the
   * caller marked VAT as non-reclaimable. Zero otherwise.
   */
  feeVat: number
  totalCosts: number
  netProceeds: number
  incrementalProfit: number
  roiPercent: number | null
  breakEven: boolean
  breakEvenSalePrice: number
  salesVolume: number | null
  confidence: GradingConfidence
  priceIsEstimate: boolean
  extremeGradeMultiplier: boolean
  exceedsServiceCap: boolean
}

export interface GradingDataQuality {
  missingRawValue: boolean
  missingGradeValues: GradeTier[]
  lowVolumeGrades: GradeTier[]
  estimatedPricesUsed: boolean
  confidence: GradingConfidence
  extremeGradeMultiplierPresent: boolean
  gradesExceedServiceCap: GradeTier[]
}

export type RecommendationCode =
  | 'LIKELY_NEGATIVE'
  | 'CONDITION_DEPENDENT'
  | 'LIKELY_POSITIVE'
  | 'INSUFFICIENT_DATA'
  | 'INSUFFICIENT_COST_DATA'

export interface GradingAnalysisResult {
  scenarios: GradingScenario[]
  breakEvenGrade: GradeTier | null
  bestFinancialScenario: GradeTier | null
  assumptions: Record<string, number | string>
  assumptionsSummary: string
  dataQuality: GradingDataQuality
  recommendationCode: RecommendationCode
  intendedUse: IntendedUse
  comparisonBasis: ComparisonBasis
  currency: string
  service: {
    id: string
    serviceName: string
    available: boolean
  }
  sellingProfile: {
    id: string
    displayName: string
    sellerType: string
  }
  fxRate: UsdToGbpRateSource
}

// ── Small helpers ─────────────────────────────────────

function calcFeeCents(gradedValueCents: number, rate: number): number {
  if (gradedValueCents <= 0 || rate <= 0) return 0
  return Math.round(gradedValueCents * rate)
}

function volumeConfidence(sales30d: number | null | undefined): GradingConfidence {
  if (sales30d == null || sales30d <= 0) return 'low'
  if (sales30d < 3) return 'low'
  if (sales30d < 10) return 'medium'
  return 'high'
}

/**
 * Total selling-side deductions for a given sale value. Applied
 * identically to the raw side (via rawNet) and the graded side
 * so the incremental comparison remains fair.
 *
 * When `applyFeeVat` is true (VAT-exclusive profile + caller
 * cannot reclaim), the aggregate base fee amount is grossed up
 * by `feeVatRate` and the VAT is exposed separately on the
 * scenario. Only the FEES are affected — the sale value itself
 * is untouched.
 */
function calcSellingFees(price: number, sp: SellingProfile, applyFeeVat: boolean): {
  marketplaceFee: number
  regulatoryFee: number
  paymentFee: number
  fixedSellingFee: number
  feeVat: number
  total: number
} {
  const marketplaceFee = calcFeeCents(price, sp.marketplaceFeeRate)
  const regulatoryFee  = calcFeeCents(price, sp.regulatoryFeeRate)
  const paymentFee     = calcFeeCents(price, sp.paymentFeeRate)
  const fixedSellingFee = price > 0 ? resolveFixedSellingFee(sp.fixedSellingFeeRule, price) : 0
  const baseTotal = marketplaceFee + regulatoryFee + paymentFee + fixedSellingFee
  const feeVatRate = sp.feeVatRate ?? 0
  const feeVat = applyFeeVat && feeVatRate > 0 && baseTotal > 0
    ? Math.round(baseTotal * feeVatRate)
    : 0
  return {
    marketplaceFee,
    regulatoryFee,
    paymentFee,
    fixedSellingFee,
    feeVat,
    total: baseTotal + feeVat,
  }
}

/**
 * Piecewise break-even sale-price solver.
 *
 * With a tiered fixed fee (£0.30 ≤ £10, £0.40 above), the
 * break-even formula is piecewise. For each candidate tier we
 * compute the price that zeros incremental profit assuming that
 * tier's fixed fee applies, then check whether that price falls
 * within the tier's range. The smallest valid solution wins.
 */
function solveBreakEvenSalePrice(
  fixedGradingCosts: number,
  rawNet: number,
  feeRateSum: number,
  rule: FixedSellingFeeRule,
  vatMultiplier: number = 1,
): number {
  // With VAT applied to fees, both the percentage rate sum and
  // each fixed-fee tier get grossed up by (1 + feeVatRate). We
  // therefore scale both sides of the piecewise solver.
  const effectiveRateSum = feeRateSum * vatMultiplier
  if (effectiveRateSum >= 1) return Number.POSITIVE_INFINITY
  const tiers = rule.kind === 'flat'
    ? [{ maxSaleCents: Number.POSITIVE_INFINITY, feeCents: rule.flat }]
    : rule.tiers
  let prevMax = 0
  let bestValid = Number.POSITIVE_INFINITY
  for (const t of tiers) {
    const effectiveFixedFee = Math.round(t.feeCents * vatMultiplier)
    const P = Math.ceil((fixedGradingCosts + rawNet + effectiveFixedFee) / (1 - effectiveRateSum))
    if (P > prevMax && P <= t.maxSaleCents && P < bestValid) bestValid = P
    prevMax = t.maxSaleCents
  }
  return bestValid
}

// ── Core calculator ───────────────────────────────────

export function analyzeGrading(input: GradingAnalysisInput): GradingAnalysisResult {
  const comparisonBasis: ComparisonBasis = input.comparisonBasis ?? 'sell_raw'
  const fxRate: UsdToGbpRateSource = input.fxRate ?? FALLBACK_USD_TO_GBP_RATE
  const fixedGradingCosts =
    input.gradingFeeInCurrency +
    input.ancillary.outboundShipping +
    input.ancillary.returnShipping +
    input.ancillary.insurance +
    input.ancillary.otherCosts
  const sp = input.sellingProfile
  const feeRateSum = sp.marketplaceFeeRate + sp.regulatoryFeeRate + sp.paymentFeeRate
  // Apply VAT to eBay fees when the profile is VAT-exclusive
  // AND the caller has not marked VAT as reclaimable. Default:
  // do not assume reclaim (safer bakes VAT into the numbers).
  const applyFeeVat = !!sp.feesExcludeVat && (input.sellerCanReclaimFeeVat !== true)
  const vatMultiplier = applyFeeVat ? 1 + (sp.feeVatRate ?? 0) : 1
  const rawValue = input.rawValue
  const estimatedPriceGrades = new Set(input.estimatedPriceGrades ?? [])

  const gradeInputs: Array<{ grade: GradeTier; price: number | null; volume: number | null | undefined }> = [
    { grade: 7,  price: input.gradeValues.psa7  ?? null, volume: input.salesVolumeByGrade?.psa7 },
    { grade: 8,  price: input.gradeValues.psa8  ?? null, volume: input.salesVolumeByGrade?.psa8 },
    { grade: 9,  price: input.gradeValues.psa9  ?? null, volume: input.salesVolumeByGrade?.psa9 },
    { grade: 10, price: input.gradeValues.psa10 ?? null, volume: input.salesVolumeByGrade?.psa10 },
  ]

  const missingGradeValues: GradeTier[] = []
  const lowVolumeGrades: GradeTier[] = []
  const gradesExceedServiceCap: GradeTier[] = []
  let extremeGradeMultiplierPresent = false

  // Raw net = rawValue - full selling deductions on the raw sale.
  const rawNet = rawValue != null && rawValue > 0
    ? rawValue - calcSellingFees(rawValue, sp, applyFeeVat).total
    : null

  const scenarios: GradingScenario[] = []
  for (const { grade, price, volume } of gradeInputs) {
    if (price == null || price <= 0) {
      missingGradeValues.push(grade)
      continue
    }
    const fees = calcSellingFees(price, sp, applyFeeVat)
    const totalCosts = fixedGradingCosts + fees.total
    const netProceeds = price - totalCosts
    const incrementalProfit = netProceeds - (rawNet ?? 0)
    const investment = fixedGradingCosts + (rawNet ?? 0)
    const roiPercent = investment > 0
      ? Math.round((incrementalProfit / investment) * 1000) / 10
      : null
    const breakEvenSalePrice = solveBreakEvenSalePrice(
      fixedGradingCosts,
      rawNet ?? 0,
      feeRateSum,
      sp.fixedSellingFeeRule,
      vatMultiplier,
    )
    const priceIsEstimate = estimatedPriceGrades.has(grade)
    const salesVolume = volume ?? null
    const scenarioConfidence: GradingConfidence = priceIsEstimate ? 'low' : volumeConfidence(salesVolume)
    if (scenarioConfidence === 'low') lowVolumeGrades.push(grade)
    const extremeGradeMultiplier = rawValue != null && rawValue > 0
      ? price / rawValue >= 10
      : false
    if (extremeGradeMultiplier) extremeGradeMultiplierPresent = true
    const exceedsServiceCap = input.serviceMaxValueInCurrency != null
      && price > input.serviceMaxValueInCurrency
    if (exceedsServiceCap) gradesExceedServiceCap.push(grade)

    scenarios.push({
      grade,
      gradedValue:        price,
      marketplaceFee:     fees.marketplaceFee,
      regulatoryFee:      fees.regulatoryFee,
      paymentFee:         fees.paymentFee,
      fixedSellingFee:    fees.fixedSellingFee,
      feeVat:             fees.feeVat,
      totalCosts,
      netProceeds,
      incrementalProfit,
      roiPercent,
      breakEven:          incrementalProfit >= 0 && !exceedsServiceCap,
      breakEvenSalePrice,
      salesVolume,
      confidence:         scenarioConfidence,
      priceIsEstimate,
      extremeGradeMultiplier,
      exceedsServiceCap,
    })
  }

  const missingRawValue = rawValue == null || rawValue <= 0
  const estimatedPricesUsed = estimatedPriceGrades.size > 0
  let confidence: GradingConfidence = 'high'
  if (missingRawValue || scenarios.length === 0) confidence = 'low'
  else if (lowVolumeGrades.length >= 2 || estimatedPricesUsed) confidence = 'low'
  else if (scenarios.length === 1 && lowVolumeGrades.length >= 1) confidence = 'low'
  else if (lowVolumeGrades.length === 1) confidence = 'medium'
  if (extremeGradeMultiplierPresent) {
    if (lowVolumeGrades.length >= 1) confidence = 'low'
    else if (confidence === 'high') confidence = 'medium'
  }

  const dataQuality: GradingDataQuality = {
    missingRawValue,
    missingGradeValues,
    lowVolumeGrades,
    estimatedPricesUsed,
    confidence,
    extremeGradeMultiplierPresent,
    gradesExceedServiceCap,
  }

  const eligibleScenarios = scenarios.filter(s => !s.exceedsServiceCap)
  const breakEvenGrade = (eligibleScenarios
    .filter(s => s.breakEven)
    .sort((a, b) => a.grade - b.grade)[0]?.grade ?? null) as GradeTier | null

  const bestFinancialScenario = (eligibleScenarios
    .slice()
    .sort((a, b) => b.incrementalProfit - a.incrementalProfit || a.grade - b.grade)[0]?.grade ?? null) as GradeTier | null

  let recommendationCode: RecommendationCode
  if (!input.service.available || eligibleScenarios.length === 0) {
    recommendationCode = 'INSUFFICIENT_COST_DATA'
  } else if (missingRawValue || scenarios.length === 0 || confidence === 'low') {
    recommendationCode = 'INSUFFICIENT_DATA'
  } else if (eligibleScenarios.every(s => !s.breakEven)) {
    recommendationCode = 'LIKELY_NEGATIVE'
  } else {
    const est = input.estimatedGrade ?? null
    const estScenario = est != null ? eligibleScenarios.find(s => s.grade === est) : null
    if (estScenario) {
      recommendationCode = estScenario.breakEven ? 'LIKELY_POSITIVE' : 'LIKELY_NEGATIVE'
    } else if (eligibleScenarios.every(s => s.breakEven)) {
      recommendationCode = 'LIKELY_POSITIVE'
    } else {
      recommendationCode = 'CONDITION_DEPENDENT'
    }
  }

  const assumptions: Record<string, number | string> = {
    grading_service_id:       input.service.id,
    grading_service_name:     input.service.serviceName,
    grading_service_available: String(input.service.available),
    grading_fee_native:       input.service.gradingFee,
    grading_fee_currency:     input.service.feeCurrency,
    grading_fee_in_currency:  input.gradingFeeInCurrency,
    service_max_value_native: input.service.maxInsuredValue ?? -1,
    ancillary_outbound:       input.ancillary.outboundShipping,
    ancillary_return:         input.ancillary.returnShipping,
    ancillary_insurance:      input.ancillary.insurance,
    ancillary_other:          input.ancillary.otherCosts,
    selling_profile_id:       sp.id,
    selling_profile_name:     sp.displayName,
    marketplace_fee_rate:     sp.marketplaceFeeRate,
    regulatory_fee_rate:      sp.regulatoryFeeRate,
    payment_fee_rate:         sp.paymentFeeRate,
    fixed_selling_fee_kind:   sp.fixedSellingFeeRule.kind,
    fees_exclude_vat:         String(!!sp.feesExcludeVat),
    fee_vat_rate:             sp.feeVatRate ?? 0,
    seller_can_reclaim_fee_vat: String(input.sellerCanReclaimFeeVat === true),
    fee_vat_applied:          String(applyFeeVat),
    comparison_basis:         comparisonBasis,
    currency:                 input.currency,
    fx_rate:                  fxRate.rate,
    fx_rate_source:           fxRate.source,
    fx_rate_effective_date:   fxRate.effectiveDate,
  }

  const assumptionsSummary = summariseAssumptions(input, fxRate, applyFeeVat)

  return {
    scenarios,
    breakEvenGrade,
    bestFinancialScenario,
    assumptions,
    assumptionsSummary,
    dataQuality,
    recommendationCode,
    intendedUse: input.intendedUse,
    comparisonBasis,
    currency: input.currency,
    service: {
      id: input.service.id,
      serviceName: input.service.serviceName,
      available: input.service.available,
    },
    sellingProfile: {
      id: sp.id,
      displayName: sp.displayName,
      sellerType: sp.sellerType,
    },
    fxRate,
  }
}

// ── Assumptions summary ───────────────────────────────

function summariseAssumptions(input: GradingAnalysisInput, fxRate: UsdToGbpRateSource, applyFeeVat: boolean): string {
  const cur = input.currency === 'GBP' ? '£' : '$'
  const gradingFee = (input.gradingFeeInCurrency / 100).toFixed(2)
  const ancillaryTotal = ((input.ancillary.outboundShipping + input.ancillary.returnShipping + input.ancillary.insurance + input.ancillary.otherCosts) / 100).toFixed(2)
  const sp = input.sellingProfile
  const rateHedge = fxRate.source === 'hardcoded_fallback' || fxRate.source === 'test_fixture'
    ? 'assumed exchange rate'
    : 'current exchange rate'
  // Compose the seller fee summary.
  let feePart: string
  const allZero = sp.marketplaceFeeRate === 0 && sp.regulatoryFeeRate === 0 && sp.paymentFeeRate === 0 && sp.fixedSellingFeeRule.kind === 'flat' && sp.fixedSellingFeeRule.flat === 0
  if (allZero) {
    feePart = `${sp.displayName} with £0 seller fees`
  } else {
    const parts: string[] = []
    if (sp.marketplaceFeeRate > 0) parts.push(`${(sp.marketplaceFeeRate * 100).toFixed(1)}% final-value fee`)
    if (sp.regulatoryFeeRate > 0) parts.push(`${(sp.regulatoryFeeRate * 100).toFixed(2)}% regulatory fee`)
    if (sp.paymentFeeRate > 0) parts.push(`${(sp.paymentFeeRate * 100).toFixed(1)}% payment fee`)
    if (sp.fixedSellingFeeRule.kind === 'flat' && sp.fixedSellingFeeRule.flat > 0) {
      parts.push(`${cur}${(sp.fixedSellingFeeRule.flat / 100).toFixed(2)}/order`)
    } else if (sp.fixedSellingFeeRule.kind === 'tiered_by_sale') {
      const t = sp.fixedSellingFeeRule.tiers
      if (t.length === 2 && t[0].maxSaleCents === 1000 && t[0].feeCents === 30 && t[1].feeCents === 40) {
        parts.push(`£0.30/order for orders ≤ £10, £0.40 above`)
      } else {
        parts.push(`tiered per-order fee`)
      }
    }
    // 52B VAT — surface the assumption visibly.
    if (sp.feesExcludeVat) {
      const reclaimNote = applyFeeVat
        ? 'calculation assumes fee VAT is not reclaimable'
        : 'calculation assumes fee VAT is reclaimable'
      parts.push(`excluding VAT; ${reclaimNote}`)
    }
    feePart = `${sp.displayName} ${parts.join(' + ')}`
  }
  return (
    `Assumptions: ${input.service.serviceName}, approximately ${cur}${gradingFee}/card at the ${rateHedge}, ` +
    `${cur}${ancillaryTotal} shipping/insurance/supplies, ${feePart}.`
  )
}

// ── LLM prompt block ──────────────────────────────────

export function buildGradingPromptBlock(result: GradingAnalysisResult): string {
  const cur = result.currency === 'GBP' ? '£' : '$'
  const fmt = (cents: number) => `${cur}${(cents / 100).toFixed(2)}`
  const lines: string[] = []
  lines.push(
    `GRADING ANALYSIS (deterministic — you MUST NOT recalculate, invent fees, or contradict these numbers).`,
    `recommendation_code=${result.recommendationCode}`,
    `intended_use=${result.intendedUse}`,
    `comparison_basis=${result.comparisonBasis}`,
    `overall_confidence=${result.dataQuality.confidence}`,
    `break_even_grade=${result.breakEvenGrade ?? 'none'}`,
    `best_financial_grade=${result.bestFinancialScenario ?? 'none'}`,
    `grading_service=${result.service.serviceName}${result.service.available ? '' : ' (UNAVAILABLE)'}`,
    `selling_profile=${result.sellingProfile.displayName}`,
    `fx_rate=${result.fxRate.rate} (${result.fxRate.source})`,
    `fee_vat_applied=${result.assumptions.fee_vat_applied ?? 'false'}`,
  )
  for (const s of result.scenarios) {
    lines.push(
      `PSA_${s.grade}: value=${fmt(s.gradedValue)} net=${fmt(s.netProceeds)} ` +
      `incremental=${s.incrementalProfit >= 0 ? '+' : ''}${fmt(s.incrementalProfit)} ` +
      `roi=${s.roiPercent != null ? s.roiPercent.toFixed(1) + '%' : 'n/a'} ` +
      `break_even=${s.breakEven} volume_30d=${s.salesVolume ?? 'unknown'} ` +
      `confidence=${s.confidence}` +
      (s.priceIsEstimate ? ' price_is_estimate' : '') +
      (s.extremeGradeMultiplier ? ' extreme_multiplier' : '') +
      (s.exceedsServiceCap ? ' exceeds_service_cap' : ''),
    )
  }
  if (!result.service.available) {
    lines.push(`WARNING: the grading service (${result.service.serviceName}) is not currently accepting new submissions — do NOT recommend booking it.`)
  }
  if (result.dataQuality.gradesExceedServiceCap.length > 0) {
    lines.push(`WARNING: PSA ${result.dataQuality.gradesExceedServiceCap.join(', PSA ')} value(s) exceed the ${result.service.serviceName} declared-value cap — a higher tier is required for those grades.`)
  }
  if (result.dataQuality.missingRawValue) {
    lines.push('WARNING: raw sale value is missing — do NOT quote an incremental-profit figure.')
  }
  if (result.dataQuality.missingGradeValues.length > 0) {
    lines.push(`WARNING: no confirmed sale data for PSA ${result.dataQuality.missingGradeValues.join(', PSA ')} — do NOT interpolate.`)
  }
  if (result.dataQuality.lowVolumeGrades.length > 0) {
    lines.push(`WARNING: thin sales volume on PSA ${result.dataQuality.lowVolumeGrades.join(', PSA ')} — label those figures as unreliable.`)
  }
  if (result.dataQuality.estimatedPricesUsed) {
    lines.push('WARNING: at least one graded value is estimated, not a confirmed sold market.')
  }
  if (result.dataQuality.extremeGradeMultiplierPresent) {
    lines.push('WARNING: an extreme graded-to-raw multiplier (>=10x) was detected — add a caution about survivorship / one-sale outliers.')
  }
  lines.push(result.assumptionsSummary)
  lines.push(
    `Response format (compact):`,
    `  1. Verdict — one plain sentence matching recommendation_code. When comparison_basis=sell_raw, phrase it "Compared with selling the card raw today, ...".`,
    `  2. Grade scenarios — per-grade one-liner using the numbers above.`,
    `  3. Break-even point — cite the break_even_grade.`,
    `  4. Assumptions — one line, verbatim from Assumptions above.`,
    `  5. Data warning — only if a WARNING appears above.`,
    `Do NOT use the phrases "sweet spot", "grading floor", "nearly doubles", or any percentage not present above.`,
  )
  if (result.intendedUse === 'collection') {
    lines.push(
      'The user grades for a personal collection. Keep the financial verdict, then add ONE short sentence on ' +
      'protection/authentication/display value. Do NOT relabel a financially negative submission as profitable.',
    )
  }
  return lines.join('\n')
}
