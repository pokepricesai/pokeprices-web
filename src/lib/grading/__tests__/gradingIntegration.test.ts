// Block 5A-W-52B.2 — contract tests on the wire between the chat
// pipeline, the deterministic grading calculator, and the LLM
// system prompt.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SMART_EP = readFileSync(join(process.cwd(), 'supabase', 'functions', 'smart-endpoint', 'index.ts'), 'utf8')
const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '2026-08-06-chat-logs-grading-telemetry.sql'), 'utf8')
const SERVICE_PROFILES = readFileSync(join(process.cwd(), 'src', 'lib', 'grading', 'gradingServiceProfiles.ts'), 'utf8')
const SELLING_PROFILES = readFileSync(join(process.cwd(), 'src', 'lib', 'grading', 'sellingProfiles.ts'), 'utf8')

// ── Verified PSA rates match browser + edge ─────────

describe('52B.2 — verified PSA rates in both browser + edge', () => {
  const REGULAR = { fee: 7999, cap: 150000 }
  const EXPRESS = { fee: 14900, cap: 250000 }
  const SUPER_EXPRESS = { fee: 34900, cap: 500000 }

  it('PSA Regular = $79.99 / $1,500 cap in both files', () => {
    expect(SERVICE_PROFILES).toMatch(new RegExp(`gradingFee: ${REGULAR.fee}`))
    expect(SERVICE_PROFILES).toMatch(new RegExp(`maxInsuredValue: ${REGULAR.cap}`))
    expect(SMART_EP).toMatch(new RegExp(`gradingFee:\\s*${REGULAR.fee}`))
    expect(SMART_EP).toMatch(new RegExp(`maxInsuredValue:\\s*${REGULAR.cap}`))
  })

  it('PSA Express = $149 / $2,500 cap in both files', () => {
    expect(SERVICE_PROFILES).toMatch(new RegExp(`gradingFee: ${EXPRESS.fee}`))
    expect(SERVICE_PROFILES).toMatch(new RegExp(`maxInsuredValue: ${EXPRESS.cap}`))
    expect(SMART_EP).toMatch(new RegExp(`gradingFee:\\s*${EXPRESS.fee}`))
    expect(SMART_EP).toMatch(new RegExp(`maxInsuredValue:\\s*${EXPRESS.cap}`))
  })

  it('PSA Super Express = $349 / $5,000 cap in both files', () => {
    expect(SERVICE_PROFILES).toMatch(new RegExp(`gradingFee: ${SUPER_EXPRESS.fee}`))
    expect(SERVICE_PROFILES).toMatch(new RegExp(`maxInsuredValue: ${SUPER_EXPRESS.cap}`))
    expect(SMART_EP).toMatch(new RegExp(`gradingFee:\\s*${SUPER_EXPRESS.fee}`))
    expect(SMART_EP).toMatch(new RegExp(`maxInsuredValue:\\s*${SUPER_EXPRESS.cap}`))
  })

  it('PSA Value is present but marked paused (available=false)', () => {
    expect(SERVICE_PROFILES).toMatch(/PSA_VALUE_DIRECT_PAUSED[\s\S]{0,600}available: false/)
    expect(SMART_EP).toMatch(/PSA_VALUE_DIRECT_PAUSED[\s\S]{0,600}available:\s*false/)
  })

  it('every browser PSA profile carries sourceUrl to psacard.com', () => {
    const psaUrlCount = (SERVICE_PROFILES.match(/sourceUrl: 'https:\/\/www\.psacard\.com/g) ?? []).length
    expect(psaUrlCount).toBeGreaterThanOrEqual(4)
  })
})

// ── Verified UK eBay Collectables business fees ─────

describe('52B.2 — UK eBay business fees (browser + edge)', () => {
  it('marketplaceFeeRate = 10.9% in both files', () => {
    expect(SELLING_PROFILES).toMatch(/marketplaceFeeRate: 0\.109/)
    expect(SMART_EP).toMatch(/marketplaceFeeRate:\s*0\.109/)
    // The pre-52B.2 12.8% must not survive anywhere in the inline copy.
    expect(SMART_EP).not.toMatch(/marketplaceFeeRate:\s*0\.128/)
  })

  it('regulatoryFeeRate = 0.35% in both files', () => {
    expect(SELLING_PROFILES).toMatch(/regulatoryFeeRate: 0\.0035/)
    expect(SMART_EP).toMatch(/regulatoryFeeRate:\s*0\.0035/)
  })

  it('paymentFeeRate = 0 (bundled into FVF)', () => {
    expect(SELLING_PROFILES).toMatch(/UK_EBAY_BUSINESS[\s\S]{0,600}paymentFeeRate: 0,/)
    expect(SMART_EP).toMatch(/UK_EBAY_BUSINESS[\s\S]{0,900}paymentFeeRate:\s*0,/)
  })

  it('fixedSellingFeeRule is tiered — £0.30 for ≤£10, £0.40 above', () => {
    for (const src of [SELLING_PROFILES, SMART_EP]) {
      expect(src).toMatch(/tiered_by_sale/)
      expect(src).toMatch(/maxSaleCents: 1000, feeCents: 30/)
      expect(src).toMatch(/POSITIVE_INFINITY, feeCents: 40/)
    }
  })

  it('description labels the profile as Collectables, not "Collectibles"', () => {
    // Small text-fidelity check to match eBay UK's own spelling.
    expect(SELLING_PROFILES).toMatch(/Collectables/)
    expect(SMART_EP).toMatch(/Collectables/)
  })

  it('business profile declares fees VAT-exclusive at 20% in both files', () => {
    expect(SELLING_PROFILES).toMatch(/UK_EBAY_BUSINESS[\s\S]{0,900}feesExcludeVat: true/)
    expect(SELLING_PROFILES).toMatch(/feeVatRate: 0\.20/)
    expect(SMART_EP).toMatch(/UK_EBAY_BUSINESS[\s\S]{0,1400}feesExcludeVat:\s*true/)
    expect(SMART_EP).toMatch(/feeVatRate:\s*0\.20/)
  })

  it('inline calculator honours sellerCanReclaimFeeVat / applyFeeVat gate', () => {
    // The edge-side default is non-reclaimable (VAT applied).
    // The analyzer input carries `sellerCanReclaimFeeVat`; the
    // inline copy pins false today but the gate lives in
    // calcAllSellingFees + solveBreakEvenSalePrice.
    expect(SMART_EP).toMatch(/const sellerCanReclaimFeeVat = false/)
    expect(SMART_EP).toMatch(/const applyFeeVat = !!\(sp as any\)\.feesExcludeVat && !sellerCanReclaimFeeVat/)
    expect(SMART_EP).toMatch(/vatMultiplier = applyFeeVat \? 1 \+ \(\(sp as any\)\.feeVatRate \?\? 0\) : 1/)
    // Break-even solver receives it.
    expect(SMART_EP).toMatch(/solveBreakEvenSalePrice\(fixedGradingCosts, rawNet \?\? 0, feeRateSum, sp\.fixedSellingFeeRule, vatMultiplier\)/)
  })

  it('assumptions summary surfaces "excluding VAT; calculation assumes fee VAT is (not )?reclaimable"', () => {
    expect(SMART_EP).toMatch(/excluding VAT; \$\{reclaimNote\}/)
    expect(SMART_EP).toMatch(/calculation assumes fee VAT is (?:not )?reclaimable/)
  })
})

// ── FX rate provenance ─────────────────────────────

describe('52B.2 — FX rate provenance in the inline calculator', () => {
  it('FALLBACK_USD_TO_GBP_RATE is defined with source metadata', () => {
    expect(SMART_EP).toMatch(/FALLBACK_USD_TO_GBP_RATE = \{[\s\S]{0,200}source:\s*"hardcoded_fallback"/)
  })

  it('prompt block emits fx_rate + source', () => {
    expect(SMART_EP).toMatch(/fx_rate=\$\{FALLBACK_USD_TO_GBP_RATE\.rate\} \(\$\{FALLBACK_USD_TO_GBP_RATE\.source\}\)/)
  })

  it('assumptions line uses "assumed exchange rate" (not "current") for the fallback', () => {
    expect(SMART_EP).toMatch(/rateHedge[\s\S]{0,200}assumed exchange rate/)
  })
})

// ── Formula integrity ──────────────────────────────

describe('52B.2 — formula integrity in the inline calculator', () => {
  it('regulatory fee is included in the total selling deductions', () => {
    expect(SMART_EP).toMatch(/function calcAllSellingFees/)
    // The helper sums marketplace + regulatory + payment + fixed
    // as `baseTotal`, then optionally adds VAT.
    expect(SMART_EP).toMatch(/const baseTotal = marketplaceFee \+ regulatoryFee \+ paymentFee \+ fixedSellingFee/)
    expect(SMART_EP).toMatch(/total: baseTotal \+ feeVat/)
  })

  it('raw side uses the same helper with the same VAT flag (fair comparison)', () => {
    expect(SMART_EP).toMatch(/rawGbp - calcAllSellingFees\(rawGbp, sp, applyFeeVat\)\.total/)
  })

  it('break-even solver is piecewise + accepts a VAT multiplier', () => {
    expect(SMART_EP).toMatch(/function solveBreakEvenSalePrice/)
    expect(SMART_EP).toMatch(/breakEvenSalePrice = solveBreakEvenSalePrice\(fixedGradingCosts, rawNet \?\? 0, feeRateSum, sp\.fixedSellingFeeRule, vatMultiplier\)/)
  })

  it('paused services still emit INSUFFICIENT_COST_DATA', () => {
    expect(SMART_EP).toMatch(/recommendationCode = "INSUFFICIENT_COST_DATA"/)
  })
})

// ── Response body + logging (unchanged from 52B.1) ─

describe('smart-endpoint — grading provenance on response + logs', () => {
  it('response body carries the grading provenance fields', () => {
    expect(SMART_EP).toMatch(/grading_analysis_used:\s+gradingAnalysisUsed/)
    expect(SMART_EP).toMatch(/grading_recommendation_code: gradingRecommendationCode/)
    expect(SMART_EP).toMatch(/grading_break_even_grade:\s+gradingBreakEvenGrade/)
    expect(SMART_EP).toMatch(/grading_data_confidence:\s+gradingDataConfidence/)
  })

  it('logChat writes the same four grading fields to chat_logs', () => {
    const logChatBody = SMART_EP.slice(
      SMART_EP.indexOf('function logChat'),
      SMART_EP.indexOf('Deno.serve('),
    )
    expect(logChatBody).toMatch(/grading_analysis_used:\s+params\.grading_analysis_used/)
    expect(logChatBody).toMatch(/grading_recommendation_code:\s+params\.grading_recommendation_code/)
    expect(logChatBody).toMatch(/grading_break_even_grade:\s+params\.grading_break_even_grade/)
    expect(logChatBody).toMatch(/grading_data_confidence:\s+params\.grading_data_confidence/)
  })
})

// ── System prompt discipline (unchanged) ────────────

describe('smart-endpoint system prompt — grading discipline', () => {
  it('replaces the arbitrary "PSA 10 > 3x PSA 9 → PSA 9 is better value" heuristic', () => {
    expect(SMART_EP).not.toMatch(/PSA 10 is more than 3x PSA 9/)
  })

  it('orders the LLM to explain the deterministic block without recalculating', () => {
    expect(SMART_EP).toMatch(/GRADING QUERIES \(deterministic — Block 5A-W-52B\)/)
    expect(SMART_EP).toMatch(/GRADING ANALYSIS/)
    expect(SMART_EP).toMatch(/Do NOT recalculate, invent grading fees/)
  })

  it('bans the loose stock phrases', () => {
    expect(SMART_EP).toMatch(/Banned phrases for grading answers: "sweet spot", "grading floor", "nearly doubles"/)
  })
})

// ── Migration contract (already includes INSUFFICIENT_COST_DATA) ─

describe('chat_logs migration — grading telemetry', () => {
  it('CHECK includes every 52B.2 recommendation code', () => {
    for (const code of ['LIKELY_NEGATIVE', 'CONDITION_DEPENDENT', 'LIKELY_POSITIVE', 'INSUFFICIENT_DATA', 'INSUFFICIENT_COST_DATA']) {
      expect(MIGRATION).toContain(`'${code}'`)
    }
  })
})

// ── Scope discipline ────────────────────────────────

describe('scope: 52B.2 does not touch out-of-scope systems', () => {
  it('did not modify the search_cards / enrichCards pipeline', () => {
    expect(SMART_EP).toContain('async function enrichCards')
    expect(SMART_EP).toContain('async function dbSearchCards')
  })

  it('did not remove the 52A.3 ambiguous candidate short-circuit', () => {
    expect(SMART_EP).toContain('ambiguous_free_text')
    expect(SMART_EP).toContain('candidate_selection')
  })
})
