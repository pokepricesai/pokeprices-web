// src/lib/dashboard/potentialDeals.ts
//
// Block 5A-W-43A — read-only loader for the dashboard's "Potential
// eBay deals" section.
//
// Reads from the shared `daily_deals` table (populated nightly by the
// sister scraper repo's detect_deals.py; producer deletes rows older
// than 1 day). This loader adds STRICTER filters than the producer so
// the dashboard shows only the safest subset:
//
//   * confidence          = 'high'   (drops the producer's 'medium' floor)
//   * seller_feedback_score >= 100   (raises the producer's 50 floor)
//   * detected_at within the last 48h (covers "today's run + yesterday
//                                     if today's cron hasn't fired yet")
//
// The producer detects deals only for BUY_IT_NOW listings (see
// ebay_scraper.py::search where `filter=buyingOptions:{FIXED_PRICE}`
// is set), so no auction filter is needed here.
//
// Fail-closed: any error returns [] rather than throwing so the
// dashboard render never crashes on a Supabase hiccup.
//
// Language rules enforced downstream: no "guaranteed", "profit",
// "flip", "arbitrage" copy anywhere in the section that consumes this
// output.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PotentialDeal {
  card_slug:             string | null
  card_name:             string | null
  set_name:              string | null
  marketplace:           string | null
  total_cost_cents:      number | null
  currency:              string | null
  fair_value_cents:      number | null
  discount_pct:          number | null
  confidence:            string | null
  seller_feedback_score: number | null
  item_web_url:          string | null
  item_image_url:        string | null
  condition:             string | null
  detected_at:           string | null
  ebay_item_id:          string | number | null
}

/** Columns the loader selects from `daily_deals`. Kept as a constant
 *  so the loader test can assert on the exact projection without
 *  restating the list. */
export const POTENTIAL_DEALS_COLUMNS =
  'card_slug, card_name, set_name, marketplace, total_cost_cents, currency, ' +
  'fair_value_cents, discount_pct, confidence, seller_feedback_score, ' +
  'item_web_url, item_image_url, condition, detected_at, ebay_item_id'

const DEFAULT_LIMIT       = 5
/** Over-fetch multiplier — the client dedupes by ebay_item_id, so we
 *  ask for more rows than we ultimately render to keep the visible
 *  window at `limit` after dedupe. */
const OVERFETCH_MULTIPLIER = 3

/** How far back to accept a detected_at value. detect_deals.py stores
 *  it as `date.today().isoformat()` (day-only) and deletes rows older
 *  than 1 day; a 48-hour cutoff catches today's fresh rows AND
 *  yesterday's if today's run hasn't fired yet, regardless of the
 *  viewer's timezone. */
export function computeDealsCutoff(nowMs: number = Date.now()): string {
  return new Date(nowMs - 48 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function loadPotentialDeals(
  supa: SupabaseClient,
  opts?: { limit?: number },
): Promise<PotentialDeal[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const cutoff = computeDealsCutoff()
  try {
    const { data, error } = await supa
      .from('daily_deals')
      .select(POTENTIAL_DEALS_COLUMNS)
      .eq('confidence', 'high')
      .gte('seller_feedback_score', 100)
      .gte('detected_at', cutoff)
      .order('discount_pct', { ascending: false })
      .limit(limit * OVERFETCH_MULTIPLIER)
    if (error || !Array.isArray(data)) return []

    // Dedupe by ebay_item_id (fallback to item_web_url) so the same
    // listing detected twice in the 48-hour window renders once.
    // Cast via `unknown` because PostgREST's typed builder narrows
    // .select(string) to GenericStringError[] in the failure branch —
    // we've already ruled that out via the `error || !Array.isArray`
    // guard above.
    const rows = data as unknown as PotentialDeal[]
    const seen = new Set<string>()
    const deduped: PotentialDeal[] = []
    for (const row of rows) {
      const key = String(row.ebay_item_id ?? row.item_web_url ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(row)
      if (deduped.length >= limit) break
    }
    return deduped
  } catch {
    return []
  }
}
