// src/lib/seo/quickFacts.ts
// Block 5A-W-46C — pure helpers for the card-page "Quick price facts"
// server-rendered block. Every function is deterministic + tested; the
// component (src/components/seo/CardPriceQuickFacts.tsx) is a thin
// server wrapper that turns the returned facts into JSX.
//
// DESIGN RULES (from the W46C brief)
//   * Never fabricate a value. If a source field is missing / zero /
//     non-finite, the corresponding fact is omitted from the returned
//     list — the caller must not render a "No data" placeholder.
//   * Only render the block when at least one meaningful fact is
//     available (see `hasEnoughFacts`).
//   * The grading premium math is exposed as its own pure helper so
//     unit tests can pin every edge case (zero raw, tiny raw, missing
//     PSA10, implausible ratio bounds).
//   * Currency is USD across the site's data model — daily_prices +
//     card_trends store *_usd columns as USD-CENTS. Any GBP display
//     is a downstream concern; this module does not attempt a GBP
//     conversion or a live FX rate. The brief allows a "relevant
//     currency" callout — we only include it when the source label
//     is explicitly USD.

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** Card identity + tier prices as returned by
 *  `get_card_detail_by_url_slug`. All price fields are USD cents. */
export type CardQuickFactsCardInput = {
  card_name:           string | null
  set_name:            string | null
  card_number?:        string | number | null
  card_number_display?: string | null
  set_printed_total?:  number | string | null
  card_url_slug?:      string | null
  card_slug?:          string | null
  image_url?:          string | null
  raw_usd?:            number | null
  psa9_usd?:           number | null
  psa10_usd?:          number | null
  is_sealed?:          boolean | null
}

/** Trend row as returned by `get_card_trends_detail`. */
export type CardQuickFactsTrendInput = {
  raw_pct_7d?:   number | null
  raw_pct_30d?:  number | null
  updated_at?:   string | null
} | null

/** One rendered fact. `key` is stable across renders so React can
 *  reuse DOM nodes and tests can pin ordering. `variant` lets the
 *  component style movement (up/down/flat) without re-deriving the
 *  sign from `value`. */
export type QuickFact = {
  key:     string
  label:   string
  value:   string
  variant?: 'default' | 'up' | 'down' | 'flat'
}

export type CardQuickFactsOutput = {
  /** Human display name with any trailing "#NN" stripped. */
  displayName: string
  /** e.g. "95/165" when the set has multiple cards, else "#95". */
  cardNumberLabel: string | null
  facts: QuickFact[]
  /** True when enough facts exist to make rendering worthwhile. */
  render: boolean
  /** Present when raw + PSA 10 both positive AND ratio in
   *  [MIN_PREMIUM_MULTIPLE, MAX_PREMIUM_MULTIPLE]. */
  gradingPremiumMultiple: number | null
  /** True when *_usd inputs are all USD cents (the site invariant). */
  currencyLabel: 'USD'
}

// ─────────────────────────────────────────────────────────────────────
// Constants + bounds (brief: reject "implausible or incoherent ratios")
// ─────────────────────────────────────────────────────────────────────

/** A card whose raw price is < $0.50 (50 cents) is too noisy for a
 *  meaningful grading multiple — a $0.10 raw / $50 PSA 10 pair gives
 *  a headline of "500× raw" that is technically true but useless. */
export const MIN_RAW_CENTS_FOR_PREMIUM = 50

/** Only display a grading multiple when it is genuinely above par. */
export const MIN_PREMIUM_MULTIPLE = 1.2

/** Cap the displayed multiple. Anything above 500× is either bad data
 *  (a cheap-tier confusion) or misleading to a lay reader — either
 *  way we suppress the chip. */
export const MAX_PREMIUM_MULTIPLE = 500

/** Minimum absolute pct move worth rendering. Sub-1% moves round to
 *  0.0% and read as noise. Matches MIN_MEANINGFUL_PCT in the weekly
 *  digest builder. */
export const MIN_MEANINGFUL_PCT_MOVE = 1

// ─────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────

/** Format USD cents. Never renders "$0.00" — a zero-cents input is
 *  treated as missing and returns null. */
export function formatUsdFromCents(cents: number | null | undefined): string | null {
  if (cents == null) return null
  if (!Number.isFinite(cents)) return null
  if (cents <= 0) return null
  const v = cents / 100
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000)    return `$${(v / 1_000).toFixed(1)}k`
  if (v >= 1_000)     return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (v >= 100)       return `$${v.toFixed(0)}`
  return `$${v.toFixed(2)}`
}

/** Signed percent with one decimal. Rounds sub-0.05% to 0.0%. */
export function formatSignedPct(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct)) return null
  const rounded = Math.round(pct * 10) / 10
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toFixed(1)}%`
}

/** Movement direction from a pct. */
export function movementVariantFor(pct: number | null | undefined): 'up' | 'down' | 'flat' | null {
  if (pct == null || !Number.isFinite(pct)) return null
  if (pct >   MIN_MEANINGFUL_PCT_MOVE) return 'up'
  if (pct < -MIN_MEANINGFUL_PCT_MOVE) return 'down'
  return 'flat'
}

/** ISO date → "18 July 2026". Returns null on any parse error or
 *  when the date is more than 2 years old (probably a stale row we
 *  should not badge as "market data updated ..."). */
export function formatFreshnessDate(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const d = new Date(iso)
  const ms = d.getTime()
  if (!Number.isFinite(ms)) return null
  const twoYearsAgo = nowMs - 2 * 365 * 24 * 60 * 60 * 1000
  if (ms < twoYearsAgo) return null
  if (ms > nowMs + 60 * 60 * 1000) return null // clock skew guard
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Strip a trailing `#NN` or `#NN<suffix>` from the DB card_name.
 *  DB stores names as "Pikachu #95"; the display H1 wants "Pikachu". */
export function cleanCardName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s*#\d+\w*\s*$/, '').trim()
}

/** Prefer "95/165" when the set has multiple cards; else "#95". */
export function buildCardNumberLabel(input: {
  card_number?:        string | number | null
  card_number_display?: string | null
  set_printed_total?:  number | string | null
}): string | null {
  const total = input.set_printed_total == null
    ? 0
    : Number(input.set_printed_total)
  if (input.card_number_display && Number.isFinite(total) && total > 1) {
    return String(input.card_number_display)
  }
  if (input.card_number != null && String(input.card_number).length > 0) {
    return `#${input.card_number}`
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Grading premium — pure
// ─────────────────────────────────────────────────────────────────────

/** Compute PSA 10 / raw as a ratio. Returns null when:
 *    * either input is missing / non-finite / non-positive
 *    * raw is below MIN_RAW_CENTS_FOR_PREMIUM (noise floor)
 *    * ratio is < MIN_PREMIUM_MULTIPLE (not a meaningful premium)
 *    * ratio is > MAX_PREMIUM_MULTIPLE (implausible)
 *  Rounding: to 1 decimal place. Pure; no I/O. */
export function computeGradingPremium(
  rawCents:   number | null | undefined,
  psa10Cents: number | null | undefined,
): number | null {
  if (rawCents   == null || !Number.isFinite(rawCents))   return null
  if (psa10Cents == null || !Number.isFinite(psa10Cents)) return null
  if (rawCents   < MIN_RAW_CENTS_FOR_PREMIUM)             return null
  if (psa10Cents <= 0)                                     return null
  const raw = rawCents
  const ratio = psa10Cents / raw
  if (!Number.isFinite(ratio))                             return null
  if (ratio < MIN_PREMIUM_MULTIPLE)                        return null
  if (ratio > MAX_PREMIUM_MULTIPLE)                        return null
  return Math.round(ratio * 10) / 10
}

// ─────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────

export type BuildQuickFactsOptions = {
  /** Injectable clock for the freshness test. Defaults to Date.now(). */
  nowMs?: number
}

/** Build the ordered list of facts + display metadata for the card.
 *  Pure — no I/O. Callers are responsible for making sure the card
 *  is indexable (see isCardIndexable). */
export function buildCardQuickFacts(
  card:  CardQuickFactsCardInput | null | undefined,
  trend: CardQuickFactsTrendInput,
  opts:  BuildQuickFactsOptions = {},
): CardQuickFactsOutput {
  const displayName = cleanCardName(card?.card_name ?? null)
  const cardNumberLabel = card ? buildCardNumberLabel({
    card_number:         card.card_number,
    card_number_display: card.card_number_display,
    set_printed_total:   card.set_printed_total,
  }) : null

  const facts: QuickFact[] = []
  if (!card) {
    return {
      displayName, cardNumberLabel, facts, render: false,
      gradingPremiumMultiple: null, currencyLabel: 'USD',
    }
  }

  const rawUsd   = card.raw_usd
  const psa9Usd  = card.psa9_usd
  const psa10Usd = card.psa10_usd

  // ── Price facts. Only emit when the source field is > 0 cents. ────
  const rawLabel   = formatUsdFromCents(rawUsd)
  const psa9Label  = formatUsdFromCents(psa9Usd)
  const psa10Label = formatUsdFromCents(psa10Usd)

  if (rawLabel) {
    facts.push({ key: 'raw',    label: 'Current raw value', value: rawLabel })
  }
  if (psa9Label) {
    facts.push({ key: 'psa9',   label: 'PSA 9 value', value: psa9Label })
  }
  if (psa10Label) {
    facts.push({ key: 'psa10',  label: 'PSA 10 value', value: psa10Label })
  }

  // ── Movement. Only emit when the pct is >= 1% either direction. ──
  const pct7  = trend?.raw_pct_7d
  const pct30 = trend?.raw_pct_30d
  const move7Label  = formatSignedPct(pct7 ?? null)
  const move30Label = formatSignedPct(pct30 ?? null)
  const move7Variant  = movementVariantFor(pct7 ?? null)
  const move30Variant = movementVariantFor(pct30 ?? null)
  let anyMovementRendered = false
  if (move7Label && move7Variant && move7Variant !== 'flat') {
    facts.push({ key: 'raw_pct_7d',  label: 'Raw value 7d',  value: move7Label,  variant: move7Variant })
    anyMovementRendered = true
  }
  if (move30Label && move30Variant && move30Variant !== 'flat') {
    facts.push({ key: 'raw_pct_30d', label: 'Raw value 30d', value: move30Label, variant: move30Variant })
    anyMovementRendered = true
  }

  // ── Grading premium. Pure helper handles the edge cases. ─────────
  const premium = computeGradingPremium(rawUsd ?? null, psa10Usd ?? null)
  if (premium != null) {
    facts.push({
      key:   'psa10_premium',
      label: 'PSA 10 premium vs raw',
      value: `${premium.toFixed(1)}× raw`,
    })
  }

  // ── Freshness. W46C-FIX1 — this timestamp comes from `card_trends`,
  //    which tracks raw-price MOVEMENT, not the point-in-time raw/PSA
  //    prices themselves. Labelling it "Market data updated" was
  //    misleading (it implied every price on the page was fetched on
  //    that date). We now:
  //      * relabel it "Price trend updated" so the scope is honest, AND
  //      * only render it when at least one movement fact is showing —
  //        a timestamp for a trend that produced no visible move is
  //        clutter without context.
  if (anyMovementRendered) {
    const freshLabel = formatFreshnessDate(trend?.updated_at ?? null, opts.nowMs)
    if (freshLabel) {
      facts.push({ key: 'updated_at', label: 'Price trend updated', value: freshLabel })
    }
  }

  // ── Render decision. At minimum, need one of the three price
  //    facts (raw / PSA 9 / PSA 10). Movement or freshness alone is
  //    not a "quick price fact".
  const hasAnyPrice = !!(rawLabel || psa9Label || psa10Label)

  return {
    displayName,
    cardNumberLabel,
    facts,
    render: hasAnyPrice,
    gradingPremiumMultiple: premium,
    currencyLabel: 'USD',
  }
}

/** Convenience: does the built output have enough to render? Mirrors
 *  `output.render` but exposed as a top-level function for callers
 *  that need to gate a wrapping element without recomputing facts. */
export function hasEnoughFacts(output: CardQuickFactsOutput | null | undefined): boolean {
  return !!output && output.render && output.facts.length > 0
}
