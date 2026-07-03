// src/lib/dashboard/potentialDeals.ts
//
// Block 5A-W-43A / 5A-W-43B — read-only loader for the dashboard's
// "Potential eBay deals" Pro section.
//
// Reads from the shared `daily_deals` table (populated nightly by the
// sister scraper repo's detect_deals.py; producer deletes rows older
// than 1 day). This loader applies STRICTER filters than the producer
// so the dashboard shows only the safest subset:
//
//   * confidence          = 'high'   (drops the producer's 'medium' floor)
//   * seller_feedback_score >= 100   (raises the producer's 50 floor)
//   * detected_at within the last 48h (covers "today's run + yesterday"
//                                     across timezones)
//   * item_web_url + ebay_item_id   both non-null — required for the
//                                     CTA to be a valid deep link
//   * card_name + set_name          exclude any row mentioning TOPPS
//                                     (case-insensitive)
//
// Optional: `cardSlugFilter` — restricts results to the caller's own
// watchlist. Empty array is treated as "no results" (matches Postgres
// IN () semantics). Undefined / null means "no filter".
//
// Producer detects deals only for BUY_IT_NOW listings (see
// ebay_scraper.py::search where `filter=buyingOptions:{FIXED_PRICE}`
// is set), so no auction filter is needed here. There is no explicit
// `active` / `sold` field on daily_deals; the freshness proxies below
// are the safest available substitute (documented so a future edit
// can add a real `active_flag` filter if the scraper starts writing
// one).
//
// Fail-closed: any error returns [] rather than throwing so the
// dashboard render never crashes on a Supabase hiccup.

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

const DEFAULT_LIMIT       = 30
const MIN_ITEM_ID_LENGTH  = 6

export type LoadPotentialDealsOptions = {
  /** Max rows returned after dedupe. Default 30 (client paginates
   *  in-memory). Also drives the DB-side over-fetch. */
  limit?:          number
  /** When provided, restricts results to deals whose `card_slug` is
   *  in this list — used for the Watchlist tab. `null`/`undefined`
   *  means "no filter" (Best deals tab). An empty array short-circuits
   *  to [] so we never hit the DB with `.in('card_slug', [])`. */
  cardSlugFilter?: string[] | null
}

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
  opts?: LoadPotentialDealsOptions,
): Promise<PotentialDeal[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const cardSlugFilter = opts?.cardSlugFilter ?? null

  // Empty watchlist → skip the round trip entirely; the caller will
  // render the "No watchlist deals" empty state.
  if (cardSlugFilter && cardSlugFilter.length === 0) return []

  const cutoff = computeDealsCutoff()

  try {
    // Chain the base filters that every path uses.
    // Note: PostgREST's builder is thenable + immutable-in-shape; the
    // `let` reassignments keep the type inference happy.
    let q: any = supa
      .from('daily_deals')
      .select(POTENTIAL_DEALS_COLUMNS)
      .eq('confidence', 'high')
      .gte('seller_feedback_score', 100)
      .gte('detected_at', cutoff)
      // TOPPS exclusion (case-insensitive) — no listing_title column
      // exists on daily_deals so this is the strongest filter we can
      // apply at the DB layer.
      .not('card_name', 'ilike', '%topps%')
      .not('set_name',  'ilike', '%topps%')
      // Require both fields the CTA needs to build a deep link.
      .not('ebay_item_id', 'is', null)
      .not('item_web_url', 'is', null)

    if (cardSlugFilter) {
      q = q.in('card_slug', cardSlugFilter)
    }

    q = q.order('discount_pct', { ascending: false }).limit(limit * 2)

    const { data, error } = await q
    if (error || !Array.isArray(data)) return []

    // Cast via `unknown` — PostgREST narrows .select(string) to
    // GenericStringError[] on the error branch; we've already ruled
    // that out.
    const rows = data as unknown as PotentialDeal[]

    // Dedupe by ebay_item_id (fallback to item_web_url) so the same
    // listing detected twice renders once.
    const seen = new Set<string>()
    const deduped: PotentialDeal[] = []
    for (const row of rows) {
      // Require both an id AND a URL to be present. The DB filter
      // already enforces this but a defensive JS check keeps the
      // CTA path safe if the schema drifts.
      if (row.ebay_item_id == null || !row.item_web_url) continue
      // ebay_item_id must be at least 6 digits — matches the deep-link
      // helper's parser.
      const idStr = String(row.ebay_item_id)
      if (!/^\d{6,}$/.test(idStr)) continue

      const key = idStr || String(row.item_web_url ?? '')
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

/** Load the current user's watchlist card_slugs — used to power the
 *  Watchlist tab. Returns `[]` on any error so the caller renders the
 *  empty state rather than crashing. */
export async function loadWatchlistSlugs(
  supa: SupabaseClient,
  userId: string,
): Promise<string[]> {
  if (!userId) return []
  try {
    const { data, error } = await supa
      .from('watchlist')
      .select('card_slug')
      .eq('user_id', userId)
    if (error || !Array.isArray(data)) return []
    const out: string[] = []
    for (const row of data as Array<{ card_slug: string | null }>) {
      if (row.card_slug) out.push(row.card_slug)
    }
    return out
  } catch {
    return []
  }
}

// Exported for tests + tuning.
export const MIN_EBAY_ITEM_ID_LENGTH = MIN_ITEM_ID_LENGTH
