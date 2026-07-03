// src/lib/dashboard/potentialDeals.ts
//
// Block 5A-W-43A / 5A-W-43B / 5A-W-43C — read-only loader for the
// dashboard's "Potential eBay deals" Pro section.
//
// Reads from the shared `daily_deals` table (populated nightly by the
// sister scraper repo's detect_deals.py; producer deletes rows older
// than 1 day). This loader applies STRICTER filters than the producer
// so the dashboard shows only the safest subset:
//
//   * confidence          = 'high'   (drops the producer's 'medium' floor)
//   * seller_feedback_score >= 100   (raises the producer's 50 floor)
//   * discount_pct        in [15, 30] — W43C (see below)
//   * detected_at within the last 48h (covers "today's run + yesterday"
//                                     across timezones)
//   * item_web_url + ebay_item_id   both non-null — required for the
//                                     CTA to be a valid deep link
//   * card_name + set_name          exclude any row mentioning TOPPS
//                                     (case-insensitive)
//   * card_name + set_name + condition   defensive JS post-filter
//                                     against the JUNK_TERMS list
//                                     (fan art / custom / replica /
//                                     reprint / etc. — W43C)
//   * marketplace + URL domain     must agree (defensive; the CTA
//                                     builder also cross-checks so
//                                     bad rows never emit a link).
//
// W43C — DISCOUNT RANGE
//   Listings more than ~30% below market are heavily correlated with
//   sold / wrong-card / fan-art / fake matches. The narrow 15–30%
//   window is what human reviewers would consider "plausible eBay
//   deal" territory. The producer already enforces ≥15% at ingest.
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

/** W43C — realistic discount window. Outside this band a row is either
 *  (a) a straightforward market drop that our data isn't seeing (< 15%
 *  is already dropped by the producer) or (b) heavily correlated with
 *  fan art / wrong card / sold listing (> 30%). */
export const MIN_DISCOUNT_PCT = 15
export const MAX_DISCOUNT_PCT = 30

/** W43C — junk-term list checked against every row's card_name +
 *  set_name + condition (case-insensitive). Some entries duplicate
 *  the DB-side TOPPS filter — kept for defence in depth if the DB
 *  filter is ever loosened. */
export const JUNK_TERMS: readonly string[] = [
  'topps',
  'fan art',
  'custom',
  'proxy',
  'replica',
  'reprint',
  'metal card',
  'gold plated',
  'handmade',
  'extended art',
  'artwork',
  'sticker',
  'coin',
  'jumbo',
  'oversized',
  'empty',
  'no cards',
  'case only',
  'box only',
  'pick your card',
  'u pick',
]

/** W43C — normalise a daily_deals.marketplace value to the eBay item
 *  URL host we expect. Anything unrecognised returns null and the row
 *  is dropped (CTA cannot be built safely). */
function expectedHostFor(marketplace: string | null | undefined): string | null {
  if (marketplace === 'EBAY_GB') return 'www.ebay.co.uk'
  if (marketplace === 'EBAY_US') return 'www.ebay.com'
  return null
}

/** W43C — true when the row's card_name / set_name / condition contain
 *  any junk term. Case-insensitive substring match. */
export function isJunkRow(row: PotentialDeal, terms: readonly string[] = JUNK_TERMS): boolean {
  const blob = `${row.card_name ?? ''} ${row.set_name ?? ''} ${row.condition ?? ''}`.toLowerCase()
  for (const t of terms) {
    if (blob.includes(t)) return true
  }
  return false
}

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
      // W43C — discount window. The producer already enforces >=15%
      // at ingest; the upper bound drops rows that are almost always
      // sold / wrong-card / fan art / fake in practice.
      .gte('discount_pct', MIN_DISCOUNT_PCT)
      .lte('discount_pct', MAX_DISCOUNT_PCT)
      // TOPPS exclusion (case-insensitive) — no listing_title column
      // exists on daily_deals so this is the strongest filter we can
      // apply at the DB layer. Additional junk terms are filtered
      // defensively in JS below via JUNK_TERMS.
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

    // Dedupe by ebay_item_id (fallback to item_web_url) + defensive
    // quality gate. Each guard has a matching DB-side filter above;
    // the JS mirror keeps the CTA path safe if the schema drifts or a
    // race exposes a stale row.
    const seen = new Set<string>()
    const deduped: PotentialDeal[] = []
    for (const row of rows) {
      // W43B — require both an id AND a URL to be present.
      if (row.ebay_item_id == null || !row.item_web_url) continue

      // W43B — ebay_item_id must be at least 6 digits (matches the
      // deep-link helper's parser).
      const idStr = String(row.ebay_item_id)
      if (!/^\d{6,}$/.test(idStr)) continue

      // W43C — discount clamp. DB does the same but a defensive JS
      // check catches any decimal drift on the boundary.
      if (typeof row.discount_pct !== 'number') continue
      if (row.discount_pct < MIN_DISCOUNT_PCT || row.discount_pct > MAX_DISCOUNT_PCT) continue

      // W43C — junk term filter over card_name / set_name / condition.
      if (isJunkRow(row)) continue

      // W43C — marketplace ↔ item URL host must agree. A row that
      // claims marketplace=EBAY_GB but carries an ebay.com URL is a
      // data bug; the CTA builder would still block it but we drop
      // it here so it never counts against the visible window.
      const expected = expectedHostFor(row.marketplace)
      if (expected) {
        let host: string | null = null
        try { host = new URL(row.item_web_url).hostname.toLowerCase() } catch { host = null }
        if (host !== expected) continue
      } else {
        // Unrecognised marketplace value — cannot build a safe CTA.
        continue
      }

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
