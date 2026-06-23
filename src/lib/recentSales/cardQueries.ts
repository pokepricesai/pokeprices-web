// src/lib/recentSales/cardQueries.ts
// Block 4B-W-4A — server-only read query that backs the
// "Recent verified sales" section on individual card pages.
//
// Returns operator-safe marketplace facts only — no PII anywhere.
// Filters to parse_status='ok' AND review_status='active', mirroring
// the public-RPC predicate documented in
// docs/recent-sales-architecture.md.
//
// Two entry points:
//   * getRecentSalesForCard(supa, slug, limit) — pure DB read; takes
//     the client so tests can inject a fake.
//   * loadRecentSalesForCardIfEnabled(slug, limit) — top-level
//     convenience used by the card page. Fail-closed: returns [] when
//     RECENT_SALES_FREE_PREVIEW_ENABLED is anything other than the
//     literal "true". When the flag is off the DB is NOT consulted.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { isFreePreviewEnabled } from './flags'

export type CardPageRecentSale = {
  saleDate:           string
  marketplaceSource:  string
  marketplaceCountry: string | null
  observedSection:    string
  rawOrGraded:        string | null
  gradingCompany:     string | null
  grade:              string | null
  conditionBucket:    string | null
  conditionText:      string | null
  bestOfferStatus:    string | null
  salePriceCents:     number
}

const DEFAULT_LIMIT = 15
const MAX_LIMIT     = 20

export async function getRecentSalesForCard(
  supa:  SupabaseClient,
  slug:  string,
  limit: number = DEFAULT_LIMIT,
): Promise<CardPageRecentSale[]> {
  if (!slug || typeof slug !== 'string') return []
  const bounded = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
  const { data, error } = await supa
    .from('recent_sales')
    .select('sale_date, marketplace_source, marketplace_country, observed_section, raw_or_graded, grading_company, grade, condition_bucket, condition_text, best_offer_status, sale_price_cents')
    .eq('internal_card_slug', slug)
    .eq('parse_status',  'ok')
    .eq('review_status', 'active')
    .order('sale_date', { ascending: false })
    .limit(bounded)
  if (error) {
    // Card page must keep rendering even if the read fails — recent
    // sales is a non-essential preview. Log to server console; return
    // empty so the section just disappears.
    // eslint-disable-next-line no-console
    console.warn('[recent-sales] card page read failed:', error.message)
    return []
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map(r => ({
    saleDate:           String(r.sale_date),
    marketplaceSource:  String(r.marketplace_source),
    marketplaceCountry: r.marketplace_country == null ? null : String(r.marketplace_country),
    observedSection:    String(r.observed_section),
    rawOrGraded:        r.raw_or_graded   == null ? null : String(r.raw_or_graded),
    gradingCompany:     r.grading_company == null ? null : String(r.grading_company),
    grade:              r.grade           == null ? null : String(r.grade),
    conditionBucket:    r.condition_bucket== null ? null : String(r.condition_bucket),
    conditionText:      r.condition_text  == null ? null : String(r.condition_text),
    bestOfferStatus:    r.best_offer_status == null ? null : String(r.best_offer_status),
    salePriceCents:     Number(r.sale_price_cents),
  }))
}

export async function loadRecentSalesForCardIfEnabled(
  slug:  string,
  limit?: number,
): Promise<CardPageRecentSale[]> {
  if (!isFreePreviewEnabled()) return []
  const supa = getSupabaseServiceClient()
  return getRecentSalesForCard(supa, slug, limit ?? DEFAULT_LIMIT)
}
