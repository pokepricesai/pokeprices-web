// src/lib/seo/admin/types.ts
// Shared types for the /admin/seo Mission Control dashboard.
//
// All numeric values are exact integers read from the SEO tables.
// Position values are 1-based (BigQuery zero-based sum_position is
// already offset by +1 at read time — see the migration notes on
// seo_gsc_page_daily.sum_position).

export type PageTypeKey =
  | 'homepage' | 'card' | 'set' | 'pokemon' | 'illustrator'
  | 'creator'  | 'insight' | 'card_show' | 'vendor'
  | 'dashboard' | 'ai_assistant' | 'browse'
  | 'quick_price' | 'grading' | 'auth' | 'other'
// Not a registry page_type — used only in the page-type breakdown to
// carry rollup rows whose canonical URL has no matching row in
// seo_pages (e.g. legacy /card/[slug] URLs Google still cites).
// Kept as an explicit bucket rather than silently dropped so the
// dashboard totals reconcile to the rollup table.
export type PageTypeBucketKey = PageTypeKey | 'unmatched'

/** Site-wide KPI snapshot for the latest `seo_kpi_daily` (source=google). */
export type LatestKpi = {
  as_of_date: string                  // '2026-09-16'
  clicks_28d: number
  impressions_28d: number
  pages_with_impressions_28d: number
  pages_ge1_click_28d: number
  pages_ge10_click_28d: number
  pages_ge28_click_28d: number
  total_urls_known: number
  urls_indexable: number
  urls_in_sitemap: number
  sum_position_28d: number | null     // additive primitive
  ctr_28d: number | null              // derived: clicks/impressions
  avg_position_28d: number | null     // derived: (sum_position / impressions) + 1
  refreshed_at: string | null
}

/** Aggregates over a specific date window derived from
 *  seo_gsc_page_daily. */
export type PeriodTotals = {
  from: string
  to: string
  days: number
  impressions: number
  clicks: number
  sum_position: number
  ctr: number | null                  // clicks/impressions
  avg_position: number | null         // (sum_position / impressions) + 1
}

/** Row per calendar date, summed across all URLs. */
export type DailyPoint = {
  date: string                        // 'YYYY-MM-DD'
  clicks: number
  impressions: number
  ctr: number | null
  avg_position: number | null
}

/** Momentum comparison between two consecutive 7-day windows. */
export type MomentumBlock = {
  current: PeriodTotals
  previous: PeriodTotals
  click_pct_change: number | null
  impression_pct_change: number | null
  ctr_delta: number | null                     // absolute pp difference (not %)
  avg_position_delta: number | null            // negative = improvement
}

/** Per-page-type aggregate (28-day window). */
export type PageTypeRow = {
  page_type: PageTypeBucketKey
  urls_known: number                  // count in seo_pages
  urls_visible_28d: number            // pages with impressions_28d > 0
  clicks_28d: number
  impressions_28d: number
  sum_position_28d: number
  productive_28d: number              // count with clicks_28d >= 28
  ctr_28d: number | null
  avg_position_28d: number | null
}

/** Row shown in the top-pages table. */
export type TopPageRow = {
  url: string                         // canonical URL
  raw_urls: string[]                  // one or more raw variants that folded to this canonical
  page_type: PageTypeBucketKey
  entity_id: string | null
  clicks_28d: number
  impressions_28d: number
  sum_position_28d: number
  ctr_28d: number | null
  avg_position_28d: number | null
  productive_28d: boolean
}

/** Reconciliation results for the page-type aggregation. All numbers
 *  are from `seo_page_rollups` (canonically deduped). If any invariant
 *  is `false`, the client should surface it in the data-health section
 *  rather than silently displaying an incomplete table. */
export type ReconciliationBlock = {
  // Aggregate totals from the canonical-deduped rollups.
  rollup_clicks_28d: number
  rollup_impressions_28d: number
  rollup_visible_28d: number
  rollup_productive_28d: number

  // Canonicalisation stats.
  rollup_rows_loaded: number
  rollup_rows_canonicalisation_failed: number   // URL parse or wrong host
  rollup_canonical_urls: number                 // after dedup

  // Match stats vs seo_pages (all lookups performed on canonical URL).
  matched_pages_lookup: number
  unmatched_pages_lookup: number
  unmatched_visible_28d: number
  unmatched_clicks_28d: number
  unmatched_impressions_28d: number

  // Page-type breakdown reconciliation. These are TRUE iff
  // SUM(page_types.<metric>) === rollup_<metric>. If any is false, the
  // dashboard is dropping rollup data somewhere and the table must not
  // be trusted.
  invariants: {
    clicks_match_rollup: boolean
    impressions_match_rollup: boolean
    visible_match_rollup: boolean
    productive_match_rollup: boolean
  }

  // KPI vs rollup — advisory only. The KPI row is a separate write
  // path and can drift from the rollup snapshot in rare cases (e.g.
  // stale rollup rows carried across --as-of-date changes; see the
  // "aging-out deferred" note in refresh-rollups-and-kpi.mjs).
  kpi_clicks_28d: number
  kpi_impressions_28d: number
  kpi_visible_28d: number
  kpi_productive_28d: number
  kpi_vs_rollup_delta: {
    clicks: number
    impressions: number
    visible: number
    productive: number
  }
}

/** Funnel numbers — every value read from the latest KPI row or from
 *  seo_pages / seo_page_rollups, never fabricated. */
export type FunnelBlock = {
  known: number
  in_sitemap: number
  visible_28d: number
  clicks_ge1_28d: number
  clicks_ge10_28d: number
  clicks_ge28_28d: number
}

/** Coverage / visibility gap. */
export type VisibilityBlock = {
  known_zero_visibility: number       // known URLs with 0 impressions in 28d
  sitemap_zero_visibility: number     // sitemap URLs with 0 impressions in 28d
  visible_no_clicks: number           // impressions>0 AND clicks_28d = 0
  visible_ge1_click: number           // clicks_28d >= 1
  visible_productive: number          // clicks_28d >= 28
}

/** Data-health snapshot. */
export type DataHealthBlock = {
  latest_gsc_date: string | null
  latest_gsc_date_source: 'google' | 'bing' | null
  latest_kpi_date: string | null
  latest_kpi_refreshed_at: string | null
  latest_ingest_at: string | null
  latest_ingest_kind: string | null
  latest_ingest_status: string | null
  registry_size: number               // count of seo_pages rows
  registry_last_seen_max: string | null    // MAX(last_seen_at) proxy for last refresh
  recent_failures: Array<{
    started_at: string
    ended_at: string | null
    job_kind: string
    source: string
    error: string | null
  }>
}

/** Everything the client needs to render the dashboard in one shot. */
export type MissionControlPayload = {
  target_date: string                 // '2026-12-25'
  target_clicks_per_day_min: number   // 4000
  target_clicks_per_day_max: number   // 5000
  as_of_date: string                  // latest KPI date
  latest_gsc_date: string | null
  days_to_target: number
  bq_export_started_on: string        // '2026-09-16' — annotation only
  kpi: LatestKpi
  funnel: FunnelBlock
  visibility: VisibilityBlock
  daily: DailyPoint[]                 // ordered oldest → newest, no gaps? gaps preserved
  momentum: MomentumBlock | null
  page_types: PageTypeRow[]
  top_pages: TopPageRow[]
  reconciliation: ReconciliationBlock
  data_health: DataHealthBlock
}
