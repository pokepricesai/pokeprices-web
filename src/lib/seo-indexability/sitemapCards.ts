// src/lib/seo-indexability/sitemapCards.ts
// Block 5A-W-35 — shared helper used by every sitemap-cards-*.xml
// route to emit only indexable card URLs (i.e. cards with at least
// one positive market-signal price on any grade tier).
//
// Two queries per batch:
//   1. cards[range]                              — the current sitemap query
//   2. daily_prices where card_slug IN cards[]   — filtered to any positive
//      tier AND to the last RECENT_PRICE_WINDOW_DAYS of history
//
// The card_slug in daily_prices is prefixed with "pc-" per the DB
// convention (CLAUDE.md); the join key is built accordingly.
//
// Scope note (see also cardIndexability.ts): the sitemap gate is a
// PRICE-SIGNAL gate. It does NOT consult recent_sales — that table is
// not part of the sitemap SELECT path, and route + sitemap must agree
// on the same stable signal. A recent-sales-derived indexability
// check is deferred to a possible future block.
//
// If the market-signal query fails, the caller can decide whether to
// fail-open (emit unfiltered) or fail-closed (emit nothing). The
// current sitemap policy is fail-open — a transient DB error should
// not empty the sitemap.
//
// ─── Block 5A-W-35B — row-cap collision fix ────────────────────────
//
// The W35V verify block found the live sitemap collapsed from ~41k to
// 655 URLs. Root cause: without a date bound, each daily_prices chunk
// requested rows for 500 card_slugs across the full price history
// (~90+ days per card = ~45k+ rows per chunk). Supabase's PostgREST
// max-rows cap intercepted the response and returned the first ~1000
// rows, which were dominated by ~10 cards with long histories. The
// other 490 priced cards per chunk were silently invisible to the
// filter.
//
// Fix:
//   * Add a 7-day date lower bound on daily_prices.
//   * Reduce IN_CHUNK_SIZE from 500 → 100.
//   * Result: each response is bounded to ~chunk × 7 rows ≤ ~700 —
//     safely under any PostgREST cap and with broad card_slug
//     coverage per response.
//
// Trade-off: cards whose only positive prices are older than 7 days
// (scraper failure? off-boarded product?) fall out of the sitemap
// until they get a fresh row. Since the scraper runs nightly, this
// is acceptable — anything stale >7 days is a lead-indicator of a
// data problem, not a legitimate active card page.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MARKET_SIGNAL_PRICE_FIELDS } from './cardIndexability'

export type CardBatchRow = {
  card_url_slug: string
  set_name:      string
}

/**
 * Block 5A-W-35B — smaller chunk so `chunk × recent-days` stays well
 * under any PostgREST max-rows cap even when priced cards have full
 * daily history in the recent window.
 */
const IN_CHUNK_SIZE = 100

/**
 * Rolling window we consider for "recent" price signals. Scraper runs
 * nightly; 7 days is a comfortable buffer for a missed run or two.
 * A card with no positive price in the last 7 days falls out of the
 * sitemap until it gets fresh data.
 */
export const RECENT_PRICE_WINDOW_DAYS = 7

const PRICE_OR_FILTER = MARKET_SIGNAL_PRICE_FIELDS.map(f => `${f}.gt.0`).join(',')

/** ISO yyyy-mm-dd for `now - RECENT_PRICE_WINDOW_DAYS`. Extracted so
 *  tests can pin the exact string the helper sends to Supabase. */
export function recentPriceLowerBound(now: Date = new Date()): string {
  const ms   = now.getTime() - RECENT_PRICE_WINDOW_DAYS * 24 * 3600 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

export type SitemapFetchResult = {
  cards:         CardBatchRow[]
  totalScanned:  number
  totalEmitted:  number
  /** True if the market-signal query failed and the batch fell back
   *  to unfiltered emission. Recorded so callers can log it. */
  filteringSkipped: boolean
  errorNote?:    string
}

/**
 * Fetch cards in [start, end) and return only the URLs whose latest
 * (or any) daily_prices row has a positive USD value on any tracked
 * grade tier.
 */
export async function fetchIndexableCardBatch(
  supabase: SupabaseClient,
  start: number,
  end:   number,
  pageSize = 1000,
): Promise<SitemapFetchResult> {
  type CardRow = { card_slug: string | null; card_url_slug: string | null; set_name: string | null }
  const allCards: CardRow[] = []

  for (let offset = start; offset < end; offset += pageSize) {
    const { data, error } = await supabase
      .from('cards')
      .select('card_slug, card_url_slug, set_name')
      .not('card_url_slug', 'is', null)
      .not('set_name',      'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) {
      return {
        cards:         [],
        totalScanned:  allCards.length,
        totalEmitted:  0,
        filteringSkipped: true,
        errorNote:     `cards fetch failed at offset ${offset}: ${error.message}`,
      }
    }
    if (!data || data.length === 0) break
    allCards.push(...(data as CardRow[]))
    if (data.length < pageSize) break
  }

  // Build the pc-prefixed key list.
  const dailyKeys: string[] = []
  const cardsWithKeys: Array<CardRow & { dailyKey: string | null }> = []
  for (const c of allCards) {
    const key = c.card_slug ? `pc-${c.card_slug}` : null
    cardsWithKeys.push({ ...c, dailyKey: key })
    if (key) dailyKeys.push(key)
  }

  const withSignal = new Set<string>()
  let filteringSkipped = false
  let errorNote: string | undefined

  // Block 5A-W-35B — computed once so every chunk sees the same window
  // and tests can pin the value.
  const recentSince = recentPriceLowerBound()

  for (let i = 0; i < dailyKeys.length; i += IN_CHUNK_SIZE) {
    const chunk = dailyKeys.slice(i, i + IN_CHUNK_SIZE)
    if (chunk.length === 0) continue
    const { data, error } = await supabase
      .from('daily_prices')
      .select('card_slug')
      .in('card_slug', chunk)
      // Block 5A-W-35B — bound by date so each response is at most
      // chunk × RECENT_PRICE_WINDOW_DAYS rows, safely under any
      // PostgREST max-rows cap.
      .gte('date', recentSince)
      .or(PRICE_OR_FILTER)
      // + 1 buffer day; the date bound is the real limiter now.
      .limit(chunk.length * (RECENT_PRICE_WINDOW_DAYS + 1))
    if (error) {
      // Fail-open: don't strand the sitemap on a transient DB error.
      // The route logs the note and keeps the pre-W35 behaviour of
      // emitting every card with a URL slug.
      filteringSkipped = true
      errorNote = `daily_prices fetch failed: ${error.message}`
      break
    }
    for (const row of (data ?? []) as Array<{ card_slug: string }>) {
      if (row.card_slug) withSignal.add(row.card_slug)
    }
  }

  const emitted: CardBatchRow[] = []
  for (const c of cardsWithKeys) {
    if (!c.card_url_slug || !c.set_name) continue
    if (filteringSkipped) {
      // Fail-open: emit unfiltered.
      emitted.push({ card_url_slug: c.card_url_slug, set_name: c.set_name })
      continue
    }
    if (!c.dailyKey) continue                    // no card_slug = no way to check
    if (!withSignal.has(c.dailyKey)) continue    // no positive price on any tier
    emitted.push({ card_url_slug: c.card_url_slug, set_name: c.set_name })
  }

  return {
    cards:            emitted,
    totalScanned:     cardsWithKeys.length,
    totalEmitted:     emitted.length,
    filteringSkipped,
    errorNote,
  }
}

/**
 * Render the final <urlset>...</urlset> XML string for a card batch.
 * Kept here so all 4 sitemap-cards routes share identical output.
 */
export function renderCardSitemapXml(
  baseUrl: string,
  cards:   CardBatchRow[],
): string {
  const now = new Date().toISOString()
  const urls = cards
    .map(c =>
      '  <url>\n    <loc>' + baseUrl + '/set/' + encodeURIComponent(c.set_name) + '/card/' + c.card_url_slug +
      '</loc>\n    <lastmod>' + now + '</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>'
    )
    .join('\n')
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>'
}
