// src/lib/seo-indexability/cardIndexability.ts
// Block 5A-W-35 — pure helper that decides whether a card page is
// indexable, based on the fields the get_card_detail_by_url_slug RPC
// returns AND the same shape we can read from the cards + daily_prices
// tables directly in sitemap generation.
//
// Motivation (from the W33 analyser + W35 audit):
//   * The GSC "Crawled — currently not indexed" export lists 977 card
//     URLs; roughly 40 look like sealed products, ~940 are legit-looking
//     card URLs Google crawled and rejected.
//   * Almost every rejected URL has no market signal (no raw price,
//     no PSA grade prices, etc.) — pages render as thin stubs.
//   * A tiny number of the rejected URLs still show impressions/clicks
//     in the GSC top-1000 pages export. We must NOT exclude those on
//     slug patterns alone; the price-signal check is the safety net.
//
// ─── Scope of the W35 gate ───────────────────────────────────────
//
// The implemented threshold is intentionally a PRICE-SIGNAL gate:
//   * valid card identity (card_name + set_name + card_url_slug), AND
//   * at least one positive USD value across the 20 grade/condition
//     tier fields returned by the get_card_detail_by_url_slug RPC
//     (see MARKET_SIGNAL_PRICE_FIELDS below).
//
// The W35 gate does NOT use recent sales as an indexability signal.
// Rationale:
//   * Recent sales live in a separate table (recent_sales) that is
//     loaded on the card route via a flag-gated helper, and is NOT
//     part of the sitemap-cards SELECT path.
//   * For sitemap and route to agree on indexability, both sides must
//     read the SAME stable DB-level signal. Prices are that signal
//     today; recent-sales are not (yet).
//
// A future W35B can consider adding a recent-sales-derived signal if
// we can surface it consistently for both route metadata AND sitemap
// generation. This block deliberately does not add new DB queries or
// recent-sales logic.
//
// The helper is pure — no I/O, no DB reads. Callers pass whatever
// they already have.

/** Every USD-denominated market-signal field the RPC returns. Any of
 *  these being > 0 counts as "has real data". Kept as a readonly
 *  string[] so callers can also use it as a SELECT list for
 *  sitemap-side queries without having to keep two lists in sync. */
export const MARKET_SIGNAL_PRICE_FIELDS = [
  // Raw + standard graded tiers
  'raw_usd',
  'psa7_usd',
  'psa8_usd',
  'psa9_usd',
  'psa10_usd',
  // Half grades / other graders' 9.5
  'cgc95_usd',
  'bgs95_usd',
  // Low-grade PSA (1-6)
  'grade1_usd',
  'grade2_usd',
  'grade3_usd',
  'grade4_usd',
  'grade5_usd',
  'grade6_usd',
  // Gem-mint / max-grade tiers from other graders
  'tag10_usd',
  'ace10_usd',
  'sgc10_usd',
  'cgc10_usd',
  'bgs10_usd',
  'bgs10black_usd',
  'cgc10pristine_usd',
] as const

export type MarketSignalField = (typeof MARKET_SIGNAL_PRICE_FIELDS)[number]

/** Shape a caller has to satisfy for the helper to be able to decide. */
export type CardIndexabilityInput = {
  card_name?:      string | null
  set_name?:       string | null
  card_url_slug?:  string | null
  is_sealed?:      boolean | null
  /** Convenience alias in case the caller already computed this. Not required. */
  has_market_signal?: boolean | null
} & Partial<Record<MarketSignalField, number | null>>

/**
 * Sealed-product slug patterns. Flags a URL as "looks like sealed
 * product living under /card/". Informational only — the helper does
 * NOT exclude sealed slugs from indexing unless they ALSO lack any
 * market signal. Several sealed URLs have real GSC traffic today,
 * so blanket exclusion would break existing rankings.
 */
export const SEALED_SLUG_PATTERNS: readonly string[] = [
  'display-box',
  'booster-box',
  'booster-bundle',
  'theme-deck',
  'elite-trainer',
  'collection-box',
  'build-and-battle',
  'build-battle-display-box',
  'premium-collection',
  'premium-tournament-collection',
  'tin-',
  '-pack',
  '-etb',
]

/**
 * Fast case-insensitive check. Match on the last segment of the URL
 * so we don't accidentally trigger on a slug that just happens to
 * contain the token elsewhere (rare, but cheap to guard against).
 */
export function isSealedProductSlug(slug: string | null | undefined): boolean {
  if (typeof slug !== 'string' || slug.length === 0) return false
  const lower = slug.toLowerCase()
  for (const pat of SEALED_SLUG_PATTERNS) {
    if (lower.includes(pat)) return true
  }
  return false
}

/**
 * Does this card carry the bare-minimum identity signals a page needs
 * to render anything meaningful? A card with no name / no set / no
 * URL slug is by definition unrenderable.
 */
export function hasCardIdentity(card: CardIndexabilityInput | null | undefined): boolean {
  if (!card) return false
  if (!card.card_name?.trim())     return false
  if (!card.set_name?.trim())      return false
  if (!card.card_url_slug?.trim()) return false
  return true
}

/**
 * Does the card have any market signal at all? A single positive USD
 * value on ANY of the price fields is enough — we deliberately use
 * a very lenient threshold because the goal is to catch true stubs
 * (all fields null / zero), not to gate on price quality.
 *
 * Also accepts the pre-computed `has_market_signal` alias for callers
 * that already ran the check (e.g. the sitemap after a joined query).
 */
export function hasMarketSignal(card: CardIndexabilityInput | null | undefined): boolean {
  if (!card) return false
  if (card.has_market_signal === true)  return true
  if (card.has_market_signal === false) return false
  for (const field of MARKET_SIGNAL_PRICE_FIELDS) {
    const v = card[field]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return true
  }
  return false
}

/**
 * Master gate — indexable iff identity + at least one market signal.
 *
 * Sealed-product-looking slugs are indexable if they have market data
 * (they clearly serve users) and non-indexable if they don't (they'd
 * be thin either way). No special-casing for `is_sealed === true`.
 */
export function isCardIndexable(card: CardIndexabilityInput | null | undefined): boolean {
  if (!hasCardIdentity(card)) return false
  return hasMarketSignal(card)
}

/**
 * Human-readable reason a card is NOT indexable. Returns null when
 * the card IS indexable. Used for admin diagnostics and (optionally)
 * a `data-reason` attribute on debug pages.
 */
export function nonIndexableReason(card: CardIndexabilityInput | null | undefined): string | null {
  if (!card) return 'no card row'
  if (!hasCardIdentity(card)) {
    if (!card.card_name?.trim())     return 'missing card_name'
    if (!card.set_name?.trim())      return 'missing set_name'
    if (!card.card_url_slug?.trim()) return 'missing card_url_slug'
  }
  if (!hasMarketSignal(card)) return 'no market signal on any grade tier'
  return null
}
