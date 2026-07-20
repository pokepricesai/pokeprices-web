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
  // W43E — enriched from ebay_listings when a fresh matching row
  // exists. Optional so unit tests that construct daily_deals-only
  // fixtures don't have to boilerplate these into every row.
  title?:                string | null
  scraped_at?:           string | null
  buying_option?:        string | null
}

/** Columns the loader selects from `daily_deals`. Kept as a constant
 *  so the loader test can assert on the exact projection without
 *  restating the list. */
export const POTENTIAL_DEALS_COLUMNS =
  'card_slug, card_name, set_name, marketplace, total_cost_cents, currency, ' +
  'fair_value_cents, discount_pct, confidence, seller_feedback_score, ' +
  'item_web_url, item_image_url, condition, detected_at, ebay_item_id'

/** W43E — columns pulled from `ebay_listings` for enrichment. Every
 *  candidate deal is joined against ebay_listings by ebay_item_id so
 *  we can drop stale/sold candidates (via scraped_at) and swap in
 *  the fresher URL / title / buying_option. */
export const EBAY_LISTINGS_ENRICH_COLUMNS =
  'ebay_item_id, marketplace, title, buying_option, item_web_url, ' +
  'item_image_url, scraped_at, listed_date, match_confidence, ' +
  'seller_feedback_score, seller_feedback_pct, seller_country, ' +
  'currency, total_cost_cents, price_cents, shipping_cents, condition'

const DEFAULT_LIMIT       = 30
const MIN_ITEM_ID_LENGTH  = 6

/** W43C — realistic discount window. Outside this band a row is either
 *  (a) a straightforward market drop that our data isn't seeing (< 15%
 *  is already dropped by the producer) or (b) heavily correlated with
 *  fan art / wrong card / sold listing (> 30%). */
export const MIN_DISCOUNT_PCT = 15
export const MAX_DISCOUNT_PCT = 30

/** W43G — GBP→USD conversion factor. Mirrors the scraper's
 *  `detect_deals.py::USD_TO_GBP = 0.79` so the display-time coherence
 *  check reproduces the same math the scraper used at ingest.
 *  IMPORTANT: convert GBP cents → USD cents by DIVIDING by this value
 *  (matches `convert_to_usd_cents` in the scraper). */
export const SCRAPER_USD_TO_GBP = 0.79

/** W43G — convert a native-currency cents value to USD cents using the
 *  same rule as the scraper. Only GBP is handled (the only non-USD
 *  currency the scraper writes into daily_deals). Anything else is
 *  passed through unchanged. Returns null for null/negative input. */
export function toUsdCents(
  cents:    number | null | undefined,
  currency: string | null | undefined,
): number | null {
  if (cents == null || cents < 0) return null
  if (currency === 'GBP')          return Math.round(cents / SCRAPER_USD_TO_GBP)
  return cents
}

/** W43G — coherence check. Given a daily_deals row's total_cost_cents /
 *  currency / fair_value_cents / discount_pct, does the USD-basis math
 *  reproduce a ratio inside the scraper's ingest window ([0.30, 0.85])?
 *  If the recorded discount_pct claims "below market" but the numbers
 *  now imply "at or above market", the row is inconsistent and must
 *  not render a green "X% below" badge.
 *
 *  The RATIO window is the primary guard (it catches the exact bug
 *  pattern from W43F/G — a GBP price displayed against a USD market
 *  ref that, after conversion, is actually AT or ABOVE market). The
 *  tolerance check is a secondary paranoia guard; it defaults to 15pp
 *  so scraper cadence drift on the USD/GBP rate does not eat every
 *  row, but a Typhlosion-shaped bug (delta ≈ 20pp) still fails it. */
export function isDiscountCoherent(
  totalCostCents:  number | null | undefined,
  currency:        string | null | undefined,
  fairValueCents:  number | null | undefined,
  discountPct:     number | null | undefined,
  tolerancePct:    number = 15,
): boolean {
  if (
    typeof discountPct    !== 'number' ||
    typeof fairValueCents !== 'number' || fairValueCents <= 0
  ) return false
  const usd = toUsdCents(totalCostCents, currency)
  if (usd == null || usd <= 0) return false
  const computedRatio    = usd / fairValueCents
  const computedDiscount = (1 - computedRatio) * 100
  // Ratio must sit inside the scraper's ingest window (0.30..0.85).
  // A ratio > 0.85 means the row is not actually "below market" any
  // more, whatever discount_pct claims.
  if (computedRatio < 0.30 || computedRatio > 0.85)                   return false
  if (Math.abs(computedDiscount - discountPct) > tolerancePct)        return false
  return true
}

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

/** W43F — how far back an ebay_listings row can have been scraped
 *  and still count as "recently checked". 7 days matches the actual
 *  per-item cadence of the ebay_listings scraper. W43E's original
 *  36-hour window was aspirational and dropped 100% of otherwise-valid
 *  candidates (see the W43F diagnostic run against live data — the
 *  freshest matching listing for a given item was ~3 days old).
 *  We do NOT claim listings are active — the disclaimer says as much.
 *  Months-stale rows are still excluded. */
export function computeListingsCutoff(nowMs: number = Date.now()): string {
  return new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()
}

/** W43E — reusable "does this free-text field contain any junk term?"
 *  check. Shared by isJunkRow (daily_deals fields) and the title-junk
 *  post-filter (ebay_listings.title). */
export function containsJunkTerm(
  text: string | null | undefined,
  terms: readonly string[] = JUNK_TERMS,
): boolean {
  if (!text) return false
  const t = text.toLowerCase()
  for (const term of terms) {
    if (t.includes(term)) return true
  }
  return false
}

type EbayListingRow = {
  ebay_item_id:          string | number | null
  marketplace:           string | null
  title:                 string | null
  buying_option:         string | null
  item_web_url:          string | null
  item_image_url:        string | null
  scraped_at:            string | null
  listed_date:           string | null
  match_confidence:      string | null
  seller_feedback_score: number | null
  seller_feedback_pct:   number | null
  seller_country:        string | null
  currency:              string | null
  total_cost_cents:      number | null
  price_cents:           number | null
  shipping_cents:        number | null
  condition:             string | null
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

  const dealsCutoff = computeDealsCutoff()

  try {
    // ── Step A: daily_deals candidates ─────────────────────────────
    // Same filters as W43C — discount clamp, TOPPS/junk, item id/URL
    // presence, marketplace/host agreement. Over-fetch × 2 so Step B's
    // ebay_listings join has room to drop stale rows.
    let q: any = supa
      .from('daily_deals')
      .select(POTENTIAL_DEALS_COLUMNS)
      .eq('confidence', 'high')
      .gte('seller_feedback_score', 100)
      .gte('detected_at', dealsCutoff)
      .gte('discount_pct', MIN_DISCOUNT_PCT)
      .lte('discount_pct', MAX_DISCOUNT_PCT)
      .not('card_name', 'ilike', '%topps%')
      .not('set_name',  'ilike', '%topps%')
      .not('ebay_item_id', 'is', null)
      .not('item_web_url', 'is', null)

    if (cardSlugFilter) {
      q = q.in('card_slug', cardSlugFilter)
    }

    q = q.order('discount_pct', { ascending: false }).limit(limit * 2)

    const { data: dealsData, error: dealsError } = await q
    if (dealsError || !Array.isArray(dealsData)) return []

    const dealRows = dealsData as unknown as PotentialDeal[]

    // Filter candidates in JS. Same defensive checks as W43C. Keep
    // first occurrence per ebay_item_id so we can join by id in Step B.
    const candidates = new Map<string, PotentialDeal>()
    for (const row of dealRows) {
      if (row.ebay_item_id == null || !row.item_web_url) continue
      const idStr = String(row.ebay_item_id)
      if (!/^\d{6,}$/.test(idStr)) continue
      if (typeof row.discount_pct !== 'number') continue
      if (row.discount_pct < MIN_DISCOUNT_PCT || row.discount_pct > MAX_DISCOUNT_PCT) continue
      if (isJunkRow(row)) continue
      const expected = expectedHostFor(row.marketplace)
      if (!expected) continue
      try {
        const host = new URL(row.item_web_url).hostname.toLowerCase()
        if (host !== expected) continue
      } catch { continue }
      if (candidates.has(idStr)) continue
      candidates.set(idStr, row)
    }
    if (candidates.size === 0) return []

    // ── Step B: ebay_listings enrichment ────────────────────────────
    // W43E — join candidates against ebay_listings by ebay_item_id.
    // Requires match_confidence=high, buying_option=FIXED_PRICE,
    // seller_feedback_score ≥ 100, item_web_url non-null, AND
    // scraped_at within the last 7 days (W43F — matches the actual
    // per-item scrape cadence of the ebay_listings pipeline).
    const listingsCutoff = computeListingsCutoff()
    const candidateIds = Array.from(candidates.keys())
    const { data: listingsData } = await supa
      .from('ebay_listings')
      .select(EBAY_LISTINGS_ENRICH_COLUMNS)
      .in('ebay_item_id', candidateIds)
      .eq('match_confidence', 'high')
      .eq('buying_option',    'FIXED_PRICE')
      .gte('seller_feedback_score', 100)
      .gte('scraped_at', listingsCutoff)
      .not('item_web_url', 'is', null)

    const listings = Array.isArray(listingsData)
      ? (listingsData as unknown as EbayListingRow[])
      : []
    if (listings.length === 0) return []

    // Group listings by ebay_item_id — the same item can appear on
    // multiple marketplaces so we may have several entries per id.
    const listingsById = new Map<string, EbayListingRow[]>()
    for (const l of listings) {
      if (l.ebay_item_id == null) continue
      const idStr = String(l.ebay_item_id)
      const arr = listingsById.get(idStr) ?? []
      arr.push(l)
      listingsById.set(idStr, arr)
    }

    // W43G — enrich each candidate but preserve daily_deals as the
    // source of truth for every field that goes into the discount
    // claim (price, currency, marketplace, item_web_url,
    // fair_value_cents, discount_pct). ebay_listings only supplies
    // title / scraped_at / buying_option — fields that describe the
    // listing but don't affect the deal math.
    //
    // W43G REQUIRES a same-marketplace ebay_listings match. W43E's
    // "any-marketplace fallback" caused GBP-listing rows to render
    // under a USD-basis discount claim (the enriched output swapped
    // in a UK ebay_listings row when only the US daily_deals row
    // had computed the discount, leaving the displayed price and
    // discount_pct on different currency bases).
    const enriched: PotentialDeal[] = []
    const seenByIdMarket = new Set<string>()
    // Array.from() so ES5-target iteration works (matches how
    // PortfolioDashboard.tsx handles map iteration in this codebase).
    for (const [idStr, deal] of Array.from(candidates.entries())) {
      const available = listingsById.get(idStr) ?? []
      if (available.length === 0) continue

      // W43G — same-marketplace only. No fallback to available[0]:
      // a UK listing cannot validate a US-basis discount claim
      // (or vice versa).
      const match = available.find(l => l.marketplace === deal.marketplace)
      if (!match) continue

      // W43E — title junk filter (fan art / custom / topps / …).
      if (containsJunkTerm(match.title)) continue

      // W43G — coherence guard. Re-compute the discount from
      // daily_deals values using the scraper's own math; if the
      // recorded discount_pct no longer matches (stale rate,
      // corrupted row, currency drift), drop the candidate rather
      // than render a misleading badge.
      if (!isDiscountCoherent(
        deal.total_cost_cents, deal.currency,
        deal.fair_value_cents, deal.discount_pct,
      )) continue

      // Marketplace ↔ URL host must agree on the daily_deals values
      // (which are now the display source of truth).
      const finalMarketplace = deal.marketplace
      const finalUrl         = deal.item_web_url
      const expected = expectedHostFor(finalMarketplace)
      if (!expected) continue
      try {
        const host = new URL(finalUrl ?? '').hostname.toLowerCase()
        if (host !== expected) continue
      } catch { continue }

      // Dedupe by (ebay_item_id, marketplace). The same item across
      // UK and US would be two separate daily_deals rows anyway;
      // this guards against duplicate daily_deals entries for the
      // same (id, marketplace) pair.
      const key = `${idStr}::${finalMarketplace}`
      if (seenByIdMarket.has(key)) continue
      seenByIdMarket.add(key)

      enriched.push({
        // W43G — every field that feeds the discount claim comes
        // from daily_deals. No cross-currency / cross-marketplace
        // substitution.
        card_slug:             deal.card_slug,
        card_name:             deal.card_name,
        set_name:              deal.set_name,
        fair_value_cents:      deal.fair_value_cents,
        discount_pct:          deal.discount_pct,
        confidence:            deal.confidence,
        detected_at:           deal.detected_at,
        ebay_item_id:          deal.ebay_item_id,
        marketplace:           finalMarketplace,
        item_web_url:          finalUrl,
        currency:              deal.currency,
        total_cost_cents:      deal.total_cost_cents,
        // Only visual / low-risk fields fall back to ebay_listings.
        item_image_url:        deal.item_image_url ?? match.item_image_url,
        condition:             deal.condition      ?? match.condition,
        seller_feedback_score: deal.seller_feedback_score ?? match.seller_feedback_score,
        // Fields only present via ebay_listings.
        title:                 match.title ?? null,
        scraped_at:            match.scraped_at ?? null,
        buying_option:         match.buying_option ?? null,
      })
      if (enriched.length >= limit) break
    }
    return enriched
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
