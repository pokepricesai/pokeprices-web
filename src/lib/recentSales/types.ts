// src/lib/recentSales/types.ts
// Block 4B-W-1 — typed mirror of the recent-sales database schema.
//
// These types MUST stay in sync with:
//   migrations/2026-06-17-recent-sales-stage-1.sql
//   recent_sales_parser@v1 (scraper repo)
//
// Constraints:
//   * No UI-only fields. Anything not stored on the row stays out of
//     these types.
//   * Status enums match the SQL CHECK constraints exactly.
//   * parse_confidence is INTEGER 0-100 (parser scale), NOT 0-1.
//   * provider_sale_key is the authoritative dedup identity.
//   * raw_hash is NOT unique.
//   * marketplace_item_id is NOT unique.

// ─────────────────────────────────────────────────────────────────────
// Enums (sourced from SQL CHECK constraints)
// ─────────────────────────────────────────────────────────────────────

export type RecentSaleParseStatus =
  | 'ok'
  | 'quarantined'
  | 'rejected'

export type RecentSaleReviewStatus =
  | 'active'
  | 'superseded'
  | 'corrected'
  | 'dismissed'

/**
 * Operator marketplace bucket. The string is preserved from the
 * parser; this list is illustrative for typed code.
 */
export type RecentSaleMarketplace =
  | 'ebay'
  | 'heritage'
  | 'goldin'
  | 'tcgplayer'
  | 'other'
  | (string & {})  // forward-compatible fallback for parser additions

export type RecentSaleGradingCompany =
  | 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE'

export type RecentSaleConditionBucket =
  | 'mint' | 'near_mint' | 'lightly_played' | 'played' | 'poor' | 'unknown'

export type RecentSaleBestOfferStatus =
  | 'none' | 'accepted' | 'unknown'

export type RecentSaleFirstEditionStatus =
  | 'first_edition' | 'unlimited' | 'shadowless' | 'unknown'

export type RecentSaleRawOrGraded = 'raw' | 'graded'

export type ProviderCardLinkMatchMethod =
  | 'automatic' | 'manual' | 'admin_override' | 'heuristic'

export type MarketImportRunSource =
  | 'scraper_nightly' | 'admin_manual' | 'backfill' | 'pilot'

export type MarketImportRunStatus =
  | 'running' | 'success' | 'partial' | 'failed'

// ─────────────────────────────────────────────────────────────────────
// Identity / referential type aliases
// ─────────────────────────────────────────────────────────────────────

/** PriceCharting bare numeric product id, e.g. "959616". */
export type ProviderCardId = string

/** Branded provider literal — kept as a string union for forward compat. */
export type Provider = 'pricecharting'

/** Initial language coverage. Japanese arrives in a future workstream. */
export type RecentSaleLanguage = 'en'

// ─────────────────────────────────────────────────────────────────────
// Row shapes
// ─────────────────────────────────────────────────────────────────────

export type ProviderCardLink = {
  id:               string
  provider:         Provider
  /** Canonical convention: bare numeric, NEVER `pc-` prefixed. */
  provider_card_id: ProviderCardId
  /** Soft reference to scraper-owned cards.card_slug. */
  card_slug:        string | null
  language:         RecentSaleLanguage
  match_method:     ProviderCardLinkMatchMethod
  confidence:       number          // 0-1 NUMERIC
  is_active:        boolean
  notes_internal:   string | null   // service-role only; never to clients
  created_at:       string
  updated_at:       string
}

export type MarketImportRun = {
  id:               string
  provider:         Provider
  source:           MarketImportRunSource
  status:           MarketImportRunStatus
  started_at:       string
  completed_at:     string | null
  pages_processed:  number
  rows_ok:          number
  rows_quarantined: number
  rows_rejected:    number
  rows_duplicate:   number
  duration_ms:      number | null
  parser_version:   string | null
  layout_signature: string | null
  notes:            string | null
  created_at:       string
}

export type RecentSale = {
  // Identity
  id:                    string
  provider_sale_key:     string
  provider:              Provider
  provider_card_id:      ProviderCardId
  provider_card_link_id: string | null
  card_slug:             string | null
  internal_card_slug:    string

  // Observed sale
  pricecharting_url:     string
  observed_section:      string
  sale_date:             string
  marketplace_source:    RecentSaleMarketplace
  marketplace_country:   string | null
  listing_title:         string
  sale_price_cents:      number
  original_price_cents:  number | null
  display_currency:      string
  source_currency:       string | null
  grading_company:       RecentSaleGradingCompany | null
  grade:                 string | null
  raw_or_graded:         RecentSaleRawOrGraded | null
  condition_text:        string | null
  condition_bucket:      RecentSaleConditionBucket | null
  listing_url:           string | null
  /** Not globally unique — same item can re-appear under a different observed_section. */
  marketplace_item_id:   string | null
  best_offer_status:     RecentSaleBestOfferStatus | null
  language:              RecentSaleLanguage
  first_edition_status:  RecentSaleFirstEditionStatus | null
  variant_text:          string | null

  // Parser
  /** Content hash from the parser; NOT unique. Used for correction lookup. */
  raw_hash:              string
  parser_version:        string
  /** Parser confidence on the 0-100 integer scale (NOT 0-1). */
  parse_confidence:      number
  parse_status:          RecentSaleParseStatus
  rejection_reason:      string | null
  /** Arbitrary parser flags such as ['low_price','no_country']. */
  anomaly_flags:         ReadonlyArray<string>
  /** Application convention: populated only for quarantined/rejected/debug rows. */
  raw_metadata:          Record<string, unknown> | null
  source_attribution:    string
  import_run_id:         string | null

  // Lifecycle
  review_status:         RecentSaleReviewStatus
  superseded_by_id:      string | null
  first_seen_at:         string
  last_seen_at:          string
  created_at:            string
  updated_at:            string
}

export type RecentSalesCardAllowListRow = {
  id:               string
  provider:         Provider
  provider_card_id: ProviderCardId
  enabled:          boolean
  reason:           string | null
  created_at:       string
  updated_at:       string
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder aggregate
// ─────────────────────────────────────────────────────────────────────

/**
 * Placeholder shape for the future `rms_summary_30d(...)` RPC. The
 * fields here are reserved names; the RPC itself is not implemented in
 * this block. Treat as a contract sketch, not a guarantee.
 *
 * All currency-bearing fields are CENTS, USD, integer.
 */
export type RecentSaleSummary = {
  card_slug:             string
  observed_section:      string
  sample_count:          number
  median_cents:          number | null
  min_cents:             number | null
  max_cents:             number | null
  trimmed_p10_cents:     number | null
  trimmed_p90_cents:     number | null
  marketplace_split:     Record<string, number>   // marketplace_source → count
  best_offer_count:      number
  latest_sale_date:      string | null
  freshness_score:       number                   // 0-1
  freshness_label:       'fresh' | 'recent' | 'stale' | 'none'
  confidence:            'high' | 'medium' | 'low' | 'none'
}

// ─────────────────────────────────────────────────────────────────────
// Enum value lists — exported for tests and admin UIs
// ─────────────────────────────────────────────────────────────────────

export const RECENT_SALE_PARSE_STATUSES = [
  'ok','quarantined','rejected',
] as const satisfies ReadonlyArray<RecentSaleParseStatus>

export const RECENT_SALE_REVIEW_STATUSES = [
  'active','superseded','corrected','dismissed',
] as const satisfies ReadonlyArray<RecentSaleReviewStatus>

export const MARKET_IMPORT_RUN_STATUSES = [
  'running','success','partial','failed',
] as const satisfies ReadonlyArray<MarketImportRunStatus>

export const MARKET_IMPORT_RUN_SOURCES = [
  'scraper_nightly','admin_manual','backfill','pilot',
] as const satisfies ReadonlyArray<MarketImportRunSource>

export const PROVIDER_CARD_LINK_MATCH_METHODS = [
  'automatic','manual','admin_override','heuristic',
] as const satisfies ReadonlyArray<ProviderCardLinkMatchMethod>
