// src/lib/seo-indexability/sitemapCards.ts
// Block 5A-W-35 — shared helper used by every sitemap-cards-*.xml
// route to emit only indexable card URLs (i.e. cards with at least
// one positive market-signal price on any grade tier).
//
// Two queries per batch:
//   1. cards[range]                              — the current sitemap query
//   2. daily_prices where card_slug IN cards[]   — filtered to any positive tier
//
// The card_slug in daily_prices is prefixed with "pc-" per the DB
// convention (CLAUDE.md); the join key is built accordingly.
//
// Scope note (see also cardIndexability.ts): the sitemap gate is a
// PRICE-SIGNAL gate. It does NOT consult recent_sales — that table is
// not part of the sitemap SELECT path, and route + sitemap must agree
// on the same stable signal. A recent-sales-derived indexability
// check is deferred to a possible W35B.
//
// If the market-signal query fails, the caller can decide whether to
// fail-open (emit unfiltered) or fail-closed (emit nothing). The
// current sitemap policy is fail-open — a transient DB error should
// not empty the sitemap.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MARKET_SIGNAL_PRICE_FIELDS } from './cardIndexability'

export type CardBatchRow = {
  card_url_slug: string
  set_name:      string
}

/** Max card_slugs per daily_prices .in() query. Supabase URL length
 *  limits get uncomfortable above ~500. */
const IN_CHUNK_SIZE = 500

const PRICE_OR_FILTER = MARKET_SIGNAL_PRICE_FIELDS.map(f => `${f}.gt.0`).join(',')

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

  for (let i = 0; i < dailyKeys.length; i += IN_CHUNK_SIZE) {
    const chunk = dailyKeys.slice(i, i + IN_CHUNK_SIZE)
    if (chunk.length === 0) continue
    const { data, error } = await supabase
      .from('daily_prices')
      .select('card_slug')
      .in('card_slug', chunk)
      .or(PRICE_OR_FILTER)
      .limit(chunk.length * 60)  // generous safety — bounded by chunk × recent days
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
