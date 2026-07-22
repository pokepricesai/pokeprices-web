// Block 5A-W-46C — pure tests for the card-page Quick Facts builder.

import { describe, it, expect } from 'vitest'
import {
  formatUsdFromCents,
  formatSignedPct,
  movementVariantFor,
  formatFreshnessDate,
  cleanCardName,
  buildCardNumberLabel,
  computeGradingPremium,
  buildCardQuickFacts,
  hasEnoughFacts,
  MIN_RAW_CENTS_FOR_PREMIUM,
  MIN_PREMIUM_MULTIPLE,
  MAX_PREMIUM_MULTIPLE,
  MIN_MEANINGFUL_PCT_MOVE,
  type CardQuickFactsCardInput,
} from '../quickFacts'

// ── formatUsdFromCents ────────────────────────────────────────────

describe('formatUsdFromCents', () => {
  it('returns null for null / undefined / non-finite / zero / negative', () => {
    expect(formatUsdFromCents(null)).toBeNull()
    expect(formatUsdFromCents(undefined)).toBeNull()
    expect(formatUsdFromCents(Number.NaN)).toBeNull()
    expect(formatUsdFromCents(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatUsdFromCents(0)).toBeNull()
    expect(formatUsdFromCents(-100)).toBeNull()
  })

  it('formats small values with two decimals', () => {
    expect(formatUsdFromCents(50)).toBe('$0.50')
    expect(formatUsdFromCents(2599)).toBe('$25.99')
  })

  it('formats $100–$999 as whole dollars', () => {
    expect(formatUsdFromCents(10000)).toBe('$100')
    expect(formatUsdFromCents(24249)).toBe('$242')
  })

  it('formats $1000–$9999 with commas', () => {
    expect(formatUsdFromCents(120_000)).toBe('$1,200')
    expect(formatUsdFromCents(999_900)).toBe('$9,999')
  })

  it('formats $10k+ compactly', () => {
    expect(formatUsdFromCents(2_500_000)).toBe('$25.0k')
  })

  it('formats $1M+ with M suffix', () => {
    expect(formatUsdFromCents(150_000_000)).toBe('$1.50M')
  })

  it('never returns "$0" strings', () => {
    // Regression guard against showing a $0 placeholder for missing data.
    for (const cents of [0, -1, null, undefined, Number.NaN]) {
      expect(formatUsdFromCents(cents as number | null | undefined)).toBeNull()
    }
  })
})

// ── formatSignedPct / movementVariantFor ─────────────────────────

describe('formatSignedPct', () => {
  it('returns null for null / non-finite', () => {
    expect(formatSignedPct(null)).toBeNull()
    expect(formatSignedPct(undefined)).toBeNull()
    expect(formatSignedPct(Number.NaN)).toBeNull()
  })

  it('signs positive moves with +', () => {
    expect(formatSignedPct(3.1)).toBe('+3.1%')
    expect(formatSignedPct(15)).toBe('+15.0%')
  })

  it('preserves the minus sign on negative moves', () => {
    expect(formatSignedPct(-2.4)).toBe('-2.4%')
  })

  it('rounds to 1 decimal', () => {
    expect(formatSignedPct(3.15)).toMatch(/^\+3\.[12]%$/)
  })
})

describe('movementVariantFor', () => {
  it('null / non-finite → null', () => {
    expect(movementVariantFor(null)).toBeNull()
    expect(movementVariantFor(Number.NaN)).toBeNull()
  })

  it('|pct| below MIN_MEANINGFUL_PCT_MOVE → flat', () => {
    expect(movementVariantFor(MIN_MEANINGFUL_PCT_MOVE - 0.01)).toBe('flat')
    expect(movementVariantFor(-MIN_MEANINGFUL_PCT_MOVE + 0.01)).toBe('flat')
  })

  it('positive above threshold → up', () => {
    expect(movementVariantFor(MIN_MEANINGFUL_PCT_MOVE + 0.5)).toBe('up')
  })

  it('negative below threshold → down', () => {
    expect(movementVariantFor(-(MIN_MEANINGFUL_PCT_MOVE + 0.5))).toBe('down')
  })
})

// ── formatFreshnessDate ─────────────────────────────────────────

describe('formatFreshnessDate', () => {
  const NOW = Date.parse('2026-07-22T00:00:00Z')

  it('returns null for bad input', () => {
    expect(formatFreshnessDate(null)).toBeNull()
    expect(formatFreshnessDate('')).toBeNull()
    expect(formatFreshnessDate('nonsense')).toBeNull()
    expect(formatFreshnessDate(42 as unknown as string)).toBeNull()
  })

  it('formats a recent ISO date as "18 July 2026"', () => {
    expect(formatFreshnessDate('2026-07-18T10:00:00Z', NOW)).toMatch(/July 2026/)
  })

  it('rejects dates > 2 years in the past (stale row)', () => {
    expect(formatFreshnessDate('2020-01-01T00:00:00Z', NOW)).toBeNull()
  })

  it('rejects dates in the near future (clock skew guard)', () => {
    expect(formatFreshnessDate('2029-01-01T00:00:00Z', NOW)).toBeNull()
  })
})

// ── cleanCardName / buildCardNumberLabel ────────────────────────

describe('cleanCardName', () => {
  it('strips trailing #NN', () => {
    expect(cleanCardName('Pikachu #95')).toBe('Pikachu')
  })

  it('preserves inline brackets like [1st Edition]', () => {
    expect(cleanCardName('Charizard [1st Edition] #4')).toBe('Charizard [1st Edition]')
  })

  it('handles nullish input', () => {
    expect(cleanCardName(null)).toBe('')
    expect(cleanCardName(undefined)).toBe('')
  })
})

describe('buildCardNumberLabel', () => {
  it('prefers card_number_display when set has multiple cards', () => {
    expect(buildCardNumberLabel({ card_number_display: '95/165', set_printed_total: 165, card_number: '95' })).toBe('95/165')
  })

  it('falls back to #card_number when set has one card', () => {
    expect(buildCardNumberLabel({ card_number_display: '1/1', set_printed_total: 1, card_number: '1' })).toBe('#1')
  })

  it('returns null when nothing usable', () => {
    expect(buildCardNumberLabel({})).toBeNull()
  })
})

// ── computeGradingPremium ───────────────────────────────────────

describe('computeGradingPremium — pure', () => {
  it('returns null when raw is missing / null / zero / non-finite', () => {
    expect(computeGradingPremium(null, 5000)).toBeNull()
    expect(computeGradingPremium(0,    5000)).toBeNull()
    expect(computeGradingPremium(-100, 5000)).toBeNull()
    expect(computeGradingPremium(Number.NaN, 5000)).toBeNull()
  })

  it('returns null when PSA 10 is missing / null / non-positive / non-finite', () => {
    expect(computeGradingPremium(1000, null)).toBeNull()
    expect(computeGradingPremium(1000, 0)).toBeNull()
    expect(computeGradingPremium(1000, -100)).toBeNull()
    expect(computeGradingPremium(1000, Number.NaN)).toBeNull()
  })

  it('returns null when raw is below MIN_RAW_CENTS_FOR_PREMIUM (noise floor)', () => {
    expect(computeGradingPremium(MIN_RAW_CENTS_FOR_PREMIUM - 1, 5000)).toBeNull()
    // At the boundary, the multiple is 5000/49 ~= 102, which is well
    // above MIN_PREMIUM_MULTIPLE, so the RAW noise-floor is what's
    // being tested here.
  })

  it('returns null when the ratio is below MIN_PREMIUM_MULTIPLE (not a real premium)', () => {
    // raw 1000c, psa10 1100c → 1.1× ratio, below 1.2× floor.
    expect(computeGradingPremium(1000, 1100)).toBeNull()
  })

  it('returns null when the ratio exceeds MAX_PREMIUM_MULTIPLE (implausible)', () => {
    // raw 100c ($1), psa10 1_000_000c ($10k) → 10000× → capped.
    expect(computeGradingPremium(100, 1_000_000)).toBeNull()
  })

  it('returns a 1-decimal ratio for a coherent pair', () => {
    // $10 raw, $85 PSA 10 → 8.5×
    expect(computeGradingPremium(1_000, 8_500)).toBe(8.5)
  })

  it('rounds to one decimal', () => {
    expect(computeGradingPremium(1_000, 3_133)).toBe(3.1)
    expect(computeGradingPremium(1_000, 3_150)).toBe(3.2)
  })

  it('accepts the maximum plausible multiple exactly', () => {
    expect(computeGradingPremium(1000, 1000 * MAX_PREMIUM_MULTIPLE)).toBe(MAX_PREMIUM_MULTIPLE)
  })
})

// ── buildCardQuickFacts ────────────────────────────────────────

const baseCard: CardQuickFactsCardInput = {
  card_name:           'Greninja #144',
  set_name:            'Celebrations',
  card_number:         '144',
  card_number_display: '144/25',
  set_printed_total:   25,
  card_url_slug:       'greninja-gold-star-swsh144',
  card_slug:           '959616',
  raw_usd:             1_840,   // $18.40
  psa9_usd:            null,
  psa10_usd:           16_200,  // $162.00
  is_sealed:           false,
}

describe('buildCardQuickFacts — assembly', () => {
  it('renders raw + PSA 10 + grading premium when all present', () => {
    const out = buildCardQuickFacts(baseCard, null)
    expect(out.render).toBe(true)
    const keys = out.facts.map(f => f.key)
    expect(keys).toContain('raw')
    expect(keys).toContain('psa10')
    expect(keys).toContain('psa10_premium')
    const premium = out.facts.find(f => f.key === 'psa10_premium')
    expect(premium?.value).toBe('8.8× raw')
    expect(out.gradingPremiumMultiple).toBe(8.8)
    expect(out.currencyLabel).toBe('USD')
  })

  it('renders a raw-only card (no PSA fields)', () => {
    const out = buildCardQuickFacts({ ...baseCard, psa9_usd: null, psa10_usd: null }, null)
    expect(out.render).toBe(true)
    const keys = out.facts.map(f => f.key)
    expect(keys).toEqual(['raw'])
    expect(out.gradingPremiumMultiple).toBeNull()
  })

  it('renders a PSA-only card (no raw) with no grading premium fact', () => {
    const out = buildCardQuickFacts({ ...baseCard, raw_usd: null }, null)
    expect(out.render).toBe(true)
    const keys = out.facts.map(f => f.key)
    expect(keys).toContain('psa10')
    expect(keys).not.toContain('psa10_premium')
    expect(out.gradingPremiumMultiple).toBeNull()
  })

  it('OMITS the block when every price field is missing', () => {
    const out = buildCardQuickFacts({ ...baseCard, raw_usd: null, psa9_usd: null, psa10_usd: null }, null)
    expect(out.render).toBe(false)
    expect(hasEnoughFacts(out)).toBe(false)
  })

  it('OMITS the block when card input is null', () => {
    const out = buildCardQuickFacts(null, null)
    expect(out.render).toBe(false)
    expect(hasEnoughFacts(out)).toBe(false)
  })

  it('adds movement facts only when |pct| >= MIN_MEANINGFUL_PCT_MOVE and NOT flat', () => {
    const out = buildCardQuickFacts(baseCard, {
      raw_pct_7d:  0.4,    // below threshold — skip
      raw_pct_30d: -4.2,   // above threshold — include
    })
    const keys = out.facts.map(f => f.key)
    expect(keys).not.toContain('raw_pct_7d')
    expect(keys).toContain('raw_pct_30d')
    const move30 = out.facts.find(f => f.key === 'raw_pct_30d')
    expect(move30?.variant).toBe('down')
    expect(move30?.value).toBe('-4.2%')
  })

  it('W46C-FIX1 — freshness fact is labelled "Price trend updated" (not "Market data")', () => {
    const NOW = Date.parse('2026-07-22T00:00:00Z')
    const out = buildCardQuickFacts(
      baseCard,
      { raw_pct_30d: -4.2, updated_at: '2026-07-18T10:00:00Z' },
      { nowMs: NOW },
    )
    const fresh = out.facts.find(f => f.key === 'updated_at')
    expect(fresh?.label).toBe('Price trend updated')
    expect(fresh?.label).not.toBe('Market data updated')
    expect(fresh?.value).toMatch(/July 2026/)
  })

  it('W46C-FIX1 — freshness fact renders ONLY when a movement fact is also rendered', () => {
    const NOW = Date.parse('2026-07-22T00:00:00Z')
    // No movement supplied → no freshness fact even though the ISO date is valid.
    const noMove = buildCardQuickFacts(
      baseCard,
      { updated_at: '2026-07-18T10:00:00Z' },
      { nowMs: NOW },
    )
    expect(noMove.facts.find(f => f.key === 'updated_at')).toBeUndefined()

    // Movement present → freshness fact appears.
    const withMove = buildCardQuickFacts(
      baseCard,
      { raw_pct_7d: -3.2, updated_at: '2026-07-18T10:00:00Z' },
      { nowMs: NOW },
    )
    expect(withMove.facts.find(f => f.key === 'updated_at')).toBeDefined()
  })

  it('W46C-FIX1 — flat / null / non-finite movement never triggers the freshness fact', () => {
    const NOW = Date.parse('2026-07-22T00:00:00Z')
    for (const bad of [null, undefined, Number.NaN, 0, 0.4] as const) {
      const out = buildCardQuickFacts(
        baseCard,
        { raw_pct_30d: bad as number | null | undefined, updated_at: '2026-07-18T10:00:00Z' },
        { nowMs: NOW },
      )
      expect(out.facts.find(f => f.key === 'updated_at')).toBeUndefined()
    }
  })

  it('does NOT render a freshness fact for a stale timestamp even if movement is present', () => {
    const NOW = Date.parse('2026-07-22T00:00:00Z')
    const out = buildCardQuickFacts(
      baseCard,
      { raw_pct_30d: -4.2, updated_at: '2018-01-01T10:00:00Z' },
      { nowMs: NOW },
    )
    expect(out.facts.find(f => f.key === 'updated_at')).toBeUndefined()
  })

  it('never emits a zero-value placeholder', () => {
    const out = buildCardQuickFacts({ ...baseCard, raw_usd: 0, psa9_usd: 0, psa10_usd: 0 }, null)
    expect(out.render).toBe(false)
    for (const f of out.facts) expect(f.value).not.toMatch(/\$0(\.|$)/)
  })

  it('exposes cleaned displayName + card number label', () => {
    const out = buildCardQuickFacts(baseCard, null)
    expect(out.displayName).toBe('Greninja')
    expect(out.cardNumberLabel).toBe('144/25')
  })

  it('never mutates the input card or trend', () => {
    const card = { ...baseCard }
    const trend = { raw_pct_30d: 3.4, updated_at: '2026-07-18T10:00:00Z' }
    const cardCopy = { ...card }
    const trendCopy = { ...trend }
    buildCardQuickFacts(card, trend)
    expect(card).toEqual(cardCopy)
    expect(trend).toEqual(trendCopy)
  })
})
